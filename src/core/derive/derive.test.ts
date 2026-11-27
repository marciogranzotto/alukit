import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ItemSource } from "../items.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES } from "../testing.ts";
import { type Derived, derive } from "./derive.ts";

/**
 * Rules of design §4.3–§4.7 that the golden table and the cart do not pin down on their own:
 * runs and their joints, pattern offsets and directions, grooves and the signs of a station's
 * offset, sec(), a pivot's range, the warnings, explicit planes and a body at a pose.
 */

let items: ItemSource;
beforeAll(async () => {
  items = (await openProject(join(FIXTURES, "golden-ends", "G01"))).items;
});

function run(doc: Record<string, unknown>): Derived {
  return derive(
    {
      schema: "alukit.project/1",
      defaults: { bar: { item: "test:TS40", opt: { finish: "anodised" } } },
      ...doc,
    },
    items,
  );
}

const codes = (d: Derived, severity = "error") =>
  d.diagnostics.filter((x) => x.severity === severity).map((x) => [x.code, x.entity]);
const point = (d: Derived, id: string) => d.nodes.get(id)?.map((v) => Math.round(v * 100) / 100);
const cut = (d: Derived, id: string) =>
  Math.round((d.bars.get(id)?.lengths.cut ?? NaN) * 100) / 100;

describe("runs (§4.3)", () => {
  const spliced = {
    bars: {
      b1: { a: [0, 0, 0], b: [700, 0, 0] },
      b2: { a: [700, 0, 0], b: [1200, 0, 0] },
      b3: { a: [0, 100, 0], b: [700, 100, 0] },
      b4: { a: [700, 100, 0], b: [1200, 100, 0] },
    },
    connections: { c1: { type: "splice", ends: ["b1.b", "b2.a"] } },
    runs: { r1: ["b1", "b2"], r2: ["b3", "b4"] },
  };

  it("measures a station along the run and lands it on the piece that holds it", () => {
    const d = run({
      ...spliced,
      nodes: {
        n1: { on: { bar: "r1", at_mm: 900 } },
        n2: { on: { bar: "r1", at_mm: 100, from: "b", face: "+y" } },
        n3: { on: { bar: "r1", at_mm: 300 } },
      },
    });
    expect(point(d, "n1")).toEqual([900, 0, 0]);
    expect(point(d, "n2")).toEqual([1100, 0, 20]);
    expect(point(d, "n3")).toEqual([300, 0, 0]);
    expect(d.runs.get("r1")?.len).toBe(1200);
  });

  it("refuses a station on a joint, and a run that is not spliced in order", () => {
    const d = run({
      ...spliced,
      nodes: {
        n1: { on: { bar: "r1", at_mm: 700.005 } },
        n2: { on: { bar: "r2", at_mm: 100 } },
      },
    });
    expect(codes(d)).toEqual([
      ["joint", "n1"],
      ["ref", "n2"],
      ["run", "r2"],
    ]);
  });
});

describe("patterns (§4.7)", () => {
  it("translates copies by offsets, along a direction, and skips stations", () => {
    const d = run({
      bars: {
        b1: { a: [0, 0, 0], b: [1000, 0, 0] },
        b2: { a: { on: { bar: "b1", at_mm: 100 } }, b: [100, 500, 0] },
        b3: { a: [0, 0, 0], b: [0, 100, 0] },
      },
      patterns: {
        pt1: { template: ["b2"], along: "b1", offsets_mm: [50, 250] },
        pt2: { template: ["b3"], along: { dir: [0, 0, 2] }, pitch_mm: 100, count: 4, skip: [2, 9] },
      },
    });
    const A = (id: string) => d.bars.get(id)?.placed.A;
    const B = (id: string) => d.bars.get(id)?.placed.B;
    expect([A("b2@1"), B("b2@1")]).toEqual([
      [150, 0, 0],
      [150, 500, 0],
    ]);
    expect(A("b2@2")).toEqual([350, 0, 0]);
    expect([...d.bars.keys()].filter((k) => k.startsWith("b3"))).toEqual(["b3", "b3@1", "b3@3"]);
    expect(A("b3@3")).toEqual([0, 0, 300]);
    expect(codes(d, "warn")).toEqual([["pattern", "pt2"]]);
  });

  it("remaps references inside the template and keeps those outside", () => {
    const d = run({
      nodes: { n1: [0, 0, 0], n2: [0, 300, 0] },
      bars: { b1: { a: [0, 0, 0], b: [1000, 0, 0] }, b2: { a: "n1", b: "n2" } },
      patterns: { pt1: { template: ["n2", "b2"], along: "b1", pitch_mm: 100, count: 2 } },
    });
    expect(d.bars.get("b2@1")?.placed.A).toEqual([0, 0, 0]); // n1 is outside: kept
    expect(d.bars.get("b2@1")?.placed.B).toEqual([100, 300, 0]); // n2@1 is the copy
  });

  it("refuses an entity in two templates", () => {
    const d = run({
      bars: { b1: { a: [0, 0, 0], b: [1000, 0, 0] }, b2: { a: [0, 0, 0], b: [0, 100, 0] } },
      patterns: {
        pt1: { template: ["b2"], along: "b1", pitch_mm: 100, count: 2 },
        pt2: { template: ["b2"], along: "b1", pitch_mm: 50, count: 2 },
      },
    });
    expect(codes(d)).toEqual([["pattern", "pt2"]]);
  });
});

describe("stations on faces and grooves (§4.3)", () => {
  it("numbers grooves by section coordinate and signs off_mm as P16 says", () => {
    // A 40x80 along +X: local x = +Y, y = +Z. Its +x face is Y = 20, with grooves at
    // section y = -20 (+x.1) and +20 (+x.2).
    const d = run({
      bars: { b1: { item: "test:TS4080", a: [0, 0, 0], b: [1000, 0, 0] } },
      nodes: {
        n1: { on: { bar: "b1", at_mm: 100, groove: "+x.2" } },
        n2: { on: { bar: "b1", at_mm: 100, face: "+x", off_mm: [5, 3] } },
        n3: { on: { bar: "b1", at_mm: 0, face: "+y", off_mm: [5, 3] } },
        n4: { on: { bar: "b1", at_mm: 0, face: "-x", off_mm: [5, 3] } },
        n5: { on: { bar: "b1", at_mm: 0, groove: "+x.3" } },
      },
    });
    expect(point(d, "n1")).toEqual([100, 20, 20]);
    // ±x faces: u along local +y (world +Z), v along the outward normal.
    expect(point(d, "n2")).toEqual([100, 23, 5]);
    expect(point(d, "n4")).toEqual([0, -23, 5]);
    // ±y faces: u along local +x (world +Y).
    expect(point(d, "n3")).toEqual([0, 5, 43]);
    expect(codes(d)).toEqual([["station", "n5"]]);
  });
});

describe("expressions in documents (§4.9)", () => {
  it("reads a bar's section with sec(), and refuses derived-model accessors", () => {
    const d = run({
      params: {
        T: "sec(b2).t_mm + 2.5",
        Hh: "sec(b1).height_mm / 2",
        L: "len(b1)",
      },
      bars: {
        b1: { item: "test:TS4080", a: [0, 0, 0], b: ["10 * Hh", 0, 0] },
        b2: { item: "test-geo:RHS-100x50x4", a: [0, 100, 0], b: [100, 100, "T"] },
      },
    });
    expect(d.params.get("T")).toBe(6.5);
    expect(d.params.get("Hh")).toBe(40);
    expect(cut(d, "b1")).toBe(400);
    expect(codes(d)).toEqual([["expr", "L"]]);
  });
});

describe("pivots (§4.5)", () => {
  it("checks the angle against the hinge's range, a check that moves nothing", () => {
    const d = run({
      bars: {
        b1: { a: [0, 0, 0], b: [1000, 0, 0] },
        b2: { a: { pivot: "c1" }, b: [800, 0, -300] },
      },
      connections: {
        c1: {
          type: "pivot",
          base: { bar: "b1", at_mm: 500, face: "+y" },
          axis: "across",
          connector: "test-geo:HNG-15",
          ends: ["b2.a"],
        },
      },
    });
    expect(codes(d)).toEqual([["pivot-range", "c1"]]);
    expect(d.pivots.get("c1")?.P).toEqual([500, 0, 35]);
    expect(cut(d, "b2")).toBe(Math.round((Math.hypot(300, 335) - 25) * 100) / 100);
  });
});

describe("warnings (§4.5)", () => {
  it("covers with no crossing: the through end stops at its node", () => {
    const d = run({
      bars: {
        b1: { item: "test:TS4080", a: [0, 0, 0], b: [1000, 0, 0], roll_deg: 90 },
        b2: { a: [500, 25, 600], b: [500, 25, 0] },
      },
      connections: {
        c1: {
          type: "butt",
          through: "b1",
          ends: ["b2.b"],
          through_end: { end: "b", mode: "cover" },
        },
      },
    });
    // And b2's end face, 25 off b1's centre line, reaches 5 past b1's 80-wide top (§4.5).
    expect(codes(d, "warn")).toEqual([
      ["cover-none", "b1.b"],
      ["connection", "c1"],
    ]);
    expect(d.butts.get("c1")?.ends[0]?.overhang).toBeCloseTo(5, 9);
    expect([cut(d, "b1"), cut(d, "b2")]).toEqual([1000, 580]);
  });

  it("an end far from its face", () => {
    const d = run({
      bars: { b1: { a: [0, 0, 0], b: [1000, 0, 0] }, b2: { a: [500, 0, 600], b: [500, 0, -200] } },
      connections: { c1: { type: "butt", through: "b1", ends: ["b2.b"] } },
    });
    expect(codes(d, "warn")).toEqual([["end-far", "b2.b"]]);
    expect(cut(d, "b2")).toBe(580);
  });
});

describe("bar options (§3.6)", () => {
  it("takes the defaults only for options the item has, and refuses values it does not offer", () => {
    const d = run({
      bars: {
        b1: { a: [0, 0, 0], b: [500, 0, 0], opt: { finish: "black" } },
        b2: { item: "test-geo:FB-50x10", a: [0, 100, 0], b: [500, 100, 0] },
        b3: { a: [0, 200, 0], b: [500, 200, 0], opt: { finish: "gold" } },
        b4: { a: [0, 300, 0], b: [500, 300, 0], opt: { colour: "red" } },
      },
    });
    expect(d.bars.get("b1")?.placed.opt).toEqual({ finish: "black" });
    expect(d.bars.get("b2")?.placed.opt).toEqual({});
    expect(codes(d)).toEqual([
      ["option", "b3"],
      ["option", "b4"],
    ]);
    expect(cut(d, "b3")).toBe(500); // placed all the same
  });
});

describe("butts (§4.5)", () => {
  const g17 = (conn: Record<string, unknown>) =>
    run({
      bars: {
        b1: { a: [0, 0, 0], b: [1000, 0, 0] },
        b2: { a: [2600, 1200, 0], b: [1000, 0, 0], ends: { b: { cut: "angle" } } },
      },
      connections: { c1: { type: "butt", through: "b1.b", ends: ["b2.b"], ...conn } },
    });
  const centre = (d: Derived) => Math.round((d.bars.get("b2")?.lengths.centre ?? 0) * 100) / 100;

  it("takes the spacer from the connector unless given (G17's 8 mm, from an end plate)", () => {
    expect(centre(g17({ connector: "test-geo:PLT-8" }))).toBe(1990);
    expect(centre(g17({ connector: "test-geo:PLT-8", spacer_mm: 0 }))).toBe(2000);
  });

  it("refuses an end named twice, and through_end where there is no through bar", () => {
    const d = run({
      bars: { b1: { a: [0, 0, 0], b: [1000, 0, 0] }, b2: { a: [1000, 0, 0], b: [1000, 600, 0] } },
      connections: {
        c1: { type: "butt", through: "b1", ends: ["b2.a", "b2.a"] },
        c2: {
          type: "butt",
          through: { body: "test-geo:CUBE-40", at: [0, 0, 0] },
          ends: ["b1.a"],
          through_end: "node",
        },
      },
    });
    expect(codes(d)).toEqual([
      ["connection", "c1"],
      ["connection", "c2"],
    ]);
    expect(cut(d, "b2")).toBe(580);
  });
});

describe("explicit planes and bodies (§4.5)", () => {
  it("cuts on a plane given by a point and a normal; an angled one needs its cut", () => {
    const d = run({
      bars: {
        b1: {
          a: [0, 0, 0],
          b: [1000, 0, 0],
          ends: { b: { plane: { point: [900, 0, 0], normal: [-2, 0, 0] } } },
        },
        b2: {
          a: [0, 100, 0],
          b: [1000, 100, 0],
          ends: { b: { plane: { point: [900, 100, 0], normal: [1, 1, 0] } } },
        },
      },
    });
    expect(cut(d, "b1")).toBe(900);
    expect(d.bars.get("b1")?.ends.b.normal.map((v) => v + 0)).toEqual([1, 0, 0]);
    expect(codes(d)).toEqual([["angled-end", "b2.b"]]);
    expect(cut(d, "b2")).toBe(1000);
  });

  it("takes a plane's normal from a bar's axis; a missing bar is a ref error", () => {
    const d = run({
      bars: {
        b1: {
          a: [0, 0, 0],
          b: [1000, 0, 0],
          ends: { b: { plane: { point: [900, 50, 0], normal: "b1" } } },
        },
        b2: {
          a: [0, 100, 0],
          b: [1000, 100, 0],
          ends: { b: { plane: { point: [900, 100, 0], normal: "b3" }, cut: "angle" } },
        },
        b3: { a: [0, 0, 0], b: [300, 300, 0] },
        b4: {
          a: [0, 200, 0],
          b: [1000, 200, 0],
          ends: { b: { plane: { point: [900, 200, 0], normal: "b9" } } },
        },
      },
    });
    expect(codes(d)).toEqual([["ref", "b4.b"]]);
    // Square to its own axis: a plain square cut through the point's station.
    expect(cut(d, "b1")).toBe(900);
    // Square to b3, at 45° to b2: the long point is 20 past the centre line.
    expect(Math.round((d.bars.get("b2")?.ends.b.angle ?? 0) * 100) / 100).toBe(45);
    expect(cut(d, "b2")).toBe(920);
    expect(cut(d, "b4")).toBe(1000);
  });

  it("refuses a plane parallel to the axis", () => {
    const d = run({
      bars: {
        b1: {
          a: [0, 0, 0],
          b: [1000, 0, 0],
          ends: { b: { plane: { point: [900, 0, 0], normal: [0, 1, 0] } } },
        },
      },
    });
    expect(codes(d)).toEqual([["plane", "b1.b"]]);
  });

  it("butts into a body at a rotated pose", () => {
    const d = run({
      bars: { b1: { a: [500, 0, 0], b: [0, 0, 0], ends: { b: { cut: "angle" } } } },
      connections: {
        c1: {
          type: "butt",
          through: { body: "test-geo:CUBE-40", at: { pos: [0, 0, 0], rot_deg: [0, 0, 30] } },
          ends: ["b1.b"],
        },
      },
    });
    expect(codes(d)).toEqual([]);
    const b = d.bars.get("b1");
    expect(Math.round((b?.lengths.centre ?? 0) * 100) / 100).toBe(
      Math.round((500 - 20 / Math.cos(Math.PI / 6)) * 100) / 100,
    );
    expect(Math.round((b?.ends.b.angle ?? 0) * 100) / 100).toBe(30);
  });
});
