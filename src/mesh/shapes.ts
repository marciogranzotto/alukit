import { cosDeg, sinDeg } from "#core/trig.ts";
import type { ViewShape } from "./model.ts";
import type { P2 } from "./outline.ts";

/**
 * The project's own items as prisms (design §4.8): a ring in one plane of the item's frame,
 * extruded along the third axis. `items.ts` builds their meshes from it and `extent.ts` their
 * points, so the box `bbox()` measures (§4.9) is the shape the viewer and the GLB draw. No
 * three.js, so the checks may use it.
 *
 * - A plate: its outline in x and y, extruded along z through its thickness.
 * - A bent angle: its section in y and z (an L with the bend's inside and outside arcs), extruded
 *   along x for its length.
 */

/** Chords per bend arc: 90° in 8 steps of 11.25° stays under the edge angle, so it draws smooth. */
export const ARC_SEGMENTS = 8;

export type Axis = 0 | 1 | 2;

type AngleShape = Extract<ViewShape, { kind: "bent-angle" }>;

/**
 * A shape as a prism: the ring in the (u, v) plane, extruded along w from 0 to `depth`. `axes`
 * says which of the item's x, y and z each of u, v and w is; it is an even permutation, so that a
 * counter-clockwise ring stays counter-clockwise seen from +w.
 */
export interface Prism {
  ring: P2[];
  depth: number;
  axes: readonly [Axis, Axis, Axis];
}

/** Twice the signed area of a ring: positive when it runs counter-clockwise. */
export function area2(ring: readonly P2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j] as P2;
    const q = ring[i] as P2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/** A ring with no corner repeated next to itself (nor the last as the first), counter-clockwise. */
export function cleanRing(ring: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return area2(out) < 0 ? out.reverse() : out;
}

/**
 * A bent angle's section in the plane of its legs, u along leg a (the item's y) and v along leg b
 * (its z), counter-clockwise: from leg a's free edge up to its inside face, round the inside arc
 * (radius R) to leg b's inside face, out to leg b's free edge, down its outside face and round the
 * outside arc (radius R + T) back to leg a's outside face. With R = 0 the inside arc is a corner.
 */
export function angleSection(s: AngleShape): P2[] {
  const [A, B] = s.legs;
  const T = s.thickness;
  const R = s.radius;
  const c = R + T;
  const arc = (r: number, from: number, to: number): P2[] =>
    Array.from({ length: ARC_SEGMENTS + 1 }, (_, i) => {
      const deg = from + ((to - from) * i) / ARC_SEGMENTS;
      return [c + r * cosDeg(deg), c + r * sinDeg(deg)] as P2;
    });
  return [
    [A, 0],
    [A, T],
    ...(R > 0 ? arc(R, 270, 180) : [[T, T] as P2]),
    [T, B],
    [0, B],
    ...arc(c, 180, 270),
  ];
}

/** A plate's outline extruded along z; a bent angle's section along x (u → y, v → z, w → x). */
export function shapePrism(s: ViewShape): Prism {
  return s.kind === "plate"
    ? { ring: cleanRing(s.outline), depth: s.thickness, axes: [0, 1, 2] }
    : { ring: cleanRing(angleSection(s)), depth: s.length, axes: [1, 2, 0] };
}
