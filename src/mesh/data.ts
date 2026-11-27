import type { V3 } from "./model.ts";

/**
 * Meshes as plain arrays, the form the GLB writer takes (design §9) and the viewer wraps in a
 * `BufferGeometry`, and 4×4 matrices as glTF and three store them: 16 numbers, column by column.
 * No three.js here.
 */

export interface MeshData {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** A unit normal per vertex. */
  normals: Float32Array;
  /** Triangles as vertex indices; absent when every three vertices make one. */
  indices?: Uint32Array;
}

/** A 4×4 matrix, column-major. */
export type Mat4 = readonly number[];

/** Columns x, y, z and a translation o: a frame as a matrix. */
export function frameMatrix(x: V3, y: V3, z: V3, o: V3): Mat4 {
  // biome-ignore format: columns read best one per line
  return [
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    o[0], o[1], o[2], 1,
  ];
}

/** a × b. */
export function mulMatrix(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** A point under a matrix. */
export function applyMatrix(m: Mat4, p: V3): V3 {
  const at = (r: number) =>
    (m[r] as number) * p[0] +
    (m[4 + r] as number) * p[1] +
    (m[8 + r] as number) * p[2] +
    (m[12 + r] as number);
  return [at(0), at(1), at(2)];
}

/** A scale along x, y and z. */
export function scaleMatrix(sx: number, sy: number, sz: number): Mat4 {
  // biome-ignore format: a diagonal
  return [
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    0, 0, 0, 1,
  ];
}

/** What `meshData` reads from a three.js `BufferGeometry`, typed by shape. */
export interface GeometryLike {
  getAttribute(name: string): { array: ArrayLike<number> } | undefined;
  index: { array: ArrayLike<number> } | null;
}

/** A geometry's positions, normals and indices, copied into plain arrays. */
export function meshData(g: GeometryLike): MeshData {
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  if (!p || !n) throw new Error("a mesh needs positions and normals");
  return {
    positions: Float32Array.from(p.array),
    normals: Float32Array.from(n.array),
    ...(g.index ? { indices: Uint32Array.from(g.index.array) } : {}),
  };
}
