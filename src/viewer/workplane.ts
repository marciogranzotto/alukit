import type { BarJson, V3 } from "../mesh/model.ts";
import { type Face, faceLocal, GRID_MM, type P2, type Ray, type Snap } from "./snap.ts";

/**
 * The work plane (design §8): where a point lands when nothing snaps, and the plane a line is
 * free in when Shift is held. By default the ground, world XY through the origin; picking a face
 * of a bar sets it to that face's plane (review m11). It carries its own u and v, so the grid on
 * it is square to its edges.
 */

export interface WorkPlane {
  origin: V3;
  /** Unit normal. */
  n: V3;
  /** Unit in-plane axes, u × v = n. */
  u: V3;
  v: V3;
  label: string;
}

export const GROUND: WorkPlane = {
  origin: [0, 0, 0],
  n: [0, 0, 1],
  u: [1, 0, 0],
  v: [0, 1, 0],
  label: "ground (XY)",
};

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addScaled = (a: V3, b: V3, s: number): V3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const neg = (a: V3): V3 => [0 - a[0], 0 - a[1], 0 - a[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Where a ray meets a plane in front of its origin. */
export function rayPlane(ray: Ray, plane: { origin: V3; n: V3 }): V3 | undefined {
  const den = dot(ray.d, plane.n);
  if (Math.abs(den) < 1e-9) return undefined;
  const u = dot(sub(plane.origin, ray.o), plane.n) / den;
  return u < 0 ? undefined : addScaled(ray.o, ray.d, u);
}

/** The same plane moved to pass through `p`: the plane a line from `p` is free in. */
export function through(plane: WorkPlane, p: V3): WorkPlane {
  return { ...plane, origin: p };
}

/** A point of the plane moved to the nearest grid node, counted from the plane's origin. */
export function onGrid(plane: WorkPlane, p: V3, step = GRID_MM): V3 {
  const r = sub(p, plane.origin);
  const a = Math.round(dot(r, plane.u) / step) * step;
  const b = Math.round(dot(r, plane.v) / step) * step;
  return addScaled(addScaled(plane.origin, plane.u, a), plane.v, b);
}

/** The grid point under the pointer, as a snap. */
export function gridSnap(ray: Ray, plane: WorkPlane, step = GRID_MM): Snap | undefined {
  const hit = rayPlane(ray, plane);
  if (!hit) return undefined;
  const p = onGrid(plane, hit, step);
  const r = (x: number) => Math.round(x * 100) / 100 + 0;
  return {
    p,
    ref: { kind: "grid" },
    label: `grid (${r(p[0])}, ${r(p[1])}, ${r(p[2])})`,
    kind: "grid",
  };
}

/** The plane of a side face of a bar's placed box, facing out; u along the bar. */
export function facePlane(bar: BarJson, id: string, face: Face): WorkPlane {
  const [lx, ly] = faceLocal(bar.box_mm, face);
  const { x, y, z: t } = bar.frame;
  const origin = addScaled(addScaled(bar.a, x, lx), y, ly);
  const n = face === "+x" ? x : face === "-x" ? neg(x) : face === "+y" ? y : neg(y);
  // u along the bar, v = n × u, so u × v = n.
  const v = cross(n, t);
  return { origin, n, u: t, v, label: `${id} ${face} face` };
}

/**
 * The side face of a bar's body a ray enters first, found analytically: the ray in the bar's
 * local frame against its placed box, between its end planes (a slab test). An entry through
 * an end, or a miss, is no face.
 */
export function rayFace(ray: Ray, bar: BarJson): { face: Face; p: V3; s: number } | undefined {
  const { x, y, z: t } = bar.frame;
  const r = sub(ray.o, bar.a);
  const o = [dot(r, x), dot(r, y), dot(r, t)];
  const d = [dot(ray.d, x), dot(ray.d, y), dot(ray.d, t)];
  const [[x0, y0], [x1, y1]] = bar.box_mm as readonly [P2, P2];
  // Along the axis, the body runs between its end planes where they cross the design line.
  const sa = dot(sub(bar.ends.a.point, bar.a), t);
  const sb = dot(sub(bar.ends.b.point, bar.a), t);
  const lo = [x0, y0, Math.min(sa, sb)];
  const hi = [x1, y1, Math.max(sa, sb)];
  let enter = -Infinity;
  let exit = Infinity;
  let axis = -1;
  let sign = 0;
  for (let k = 0; k < 3; k++) {
    const ok = o[k] as number;
    const dk = d[k] as number;
    const l = lo[k] as number;
    const h = hi[k] as number;
    if (Math.abs(dk) < 1e-12) {
      if (ok < l || ok > h) return undefined;
      continue;
    }
    let t0 = (l - ok) / dk;
    let t1 = (h - ok) / dk;
    let s0 = -1;
    if (t0 > t1) {
      [t0, t1] = [t1, t0];
      s0 = 1;
    }
    if (t0 > enter) {
      enter = t0;
      axis = k;
      sign = s0;
    }
    exit = Math.min(exit, t1);
  }
  if (enter > exit || exit < 0 || axis < 0 || axis === 2) return undefined;
  const face = (axis === 0 ? (sign > 0 ? "+x" : "-x") : sign > 0 ? "+y" : "-y") as Face;
  const p = addScaled(ray.o, ray.d, Math.max(enter, 0));
  return { face, p, s: dot(sub(p, bar.a), t) };
}
