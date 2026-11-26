/** Millimetres per metre. Lengths are stored in mm (design §2). */
export const MM_PER_M = 1000;

/** Converts millimetres to metres. */
export function mFromMm(mm: number): number {
  return mm / MM_PER_M;
}

/** Converts metres to millimetres. */
export function mmFromM(m: number): number {
  return m * MM_PER_M;
}
