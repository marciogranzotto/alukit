import { cosDeg, sinDeg } from "#core/trig.ts";
import type { MeshData } from "./data.ts";
import type { V3 } from "./model.ts";

/**
 * The simple parametric solids hardware and parts are drawn with (design §8: "simple parametric
 * meshes"): a box and a rod. Flat-shaded where faces meet at an edge, triangles wound
 * counter-clockwise seen from outside. No three.js; the trigonometry is exact at the special
 * angles (§5.2), so the same input gives the same floats.
 */

type Axis = 0 | 1 | 2;

/** Each face of a box: its outward axis and sign, and two in-plane axes with u × v outward. */
const FACES: readonly [Axis, 1 | -1, Axis, Axis][] = [
  [0, 1, 1, 2],
  [0, -1, 2, 1],
  [1, 1, 2, 0],
  [1, -1, 0, 2],
  [2, 1, 0, 1],
  [2, -1, 1, 0],
];

/** An axis-aligned box from corner `lo` to corner `hi`: 24 vertices, 12 triangles. */
export function boxMesh(lo: V3, hi: V3): MeshData {
  const c = [0, 1, 2].map((k) => ((lo[k] as number) + (hi[k] as number)) / 2);
  const h = [0, 1, 2].map((k) => ((hi[k] as number) - (lo[k] as number)) / 2);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const [n, s, u, v] of FACES) {
    const base = positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const p = [...c];
      p[n] = (p[n] as number) + s * (h[n] as number);
      p[u] = (p[u] as number) + su * (h[u] as number);
      p[v] = (p[v] as number) + sv * (h[v] as number);
      positions.push(...p);
      const nv = [0, 0, 0];
      nv[n] = s;
      normals.push(...nv);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  };
}

/**
 * A rod: a cylinder of diameter 1 and length 1 along y, from y = −½ to ½, with `segments` flat
 * sides around it (smooth normals) and two caps. Scaled by a matrix to a fastener's diameter and
 * length. Its vertex at angle θ sits at (½ sin θ, y, ½ cos θ), as three's `CylinderGeometry`.
 */
export function rodMesh(segments = 12): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const ring = Array.from({ length: segments + 1 }, (_, i) => {
    const deg = (360 * i) / segments;
    return [sinDeg(deg), cosDeg(deg)] as const;
  });
  // The side: a top and a bottom ring, the seam vertex repeated.
  for (const y of [0.5, -0.5]) {
    for (const [s, c] of ring) {
      positions.push(s / 2, y, c / 2);
      normals.push(s, 0, c);
    }
  }
  const bottom = segments + 1;
  for (let i = 0; i < segments; i++) {
    const a = i;
    const b = bottom + i;
    const c = bottom + i + 1;
    const d = i + 1;
    indices.push(a, b, d, b, c, d);
  }
  // The caps: a centre and a ring each, facing out along ±y.
  for (const y of [0.5, -0.5]) {
    const centre = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, Math.sign(y), 0);
    for (const [s, c] of ring) {
      positions.push(s / 2, y, c / 2);
      normals.push(0, Math.sign(y), 0);
    }
    for (let i = 0; i < segments; i++) {
      const p = centre + 1 + i;
      const q = centre + 2 + i;
      if (y > 0) indices.push(centre, p, q);
      else indices.push(centre, q, p);
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  };
}
