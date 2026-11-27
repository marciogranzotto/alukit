import type { BarJson, V3 } from "../mesh/model.ts";
import type { Hit } from "./scene.ts";
import { type Face, type P2, q, type Ray } from "./snap.ts";

/**
 * What a pick lands on, found analytically from the derived model, as snapping is (design §8;
 * docs/ux/editing-audit.md E0.3): the viewer's raycast says which body is under the pointer and
 * where, and this says which face of a bar the pointer's ray enters (a side of its placed box, or
 * an end plane) and the station there, along the bar from its design point a. The body is the
 * box between its two end planes (each through the end's point, square to its normal, so an
 * angled end is cut as derive cuts it). Pure: a test needs no renderer.
 */

export type HitFace = Face | "a" | "b";

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const neg = (a: V3): V3 => [0 - a[0], 0 - a[1], 0 - a[2]];
const addScaled = (a: V3, b: V3, s: number): V3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];

/** One of the body's six bounding planes: a point on it and its outward normal. */
interface Bound {
  face: HitFace;
  at: V3;
  n: V3;
}

function bounds(bar: BarJson): Bound[] {
  const { x, y } = bar.frame;
  const [[x0, y0], [x1, y1]] = bar.box_mm;
  return [
    { face: "+x", at: addScaled(bar.a, x, x1), n: x },
    { face: "-x", at: addScaled(bar.a, x, x0), n: neg(x) },
    { face: "+y", at: addScaled(bar.a, y, y1), n: y },
    { face: "-y", at: addScaled(bar.a, y, y0), n: neg(y) },
    { face: "a", at: bar.ends.a.point, n: bar.ends.a.normal },
    { face: "b", at: bar.ends.b.point, n: bar.ends.b.normal },
  ];
}

/**
 * Where a ray enters a bar's body (Cyrus–Beck: the ray against each bounding half-space): the
 * face, the point, its outward normal, and the station, clamped to the bar's design length.
 */
export function barHit(
  ray: Ray,
  bar: BarJson,
): { face: HitFace; p: V3; normal: V3; at_mm: number } | undefined {
  let enter = -Infinity;
  let exit = Infinity;
  let entered: Bound | undefined;
  for (const b of bounds(bar)) {
    const num = dot(sub(b.at, ray.o), b.n);
    const den = dot(ray.d, b.n);
    if (Math.abs(den) < 1e-12) {
      // Parallel to the plane: outside it, it never comes in.
      if (num < 0) return undefined;
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > enter) {
        enter = t;
        entered = b;
      }
    } else exit = Math.min(exit, t);
  }
  if (!entered || enter > exit || exit < 0) return undefined;
  const p = addScaled(ray.o, ray.d, Math.max(enter, 0));
  const s = dot(sub(p, bar.a), bar.frame.z);
  return {
    face: entered.face,
    p,
    normal: entered.n,
    at_mm: q(Math.min(Math.max(s, 0), bar.len_mm)),
  };
}

/**
 * The hit on body `id` at `p` (the raycast's point, with the mesh's normal there): on a bar, the
 * face, normal and station its ray enters by; on anything else, the raycast's alone.
 */
export function hitOn(
  bars: Readonly<Record<string, BarJson>>,
  id: string,
  ray: Ray,
  p: V3,
  normal: V3,
): Hit {
  const bar = bars[id];
  const h = bar ? barHit(ray, bar) : undefined;
  if (!h) return { id, p, normal };
  return { id, p, normal: h.normal, face: h.face, station: { bar: id, at_mm: h.at_mm } };
}

// ---------------------------------------------------------------------------------------------
// Box selection (docs/ux/editing-audit.md E-UX-10, E2.3): a window takes what lies wholly inside
// the box, a crossing what it touches. A body is the outline its corners project to: the convex
// hull of a box's eight corners is exactly the box's silhouette, in either projection.

/** A rectangle on the page, CSS pixels: x0 ≤ x1, y0 ≤ y1. */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** z of (a − o) × (b − o): positive when o, a, b turn one way, negative the other, 0 in a line. */
const turn = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** The convex hull of some points, in order round it (Andrew's monotone chain). */
export function convexHull(pts: readonly P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length <= 2) return p;
  const half = (list: readonly P2[]) => {
    const out: P2[] = [];
    for (const x of list) {
      while (out.length >= 2 && turn(out[out.length - 2] as P2, out[out.length - 1] as P2, x) <= 0)
        out.pop();
      out.push(x);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

const insideRect = (p: P2, r: ScreenRect) =>
  p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;

/** Whether a point lies in a convex polygon given in order round it (on an edge counts). */
function insideHull(p: P2, hull: readonly P2[]): boolean {
  if (hull.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < hull.length; i++) {
    const t = turn(hull[i] as P2, hull[(i + 1) % hull.length] as P2, p);
    if (t === 0) continue;
    if (sign === 0) sign = Math.sign(t);
    else if (Math.sign(t) !== sign) return false;
  }
  return true;
}

/** Whether two segments meet, touching included. */
function segmentsMeet(a: P2, b: P2, c: P2, d: P2): boolean {
  const d1 = turn(c, d, a);
  const d2 = turn(c, d, b);
  const d3 = turn(a, b, c);
  const d4 = turn(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  const on = (p: P2, q1: P2, q2: P2) =>
    Math.min(q1[0], q2[0]) <= p[0] &&
    p[0] <= Math.max(q1[0], q2[0]) &&
    Math.min(q1[1], q2[1]) <= p[1] &&
    p[1] <= Math.max(q1[1], q2[1]);
  return (
    (d1 === 0 && on(a, c, d)) ||
    (d2 === 0 && on(b, c, d)) ||
    (d3 === 0 && on(c, a, b)) ||
    (d4 === 0 && on(d, a, b))
  );
}

/**
 * Whether a box drawn on the screen takes a body whose corners project to `pts`: as a window,
 * when every corner is inside it; as a crossing, when the body's outline touches it (a corner
 * inside the box, a corner of the box inside the outline, or an edge of each crossing). Pure.
 */
export function boxTakes(pts: readonly P2[], r: ScreenRect, mode: "window" | "crossing"): boolean {
  if (pts.length === 0) return false;
  if (mode === "window") return pts.every((p) => insideRect(p, r));
  const hull = convexHull(pts);
  if (hull.some((p) => insideRect(p, r))) return true;
  const box: P2[] = [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x1, r.y1],
    [r.x0, r.y1],
  ];
  if (box.some((p) => insideHull(p, hull))) return true;
  const edges = (poly: readonly P2[]) =>
    poly.length < 2 ? [] : poly.map((p, i) => [p, poly[(i + 1) % poly.length] as P2] as const);
  for (const [a, b] of edges(hull))
    for (const [c, d] of edges(box)) if (segmentsMeet(a, b, c, d)) return true;
  return false;
}
