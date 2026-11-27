/**
 * Metric threads and their clearance holes (design §4.5, call 27).
 *
 * A `bolt` through layers gets an ISO 273 medium-series clearance hole in each, and a sleeve the
 * hole of a shank of its outside diameter. The table is ISO 273:1979's medium series, read from
 * its identical national adoption IS 1821:1987, p. 2 (verified 2026-11-26), for thread diameters
 * 1 to 150 mm.
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

/**
 * The hole for a sleeve that passes a wall or a layer (acceptance gap A7): ISO 273's medium
 * series for a shank of the sleeve's outside diameter, the series the bolts in the same joint
 * take. ISO 273 sizes holes by the diameter of what passes them, so a sleeve of 16 takes 17.5 and
 * one of 18 takes 20. An outside diameter between two of the table's takes the next one up, so its
 * clearance is never less than the shank's below it (a 17.2 tube takes 18's 20; *inferred*: the
 * standard tables only its own diameters). Past the table, 150 mm, there is none.
 */
export function sleeveHole(od: number): number | undefined {
  for (const [d, h] of ISO273_MEDIUM) if (d >= od - 1e-9) return h;
  return undefined;
}

/**
 * ISO 261 coarse pitches, nominal diameter d → pitch P, in mm: the sizes ISO 262 selects for
 * screws, bolts and nuts, 1 to 64 mm (read from the ISO metric screw thread article's table of
 * ISO 262's sizes, 2026-11-26).
 */
const ISO261_COARSE: ReadonlyMap<number, number> = new Map([
  [1, 0.25],
  [1.2, 0.25],
  [1.4, 0.3],
  [1.6, 0.35],
  [1.8, 0.35],
  [2, 0.4],
  [2.5, 0.45],
  [3, 0.5],
  [3.5, 0.6],
  [4, 0.7],
  [5, 0.8],
  [6, 1],
  [7, 1],
  [8, 1.25],
  [10, 1.5],
  [12, 1.75],
  [14, 2],
  [16, 2],
  [18, 2.5],
  [20, 2.5],
  [22, 2.5],
  [24, 3],
  [27, 3],
  [30, 3.5],
  [33, 3.5],
  [36, 4],
  [39, 4],
  [42, 4.5],
  [45, 4.5],
  [48, 5],
  [52, 5],
  [56, 5.5],
  [60, 5.5],
  [64, 6],
]);

/**
 * A metric thread's pitch: the one written (`M10x1.25` gives 1.25), else ISO 261's coarse pitch
 * for its diameter. Undefined for anything else.
 */
export function threadPitch(thread: string): number | undefined {
  const m = /^M(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/.exec(thread.trim());
  if (!m) return undefined;
  return m[2] !== undefined ? Number(m[2]) : ISO261_COARSE.get(Number(m[1]));
}

/**
 * The tap drill of a metric thread: its major diameter minus its pitch, the rule for ISO metric
 * threads ("major minus pitch", Wikipedia's drill and tap size chart). It gives about three
 * quarters of the thread's depth: M6 5.00, M8 6.75, M10 8.50. Shops round some sizes to the
 * drills they stock (M8 6.8); a threaded hole that names its drill as `d_mm` uses that one.
 */
export function tapDrill(thread: string): number | undefined {
  const d = threadDiameter(thread);
  const p = threadPitch(thread);
  return d === undefined || p === undefined ? undefined : d - p;
}

/**
 * The minor-diameter tolerance T_D1 of an internal thread in tolerance class 6H, by pitch, in mm:
 * ISO 965-3:1998, Table 1, the minor diameter's upper deviation ES (EI is 0 for position H). Read
 * from the standard's public preview pages, 2026-11-27, which give the pitches 0.3 to 2.5 mm
 * (M1.4 to M22 in the coarse series); T_D1 depends on the pitch alone, so a fine pitch takes the
 * same value as a coarse one. 6H is the medium class ISO 965-1 gives general-purpose tapped holes.
 */
const TD1_6H: ReadonlyMap<number, number> = new Map([
  [0.3, 0.085],
  [0.35, 0.1],
  [0.4, 0.112],
  [0.45, 0.125],
  [0.5, 0.14],
  [0.6, 0.16],
  [0.7, 0.18],
  [0.75, 0.19],
  [0.8, 0.2],
  [1, 0.236],
  [1.25, 0.265],
  [1.5, 0.3],
  [1.75, 0.335],
  [2, 0.375],
  [2.5, 0.45],
]);

/** To 0.001 mm, the resolution ISO 724 and ISO 965 tabulate thread diameters in. */
const um = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The largest minor diameter a 6H internal thread may have: its basic minor diameter, D − 1.082532
 * P (ISO 724: D less twice 5H/8, H = 0.866025 P), plus T_D1. A hole wider than this leaves the
 * thread short of its depth. Undefined for a thread that is not metric, or whose pitch the table
 * does not give.
 */
export function minorDiameterMax(thread: string): number | undefined {
  const d = threadDiameter(thread);
  const p = threadPitch(thread);
  const td1 = p === undefined ? undefined : TD1_6H.get(p);
  return d === undefined || p === undefined || td1 === undefined
    ? undefined
    : um(um(d - 1.082532 * p) + td1);
}

/** A tap's fit to a core (`tapFit`): `limit_mm` is the bound the core's diameter crossed. */
export type TapFit =
  | { fits: true }
  | { fits: false; why: "core-wide" | "core-narrow"; limit_mm: number };

/**
 * Whether two thread designations name one thread: two metric threads of one diameter and pitch
 * (`M8` and `M8x1.25`), or the same text otherwise.
 */
export function sameThread(a: string, b: string): boolean {
  const [da, db] = [threadDiameter(a), threadDiameter(b)];
  if (da === undefined || db === undefined) return a.trim() === b.trim();
  return da === db && threadPitch(a) === threadPitch(b);
}

/**
 * Whether a tap fits a core (design §5.5). A core is a bore sized for a thread, and tapping it may
 * first drill it up to the tap drill. In this order:
 *
 * 1. **A thread the vendor labels the core with fits it** (`threads`, the drawing's "Ø13,7 (M16)"
 *    or the shop's "Centro permite rosca: M5"): the vendor sanctions it, cut or formed. Forseti
 *    labels its 20-series Ø4.6 cores M5, a forming tap's pre-hole, wider than a cut M5 allows.
 * 2. **Any other thread is judged as a cut thread**, and fits when both hold:
 *
 *    - **the core is no wider than the thread's largest minor diameter** (`minorDiameterMax`,
 *      6H). The tap drill, `tapDrill`'s major-minus-pitch, lies inside that tolerance, and a shop
 *      rounds it to the drills it stocks: an M8's 6.75 is drilled 6.8, the core of every 40x40
 *      with an M8 centre, and 6.8 is within M8's 6.912. A wider core leaves a shallow thread:
 *      "core-wide", with that diameter as `limit_mm`;
 *    - **its tap drill takes at most one pitch off the core's diameter**: half a pitch of wall on
 *      each side, a little less than the thread's own depth (5H/8, 0.54 P). More, and the core
 *      was made for a smaller thread, and the wall around it, which no section states, decides:
 *      "core-narrow", with the narrowest core it fits, tap drill less pitch, as `limit_mm`.
 *
 * So an M16 fits a Ø13.7 core (drilled up 0.30 to 14.00) and not a Ø5 corner hole labelled M6
 * (14.00 is 9.00 over); an M6 fits the Ø5 (its tap drill is 5.00) and an M8 does not (1.75 over its
 * 1.25 pitch). Undefined when the thread is not a label and has no tap drill or no 6H tolerance
 * here: not metric, or a pitch past the table's 2.5 mm.
 */
export function tapFit(
  thread: string,
  core: { d_mm: number; threads?: readonly string[] },
): TapFit | undefined {
  if (core.threads?.some((t) => sameThread(t, thread))) return { fits: true };
  const d_mm = core.d_mm;
  const max = minorDiameterMax(thread);
  const drill = tapDrill(thread);
  const p = threadPitch(thread);
  if (max === undefined || drill === undefined || p === undefined) return undefined;
  const eps = 1e-9;
  if (d_mm > max + eps) return { fits: false, why: "core-wide", limit_mm: max };
  if (drill > d_mm + p + eps) return { fits: false, why: "core-narrow", limit_mm: um(drill - p) };
  return { fits: true };
}
