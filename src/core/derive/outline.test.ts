import { describe, expect, it } from "vitest";
import { angle } from "#catalog/sections/generators/angle.ts";
import { rhs } from "#catalog/sections/generators/rhs.ts";
import { NO_CONTEXT } from "#catalog/sections/generators/types.ts";
import type { Face } from "../project/schema.ts";
import type { Vec2 } from "../section-properties.ts";
import { materialAlong, sectionOutlineFaces } from "./outline.ts";

/** A section's inner faces and the material on a line (gap A3, design §4.5). */

const r2 = (x: number) => Math.round(x * 100) / 100;
const faces = (outline: Vec2[], grooves: Face[] = []) =>
  sectionOutlineFaces({ draw: { outline }, grooves: grooves.map((face) => ({ face })) }).inner.map(
    (f) => [f.name, f.a.map(r2), f.b.map(r2)],
  );
const axisAligned = (outline: readonly Vec2[]) =>
  sectionOutlineFaces({ draw: { outline }, grooves: [] }).inner.filter(
    (f) => Math.abs(f.n[0]) === 1 || Math.abs(f.n[1]) === 1,
  );

// The synthetic channel of test-open: 100 tall, flanges 50 x 8, web 6 on −x, open toward +x.
const channel: Vec2[] = [
  [-25, -50],
  [25, -50],
  [25, -42],
  [-19, -42],
  [-19, 42],
  [25, 42],
  [25, 50],
  [-25, 50],
];

// A 40 x 40 with a groove (opening 8, depth 6) in its +y face and a mark 0.2 deep at 11..13.
const slotted: Vec2[] = [
  [-20, -20],
  [20, -20],
  [20, 20],
  [13, 20],
  [13, 19.8],
  [11, 19.8],
  [11, 20],
  [4, 20],
  [4, 14],
  [-4, 14],
  [-4, 20],
  [-20, 20],
];

describe("inner faces", () => {
  it("a channel's: both flanges' inner faces and the web's", () => {
    expect(faces(channel)).toEqual([
      ["+y@-42.00", [25, -42], [-19, -42]],
      ["+x@-19.00", [-19, -42], [-19, 42]],
      ["-y@42.00", [-19, 42], [25, 42]],
    ]);
    // Given clockwise, the ring is turned counter-clockwise first: the same faces.
    expect(faces([...channel].reverse()).map(([n]) => n)).toEqual([
      "+y@-42.00",
      "+x@-19.00",
      "-y@42.00",
    ]);
  });

  it("an angle's: its two inside leg faces, between the root and toe radii", () => {
    // Legs 76.2, thickness 6.35, root 9.525, toe 4.76; heel at (−38.1, −38.1).
    const g = angle.generate(
      angle.params.parse({ a_mm: 76.2, b_mm: 76.2, t_mm: 6.35, r1_mm: 9.525, r2_mm: 4.76 }),
      NO_CONTEXT,
    );
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    const legs = axisAligned(g.outline).map((f) => [f.name, f.a.map(r3), f.b.map(r3)]);
    // −38.1 + 6.35 + 9.525 = −22.225 (the root's end), 38.1 − 4.76 = 33.34 (the toe's start).
    expect(legs).toEqual([
      ["+y@-31.75", [33.34, -31.75], [-22.225, -31.75]],
      ["+x@-31.75", [-31.75, -22.225], [-31.75, 33.34]],
    ]);
  });

  it("an RHS has none square to its sides: only its corner radii's chords", () => {
    const g = rhs.generate(
      rhs.params.parse({ h_mm: 100, b_mm: 50, t_mm: 4, ro_mm: 6 }),
      NO_CONTEXT,
    );
    expect(axisAligned(g.outline)).toEqual([]);
  });

  it("closes a grooved side's groove and marks: a T-slot's face is its bounding plane", () => {
    expect(faces(slotted, ["+y"])).toEqual([]);
    // Undeclared, the mark's and the groove's walls and floors are faces, each facing out of
    // the material: the mark's wall at x = 13 faces −x, its floor +y.
    expect(faces(slotted).map(([n]) => n)).toEqual([
      "-x@13.00",
      "+y@19.80",
      "+x@11.00",
      "-x@4.00",
      "+y@14.00",
      "+x@-4.00",
    ]);
  });

  it("keeps an excursion from an ungrooved side: a channel's open side stays open", () => {
    // A groove declared on −x does not touch the +x side's opening.
    expect(faces(channel, ["-x"]).length).toBe(3);
  });
});

describe("material along a line", () => {
  it("crosses a channel's flanges, its web, or nothing", () => {
    expect(materialAlong(channel, [3, 0], [0, 1])).toEqual([
      [-50, -42],
      [42, 50],
    ]);
    expect(materialAlong(channel, [-22, 0], [0, 1])).toEqual([[-50, 50]]);
    expect(materialAlong(channel, [0, 0], [1, 0])).toEqual([[-25, -19]]);
    expect(materialAlong(channel, [0, 60], [1, 0])).toEqual([]);
  });

  it("counts a line through a vertex or along an edge once", () => {
    // Along the web's inner face (x = −19) and through the inner corners.
    expect(materialAlong(channel, [-19, 0], [0, 1])).toEqual([[-50, 50]]);
    // Through the toe corners' line y = 42, from the left.
    expect(materialAlong(channel, [0, 42], [1, 0]).length).toBeGreaterThan(0);
  });
});
