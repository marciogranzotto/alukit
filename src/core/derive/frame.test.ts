import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ItemSource } from "../items.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES } from "../testing.ts";
import type { V3 } from "../vec.ts";
import { derive } from "./derive.ts";
import { barFrame } from "./place.ts";

/** The frame table of design §4.4, the golden set for orientation. */

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];
const Z: V3 = [0, 0, 1];
const neg = (v: V3): V3 => [0 - v[0], 0 - v[1], 0 - v[2]];

function frameOf(a: V3, b: V3) {
  const f = barFrame([b[0] - a[0], b[1] - a[1], b[2] - a[2]], undefined, 0);
  if ("problem" in f) throw new Error(f.problem);
  return f;
}

function close(got: V3, want: V3, tol = 1e-9) {
  for (let i = 0; i < 3; i++)
    expect(Math.abs((got[i] as number) - (want[i] as number))).toBeLessThan(tol);
}

describe("bar frames (design §4.4 table)", () => {
  const rows: [string, V3, V3, V3, V3][] = [
    ["along +X", [0, 0, 0], [1000, 0, 0], Y, Z],
    ["along −X: reversing a bar mirrors local x", [1000, 0, 0], [0, 0, 0], neg(Y), Z],
    ["along +Y", [0, 0, 0], [0, 1000, 0], neg(X), Z],
    ["vertical, upward", [0, 0, 0], [0, 0, 900], X, Y],
    ["vertical, downward", [0, 0, 900], [0, 0, 0], neg(X), Y],
  ];
  for (const [name, a, b, x, y] of rows) {
    it(`${name}: local x and y exactly`, () => {
      const { frame } = frameOf(a, b);
      expect(frame.x).toEqual(x.map((v) => v + 0)); // exact, and never -0 against +0
      expect(frame.y.map((v) => v + 0)).toEqual(y);
    });
  }

  it("top node at x = 0.1 + 0.2 − 0.3 (5.6e-17 mm): vertical within tol.vert, no flip", () => {
    const top = 0.1 + 0.2 - 0.3;
    expect(top).toBeGreaterThan(0);
    const f = frameOf([0, 0, 0], [top, 0, 900]);
    expect(f.vertical).toBe(true);
    close(f.frame.x, X);
    close(f.frame.y, Y);
  });

  it("900 mm leaning 0.01 mm toward +Y: not vertical, −X and −Y, near-vertical", () => {
    const f = frameOf([0, 0, 0], [0, 0.01, 900]);
    expect(f.vertical).toBe(false);
    expect(f.nearVertical).toBe(true);
    close(f.frame.x, neg(X), 1e-6);
    close(f.frame.y, neg(Y), 1e-4);
  });

  it("rolls counter-clockwise seen from B, exactly at multiples of 90°", () => {
    const r90 = barFrame([1000, 0, 0], undefined, 90);
    const r180 = barFrame([1000, 0, 0], undefined, -180);
    if ("problem" in r90 || "problem" in r180) throw new Error("no frame");
    // Along +X, x = +Y and y = +Z; a quarter turn about +X takes +Y to +Z and +Z to −Y.
    expect(r90.frame.x).toEqual(Z);
    expect(r90.frame.y.map((v) => v + 0)).toEqual(neg(Y));
    expect(r180.frame.x.map((v) => v + 0)).toEqual(neg(Y));
    expect(r180.frame.y.map((v) => v + 0)).toEqual([0, 0, -1]);
  });

  it("refuses an up parallel to the axis and a zero-length bar", () => {
    expect(barFrame([0, 0, 900], Z, 0)).toEqual({ problem: "up-parallel" });
    expect(barFrame([0, 0, 0.001], undefined, 0)).toEqual({ problem: "zero-length" });
  });
});

describe("frames in a derived document", () => {
  let items: ItemSource;
  beforeAll(async () => {
    items = (await openProject(join(FIXTURES, "golden-ends", "G01"))).items;
  });
  const doc = (bars: Record<string, unknown>) => ({
    schema: "alukit.project/1",
    defaults: { bar: { item: "test:TS4080", opt: { finish: "anodised" } } },
    bars,
  });

  it("warns about a near-vertical bar without up, and not with one", () => {
    const d = derive(
      doc({
        b1: { a: [0, 0, 0], b: [0, 0.01, 900] },
        b2: { a: [100, 0, 0], b: [100, 0.01, 900], up: "+y" },
      }),
      items,
    );
    expect(d.diagnostics.map((x) => [x.severity, x.code, x.entity])).toEqual([
      ["warn", "near-vertical", "b1"],
    ]);
  });

  it("places a rolled 40x80 with corners at exactly ±20 and ±40", () => {
    const d = derive(doc({ b1: { a: [0, 0, 0], b: [1200, 0, 0], roll_deg: 90 } }), items);
    const b = d.bars.get("b1")?.placed;
    expect(b?.box).toEqual({ x0: -20, x1: 20, y0: -40, y1: 40 });
    expect(b?.frame.x).toEqual(Z);
    expect(b?.frame.y.map((v) => v + 0)).toEqual(neg(Y));
  });

  it("puts an anchor's point on the design line, and offsets along the section's own axes", () => {
    const d = derive(
      doc({
        b1: { a: [0, 0, 0], b: [1000, 0, 0], anchor: "-x+y" },
        b2: { a: [0, 0, 0], b: [1000, 0, 0], anchor: "c", off_mm: [5, -10] },
      }),
      items,
    );
    expect(d.bars.get("b1")?.placed.box).toEqual({ x0: 0, x1: 40, y0: -80, y1: 0 });
    expect(d.bars.get("b2")?.placed.box).toEqual({ x0: -15, x1: 25, y0: -50, y1: 30 });
  });
});
