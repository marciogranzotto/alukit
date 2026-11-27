import type { BarJson, V3 } from "../mesh/model.ts";
import type { Hit } from "./scene.ts";
import { type Face, q, type Ray } from "./snap.ts";

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
