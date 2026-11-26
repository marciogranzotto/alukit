import { cross, unit } from "#core/vec.ts";
import { frameMatrix, type Mat4, mulMatrix, scaleMatrix } from "./data.ts";
import type { PartJson, V3, ViewFastener, ViewPart } from "./model.ts";

/**
 * Where parts and fasteners go (design §8): what the viewer draws and the GLB writer exports,
 * placed by one matrix each. No three.js.
 */

/** The marker drawn for a part whose item gives no box: a 20 mm cube at its station. */
const MARKER: [V3, V3] = [
  [-10, -10, -10],
  [10, 10, 10],
];

export interface PartShape {
  /** The box in the part's own frame. */
  box: [V3, V3];
  /** The part's frame, at its origin; a marker's at its point. */
  matrix: Mat4;
  /** A placeholder, or a marker. */
  translucent: boolean;
}

/** A placed part as a box in its frame (§3.2's `bbox_mm`); undefined for an unplaced line. */
export function partShape(p: PartJson, view: ViewPart | undefined): PartShape | undefined {
  if (p.unplaced || !p.frame || !p.origin || !p.point) return undefined;
  const box = view?.box;
  return {
    box: box ?? MARKER,
    matrix: frameMatrix(p.frame.x, p.frame.y, p.frame.z, box ? p.origin : p.point),
    translucent: view?.translucent ?? true,
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
 * A fastener's rod (`rodMesh`: diameter 1, length 1 along y, centred) placed from its head along
 * its axis, scaled to its diameter and length.
 */
export function fastenerMatrix(f: ViewFastener): Mat4 {
  const [u, w] = across(f.axis);
  const mid: V3 = [
    f.head[0] + (f.axis[0] * f.len) / 2,
    f.head[1] + (f.axis[1] * f.len) / 2,
    f.head[2] + (f.axis[2] * f.len) / 2,
  ];
  return mulMatrix(frameMatrix(w, f.axis, u, mid), scaleMatrix(f.d, f.len, f.d));
}

/**
 * A fastener's id, `<connection>.f<k>`: for one cut from bar stock, the piece the cut list
 * names (`c23.f1`).
 */
export function fastenerId(f: Pick<ViewFastener, "connection" | "k">): string {
  return `${f.connection}.f${f.k}`;
}
