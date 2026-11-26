import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bom } from "../bom/bom.ts";
import { cutList } from "../cutlist/cutlist.ts";
import { derive } from "../derive/derive.ts";
import type { ItemSource } from "../items.ts";
import { order } from "../order/order.ts";
import { openProject } from "../project/open.ts";
import { parseProject } from "../project/parse.ts";
import { FIXTURES, mergePatch } from "../testing.ts";
import { tapDrill } from "../threads.ts";
import { projectItems } from "./source.ts";

/**
 * Project items (design §4.8): a plate's and a bent angle's mass from its net volume, hole
 * features valued and checked, placeholders and generic items as entered. On the order fixture's
 * catalogs (test:s235, 7850 kg/m³; test:al-6063-t5, 2700 kg/m³).
 */

let items: ItemSource;
let base: Record<string, unknown>;
beforeAll(async () => {
  const p = await openProject(join(FIXTURES, "order"));
  expect(p.diagnostics).toEqual([]);
  items = p.items;
  base = p.raw as Record<string, unknown>;
});

const STEEL = 7850e-9; // kg/mm³
const AL = 2700e-9;
const disc = (d: number) => (Math.PI * d * d) / 4;

function resolve(defs: Record<string, unknown>) {
  const doc = parseProject(mergePatch(base, { items: defs })).doc;
  return projectItems(items, doc);
}

function problems(defs: Record<string, unknown>) {
  return resolve(defs).diagnostics.map((d) => [d.entity, d.code, d.field, d.message]);
}

const rect = [
  [0, 0],
  [100, 0],
  [100, 60],
  [0, 60],
];
const plate = (extra: Record<string, unknown> = {}) => ({
  kind: "plate",
  name: "Plate",
  material: "test:s235",
  thickness_mm: 5,
  outline: rect,
  ...extra,
});
const angle = (extra: Record<string, unknown> = {}) => ({
  kind: "bent-angle",
  name: "Angle",
  material: "test:al-6063-t5",
  thickness_mm: 3,
  length_mm: 50,
  legs_mm: [40, 30],
  bend_radius_mm: 3,
  k_factor: 0.4,
  ...extra,
});

describe("tap drills: major diameter minus pitch", () => {
  it("takes ISO 261's coarse pitch, or the pitch written", () => {
    expect([tapDrill("M3"), tapDrill("M6"), tapDrill("M8"), tapDrill("M10")]).toEqual([
      2.5, 5, 6.75, 8.5,
    ]);
    expect(tapDrill("M10x1.25")).toBe(8.75);
    expect(tapDrill("1/4-20 UNC")).toBeUndefined();
  });
});

describe("a plate", () => {
  it("weighs its outline's area times its thickness, less what each hole removes", () => {
    const holes = [
      { at: [20, 20], d_mm: 8 },
      { at: [80, 20], thread: "M6" },
      { at: [20, 40], d_mm: 6.6, csk: { d_mm: 12.4, angle_deg: 90 } },
      { at: [80, 40], d_mm: 6.6, cbore: { d_mm: 11, depth_mm: 3 } },
      { at: [50, 30], d_mm: 6, depth_mm: 2, face: "back" },
    ];
    const r = resolve({ p: plate({ holes }) });
    expect(r.diagnostics).toEqual([]);
    const p = r.resolved.get("project:p");
    // A 90° countersink from Ø12.4 down to Ø6.6 is (12.4 − 6.6) / 2 = 2.9 deep: its cone less
    // the drill's cylinder over that depth.
    const h = 2.9;
    const cone = (Math.PI * h * (12.4 ** 2 + 12.4 * 6.6 + 6.6 ** 2)) / 12 - disc(6.6) * h;
    const removed =
      disc(8) * 5 +
      disc(5) * 5 +
      disc(6.6) * 5 +
      cone +
      disc(6.6) * 5 +
      (disc(11) - disc(6.6)) * 3 +
      disc(6) * 2;
    expect(p?.view.mass_kg?.src).toBe("calc");
    expect(p?.view.mass_kg?.v).toBeCloseTo((6000 * 5 - removed) * STEEL, 12);
    expect(p?.holes.map((x) => [x.id, x.type, x.d, x.face])).toEqual([
      ["h1", "through", 8, "front"],
      ["h2", "threaded", 5, "front"],
      ["h3", "countersunk", 6.6, "front"],
      ["h4", "counterbored", 6.6, "front"],
      ["h5", "blind", 6, "back"],
    ]);
    expect(p?.holes[2]?.csk?.depth).toBeCloseTo(2.9, 12);
    // Its box in its own frame: the outline's extent, from z = 0 to its thickness; made local.
    expect(p?.view.bbox_mm).toEqual([
      [0, 0, 0],
      [100, 60, 5],
    ]);
    expect(p?.supplier).toBe("local");
  });

  it("reports holes outside the outline, overlapping, or wider than they can be", () => {
    const holes = [
      { at: [120, 20], d_mm: 8 },
      { at: [3, 30], d_mm: 8 },
      { at: [50, 30], d_mm: 8 },
      { at: [55, 30], d_mm: 8 },
      { at: [20, 45], d_mm: 6.6, csk: { d_mm: 6, angle_deg: 90 } },
      { at: [80, 45], d_mm: 6.6, cbore: { d_mm: 11, depth_mm: 5 } },
      { at: [80, 10], thread: "1/4-20 UNC" },
      { at: [20, 10], d_mm: 3, depth_mm: 5 },
    ];
    expect(problems({ p: plate({ holes }) })).toEqual([
      ["project:p", "hole", "holes", "h3 and h4 overlap"],
      ["project:p", "hole", "holes[0]", "h1 at [120, 20] is outside the outline"],
      ["project:p", "hole", "holes[1]", "h2 at [3, 30] reaches 1 past the outline"],
      ["project:p", "hole", "holes[4]", "h5: countersink Ø6 is not wider than the hole, Ø6.6"],
      [
        "project:p",
        "hole",
        "holes[5]",
        "h6: the counterbore is 5 deep, not less than the hole's 5",
      ],
      ["project:p", "hole", "holes[6]", "h7: no tap drill known for 1/4-20 UNC: give it as d_mm"],
      [
        "project:p",
        "hole",
        "holes[7]",
        "h8: depth 5 reaches through the 5 mm thickness: leave depth_mm out for a through hole",
      ],
    ]);
    // A hole that cannot be valued leaves the mass unknown, rather than wrong.
    expect(resolve({ p: plate({ holes }) }).resolved.get("project:p")?.view.mass_kg).toBe(
      undefined,
    );
  });

  it("reports an outline that crosses itself, and a material no catalog holds", () => {
    const bow = [
      [0, 0],
      [100, 60],
      [100, 0],
      [0, 60],
    ];
    expect(problems({ p: plate({ outline: bow, material: "test:unobtainium" }) })).toEqual([
      [
        "project:p",
        "item",
        "material",
        "no material test:unobtainium (in the lock, or the project's catalogs)",
      ],
      ["project:p", "outline", "outline", "edges 0 and 2 cross: the outline must not cross itself"],
    ]);
  });
});

describe("a bent angle", () => {
  it("weighs its developed length (the bend allowance on a K-factor) times its length and thickness", () => {
    const holes = { a: [{ at: [25, 22], d_mm: 5.5 }], b: [{ at: [25, 18], thread: "M4" }] };
    const r = resolve({ a: angle({ holes }) });
    expect(r.diagnostics).toEqual([]);
    const a = r.resolved.get("project:a");
    // BA = (π / 2)(R + K T) = (π / 2)(3 + 0.4 × 3); flat = (40 − 6) + (30 − 6) + BA.
    const ba = (Math.PI / 2) * 4.2;
    const flat = 34 + 24 + ba;
    expect(a?.angle?.allowance).toBeCloseTo(ba, 12);
    expect(a?.angle?.developed).toBeCloseTo(flat, 12);
    expect([a?.angle?.bendFrom, a?.angle?.bendTo]).toEqual([34, 34 + ba]);
    const volume = flat * 50 * 3 - disc(5.5) * 3 - disc(3.3) * 3;
    expect(a?.view.mass_kg?.v).toBeCloseTo(volume * AL, 12);
    // On the blank: leg a's hole 40 − 22 from leg a's free edge; leg b's flat − (30 − 18).
    expect(a?.holes.map((h) => [h.id, h.leg, h.flat?.[1]])).toEqual([
      ["a1", "a", 18],
      ["b1", "b", flat - 12],
    ]);
    expect(a?.view.bbox_mm).toEqual([
      [0, 0, 0],
      [50, 40, 30],
    ]);
  });

  it("reports a hole in the bend or off its leg, and a leg with no flat", () => {
    const holes = {
      a: [
        { at: [25, 7], d_mm: 4 },
        { at: [48, 22], d_mm: 5.5 },
      ],
      b: [{ at: [25, 29], d_mm: 4 }],
    };
    expect(problems({ a: angle({ holes }) })).toEqual([
      [
        "project:a",
        "hole",
        "holes/a[0]",
        "a1 reaches into the bend: its edge is 5 from the heel, the flat starts at 6",
      ],
      ["project:a", "hole", "holes/a[1]", "a2 at [48, 22] runs off leg a"],
      ["project:a", "hole", "holes/b[0]", "b1 at [25, 29] runs off leg b"],
    ]);
    expect(problems({ a: angle({ legs_mm: [40, 6] }) })).toEqual([
      [
        "project:a",
        "bend",
        "legs_mm",
        "leg b (6) is not longer than the bend's outside setback, R + T = 6: it has no flat",
      ],
    ]);
  });
});

describe("placeholders and generic items", () => {
  it("take their mass as entered, an estimate unless they say otherwise, and no supplier", () => {
    const r = resolve({
      m: {
        kind: "placeholder",
        name: "Motor",
        bbox_mm: [
          [0, 0, 0],
          [100, 80, 60],
        ],
        mass_kg: 2.5,
      },
      g: {
        kind: "generic",
        name: "Controller",
        mass_kg: { v: 0.3, src: "meas" },
        supplier: "shop-a",
        price_minor: { v: 9900, src: "src", read: "2026-11-20" },
      },
    });
    expect(r.diagnostics).toEqual([]);
    const m = r.resolved.get("project:m");
    const g = r.resolved.get("project:g");
    expect([m?.view.mass_kg, m?.supplier, m?.price]).toEqual([
      { v: 2.5, src: "est" },
      undefined,
      undefined,
    ]);
    expect([g?.view.mass_kg, g?.supplier, g?.price]).toEqual([
      { v: 0.3, src: "meas" },
      "shop-a",
      { v: 9900, src: "src", read: "2026-11-20" },
    ]);
  });

  it("are counted in the bill of materials under their own kinds, placed or unplaced", () => {
    const d = derive(
      mergePatch(base, {
        items: {
          m: {
            kind: "placeholder",
            name: "Motor",
            bbox_mm: [
              [0, 0, 0],
              [100, 80, 60],
            ],
            mass_kg: 2.5,
          },
          p: plate(),
        },
        parts: {
          p8: { item: "project:m", on: { bar: "b1", at_mm: 300, face: "+y" } },
          p9: { item: "project:p", qty: 2, unplaced: true, why: "spares" },
        },
      }),
      items,
    );
    expect(d.diagnostics).toEqual([]);
    // On the flat's top face (z = 2.5), its own frame on the station (§4.7).
    const p8 = d.parts.get("p8");
    expect(p8?.placed && [p8.kind, p8.datum, p8.origin]).toEqual([
      "placeholder",
      "origin",
      [300, 0, 2.5],
    ]);
    const b = bom({ derived: d, items });
    expect(b.diagnostics).toEqual([]);
    const own = b.groups.filter((g) => g.kind === "plate" || g.kind === "placeholder");
    expect(
      own.map((g) => [g.kind, g.lines.map((l) => [l.item, l.qty, l.mass_src, l.sources])]),
    ).toEqual([
      ["plate", [["project:p", 2, "calc", ["p9"]]]],
      ["placeholder", [["project:m", 1, "est", ["p8"]]]],
    ]);
    // The plate: 100 × 60 × 5 of steel, 0.2355 kg each, rounded once per line: 0.471.
    expect(own[0]?.lines[0]?.mass_kg).toBe(0.471);
  });
});

describe("a placeholder as a butt's through body (gap G-B, golden case G28)", () => {
  it("is counted once, with the connection, and holds only its own order line", async () => {
    // G28's lengths are in golden.test.ts; here, what the body adds to the outputs (§4.5: it is
    // drawn and counted with the connection, not also a part).
    const p = await openProject(join(FIXTURES, "golden-ends", "G28"));
    const d = derive(p.raw, p.items);
    expect(d.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    const b = bom({ derived: d, items: p.items });
    const held = b.groups.find((g) => g.kind === "placeholder");
    expect(held?.lines.map((l) => [l.item, l.qty, l.mass_kg, l.sources])).toEqual([
      ["project:motor", 1, 2.8, ["c1"]],
    ]);
    const cl = cutList({ derived: d, items: p.items });
    const o = order({
      derived: d,
      items: p.items,
      bom: b,
      cutList: cl,
      diagnostics: [...d.diagnostics, ...cl.diagnostics, ...b.diagnostics],
      asOf: "2026-11-26",
    });
    // The bars are bought from their supplier, unheld; the motor's line is in the unsourced
    // group, and only that group is held for it. Unpriced, it is a placeholder still: the one
    // reason says why (no missing-price besides).
    expect(o.suppliers.map((s) => [s.supplier, s.status, s.reasons.map((r) => r.rule)])).toEqual([
      ["test-vendor", "READY", []],
      [null, "BLOCKED", ["placeholder"]],
    ]);
    expect(o.totals.unpriced).toBe(1);
  });
});
