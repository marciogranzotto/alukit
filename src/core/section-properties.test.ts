import { describe, expect, it } from "vitest";
import { type Ring, ringArea, sectionProperties } from "./section-properties.ts";

/** A w × h rectangle centred on (cx, cy), counter-clockwise. */
function rect(w: number, h: number, cx = 0, cy = 0): Ring {
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ];
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe("section properties of polygons with holes", () => {
  it("gives a rectangle's closed form", () => {
    const p = sectionProperties([{ outline: rect(40, 80), holes: [] }]);
    expect(p.area_mm2).toBe(3200);
    expect(p.centroid_mm).toEqual([0, 0]);
    expect(p.Ix_mm4).toBeCloseTo((40 * 80 ** 3) / 12, 6);
    expect(p.Iy_mm4).toBeCloseTo((80 * 40 ** 3) / 12, 6);
    expect(p.Ixy_mm4).toBeCloseTo(0, 6);
    expect(p.I1_mm4).toBeCloseTo(p.Ix_mm4, 6);
    expect(p.principal_deg).toBe(0);
    expect(p.Wx_mm3).toBeCloseTo((40 * 80 ** 2) / 6, 6);
    expect(p.bbox_mm).toEqual([
      [-20, -40],
      [20, 40],
    ]);
  });

  it("subtracts holes whatever the winding", () => {
    const hole = rect(20, 20);
    const cw = [...hole].reverse();
    const ccwOutline = rect(40, 40);
    const cwOutline = [...ccwOutline].reverse();
    const expectedI = (40 ** 4 - 20 ** 4) / 12;
    for (const [outline, h] of [
      [ccwOutline, hole],
      [ccwOutline, cw],
      [cwOutline, hole],
      [cwOutline, cw],
    ] as const) {
      const p = sectionProperties([{ outline, holes: [h] }]);
      expect(p.area_mm2).toBe(1200);
      expect(p.Ix_mm4).toBeCloseTo(expectedI, 6);
      expect(p.Iy_mm4).toBeCloseTo(expectedI, 6);
    }
    expect(ringArea(hole)).toBe(400);
    expect(ringArea(cw)).toBe(-400);
  });

  it("finds the centroid and transfers to it (parallel axis)", () => {
    // The same rectangle far from the origin: the result must not lose digits.
    const p = sectionProperties([{ outline: rect(40, 80, 1e6, -2e6), holes: [] }]);
    expect(p.centroid_mm).toEqual([1e6, -2e6]);
    expect(rel(p.Ix_mm4, (40 * 80 ** 3) / 12)).toBeLessThan(1e-12);
    expect(Math.abs(p.Ixy_mm4)).toBeLessThan(1e-6);
  });

  it("gives an L's product of area and principal axes", () => {
    // Equal-leg L 30 × 30 × 5 (sharp corners) with the heel at the origin.
    const L: Ring = [
      [0, 0],
      [30, 0],
      [30, 5],
      [5, 5],
      [5, 30],
      [0, 30],
    ];
    const p = sectionProperties([{ outline: L, holes: [] }]);
    // Two rectangles: 30 × 5 at (15, 2.5) and 5 × 25 at (2.5, 17.5).
    const A = 150 + 125;
    const c = (150 * 15 + 125 * 2.5) / A;
    expect(p.area_mm2).toBeCloseTo(A, 9);
    expect(p.centroid_mm[0]).toBeCloseTo(c, 9);
    expect(p.centroid_mm[1]).toBeCloseTo(c, 9);
    const Ixy = 150 * (15 - c) * (2.5 - c) + 125 * (2.5 - c) * (17.5 - c);
    expect(p.Ixy_mm4).toBeCloseTo(Ixy, 6);
    // Equal legs: Ix = Iy, so the principal axes lie at ±45°. Ixy < 0 here (the legs lie where
    // x − cx and y − cy have opposite signs), which puts the major axis on the heel–centroid
    // diagonal, at +45°.
    expect(p.Ixy_mm4).toBeLessThan(0);
    expect(p.principal_deg).toBeCloseTo(45, 9);
    expect(p.I1_mm4 + p.I2_mm4).toBeCloseTo(p.Ix_mm4 + p.Iy_mm4, 6);
    expect(p.I1_mm4).toBeCloseTo(p.Ix_mm4 + Math.abs(p.Ixy_mm4), 6);
  });

  it("rotates principal axes with the section", () => {
    // A 10 × 40 rectangle rotated 30° counter-clockwise: its strong axis (x, for a tall
    // rectangle) rotates by 30°.
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const r = rect(10, 40).map(([x, y]) => [x * c - y * s, x * s + y * c] as const);
    const p = sectionProperties([{ outline: r, holes: [] }]);
    expect(p.principal_deg).toBeCloseTo(30, 9);
    expect(p.I1_mm4).toBeCloseTo((10 * 40 ** 3) / 12, 6);
    expect(p.I2_mm4).toBeCloseTo((40 * 10 ** 3) / 12, 6);
  });

  it("adds separate regions", () => {
    const p = sectionProperties([
      { outline: rect(10, 10, -20, 0), holes: [] },
      { outline: rect(10, 10, 20, 0), holes: [] },
    ]);
    expect(p.area_mm2).toBe(200);
    expect(p.Iy_mm4).toBeCloseTo(2 * ((10 * 10 ** 3) / 12 + 100 * 400), 6);
  });

  it("tolerates a repeated closing vertex", () => {
    const closed = [...rect(40, 40), [-20, -20] as const];
    expect(sectionProperties([{ outline: closed, holes: [] }]).area_mm2).toBe(1600);
  });

  it("refuses degenerate input", () => {
    expect(() => sectionProperties([])).toThrow(RangeError);
    expect(() =>
      sectionProperties([
        {
          outline: [
            [0, 0],
            [1, 1],
          ],
          holes: [],
        },
      ]),
    ).toThrow(/3/);
    expect(() => sectionProperties([{ outline: rect(10, 10), holes: [rect(20, 20)] }])).toThrow(
      /positive/,
    );
    expect(() =>
      sectionProperties([
        {
          outline: [
            [0, 0],
            [1, Number.NaN],
            [1, 1],
          ],
          holes: [],
        },
      ]),
    ).toThrow(/non-finite/);
  });

  it("is deterministic: the same input gives the same bits", () => {
    const ring = rect(40, 80, 3.3, -7.7);
    const a = sectionProperties([{ outline: ring, holes: [rect(5, 5, 3.3, -7.7)] }]);
    const b = sectionProperties([{ outline: ring, holes: [rect(5, 5, 3.3, -7.7)] }]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
