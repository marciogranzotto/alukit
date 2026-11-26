import { TOL } from "./tolerances.ts";

/**
 * Sine and cosine in degrees (design §5.2). The angle is reduced exactly (`%` is exact in IEEE),
 * and at multiples of 30° within `tol.snap` the result comes from a table, so it is exactly 0,
 * ±½ or ±1 where that is the true value and √3/2 rounded once elsewhere. Other angles use Math,
 * which is stable within one Node major.
 */

const HALF_SQRT3 = Math.sqrt(3) / 2;
/** sin(30° × k) for k = 0 … 11. */
const SIN30: readonly number[] = [
  0,
  0.5,
  HALF_SQRT3,
  1,
  HALF_SQRT3,
  0.5,
  0,
  -0.5,
  -HALF_SQRT3,
  -1,
  -HALF_SQRT3,
  -0.5,
];

/** `deg` reduced to [0, 360). */
export function reduceDeg(deg: number): number {
  const r = deg % 360;
  const pos = r < 0 ? r + 360 : r;
  return pos === 360 || pos === 0 ? 0 : pos;
}

/** The table index k when `deg` is within `tol.snap` of 30° × k, else undefined. */
function tableIndex(reduced: number): number | undefined {
  const k = Math.round(reduced / 30);
  if (Math.abs(reduced - 30 * k) > TOL.snap * Math.max(1, reduced)) return undefined;
  return k % 12;
}

export function sinDeg(deg: number): number {
  const r = reduceDeg(deg);
  const k = tableIndex(r);
  if (k !== undefined) return SIN30[k] as number;
  return Math.sin((r * Math.PI) / 180);
}

export function cosDeg(deg: number): number {
  const r = reduceDeg(deg);
  const k = tableIndex(r);
  if (k !== undefined) return SIN30[(k + 3) % 12] as number;
  return Math.cos((r * Math.PI) / 180);
}

/** atan2 in degrees, in (-180, 180]. Never -0. */
export function atan2Deg(y: number, x: number): number {
  const d = (Math.atan2(y, x) * 180) / Math.PI;
  return d === 0 ? 0 : d;
}
