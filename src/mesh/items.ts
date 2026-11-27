import { ShapeUtils, Vector2 } from "three";
import type { MeshData } from "./data.ts";
import type { V3, ViewHole, ViewShape } from "./model.ts";
import type { P2 } from "./outline.ts";
import type { PartShape } from "./place.ts";
import { area2, type Prism, shapePrism } from "./shapes.ts";
import { boxMesh } from "./solids.ts";

/**
 * Meshes of the project's own items (design §4.8, §8, §9), as plain arrays for the viewer and the
 * GLB writer alike. Everything is in the item's own frame (§3.2): +z away from the face it mounts
 * on, +x along the bar it mounts on. Flat-shaded, triangles wound counter-clockwise seen from
 * outside, as `solids.ts`.
 *
 * - A plate: its outline extruded from z = 0 to its thickness.
 * - A bent angle: its section, an L with the bend's inside and outside arcs (radii R and R + T
 *   about one centre, R + T from each outside face), extruded along x for its length. Leg a lies
 *   on the mounting face along +y; leg b rises along +z. Its box is [0, 0, 0] to [length, a, b].
 * - A placeholder, or any other part: its box (`boxMesh`).
 * - Holes are marked, not cut: a rod of the drill's diameter through the material, or as deep as
 *   a blind hole, and a wider one for a countersink's or a counterbore's mouth, each standing
 *   proud of the face it shows on. `rodMesh` draws them, `holeMatrix` places them.
 *
 * The one piece of three.js here is its triangulator (`ShapeUtils.triangulateShape`, earcut) for
 * the end faces of an outline, which may be concave: the same one a section's extrusion uses in
 * `bars.ts`. No geometry class, no renderer. The prisms themselves are `shapes.ts`'s, which the
 * checks' `bbox()` reads too (§4.9).
 */

/** How far a hole's marker stands proud of a face, so it shows (mm). */
export const MARK_PROUD_MM = 0.5;

/** Sides of a hole's rod: more than a fastener's, as a hole is often small and seen end on. */
export const HOLE_SEGMENTS = 16;

type PlateShape = Extract<ViewShape, { kind: "plate" }>;
type AngleShape = Extract<ViewShape, { kind: "bent-angle" }>;

/**
 * A shape's prism (`shapes.ts`: its clean, counter-clockwise ring in the (u, v) plane, extruded
 * along w from 0 to `depth`): both end faces triangulated, one flat quad per side.
 */
function prism({ ring, depth, axes }: Prism): MeshData {
  const n = ring.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const put = (u: number, v: number, w: number, nu: number, nv: number, nw: number) => {
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    p[axes[0]] = u;
    p[axes[1]] = v;
    p[axes[2]] = w;
    q[axes[0]] = nu;
    q[axes[1]] = nv;
    q[axes[2]] = nw;
    positions.push(...p);
    normals.push(...q);
  };

  // The end faces: earcut's triangles, each turned to face out (+w at w = depth, −w at w = 0).
  const triangles = ShapeUtils.triangulateShape(
    ring.map(([u, v]) => new Vector2(u, v)),
    [],
  );
  for (const [w, sign] of [
    [depth, 1],
    [0, -1],
  ] as const) {
    const base = positions.length / 3;
    for (const [u, v] of ring) put(u, v, w, 0, 0, sign);
    for (const t of triangles) {
      const [a, b, c] = t as [number, number, number];
      const ccw = area2([ring[a] as P2, ring[b] as P2, ring[c] as P2]) > 0;
      if (ccw === sign > 0) indices.push(base + a, base + b, base + c);
      else indices.push(base + a, base + c, base + b);
    }
  }

  // The sides: a counter-clockwise ring's outward normal along an edge (du, dv) is (dv, −du).
  for (let i = 0; i < n; i++) {
    const [u0, v0] = ring[i] as P2;
    const [u1, v1] = ring[(i + 1) % n] as P2;
    const l = Math.hypot(u1 - u0, v1 - v0);
    const nu = (v1 - v0) / l;
    const nv = -(u1 - u0) / l;
    const base = positions.length / 3;
    put(u0, v0, 0, nu, nv, 0);
    put(u1, v1, 0, nu, nv, 0);
    put(u1, v1, depth, nu, nv, 0);
    put(u0, v0, depth, nu, nv, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  };
}

/** A plate: its outline extruded along z through its thickness. */
export function plateMesh(s: PlateShape): MeshData {
  return prism(shapePrism(s));
}

/** A bent angle: its section (`angleSection`) extruded along the item's x: u → y, v → z, w → x. */
export function angleMesh(s: AngleShape): MeshData {
  return prism(shapePrism(s));
}

export function itemMesh(s: ViewShape): MeshData {
  return s.kind === "plate" ? plateMesh(s) : angleMesh(s);
}

/** A placed part's mesh in its own frame: a project shape, else its box (or marker). */
export function partMesh(p: PartShape): MeshData {
  return p.shape ? itemMesh(p.shape) : boxMesh(p.box[0], p.box[1]);
}

/** A hole's marker: a rod about `centre` along `axis`, `len` long and `d` across. */
export interface HoleMark {
  /** The hole's id (`h1`, `a1` …) and type, as the machining sheet gives them. */
  hole: string;
  type: ViewHole["type"];
  /** The drill's rod, or the wider one of a countersink's or a counterbore's mouth. */
  rod: "drill" | "countersink" | "counterbore";
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
    const rod = (what: HoleMark["rod"], [from, to]: readonly [number, number], d: number) => {
      const mid = (from + to) / 2;
      out.push({
        hole: h.id,
        type: h.type,
        rod: what,
        centre: [base[0] + n[0] * mid, base[1] + n[1] * mid, base[2] + n[2] * mid],
        axis: n,
        len: to - from,
        d,
      });
    };
    const span = (depth: number | undefined): [number, number] =>
      depth === undefined ? [-P, T + P] : front ? [T - depth, T + P] : [-P, depth];
    rod("drill", span(h.depth), h.d);
    if (h.mouth) {
      const what = h.type === "countersunk" ? "countersink" : "counterbore";
      rod(what, span(h.mouth.depth), h.mouth.d);
    }
  }
  return out;
}
