/**
 * Three-vectors for the geometry core (design §4.4, §4.5): plain tuples, pure functions, IEEE
 * arithmetic only (no `Math` transcendentals), so results are the same on every machine.
 */

export type V3 = readonly [number, number, number];

export const ZERO: V3 = [0, 0, 0];

export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** `a + b × s`. */
export function addScaled(a: V3, b: V3, s: number): V3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}

export function neg(a: V3): V3 {
  return [-a[0], -a[1], -a[2]];
}

export function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function norm(a: V3): number {
  return Math.sqrt(dot(a, a));
}

export function dist(a: V3, b: V3): number {
  return norm(sub(a, b));
}

/** `a` scaled to unit length, or undefined for a zero vector. */
export function unit(a: V3): V3 | undefined {
  const n = norm(a);
  return n === 0 ? undefined : scale(a, 1 / n);
}

/** World axes by name, as documents write them (`"+z"`). */
export const AXIS = {
  "+x": [1, 0, 0],
  "-x": [-1, 0, 0],
  "+y": [0, 1, 0],
  "-y": [0, -1, 0],
  "+z": [0, 0, 1],
  "-z": [0, 0, -1],
} as const satisfies Record<string, V3>;
export type AxisName = keyof typeof AXIS;

/** The angle between two unit vectors in degrees, in [0, 180]. */
export function angleDeg(a: V3, b: V3): number {
  // atan2 of |a × b| and a · b is accurate near 0° and 180°, where acos is not.
  return (Math.atan2(norm(cross(a, b)), dot(a, b)) * 180) / Math.PI;
}
