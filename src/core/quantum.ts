import { TOL } from "./tolerances.ts";

/**
 * Numbers in output files (design §2 "Output quantum", §5.2). A quantum is given as the number
 * of quanta per unit (100 for 0.01), so the result is `n / perUnit`: one correctly rounded
 * division, which prints as the short decimal (0.3, not 0.30000000000000004).
 */
export const QUANTUM = {
  /** Lengths: 0.01 mm. */
  len_mm: 100,
  /** Angles: 0.01°. */
  ang_deg: 100,
  /** Mass: 0.001 kg (also used for kg/m). */
  mass_kg: 1000,
  /** Money: one minor unit. */
  minor: 1,
} as const;

/** The snap window for `x`: `tol.snap`, relative, with a floor of 1 so values near 0 snap too. */
function window(x: number): number {
  return TOL.snap * Math.max(1, Math.abs(x));
}

/** `x` snapped to the nearest integer when it lies within `tol.snap` of it (design §5.2). */
export function snapInt(x: number): number {
  const n = Math.round(x);
  return Math.abs(x - n) <= window(x) ? n : x;
}

/** Floor after snapping, so 2.9999999999999996 floors to 3. */
export function snapFloor(x: number): number {
  return Math.floor(snapInt(x));
}

/** Ceil after snapping, so 3.0000000000000004 ceils to 3. */
export function snapCeil(x: number): number {
  return Math.ceil(snapInt(x));
}

/** Round half away from zero, after snapping to the nearest half (design §5.2). */
export function roundHalfAway(x: number): number {
  const half = Math.round(x * 2) / 2;
  const snapped = Math.abs(x - half) <= window(x) ? half : x;
  const n = Math.sign(snapped) * Math.floor(Math.abs(snapped) + 0.5);
  return n === 0 ? 0 : n; // never -0
}

/**
 * `x` on the grid of `1 / perUnit`: divide by the quantum, snap, round half away from zero.
 * `perUnit` must be a positive integer. Never returns -0. Throws on a non-finite `x`, which no
 * output may contain (design §2).
 */
export function quantize(x: number, perUnit: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`cannot quantise ${x}`);
  if (!Number.isInteger(perUnit) || perUnit <= 0) {
    throw new RangeError(`quanta per unit must be a positive integer, not ${perUnit}`);
  }
  const n = roundHalfAway(x * perUnit);
  const q = n / perUnit;
  return q === 0 ? 0 : q;
}
