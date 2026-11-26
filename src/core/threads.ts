/**
 * Metric threads and their clearance holes (design §4.5, call 27).
 *
 * A `bolt` through layers gets an ISO 273 medium-series clearance hole in each. The table is
 * ISO 273:1979's medium series, read from its identical national adoption IS 1821:1987, p. 2
 * (verified 2026-11-26), for thread diameters 1 to 150 mm.
 */

/** ISO 273 medium series: nominal thread diameter d → clearance hole d_h, in mm. */
const ISO273_MEDIUM: ReadonlyMap<number, number> = new Map([
  [1, 1.2],
  [1.2, 1.4],
  [1.4, 1.6],
  [1.6, 1.8],
  [1.8, 2.1],
  [2, 2.4],
  [2.5, 2.9],
  [3, 3.4],
  [3.5, 3.9],
  [4, 4.5],
  [4.5, 5],
  [5, 5.5],
  [6, 6.6],
  [7, 7.6],
  [8, 9],
  [10, 11],
  [12, 13.5],
  [14, 15.5],
  [16, 17.5],
  [18, 20],
  [20, 22],
  [22, 24],
  [24, 26],
  [27, 30],
  [30, 33],
  [33, 36],
  [36, 39],
  [39, 42],
  [42, 45],
  [45, 48],
  [48, 52],
  [52, 56],
  [56, 62],
  [60, 66],
  [64, 70],
  [68, 74],
  [72, 78],
  [76, 82],
  [80, 86],
  [85, 91],
  [90, 96],
  [95, 101],
  [100, 107],
  [105, 112],
  [110, 117],
  [115, 122],
  [120, 127],
  [125, 132],
  [130, 137],
  [140, 147],
  [150, 158],
]);

/**
 * The nominal diameter of a metric thread: `M10` and `M10x1.25` give 10. Undefined for anything
 * that is not written `M<d>` with an optional `x<pitch>`.
 */
export function threadDiameter(thread: string): number | undefined {
  const m = /^M(\d+(?:\.\d+)?)(?:x\d+(?:\.\d+)?)?$/.exec(thread.trim());
  return m ? Number(m[1]) : undefined;
}

/** The ISO 273 medium-series clearance hole for a thread, or undefined when it has none. */
export function clearanceHole(thread: string): number | undefined {
  const d = threadDiameter(thread);
  return d === undefined ? undefined : ISO273_MEDIUM.get(d);
}
