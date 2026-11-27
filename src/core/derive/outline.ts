import type { BuiltSection } from "#catalog/link.ts";
import type { Face } from "../project/schema.ts";
import type { Ring, Vec2 } from "../section-properties.ts";
import { TOL } from "../tolerances.ts";
import { angleDeg } from "../vec.ts";

/**
 * A section's faces for face connections (design §4.5, gap A3), in section coordinates.
 *
 * A bar's **bounding faces** are its bounding box's four sides, whole: the faces §4.3 names and
 * cuts and stations use. A T-slot's grooved side, an RHS's radiused side and a round bar's
 * tangent plane all bear on them, so they keep that meaning here, and derive builds them from the
 * box, not from this module.
 *
 * A bar's **inner faces** are the straight runs of its outline's outer ring that lie off its four
 * sides: an angle's inside leg faces, a channel's inner flange and web faces, a beam's. The sides
 * here are the outline's own extremes, not the nominal box: an exact outline drawn on a drawing's
 * stroke centreline sits a few hundredths of a millimetre inside its box, and its outer faces are
 * still its sides. Holes (a tube's bore, a T-slot's core and cavities) are not faces: a layer
 * inside a hollow one is out of scope.
 *
 * On a side where the section declares a groove, every excursion of the outline from that side
 * and back to it is part of the face: the grooves themselves and any marks rolled into the face.
 * They are closed along the side before the inner faces are taken, so a T-slot has none, and a
 * bolt across a groove bears on the side's plane. An excursion from an ungrooved side, such as a
 * channel's open side, stays open: its walls are the channel's inner faces.
 */

export interface OutlineFace {
  /** Outward unit normal. */
  n: Vec2;
  /** The face's ends, in ring order (counter-clockwise). */
  a: Vec2;
  b: Vec2;
  /**
   * How derive reports it: the side it faces and the plane's section coordinate (`+x@-31.75`), or
   * for an oblique face its normal and the plane's distance from the origin
   * (`[0.7071,0.7071]@12.34`).
   */
  name: string;
}

export interface OutlineFaces {
  /** The outer ring, counter-clockwise, with every grooved side's excursions closed. */
  ring: Vec2[];
  /** The inner faces, in ring order. */
  inner: OutlineFace[];
  /** The inner faces' indices by their normal's diamond angle, for `innerFacing`. */
  byNormal: readonly { p: number; k: number }[];
}

interface Side {
  face: Face;
  n: Vec2;
  axis: 0 | 1;
  max: boolean;
}

const SIDES: readonly Side[] = [
  { face: "+x", n: [1, 0], axis: 0, max: true },
  { face: "-x", n: [-1, 0], axis: 0, max: false },
  { face: "+y", n: [0, 1], axis: 1, max: true },
  { face: "-y", n: [0, -1], axis: 1, max: false },
];

const fmt = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
const v3 = (v: Vec2) => [v[0], v[1], 0] as const;

/** Two directions within `tol.ang` of each other. */
function same(a: Vec2, b: Vec2): boolean {
  // A cheap, loose rejection first: the angle test decides.
  if (a[0] * b[0] + a[1] * b[1] < 0.99) return false;
  return angleDeg(v3(a), v3(b)) <= TOL.ang;
}

function signedArea(r: Ring): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i] as Vec2;
    const [x1, y1] = r[(i + 1) % r.length] as Vec2;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/**
 * Closes the excursions of a counter-clockwise ring from one side of its box and back to it: each
 * chain of vertices off the side between two on it, when the second lies further along the side
 * than the first (the ring runs along a side in the direction of its normal turned +90°). The
 * chain from the side's last vertex round the rest of the section back to its first runs the other
 * way, so it is kept.
 */
function closeSide(ring: Vec2[], side: Side, at: number): Vec2[] {
  const on = (p: Vec2) => Math.abs(p[side.axis] - at) <= TOL.len;
  const along: Vec2 = [-side.n[1], side.n[0]];
  const idx: number[] = [];
  for (const [i, p] of ring.entries()) if (on(p)) idx.push(i);
  if (idx.length < 2) return ring;
  const N = ring.length;
  const drop = new Set<number>();
  for (const [k, i] of idx.entries()) {
    const j = idx[(k + 1) % idx.length] as number;
    const steps = (j - i + N) % N;
    if (steps <= 1) continue;
    const p = ring[i] as Vec2;
    const q = ring[j] as Vec2;
    if ((q[0] - p[0]) * along[0] + (q[1] - p[1]) * along[1] <= TOL.len) continue;
    for (let m = 1; m < steps; m++) drop.add((i + m) % N);
  }
  return drop.size === 0 ? ring : ring.filter((_, i) => !drop.has(i));
}

function faceName(n: Vec2, a: Vec2, b: Vec2): string {
  const side = SIDES.find((s) => same(n, s.n));
  if (side) return `${side.face}@${fmt((a[side.axis] + b[side.axis]) / 2)}`;
  const c = n[0] * a[0] + n[1] * a[1];
  return `[${n[0].toFixed(4)},${n[1].toFixed(4)}]@${fmt(c)}`;
}

/** The faces of a section (above), from its drawn outline and its grooves. */
export function sectionOutlineFaces(s: {
  draw: { outline: Ring };
  grooves: readonly { face: Face }[];
}): OutlineFaces {
  let ring = [...s.draw.outline];
  if (signedArea(ring) < 0) ring.reverse();
  const lo: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const hi: [number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const p of ring) {
    for (const k of [0, 1] as const) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  const value = (side: Side) => (side.max ? hi : lo)[side.axis];
  for (const side of SIDES) {
    if (s.grooves.some((g) => g.face === side.face)) ring = closeSide(ring, side, value(side));
  }

  // Edges, each with its direction and outward normal (the direction turned −90°).
  const edges: { p: Vec2; q: Vec2; dir: Vec2 }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % ring.length] as Vec2;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    edges.push({ p, q, dir: [dx / len, dy / len] });
  }
  // Straight runs: consecutive edges along the run's first direction. Start where the direction
  // turns, so that no run wraps past the ring's first vertex.
  const n = edges.length;
  let start = 0;
  while (
    start < n &&
    same(
      (edges[(start - 1 + n) % n] as (typeof edges)[0]).dir,
      (edges[start] as (typeof edges)[0]).dir,
    )
  )
    start++;
  if (start === n) start = 0;
  const inner: OutlineFace[] = [];
  for (let k = 0; k < n; ) {
    const first = edges[(start + k) % n] as (typeof edges)[0];
    let last = first;
    k++;
    while (k < n && same(first.dir, (edges[(start + k) % n] as (typeof edges)[0]).dir)) {
      last = edges[(start + k) % n] as (typeof edges)[0];
      k++;
    }
    const a = first.p;
    const b = last.q;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const nrm: Vec2 = [dy / len, -dx / len];
    const onSide = SIDES.some(
      (side) =>
        same(nrm, side.n) &&
        Math.abs(a[side.axis] - value(side)) <= TOL.len &&
        Math.abs(b[side.axis] - value(side)) <= TOL.len,
    );
    if (!onSide) inner.push({ n: nrm, a, b, name: faceName(nrm, a, b) });
  }
  const byNormal = inner
    .map((f, k) => ({ p: diamond(f.n), k }))
    .sort((x, y) => x.p - y.p || x.k - y.k);
  return { ring, inner, byNormal };
}

/**
 * A direction's diamond angle, in [0, 4): it grows with the direction's true angle, never faster
 * than one per radian, and takes only arithmetic (§5.2).
 */
function diamond([x, y]: Vec2): number {
  if (y >= 0) return x >= 0 ? y / (x + y) : 1 - x / (-x + y);
  return x < 0 ? 2 - y / (-x - y) : 3 + x / (x - y);
}

/**
 * The inner faces whose outward normal lies within `window` radians of the unit direction `n`,
 * by index in face order: a superset of those within tol.ang, which the caller's angle test
 * decides. A section with radii has hundreds of faces, nearly all arc chords.
 */
export function innerFacing(f: OutlineFaces, n: Vec2, window = 1e-3): number[] {
  const p = diamond(n);
  const idx = f.byNormal;
  const first = (v: number) => {
    let lo = 0;
    let hi = idx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((idx[mid] as { p: number }).p < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const out: number[] = [];
  const take = (lo: number, hi: number) => {
    for (let i = first(lo); i < idx.length && (idx[i] as { p: number }).p <= hi; i++)
      out.push((idx[i] as { k: number }).k);
  };
  take(p - window, p + window);
  if (p - window < 0) take(p - window + 4, 4);
  if (p + window >= 4) take(0, p + window - 4);
  return out.sort((a, b) => a - b);
}

const cache = new WeakMap<BuiltSection, OutlineFaces>();

/** A built section's faces, worked out once per section. */
export function outlineFaces(section: BuiltSection): OutlineFaces {
  let f = cache.get(section);
  if (!f) {
    f = sectionOutlineFaces(section);
    cache.set(section, f);
  }
  return f;
}

/**
 * Where the line o + w·d lies inside a ring: the intervals of w, in order. A vertex on the line
 * counts as being on its negative side, so a line through a vertex or along an edge still crosses
 * the ring an even number of times.
 */
export function materialAlong(ring: Ring, o: Vec2, d: Vec2): [number, number][] {
  const side = (p: Vec2) => d[0] * (p[1] - o[1]) - d[1] * (p[0] - o[0]);
  const ws: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % ring.length] as Vec2;
    const sp = side(p);
    const sq = side(q);
    if (sp > 0 === sq > 0) continue;
    const t = sp / (sp - sq);
    const x = p[0] + (q[0] - p[0]) * t;
    const y = p[1] + (q[1] - p[1]) * t;
    ws.push((x - o[0]) * d[0] + (y - o[1]) * d[1]);
  }
  ws.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ws.length; i += 2) out.push([ws[i] as number, ws[i + 1] as number]);
  return out;
}
