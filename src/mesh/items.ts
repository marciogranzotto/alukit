import { type BufferGeometry, ExtrudeGeometry, Matrix4, Shape, Vector2 } from "three";
import type { V3, ViewHole, ViewShape } from "./model.ts";

/**
 * Meshes of the project's own plates and bent angles (design §4.8, §8). Node-safe, like
 * `bars.ts`: three's geometry classes only. Everything is in the item's own frame (§3.2): +z away
 * from the face it mounts on, +x along the bar it mounts on.
 *
 * - A plate: its outline extruded from z = 0 to its thickness.
 * - A bent angle: its section, an L with the bend's inside and outside arcs (radii R and R + T
 *   about one centre, R + T from each outside face), extruded along x for its length. Leg a lies
 *   on the mounting face along +y; leg b rises along +z. Its box is [0, 0, 0] to [length, a, b].
 * - Holes are marked, not cut: a rod of the drill's diameter through the material, or as deep as
 *   a blind hole, and a wider one for a countersink's or a counterbore's mouth, each standing
 *   proud of the face it shows on.
 */

/** How far a hole's marker stands proud of a face, so it shows (mm). */
export const MARK_PROUD_MM = 0.5;

/** Segments per bend arc: 90° in 8 steps stays under the edge angle, so the bend draws smooth. */
const ARC_SEGMENTS = 8;

type PlateShape = Extract<ViewShape, { kind: "plate" }>;
type AngleShape = Extract<ViewShape, { kind: "bent-angle" }>;

export function plateGeometry(s: PlateShape): BufferGeometry {
  const shape = new Shape(s.outline.map(([x, y]) => new Vector2(x, y)));
  const g = new ExtrudeGeometry(shape, {
    depth: s.thickness,
    steps: 1,
    bevelEnabled: false,
  });
  g.deleteAttribute("uv");
  return g;
}

/**
 * A bent angle's section in the plane of its legs, u along leg a (the item's y) and v along leg b
 * (its z). It starts at leg a's free edge and lets each arc add the line to its own start, so no
 * corner is written twice, and closes back along leg a's outside face.
 */
export function angleSection(s: AngleShape): Shape {
  const [A, B] = s.legs;
  const T = s.thickness;
  const R = s.radius;
  const c = R + T;
  const shape = new Shape();
  shape.moveTo(A, 0);
  shape.lineTo(A, T);
  // Leg a's inside face, then the inside arc (radius R) round to leg b's inside face.
  if (R > 0) shape.absarc(c, c, R, -Math.PI / 2, -Math.PI, true);
  else shape.lineTo(T, T);
  shape.lineTo(T, B);
  shape.lineTo(0, B);
  // Leg b's outside face, then the outside arc (radius R + T) round to leg a's outside face.
  shape.absarc(c, c, c, Math.PI, 1.5 * Math.PI, false);
  return shape;
}

/** Section plane (u, v, extrusion w) onto the item's frame: x = w, y = u, z = v. */
const SECTION_TO_ITEM = new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);

export function angleGeometry(s: AngleShape): BufferGeometry {
  const g = new ExtrudeGeometry(angleSection(s), {
    depth: s.length,
    steps: 1,
    bevelEnabled: false,
    curveSegments: ARC_SEGMENTS,
  });
  g.deleteAttribute("uv");
  g.applyMatrix4(SECTION_TO_ITEM);
  return g;
}

export function itemGeometry(s: ViewShape): BufferGeometry {
  return s.kind === "plate" ? plateGeometry(s) : angleGeometry(s);
}

/** A hole's marker: a rod about `centre` along `axis`, `len` long and `d` across. */
export interface HoleMark {
  centre: V3;
  axis: V3;
  len: number;
  d: number;
}

/**
 * Where a hole crosses the material: its centre line's point on the back face, and the unit
 * normal from there toward the front face. A plate's and leg a's back face is z = 0 (the face
 * the part mounts on), leg b's is y = 0 (its outside face).
 */
function holeLine(s: ViewShape, h: ViewHole): { base: V3; n: V3 } {
  if (s.kind === "bent-angle" && h.leg === "b")
    return { base: [h.at[0], 0, h.at[1]], n: [0, 1, 0] };
  return { base: [h.at[0], h.at[1], 0], n: [0, 0, 1] };
}

/** The markers of a shape's holes, in the item's frame: one rod per hole, one more per mouth. */
export function holeMarks(s: ViewShape): HoleMark[] {
  const T = s.thickness;
  const P = MARK_PROUD_MM;
  const out: HoleMark[] = [];
  for (const h of s.holes) {
    const { base, n } = holeLine(s, h);
    // Spans measured along n from the back face (0) to the front face (T); a hole and its mouth
    // are drilled from the hole's face.
    const front = h.face === "front";
    const rod = ([from, to]: readonly [number, number], d: number) => {
      const mid = (from + to) / 2;
      out.push({
        centre: [base[0] + n[0] * mid, base[1] + n[1] * mid, base[2] + n[2] * mid],
        axis: n,
        len: to - from,
        d,
      });
    };
    const span = (depth: number | undefined): [number, number] =>
      depth === undefined ? [-P, T + P] : front ? [T - depth, T + P] : [-P, depth];
    rod(span(h.depth), h.d);
    if (h.mouth) rod(span(h.mouth.depth), h.mouth.d);
  }
  return out;
}
