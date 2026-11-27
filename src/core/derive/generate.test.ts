import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bom } from "../bom/bom.ts";
import { bomCsv, bomMarkdown } from "../bom/format.ts";
import { cutList } from "../cutlist/cutlist.ts";
import type { ItemSource } from "../items.ts";
import { order } from "../order/order.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES, mergePatch } from "../testing.ts";
import { sleeveHole } from "../threads.ts";
import { type Derived, derive } from "./derive.ts";

/**
 * Generation rules of design §3.4, §4.5 and §4.7 that G22–G25 and the cart do not pin down on
 * their own: a connector's requires, a screw's tap, T-nut and carriage fit, a part's frame with
 * no face, end distances given or out of range, and the warnings. Every expected value is worked
 * by hand in the comments.
 */

let items: ItemSource;
beforeAll(async () => {
  items = (await openProject(join(FIXTURES, "golden-gen", "G25"))).items;
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

const diags = (d: Derived, severity = "error") =>
  d.diagnostics.filter((x) => x.severity === severity).map((x) => [x.code, x.entity]);
const r2 = (x: number) => Math.round(x * 100) / 100;
const ops = (d: Derived, id: string) =>
  (d.bars.get(id)?.ops ?? []).map((o) =>
    o.op === "hole"
      ? {
          op: o.op,
          face: o.face,
          at: r2(o.at),
          ...(o.across !== undefined ? { across: r2(o.across) } : {}),
          ...(o.d !== undefined ? { d: o.d } : {}),
          ...(o.thread !== undefined ? { thread: o.thread } : {}),
          ...(o.depth !== undefined ? { depth: r2(o.depth) } : {}),
          by: o.by,
        }
      : o,
  );
const hardware = (d: Derived) =>
  Object.fromEntries(
    [...new Set(d.hardware.map((h) => h.item))].map((i) => [
      i,
      d.hardware.filter((h) => h.item === i).reduce((s, h) => s + h.qty, 0),
    ]),
  );

describe("a connector's requires (§3.4)", () => {
  // A 40x40 crossbar b2 along +y from (500, 0, 0) butts into b1 (along +x, centred on the
  // x axis, y −20..20): its end a stops on b1's face y = 20, 20 from its design point.
  const tee = {
    bars: {
      b1: { a: [0, 0, 0], b: [1000, 0, 0] },
      b2: { a: [500, 0, 0], b: [500, 500, 0] },
    },
    connections: {
      c1: { type: "butt", through: "b1", ends: ["b2.a"], connector: "test-gen:END-40" },
    },
  };

  it("taps the butting end, drills its access hole and the through bar where it lands", () => {
    const d = run(tee);
    expect(diags(d)).toEqual([]);
    expect(r2(d.bars.get("b2")?.lengths.cut ?? 0)).toBe(480);
    // End tap M8, 20 deep, in b2's end a; the access hole Ø7, 10 deep, 20 in from that end:
    // at 20 + 20 = 40 from the design point, on the face the requires name (+y).
    expect(ops(d, "b2")).toEqual([
      { op: "end-tap", from: "a", thread: "M8", depth: 20, by: "c1" },
      { op: "hole", face: "+y", at: 40, d: 7, depth: 10, by: "c1" },
    ]);
    // b1's frame: t = +X, y = +Z, x = y × t = +Y; b2's centre line meets b1 at x = 500 on its
    // world +Y face, which is b1's local +x. Centred, so nothing across.
    expect(ops(d, "b1")).toEqual([{ op: "hole", face: "+x", at: 500, d: 8.5, by: "c1" }]);
    expect(hardware(d)).toEqual({ "test-gen:END-40": 1 });
  });

  it("counts one connector per butting end, and lists the piece's hole from its own end a", () => {
    const d = run({
      ...tee,
      bars: { ...tee.bars, b3: { a: [700, 500, 0], b: [700, 0, 0] } },
      connections: {
        c1: { type: "butt", through: "b1", ends: ["b2.a", "b3.b"], connector: "test-gen:END-40" },
      },
    });
    expect(diags(d)).toEqual([]);
    expect(hardware(d)).toEqual({ "test-gen:END-40": 2 });
    // b3 runs −Y, its end b on b1's face: sb = 480 from its design point, the hole 20 back.
    expect(ops(d, "b3")).toEqual([
      { op: "end-tap", from: "b", thread: "M8", depth: 20, by: "c1" },
      { op: "hole", face: "+y", at: 460, d: 7, depth: 10, by: "c1" },
    ]);
    // In the cut list, both crossbars are 480 with the tap at one end and the hole 20 from it:
    // b3 turned end for end is b2, so one line of two.
    const cl = cutList({ derived: d, items });
    const g = cl.groups.find((x) => x.item === "test:TS40");
    expect(g?.lines.map((l) => [l.count, l.cut_mm, l.sources])).toEqual([
      [1, 1000, ["b1"]],
      [2, 480, ["b2", "b3"]],
    ]);
  });

  it("refuses a connector that does not fit the bars' system", () => {
    const d = run({
      ...tee,
      bars: { ...tee.bars, b2: { ...tee.bars.b2, item: "test-geo:FB-50x10" } },
    });
    expect(diags(d)).toEqual([["fit", "c1"]]);
  });
});

describe("face fastenings (§4.5)", () => {
  // Flat 50x20 (b2, z 10..30) screwed down into flat 50x10 (b1, z 0..10), two screws.
  const flats = {
    bars: {
      b1: { item: "test-geo:FB-50x10", a: [0, 0, 0], b: [400, 0, 0], anchor: "-y" },
      b2: { item: "test-geo:FB-50x20", a: [0, 0, 10], b: [400, 0, 10], anchor: "-y" },
    },
  };

  it("clears the screw through the layers before the last and taps the last", () => {
    const d = run({
      ...flats,
      connections: {
        c1: {
          type: "face",
          bars: ["b2", "b1"],
          fastening: "screw",
          fastener: "test-gen:SCR-M5x25",
          stations: { at_mm: [100, 300] },
        },
      },
    });
    expect(diags(d)).toEqual([]);
    // ISO 273 medium for M5: Ø5.5. A flat lying flat (anchor −y): its top is local +y.
    expect(ops(d, "b2")).toEqual([
      { op: "hole", face: "+y", at: 100, d: 5.5, by: "c1" },
      { op: "hole", face: "+y", at: 300, d: 5.5, by: "c1" },
    ]);
    expect(ops(d, "b1")).toEqual([
      { op: "hole", face: "+y", at: 100, thread: "M5", by: "c1" },
      { op: "hole", face: "+y", at: 300, thread: "M5", by: "c1" },
    ]);
    // The grip leaves out the tapped layer: b2's 20.
    expect(d.fastenings.get("c1")?.stations.map((s) => r2(s.grip))).toEqual([20, 20]);
    expect(hardware(d)).toEqual({ "test-gen:SCR-M5x25": 2 });
  });

  it("puts a T-nut only in a grooved bar it fits", () => {
    const flat = run({
      ...flats,
      connections: {
        c1: {
          type: "face",
          bars: ["b2", "b1"],
          fastening: "tnut",
          fastener: "test-gen:SCR-M5x25",
          stack: ["test-gen:TNUT-M5"],
          stations: { at_mm: [100] },
        },
      },
    });
    // A flat bar has no groove for it.
    expect(diags(flat)).toEqual([["fit", "c1"]]);
    expect(flat.diagnostics[0]?.message).toContain("no groove of b1's face +y");

    // On a 40x40 (system s40-c8, groove c8), the flat's 20 and the groove's lip make the grip,
    // and the T-nut's own hole is not drilled.
    const slot = run({
      bars: {
        b1: { a: [0, 0, 0], b: [400, 0, 0], anchor: "-y" },
        b2: { item: "test-geo:FB-50x20", a: [0, 0, 40], b: [400, 0, 40], anchor: "-y" },
      },
      connections: {
        c1: {
          type: "face",
          bars: ["b2", "b1"],
          fastening: "tnut",
          fastener: "test-gen:SCR-M5x25",
          stack: ["test-gen:TNUT-M5"],
          stations: { at_mm: [100] },
        },
      },
    });
    expect(diags(slot)).toEqual([]);
    expect(ops(slot, "b1")).toEqual([]);
    expect(ops(slot, "b2")).toEqual([{ op: "hole", face: "+y", at: 100, d: 5.5, by: "c1" }]);
    expect(hardware(slot)).toEqual({ "test-gen:SCR-M5x25": 1, "test-gen:TNUT-M5": 1 });
  });

  it("refuses layers that do not touch", () => {
    const d = run({
      bars: {
        ...flats.bars,
        b2: { ...flats.bars.b2, a: [0, 0, 12], b: [400, 0, 12] },
      },
      connections: {
        c1: {
          type: "face",
          bars: ["b2", "b1"],
          fastening: "screw",
          fastener: "test-gen:SCR-M5x25",
          stations: { at_mm: [100] },
        },
      },
    });
    expect(diags(d)).toEqual([["face", "c1"]]);
  });
});

describe("sleeves cut from stock (§4.5)", () => {
  it("widens the walls a sleeve passes and counterbores a layer it enters part way", async () => {
    const g25 = await openProject(join(FIXTURES, "golden-gen", "G25"));
    // G25's stack along +z: b1 0..10, b2 10..30, the RHS b3 30..80 (walls 30..34 and 76..80),
    // b4 80..100, b5 100.5..110.5. A 50 mm sleeve stands on the nut-side inner wall (z 76) and
    // reaches back to z 26: through the entry wall whole, and 4 into b2's top. The sleeve's
    // holes take ISO 273 medium for its 18 mm outside: 20 (acceptance gap A7; it was 18).
    const raw = mergePatch(g25.raw, {
      connections: {
        c1: {
          stack: [
            "test-geo:WSH-M10",
            "test-geo:NUT-M10",
            { item: "test-geo:TUBE-18x2", inside: "b3", len_mm: 50 },
            "test-geo:WSH-M10",
            "test-geo:NUT-M10",
          ],
        },
      },
    });
    const d = derive(raw, g25.items);
    expect(diags(d)).toEqual([]);
    const b2 = d.bars.get("b2")?.ops ?? [];
    expect(b2.length).toBe(4);
    for (const o of b2) {
      expect(o.op === "hole" && [o.face, o.d, o.cbore]).toEqual(["+y", 11, { d: 20, depth: 4 }]);
    }
    // The RHS: per station, the entry wall at the sleeve's 20 and the exit wall at 11, 4 deep.
    const walls = (d.bars.get("b3")?.ops ?? []).map((o) => (o.op === "hole" ? [o.d, o.depth] : []));
    expect(walls.filter(([dd]) => dd === 20).length).toBe(4);
    expect(walls.filter(([dd]) => dd === 11).length).toBe(4);
    expect(new Set(walls.map(([, depth]) => depth))).toEqual(new Set([4]));
    const cl = cutList({ derived: d, items: g25.items });
    const tube = cl.groups.find((g) => g.item === "test-geo:TUBE-18x2");
    expect(tube?.lines.map((l) => [l.count, l.cut_mm])).toEqual([[4, 50]]);
  });

  it("clears a sleeve by ISO 273 medium for a shank of its outside diameter (acceptance gap A7)", () => {
    // Tabled diameters take their own row: 16 → 17.5, 18 → 20, 150 → 158.
    expect([sleeveHole(16), sleeveHole(18), sleeveHole(150)]).toEqual([17.5, 20, 158]);
    // Between rows, the next row up: a 17.2 mm tube is cleared as an 18 mm shank, 21.3 as 22.
    expect([sleeveHole(17.2), sleeveHole(21.3)]).toEqual([20, 24]);
    // Past the table there is no default; the sleeve must give clearance_mm.
    expect(sleeveHole(152)).toBeUndefined();
  });

  it("takes a sleeve's clearance_mm as an expression, and refuses a negative one", async () => {
    // A sleeve of bore + 4 passes the RHS's head-side wall: its four holes take 18 + 2.5.
    const g25 = await openProject(join(FIXTURES, "golden-gen", "G25"));
    const sleeve = (extra: Record<string, unknown>) =>
      mergePatch(g25.raw, {
        connections: {
          c1: {
            stack: [
              "test-geo:WSH-M10",
              "test-geo:NUT-M10",
              { item: "test-geo:TUBE-18x2", inside: "b3", len_mm: "bore + 4", ...extra },
              "test-geo:WSH-M10",
              "test-geo:NUT-M10",
            ],
          },
        },
      });
    const bad = derive(sleeve({ clearance_mm: -1 }), g25.items);
    expect(diags(bad)).toEqual([["face", "c1"]]);
    const ok = derive(sleeve({ clearance_mm: "2 * 1.25" }), g25.items);
    expect(diags(ok)).toEqual([]);
    const b3 = (ok.bars.get("b3")?.ops ?? []).map((o) => (o.op === "hole" ? o.d : 0));
    expect(b3.filter((x) => x === 20.5).length).toBe(4);
  });
});

describe("parts on stations (§4.3)", () => {
  const rail = {
    bars: {
      b1: {
        item: "test-gen:RAIL-G",
        a: [0, 0, 0],
        b: [470, 0, 0],
        anchor: "mount",
        holes: { factory: "a" },
      },
    },
  };

  it("with no face, takes the bar's local y as the part's z, its datum on the design line", () => {
    const d = run({
      ...rail,
      parts: { p1: { item: "test-gen:CAR-G", on: { bar: "b1", at_mm: 100 } } },
    });
    expect(diags(d)).toEqual([]);
    const p = d.parts.get("p1");
    expect(p?.placed && [p.datum, p.point.map(r2), p.frame.z, p.frame.x]).toEqual([
      "run",
      [100, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
    ]);
  });

  it("refuses a carriage on a rail of another system", () => {
    const d = run({
      bars: { b1: { ...rail.bars.b1, item: "test:RAIL20", holes: { drilled: true } } },
      parts: { p1: { item: "test-gen:CAR-G", on: { bar: "b1", at_mm: 100 } } },
    });
    expect(diags(d)).toEqual([["fit", "p1"]]);
  });
});

describe("rail holes (§4.7)", () => {
  const railBar = (holes: unknown) => ({
    bars: {
      b1: {
        item: "test-gen:RAIL-G",
        a: [0, 0, 0],
        b: [470, 0, 0],
        anchor: "mount",
        ...(holes === undefined ? {} : { holes }),
      },
    },
  });

  it("lays out from a given E, and refuses one outside the rail's range", () => {
    // E_a 25: holes at 25 + 60k while 470 − (25 + 60k) ≥ 20, k ≤ 7: 8 holes, E_b = 470 − 445.
    const d = run(railBar({ E_a_mm: 25 }));
    expect(diags(d)).toEqual([]);
    const r = d.bars.get("b1")?.rail;
    expect([r?.how, r?.holes.length, r2(r?.E_a ?? 0), r2(r?.E_b ?? 0)]).toEqual(["E_a", 8, 25, 25]);
    expect(diags(run(railBar({ E_a_mm: 10 })))).toEqual([["rail", "b1.a"]]);
  });

  it("warns when a stock rail names no factory end, and lays out from end a", () => {
    const d = run(railBar(undefined));
    expect(diags(d, "warn")).toEqual([["rail", "b1"]]);
    expect(d.bars.get("b1")?.rail?.how).toBe("factory");
    expect(r2(d.bars.get("b1")?.rail?.E_a ?? 0)).toBe(30);
  });

  it("needs stock_mm when the stock lengths' factory ends differ, and keeps the piece there", () => {
    // test:RAIL20: the 1000 states E 20; the 500 states none, so it takes the centred layout's,
    // 20 + ((500 − 40) mod 60) / 2 = 40, as an estimate. A 470 piece with its factory end at a:
    const rail20 = (holes: unknown) => ({
      bars: {
        b1: { item: "test:RAIL20", a: [0, 0, 0], b: [470, 0, 0], anchor: "mount", holes },
      },
    });
    // Unnamed, it is laid out from the shortest length that holds it, the 500: holes 40 + 60k
    // while 470 − (40 + 60k) ≥ 20, k ≤ 6, so E_b = 470 − 400 = 70, beyond E_max 40.
    const unnamed = run(rail20({ factory: "a" }));
    expect(diags(unnamed)).toEqual([
      ["rail", "b1"],
      ["rail", "b1.b"],
    ]);
    // Named 1000: E 20, 8 holes, E_b 30; nested in the 1000 though the 500 is cheaper.
    const named = run(rail20({ factory: "a", stock_mm: 1000 }));
    expect(diags(named)).toEqual([]);
    const r = named.bars.get("b1")?.rail;
    expect([r?.holes.length, r2(r?.E_a ?? 0), r2(r?.E_b ?? 0), r?.stock_mm]).toEqual([
      8, 20, 30, 1000,
    ]);
    const g = cutList({ derived: named, items }).groups.find((x) => x.item === "test:RAIL20");
    expect(g?.stock?.map((b) => b.sku)).toEqual(["test:RAIL20-1000"]);
    // A length nobody sells.
    expect(diags(run(rail20({ factory: "a", stock_mm: 750 })))).toEqual([["rail", "b1"]]);
  });

  it("refuses holes on a bar that is not a rail", () => {
    const d = run({ bars: { b1: { a: [0, 0, 0], b: [470, 0, 0], holes: { drilled: true } } } });
    expect(diags(d)).toEqual([["rail", "b1"]]);
  });
});

describe("the BOM's formats (§5.4)", () => {
  it("prints the same lines as Markdown and CSV, an unplaced line with its reason", () => {
    const d = run({
      bars: { b1: { a: [0, 0, 0], b: [1000, 0, 0] } },
      parts: { p1: { item: "test-gen:TNUT-M5", qty: 4, unplaced: true, why: "spares" } },
    });
    const b = bom({ derived: d, items });
    expect(b.diagnostics).toEqual([]);
    // 1 m of TS40 at 1.493 kg/m, and four T-nuts of 4 g.
    expect(b.groups.map((g) => [g.kind, g.mass_kg])).toEqual([
      ["bar", 1.493],
      ["fastener", 0.016],
    ]);
    expect(b.mass_kg).toBe(1.509);
    const csv = bomCsv(b).split("\n");
    expect(csv[0]).toBe(
      "kind,item,name,options,qty,length_mm,unit_mass_kg,mass_kg,mass_src,sources,unplaced",
    );
    expect(csv[1]).toBe(
      "bar,test:TS40,Profile 40x40 (parametric),finish anodised,1,1000.00,1.493,1.493,est,b1,",
    );
    expect(csv[2]).toBe(
      'fastener,test-gen:TNUT-M5,"T-nut M5, groove 8",,4,,0.004,0.016,est,p1,"p1: 4 unplaced, spares"',
    );
    const md = bomMarkdown(b);
    expect(md).toContain("## Bars");
    expect(md).toContain("## Fasteners");
    expect(md).toContain("Total mass: 1.509 kg.");
  });

  it("marks an estimated mass in Markdown as it marks a computed one", () => {
    const d = run({
      bars: { b1: { a: [0, 0, 0], b: [1000, 0, 0] } },
      parts: { p1: { item: "test-gen:TNUT-M5", qty: 4, unplaced: true, why: "spares" } },
    });
    const b = bom({ derived: d, items });
    // Both masses are `est` (the CSV's mass_src above): the Markdown says so beside each.
    expect(b.groups.flatMap((g) => g.lines.map((l) => l.mass_src))).toEqual(["est", "est"]);
    const md = bomMarkdown(b);
    expect(md).toContain(
      "| test:TS40 | Profile 40x40 (parametric) | finish anodised | 1 | 1000.00 | 1.493 | 1.493 (est) | b1 |",
    );
    expect(md).toContain("| 0.004 | 0.016 (est) |");
    expect(md).toContain("estimated (est)");
  });
});

describe("a hole into the end a butt bears on (§3.4, acceptance gap A4)", () => {
  async function g31(patch: unknown) {
    const p = await openProject(join(FIXTURES, "golden-gen", "G31"));
    return { d: derive(mergePatch(p.raw, patch), p.items), items: p.items };
  }

  it("refuses a hole that the spacer carries off the end face", async () => {
    // A 40 mm spacer: the brace's centre line meets the spacer's face (x = 160) at y = 40, which
    // is off the block's 40 x 40 end face (|y| ≤ 20).
    const { d } = await g31({ connections: { c1: { spacer_mm: 40 } } });
    expect(diags(d)).toEqual([["connection", "c1"]]);
    expect(ops(d, "b1")).toEqual([]);
  });

  it("groups two blocks whose holes are the same once turned end for end", async () => {
    // b1's hole is at its end b, 10 toward world +Y (its local x). Turned end for end that is end
    // a, x -10. b3 runs along +X centred on y = 10 and takes a brace on its end a at y = 0: its
    // hole is at end a, local x 0 - 10 = -10. The same piece.
    const { d, items: its } = await g31({
      bars: {
        b3: { a: [-1000, 10, 0], b: [-880, 10, 0], label: "block, its end a toward the brace" },
        b4: { a: [-2600, 1200, 0], b: [-1000, 0, 0], ends: { b: { cut: "angle" } } },
      },
      connections: {
        c2: { type: "butt", through: "b3.a", ends: ["b4.b"], connector: "test-joint:END-AX" },
      },
    });
    expect(diags(d)).toEqual([]);
    const cl = cutList({ derived: d, items: its });
    const blocks = cl.groups[0]?.lines.filter((l) => l.cut_mm === 120);
    expect(blocks?.map((l) => [l.count, l.sources, l.machining])).toEqual([
      [2, ["b1", "b3"], [{ op: "end-hole", from: "a", off_mm: [-10, 0], d_mm: 9 }]],
    ]);
  });
});

describe("joint recipes (§3.4, acceptance gap A2)", () => {
  // G30's bush joint: a T-slot bar butting into an RHS of no system, held by a bush in its core
  // and a sleeve in the RHS's bore, with a Ø9 hole through the RHS. The joint has no body.
  async function g30(patch: unknown) {
    const p = await openProject(join(FIXTURES, "golden-gen", "G30"));
    const d = derive(mergePatch(p.raw, patch), p.items);
    return { d, items: p.items };
  }
  const recipe = { connections: { c1: { connector: "test-joint:BUSH-JOINT" } } };
  const name = "Bush joint: a bush in the core and a sleeve in the bore, no body (synthetic)";

  it("bills what the recipe brings, lists the recipe apart, and weighs and buys nothing for it", async () => {
    const { d, items: its } = await g30(recipe);
    expect(diags(d)).toEqual([]);
    expect(d.recipes).toEqual([{ item: "test-joint:BUSH-JOINT", opt: {}, qty: 1, source: "c1" }]);
    expect(hardware(d)).toEqual({ "test-joint:BUSH-M8": 1 });
    // Its machining still lands on the bars: the Ø9 hole through the RHS where b2 meets it.
    expect(ops(d, "b1")).toEqual([{ op: "hole", face: "+x", at: 500, d: 9, by: "c1" }]);

    const cl = cutList({ derived: d, items: its });
    const b = bom({ derived: d, items: its });
    expect(b.recipes).toEqual([{ item: "test-joint:BUSH-JOINT", name, qty: 1, sources: ["c1"] }]);
    const lines = b.groups.flatMap((g) => g.lines.map((l) => l.item));
    expect(lines).not.toContain("test-joint:BUSH-JOINT");
    expect(lines).toContain("test-joint:BUSH-M8");
    expect(b.mass_unknown).not.toContain("test-joint:BUSH-JOINT");
    expect(b.diagnostics.map((x) => x.entity)).not.toContain("test-joint:BUSH-JOINT");
    expect(bomMarkdown(b)).toContain(`| test-joint:BUSH-JOINT | ${name} | 1 | c1 |`);
    expect(bomCsv(b).trimEnd().split("\n").at(-1)).toBe(
      `recipe,test-joint:BUSH-JOINT,"${name}",,1,,,,,c1,`,
    );

    const o = order({
      derived: d,
      items: its,
      bom: b,
      cutList: cl,
      diagnostics: [...d.diagnostics, ...cl.diagnostics, ...b.diagnostics],
      asOf: "2026-11-26",
    });
    const ordered = o.suppliers.flatMap((s) => s.lines.map((l) => l.item));
    expect(ordered).not.toContain("test-joint:BUSH-JOINT");
    expect(ordered).toContain("test-joint:BUSH-M8");
  });

  it("is a connector with a body otherwise: counted, weighed and bought", async () => {
    const { d, items: its } = await g30({});
    expect(d.recipes).toEqual([]);
    expect(hardware(d)).toEqual({ "test-joint:BUSH-END": 1, "test-joint:BUSH-M8": 1 });
    const b = bom({ derived: d, items: its });
    expect(b.recipes).toBeUndefined();
    expect(b.groups.find((g) => g.kind === "connector")?.lines.map((l) => l.item)).toEqual([
      "test-joint:BUSH-END",
    ]);
  });

  it("cannot be placed or counted as a part, having no body", async () => {
    const { d } = await g30({
      parts: {
        p1: { item: "test-joint:BUSH-JOINT", on: { bar: "b1", at_mm: 100, face: "+y" } },
        p2: { item: "test-joint:BUSH-JOINT", qty: 2, unplaced: true, why: "spares" },
      },
    });
    expect(diags(d)).toEqual([
      ["part", "p1"],
      ["part", "p2"],
    ]);
    expect(d.parts.size).toBe(0);
  });
});
