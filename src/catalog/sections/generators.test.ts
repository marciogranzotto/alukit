import { describe, expect, it } from "vitest";
import { type Region, sectionProperties } from "#core/section-properties.ts";
import { type ClosedForm, combine, spandrel } from "./closed-form.ts";
import {
  angle,
  flat,
  GENERATORS,
  NO_CONTEXT,
  rail,
  rhs,
  rod,
  threadedRod,
  tslot,
  tube,
} from "./generators/index.ts";
import type { GeneratedSection, GeneratorContext, GrooveDims } from "./generators/types.ts";

/** Design §12, M1: each generator matches its closed-form A and I within 0.1 %. */
const LIMIT = 0.001;

const grooves: Record<string, GrooveDims> = {
  c8: { opening_mm: 8.2, lip_mm: 2.2, depth_mm: 12.25, undercut_mm: 14.5 },
  c10: { opening_mm: 10.2, lip_mm: 3, depth_mm: 13, undercut_mm: 17 },
};
const ctx: GeneratorContext = { groove: (ref) => grooves[ref] };

function propsOf(g: GeneratedSection) {
  const region: Region = g.props ?? { outline: g.outline, holes: g.holes };
  return sectionProperties([region]);
}

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.abs(b);
}

/** Polygon against closed form: A, Ix, Iy within 0.1 %; Ixy within 0.1 % of the larger I. */
function expectMatch(g: GeneratedSection, cf: ClosedForm) {
  const p = propsOf(g);
  expect(rel(p.area_mm2, cf.area_mm2), "area").toBeLessThan(LIMIT);
  expect(rel(p.Ix_mm4, cf.Ix_mm4), "Ix").toBeLessThan(LIMIT);
  expect(rel(p.Iy_mm4, cf.Iy_mm4), "Iy").toBeLessThan(LIMIT);
  const scale = Math.max(cf.Ix_mm4, cf.Iy_mm4);
  expect(Math.abs(p.Ixy_mm4 - cf.Ixy_mm4) / scale, "Ixy").toBeLessThan(LIMIT);
  expect(Math.abs(p.centroid_mm[0] - cf.centroid_mm[0]), "cx").toBeLessThan(0.01);
  expect(Math.abs(p.centroid_mm[1] - cf.centroid_mm[1]), "cy").toBeLessThan(0.01);
  return p;
}

describe("closed-form primitives (the oracle)", () => {
  it("spandrel matches brute-force integration", () => {
    // Midpoint rule on a fine grid over the square, counting cells outside the quarter circle.
    const r = 5;
    const n = 1500;
    const h = r / n;
    let A = 0;
    let Sx = 0;
    let Sy = 0;
    let Sxx = 0;
    let Sxy = 0;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * h;
      for (let j = 0; j < n; j++) {
        const y = (j + 0.5) * h;
        if ((x - r) ** 2 + (y - r) ** 2 > r * r) {
          A += h * h;
          Sx += x * h * h;
          Sy += y * h * h;
          Sxx += x * x * h * h;
          Sxy += x * y * h * h;
        }
      }
    }
    const s = spandrel(0, 0, r, 1, 1);
    expect(rel(A, s.A)).toBeLessThan(2e-3);
    expect(rel(Sx / A, s.cx)).toBeLessThan(2e-3);
    expect(rel(Sy / A, s.cy)).toBeLessThan(2e-3);
    const cx = Sx / A;
    const cy = Sy / A;
    expect(rel(Sxx - A * cx * cx, s.Iyc)).toBeLessThan(5e-3);
    expect(rel(Sxy - A * cx * cy, s.Ixyc)).toBeLessThan(5e-3);
  });

  it("mirrors the spandrel's product of area with its direction", () => {
    expect(spandrel(0, 0, 3, -1, 1).Ixyc).toBeCloseTo(-spandrel(0, 0, 3, 1, 1).Ixyc, 12);
    expect(spandrel(0, 0, 3, -1, -1).Ixyc).toBeCloseTo(spandrel(0, 0, 3, 1, 1).Ixyc, 12);
  });

  it("gives the textbook values for a rectangle with a hole", () => {
    const cf = combine([
      [{ A: 40 * 40, cx: 0, cy: 0, Ixc: 40 ** 4 / 12, Iyc: 40 ** 4 / 12, Ixyc: 0 }, 1],
      [{ A: 20 * 20, cx: 0, cy: 0, Ixc: 20 ** 4 / 12, Iyc: 20 ** 4 / 12, Ixyc: 0 }, -1],
    ]);
    expect(cf.area_mm2).toBe(1200);
    expect(cf.Ix_mm4).toBe((40 ** 4 - 20 ** 4) / 12);
  });
});

describe("generators match their closed forms within 0.1 % (design §12, M1)", () => {
  it("tslot: a 40x40 box less four slots and a bore", () => {
    const p = tslot.params.parse({
      w_mm: 40,
      h_mm: 40,
      groove: "c8",
      bores: [{ at_mm: [0, 0], d_mm: 6.8 }],
    });
    expect(tslot.problems(p, ctx)).toEqual([]);
    const g = tslot.generate(p, ctx);
    const props = expectMatch(g, tslot.closedForm(p, ctx));
    expect(g.grooves.map((x) => x.face)).toEqual(["-y", "+x", "+y", "-x"]);
    expect(g.bbox_mm).toEqual([
      [-20, -20],
      [20, 20],
    ]);
    expect(props.bbox_mm).toEqual(g.bbox_mm);
    // Symmetric: no product of area, Ix = Iy.
    expect(Math.abs(props.Ixy_mm4)).toBeLessThan(1e-6 * props.Ix_mm4);
    expect(rel(props.Ix_mm4, props.Iy_mm4)).toBeLessThan(1e-9);
  });

  it("tslot: a 40x80 with two grooves on each long face and two bores", () => {
    const p = tslot.params.parse({
      w_mm: 40,
      h_mm: 80,
      groove: "c8",
      grooves: [
        { face: "-y", at_mm: 0 },
        { face: "+y", at_mm: 0 },
        { face: "+x", at_mm: -20 },
        { face: "+x", at_mm: 20 },
        { face: "-x", at_mm: 20 },
        { face: "-x", at_mm: -20 },
      ],
      bores: [
        { at_mm: [0, -20], d_mm: 6.8 },
        { at_mm: [0, 20], d_mm: 6.8 },
      ],
    });
    expect(tslot.problems(p, ctx)).toEqual([]);
    const g = tslot.generate(p, ctx);
    const props = expectMatch(g, tslot.closedForm(p, ctx));
    expect(props.Ix_mm4).toBeGreaterThan(3 * props.Iy_mm4);
    // Grooves come back in section coordinates, numbered by increasing coordinate per face.
    expect(g.grooves.filter((x) => x.face === "-x").map((x) => x.at_mm)).toEqual([20, -20]);
  });

  it("tslot: a groove type per groove", () => {
    const p = tslot.params.parse({
      w_mm: 45,
      h_mm: 45,
      groove: "c10",
      grooves: [
        { face: "+y", at_mm: 0, type: "c8" },
        { face: "-y", at_mm: 0 },
      ],
    });
    expect(tslot.problems(p, ctx)).toEqual([]);
    const g = tslot.generate(p, ctx);
    expectMatch(g, tslot.closedForm(p, ctx));
    expect(g.grooves.map((x) => x.type)).toEqual(["c8", "c10"]);
  });

  it("tslot: names unbuildable params", () => {
    const bad = tslot.params.parse({
      w_mm: 20,
      h_mm: 20,
      groove: "c8",
      grooves: [
        { face: "+y", at_mm: 0 },
        { face: "+x", at_mm: 0 },
        { face: "-x", at_mm: 7 },
      ],
      bores: [{ at_mm: [0, 0], d_mm: 6 }],
    });
    const problems = tslot.problems(bad, ctx).join("\n");
    expect(problems).toMatch(/runs off the face/);
    expect(problems).toMatch(/overlaps/);
    expect(
      tslot.problems(tslot.params.parse({ w_mm: 40, h_mm: 40, groove: "nope" }), ctx)[0],
    ).toMatch(/unknown groove type/);
  });

  it("tslot: a chamber that narrows to its bottom, on 40x40, 40x80 and 80x80 envelopes", () => {
    // The 40-series groove as measured on the 40x40 básico's vector outline (M2a): a 22 mm
    // chamber that would cross the neighbouring grooves' at the corners if it ran square to the
    // bottom.
    const c840: GrooveDims = {
      opening_mm: 8.18,
      lip_mm: 3.79,
      depth_mm: 9.99,
      undercut_mm: 22.01,
      taper_from_mm: 7.03,
      bottom_mm: 12.24,
    };
    const { taper_from_mm: _t, bottom_mm: _b, ...square } = c840;
    const types: Record<string, GrooveDims> = { c840, square };
    const tctx: GeneratorContext = { groove: (ref) => types[ref] };
    const cases = [
      { w_mm: 40, h_mm: 40, groove: "c840", bores: [{ at_mm: [0, 0], d_mm: 13.7 }] },
      {
        w_mm: 40,
        h_mm: 80,
        groove: "c840",
        grooves: [
          { face: "-y", at_mm: 0 },
          { face: "+x", at_mm: -20 },
          { face: "+x", at_mm: 20 },
          { face: "+y", at_mm: 0 },
          { face: "-x", at_mm: -20 },
          { face: "-x", at_mm: 20 },
        ],
        bores: [
          { at_mm: [0, -20], d_mm: 13.7 },
          { at_mm: [0, 20], d_mm: 13.7 },
        ],
      },
      {
        w_mm: 80,
        h_mm: 80,
        groove: "c840",
        grooves: (["-y", "+x", "+y", "-x"] as const).flatMap((face) => [
          { face, at_mm: -20 },
          { face, at_mm: 20 },
        ]),
        bores: [-20, 20].flatMap((x) => [-20, 20].map((y) => ({ at_mm: [x, y], d_mm: 13.7 }))),
      },
    ];
    for (const c of cases) {
      const p = tslot.params.parse(c);
      expect(tslot.problems(p, tctx), `${c.w_mm}x${c.h_mm}`).toEqual([]);
      const g = tslot.generate(p, tctx);
      expectMatch(g, tslot.closedForm(p, tctx));
      // Ten outline points per tapered slot plus the four corners.
      expect(g.outline).toHaveLength(4 + 10 * g.grooves.length);
    }
    // The same chamber run square to the bottom crosses its neighbour at each corner of a 40x40.
    const p = tslot.params.parse({ ...cases[0], groove: "square" });
    expect(tslot.problems(p, tctx).join("\n")).toMatch(/groove 0 overlaps groove 1/);
    // A taper must lie between the lip and the bottom, and fit inside the undercut.
    const bad: GrooveDims = { ...c840, taper_from_mm: 2, bottom_mm: 30 };
    const problems = tslot
      .problems(tslot.params.parse({ ...cases[0], groove: "bad" }), { groove: () => bad })
      .join("\n");
    expect(problems).toMatch(/taper_from_mm not between the lip and the depth/);
    expect(problems).toMatch(/bottom_mm not within the undercut/);
  });

  it("rhs: with outer and inner corner radii", () => {
    const p = rhs.params.parse({ b_mm: 50, h_mm: 100, t_mm: 3, ro_mm: 6 });
    expect(rhs.problems(p, NO_CONTEXT)).toEqual([]);
    const props = expectMatch(rhs.generate(p, NO_CONTEXT), rhs.closedForm(p, NO_CONTEXT));
    // A cross-check of the closed form itself: the sharp-cornered RHS minus the corners.
    const sharp = 50 * 100 - 44 * 94;
    const corners = (4 - Math.PI) * (6 ** 2 - 3 ** 2);
    expect(rel(props.area_mm2, sharp - corners)).toBeLessThan(LIMIT);
  });

  it("rhs: square, sharp corners, and an explicit inner radius", () => {
    for (const params of [
      { b_mm: 40, h_mm: 40, t_mm: 2 },
      { b_mm: 60, h_mm: 40, t_mm: 4, ro_mm: 8, ri_mm: 4 },
    ]) {
      const p = rhs.params.parse(params);
      expect(rhs.problems(p, NO_CONTEXT)).toEqual([]);
      expectMatch(rhs.generate(p, NO_CONTEXT), rhs.closedForm(p, NO_CONTEXT));
    }
    expect(rhs.problems(rhs.params.parse({ b_mm: 10, h_mm: 10, t_mm: 6 }), NO_CONTEXT)).not.toEqual(
      [],
    );
  });

  it("tube, rod, flat and rail", () => {
    const cases = [
      [tube, { d_mm: 33.7, t_mm: 2.6 }],
      [tube, { d_mm: 6, t_mm: 1 }],
      [rod, { d_mm: 10 }],
      [rod, { d_mm: 200 }],
      // A small radius: the flattening error must be relative, not grow as the radius shrinks.
      [rod, { d_mm: 1 }],
      [tube, { d_mm: 2, t_mm: 0.3 }],
      [flat, { b_mm: 50, t_mm: 6 }],
      [rail, { w_mm: 20, h_mm: 17.5 }],
    ] as const;
    for (const [gen, params] of cases) {
      const p = gen.params.parse(params);
      expect(gen.problems(p as never, NO_CONTEXT)).toEqual([]);
      expectMatch(gen.generate(p as never, NO_CONTEXT), gen.closedForm(p as never, NO_CONTEXT));
    }
    // The textbook numbers, so the closed forms are not only self-consistent.
    expect(rod.closedForm({ d_mm: 10 }, NO_CONTEXT).Ix_mm4).toBeCloseTo(
      (Math.PI * 10 ** 4) / 64,
      9,
    );
    expect(flat.closedForm({ b_mm: 50, t_mm: 6 }, NO_CONTEXT).Ix_mm4).toBeCloseTo(
      (50 * 6 ** 3) / 12,
      9,
    );
    expect(rail.generate({ w_mm: 20, h_mm: 17.5 }, NO_CONTEXT).datums).toEqual({
      mount: [0, -8.75],
      top: [0, 8.75],
    });
  });

  it("threaded rod: drawn at nominal size, properties from the stress area", () => {
    const p = threadedRod.params.parse({ d_mm: 10, pitch_mm: 1.5 });
    const g = threadedRod.generate(p, NO_CONTEXT);
    const props = expectMatch(g, threadedRod.closedForm(p, NO_CONTEXT));
    // ISO 898-1's tabulated stress area for M10 is 58.0 mm².
    expect(Math.abs(props.area_mm2 - 58.0)).toBeLessThan(0.1);
    expect(g.bbox_mm).toEqual([
      [-5, -5],
      [5, 5],
    ]);
  });

  it("angle: equal and unequal legs with root and toe radii", () => {
    for (const params of [
      { a_mm: 50, b_mm: 50, t_mm: 5, r1_mm: 7, r2_mm: 3.5 },
      { a_mm: 80, b_mm: 40, t_mm: 6, r1_mm: 7, r2_mm: 3.5 },
      { a_mm: 30, b_mm: 30, t_mm: 3 },
    ]) {
      const p = angle.params.parse(params);
      expect(angle.problems(p, NO_CONTEXT)).toEqual([]);
      const g = angle.generate(p, NO_CONTEXT);
      expectMatch(g, angle.closedForm(p, NO_CONTEXT));
      expect(g.datums.heel).toEqual([-p.b_mm / 2, -p.a_mm / 2]);
    }
    // EN 10056-1's area formula for an angle: t(a + b − t) + (1 − π/4)(r1² − 2 r2²).
    const cf = angle.closedForm(
      angle.params.parse({ a_mm: 50, b_mm: 50, t_mm: 5, r1_mm: 7, r2_mm: 3.5 }),
      NO_CONTEXT,
    );
    expect(cf.area_mm2).toBeCloseTo(5 * 95 + (1 - Math.PI / 4) * (49 - 2 * 12.25), 9);
  });

  it("every generator is tested here", () => {
    expect(Object.keys(GENERATORS).sort()).toEqual(
      ["angle", "flat", "rail", "rhs", "rod", "threaded-rod", "tslot", "tube"].sort(),
    );
  });
});
