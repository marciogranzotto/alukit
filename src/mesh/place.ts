import { cross, unit } from "#core/vec.ts";
import { frameMatrix, type Mat4, mulMatrix, scaleMatrix } from "./data.ts";
import type { PartJson, V3, ViewFastener, ViewPart, ViewShape } from "./model.ts";

/**
 * Where parts, fasteners and holes go (design §8): what the viewer draws and the GLB writer
 * exports, placed by one matrix each. No three.js.
 */

/** The marker drawn for a part whose item gives no box: a 20 mm cube at its station. */
const MARKER: [V3, V3] = [
  [-10, -10, -10],
  [10, 10, 10],
];

export interface PartShape {
  /** The box in the part's own frame; a marker's about its point. */
  box: [V3, V3];
  /** A project plate's or bent angle's shape (§4.8), drawn instead of its box. */
  shape?: ViewShape;
  /** The part's frame, at its origin; a marker's at its point. */
  matrix: Mat4;
  /** A placeholder, or a marker. A shape never is. */
  translucent: boolean;
  /** A placeholder (§4.8): its box, translucent and outlined. */
  placeholder: boolean;
}

/**
 * A placed part in its frame (§3.2): a project shape, or a box (`bbox_mm`); undefined for an
 * unplaced line.
 */
export function partShape(p: PartJson, view: ViewPart | undefined): PartShape | undefined {
  if (p.unplaced || !p.frame || !p.origin || !p.point) return undefined;
  const box = view?.box;
  const shape = view?.shape;
  return {
    box: box ?? MARKER,
    ...(shape ? { shape } : {}),
    matrix: frameMatrix(p.frame.x, p.frame.y, p.frame.z, box || shape ? p.origin : p.point),
    translucent: !shape && (view?.translucent ?? true),
    placeholder: view?.placeholder === true,
  };
}

/** Two unit vectors square to `a` and to each other, completing a right-handed frame (u, a, w). */
function across(a: V3): [V3, V3] {
  const ref: V3 = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(ref, a)) as V3;
  const w = unit(cross(a, u)) as V3;
  return [u, w];
}

/**
 * A rod (`rodMesh`: diameter 1, length 1 along y, centred) about `mid` along the unit `axis`,
 * scaled to its diameter and length.
 */
export function rodMatrix(mid: V3, axis: V3, len: number, d: number): Mat4 {
  const [u, w] = across(axis);
  return mulMatrix(frameMatrix(w, axis, u, mid), scaleMatrix(d, len, d));
}

/** A fastener's rod, placed from its head along its axis. */
export function fastenerMatrix(f: ViewFastener): Mat4 {
  const mid: V3 = [
    f.head[0] + (f.axis[0] * f.len) / 2,
    f.head[1] + (f.axis[1] * f.len) / 2,
    f.head[2] + (f.axis[2] * f.len) / 2,
  ];
  return rodMatrix(mid, f.axis, f.len, f.d);
}

/** A hole's marker (`holeMarks`), in the frame of the part it is in. */
export function holeMatrix(m: { centre: V3; axis: V3; len: number; d: number }): Mat4 {
  return rodMatrix(m.centre, m.axis, m.len, m.d);
}

/**
 * A fastener's id, `<connection>.f<k>`: for one cut from bar stock, the piece the cut list
 * names (`c23.f1`).
 */
export function fastenerId(f: Pick<ViewFastener, "connection" | "k">): string {
  return `${f.connection}.f${f.k}`;
}
