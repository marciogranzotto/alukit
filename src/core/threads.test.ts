import { describe, expect, it } from "vitest";
import { minorDiameterMax, tapFit } from "./threads.ts";

/**
 * The tap-fit rule (design §5.5): a tap fits a core when the core is no wider than the thread's
 * largest minor diameter (6H) and its tap drill takes no more than one pitch off the core's wall.
 * Each expected value is worked by hand from ISO 724's basic minor diameter, D − 1.082532 P, and
 * ISO 965-3's T_D1 for 6H, in the comments.
 */

describe("the largest minor diameter of a 6H internal thread", () => {
  it("is the basic minor diameter plus T_D1 for its pitch", () => {
    // M6: 6 − 1.082532 = 4.917, + 0.236 = 5.153. M8: 8 − 1.353165 = 6.647, + 0.265 = 6.912.
    // M16: 16 − 2.165064 = 13.835, + 0.375 = 14.210. M5: 5 − 0.866026 = 4.134, + 0.200 = 4.334.
    expect(minorDiameterMax("M6")).toBeCloseTo(5.153, 3);
    expect(minorDiameterMax("M8")).toBeCloseTo(6.912, 3);
    expect(minorDiameterMax("M16")).toBeCloseTo(14.21, 3);
    expect(minorDiameterMax("M5")).toBeCloseTo(4.334, 3);
    // A fine pitch takes its own T_D1: M10x1.25, 10 − 1.353165 + 0.265 = 8.912.
    expect(minorDiameterMax("M10x1.25")).toBeCloseTo(8.912, 3);
  });

  it("is not known for a thread that is not metric, or a pitch the table does not give", () => {
    expect(minorDiameterMax("1/4-20 UNC")).toBeUndefined();
    // M24's coarse pitch is 3 mm: the table read stops at 2.5.
    expect(minorDiameterMax("M24")).toBeUndefined();
  });
});

describe("a tap on a core", () => {
  it("fits the core its thread is sized for, drilled up to its tap drill", () => {
    // M6 in Ø5: tap drill 5.00, the core itself. M8 in Ø6.8: 6.8 ≤ 6.912, and the tap drill
    // 6.75 takes nothing off. M16 in Ø13.7: drilled up 0.30 to 14.00, within its 2 mm pitch.
    // M14 in Ø12.1 (the 30 series): 12.1 ≤ 11.835 + 0.375 = 12.210. M8 in Ø6.5: drilled up 0.25.
    expect(tapFit("M6", 5)).toEqual({ fits: true });
    expect(tapFit("M8", 6.8)).toEqual({ fits: true });
    expect(tapFit("M16", 13.7)).toEqual({ fits: true });
    expect(tapFit("M14", 12.1)).toEqual({ fits: true });
    expect(tapFit("M8", 6.5)).toEqual({ fits: true });
  });

  it("does not fit a core wider than its largest minor diameter: the thread would be shallow", () => {
    // M8 in an 80x80's Ø13.7 core; M5 in Ø4.6, 4.6 > 4.334.
    expect(tapFit("M8", 13.7)).toEqual({ fits: false, why: "core-wide", limit_mm: 6.912 });
    expect(tapFit("M5", 4.6)).toEqual({ fits: false, why: "core-wide", limit_mm: 4.334 });
  });

  it("does not fit a core it would drill up by more than one pitch", () => {
    // M16 in a Ø5 corner hole: tap drill 14.00, 9.00 over the core, its pitch 2: the narrowest
    // core it fits is 14 − 2 = 12. M8 in Ø5: 6.75, 1.75 over its pitch 1.25: the narrowest 5.50.
    expect(tapFit("M16", 5)).toEqual({ fits: false, why: "core-narrow", limit_mm: 12 });
    expect(tapFit("M8", 5)).toEqual({ fits: false, why: "core-narrow", limit_mm: 5.5 });
    // At the limit it fits: M10 (tap drill 8.5, pitch 1.5) in a Ø7 core.
    expect(tapFit("M10", 7)).toEqual({ fits: true });
  });

  it("cannot be judged for a thread AluKit has no tap drill or tolerance for", () => {
    expect(tapFit("1/4-20 UNC", 5)).toBeUndefined();
    expect(tapFit("M24", 21)).toBeUndefined();
  });
});
