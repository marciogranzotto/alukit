import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { derive } from "../derive/derive.ts";
import type { ItemSource } from "../items.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES } from "../testing.ts";
import { cutList } from "./cutlist.ts";
import { nest } from "./nesting.ts";

const h = (mm: number) => Math.round(mm * 100);

describe("nesting (design §5.3)", () => {
  it("counts a kerf between pieces and a trim at each end (G23's arithmetic)", () => {
    // "A plain bar of the same lengths nests into one (3 × 470 + 2 × 3 = 1416)" in 1500.
    const stock = [{ sku: "s1500", len: h(1500), price: 100 }];
    const three = nest(
      ["p1", "p2", "p3"].map((id) => ({ id, len: h(470) })),
      stock,
      h(3),
      0,
    );
    expect(three.bars.map((b) => [b.pieces.length, b.used / 100])).toEqual([[3, 1416]]);
    const four = nest(
      ["p1", "p2", "p3", "p4"].map((id) => ({ id, len: h(470) })),
      stock,
      h(3),
      0,
    );
    expect(four.bars.map((b) => b.pieces.length)).toEqual([3, 1]);
    const trimmed = nest([{ id: "p1", len: h(1490) }], stock, h(3), h(5));
    expect(trimmed.bars.map((b) => b.used / 100)).toEqual([1500]);
    expect(nest([{ id: "p1", len: h(1491) }], stock, h(3), h(5)).unplaced).toEqual([
      { id: "p1", len: h(1491) },
    ]);
  });

  it("minimises cost, not waste: one long bar beats two short ones when it is cheaper", () => {
    const pieces = [1120, 1120, 520, 300, 300].map((len, i) => ({ id: `b${i + 1}`, len: h(len) }));
    const stocks = (long: number) => [
      { sku: "s3000", len: h(3000), price: 4000 },
      { sku: "s6000", len: h(6000), price: long },
    ];
    const cheap = nest(pieces, stocks(7000), h(3), h(5));
    expect(cheap.bars.map((b) => b.stock.sku)).toEqual(["s6000"]);
    expect(cheap.cost).toBe(7000);
    const dear = nest(pieces, stocks(9000), h(3), h(5));
    expect(dear.bars.map((b) => [b.stock.sku, b.pieces.map((p) => p.id)])).toEqual([
      ["s3000", ["b1", "b2", "b3"]],
      ["s3000", ["b4", "b5"]],
    ]);
    expect(dear.cost).toBe(8000);
  });

  it("moves each bar down to the cheapest length that holds it", () => {
    const r = nest(
      [{ id: "a", len: h(800) }],
      [
        { sku: "s1000", len: h(1000), price: 50 },
        { sku: "s2000", len: h(2000), price: 80 },
      ],
      h(3),
      0,
    );
    expect(r.bars.map((b) => b.stock.sku)).toEqual(["s1000"]);
  });

  it("breaks a cost tie by fewer bars", () => {
    const r = nest(
      [
        { id: "a", len: h(600) },
        { id: "b", len: h(600) },
      ],
      [
        { sku: "s1000", len: h(1000), price: 100 },
        { sku: "s2000", len: h(2000), price: 200 },
      ],
      0,
      0,
    );
    expect(r.bars.map((b) => b.stock.sku)).toEqual(["s2000"]);
  });

  it("stands a factory piece at a stock end, with no trim there, at most two per bar", () => {
    const stock = [{ sku: "s1000", len: h(1000), price: 100 }];
    // Two factory pieces of 470: 0 × 5 + 940 + 3 = 943 (the cart's rail).
    const two = nest(
      [
        { id: "r1", len: h(470), factory: true },
        { id: "r2", len: h(470), factory: true },
      ],
      stock,
      h(3),
      h(5),
    );
    expect(two.bars.map((b) => [b.used / 100, b.pieces.map((p) => [p.id, p.end])])).toEqual([
      [
        943,
        [
          ["r1", "start"],
          ["r2", "end"],
        ],
      ],
    ]);
    // One factory piece and a plain one: a trim at the far end only, 5 + 940 + 3 = 948; the
    // factory piece first.
    const mixed = nest(
      [
        { id: "p1", len: h(470) },
        { id: "r1", len: h(470), factory: true },
      ],
      stock,
      h(3),
      h(5),
    );
    expect(mixed.bars.map((b) => [b.used / 100, b.pieces.map((p) => [p.id, p.end])])).toEqual([
      [
        948,
        [
          ["r1", "start"],
          ["p1", undefined],
        ],
      ],
    ]);
    // Three short factory pieces fit by length but not by ends: two bars.
    const three = nest(
      ["r1", "r2", "r3"].map((id) => ({ id, len: h(100), factory: true })),
      stock,
      h(3),
      h(5),
    );
    expect(three.bars.map((b) => b.pieces.length)).toEqual([2, 1]);
  });

  it("keeps a piece that names its stock length in that length, cheaper or not", () => {
    const stocks = [
      { sku: "s500", len: h(500), price: 100 },
      { sku: "s1000", len: h(1000), price: 200 },
    ];
    const free = nest([{ id: "p1", len: h(300) }], stocks, h(3), h(5));
    expect(free.bars.map((b) => b.stock.sku)).toEqual(["s500"]);
    const pinned = nest([{ id: "p1", len: h(300), stock: h(1000) }], stocks, h(3), h(5));
    expect(pinned.bars.map((b) => b.stock.sku)).toEqual(["s1000"]);
    // A free piece that rides in the pinned bar keeps it there; one too long for any is unplaced.
    const ride = nest(
      [
        { id: "p1", len: h(300), stock: h(1000) },
        { id: "p2", len: h(300) },
      ],
      stocks,
      h(3),
      h(5),
    );
    expect(ride.bars.map((b) => [b.stock.sku, b.pieces.map((p) => p.id)])).toEqual([
      ["s1000", ["p1", "p2"]],
    ]);
    expect(nest([{ id: "p1", len: h(600), stock: h(500) }], stocks, h(3), h(5)).unplaced).toEqual([
      { id: "p1", len: h(600), stock: h(500) },
    ]);
  });
});

describe("the cut list (design §5.3)", () => {
  let items: ItemSource;
  beforeAll(async () => {
    items = (await openProject(join(FIXTURES, "golden-ends", "G01"))).items;
  });
  const list = (bars: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    cutList({
      derived: derive(
        {
          schema: "alukit.project/1",
          defaults: { bar: { item: "test:TS40", opt: { finish: "anodised" } } },
          bars,
          ...extra,
        },
        items,
      ),
      items,
    });

  it("orders a supplier-cut piece rounded to res_mm and bills it in steps (review M7's example)", () => {
    // 1,234 mm billed in 10 mm steps is 124 steps: 1240 mm.
    const cl = list({ b1: { a: [0, 0, 0], b: [1234.4, 0, 0] } });
    const [line] = cl.groups[0]?.lines ?? [];
    expect([line?.cut_mm, line?.ordered_mm, line?.billed_mm]).toEqual([1234.4, 1234, 1240]);
  });

  it("bills at least min_bill_mm per piece, and refuses lengths outside the offer's range", () => {
    const cl = list({
      b1: { item: "test:TS40E", a: [0, 0, 0], b: [60, 0, 0] },
      b2: { item: "test:TS40E", a: [0, 0, 0], b: [30, 0, 0] },
      b3: { item: "test:TS40E", a: [0, 0, 0], b: [3200, 0, 0] },
    });
    const lines = cl.groups[0]?.lines.map((l) => [l.cut_mm, l.billed_mm]);
    expect(lines).toEqual([
      [3200, 3200],
      [60, 100],
      [30, 100],
    ]);
    expect(cl.diagnostics.map((d) => [d.code, d.entity])).toEqual([
      ["length", "b2"],
      ["length", "b3"],
    ]);
    expect(cl.diagnostics[1]?.message).toMatch(/split it with a splice/);
  });

  it("groups a piece with its end-for-end flip", () => {
    // Two braces with a 45° cut, one at end a, the other drawn the other way round with it at b.
    const cl = list(
      {
        b1: { a: [0, 0, 0], b: [1000, 0, 0] },
        b2: {
          a: { on: { bar: "b1", at_mm: 500 } },
          b: [1000, 0, 500],
          ends: { a: { cut: "angle" } },
        },
        b3: {
          a: [0, 0, 500],
          b: { on: { bar: "b1", at_mm: 500 } },
          ends: { b: { cut: "angle" } },
        },
      },
      {
        connections: {
          c1: { type: "butt", through: "b1", ends: ["b2.a", "b3.b"] },
        },
      },
    );
    const lines = cl.groups[0]?.lines ?? [];
    expect(lines.map((l) => [l.count, l.cut_mm, l.sources])).toEqual([
      [1, 1000, ["b1"]],
      [2, 698.82, ["b2", "b3"]],
    ]);
    expect(lines[1]?.ends).toEqual({
      a: "square",
      b: { angle_deg: 45, mitre_deg: 0, bevel_deg: -45 },
    });
  });

  it("lists machining from the named end's long point, and groups mirrored holes", () => {
    const cl = list({
      b1: {
        a: [0, 0, 0],
        b: [1000, 0, 0],
        ops: [{ op: "hole", face: "+x", at_mm: 20, d_mm: 7 }],
      },
      b2: {
        a: [1000, 100, 0],
        b: [0, 100, 0],
        ops: [{ op: "hole", face: "-x", at_mm: 20, from: "b", d_mm: 7 }],
      },
      b3: {
        a: [0, 200, 0],
        b: [1000, 200, 0],
        ends: { a: { extend_mm: 5 } },
        ops: [{ op: "hole", face: "+x", at_mm: 20, d_mm: 7 }],
      },
    });
    const lines = cl.groups[0]?.lines ?? [];
    expect(lines.map((l) => [l.count, l.cut_mm, l.sources, l.machining])).toEqual([
      [1, 1005, ["b3"], [{ op: "hole", face: "+x", from: "a", at_mm: 25, d_mm: 7 }]],
      [2, 1000, ["b1", "b2"], [{ op: "hole", face: "+x", from: "a", at_mm: 20, d_mm: 7 }]],
    ]);
  });

  it("follows an order override to stock, and says when nothing sells it by length", () => {
    const cl = list(
      { b1: { item: "test-geo:FB-50x10", a: [0, 0, 0], b: [500, 0, 0] } },
      { order: { "test-geo:FB-50x10": { sale: "cut" } } },
    );
    expect(cl.groups[0]?.mode).toBe("none");
    expect(cl.diagnostics.map((d) => d.code)).toEqual(["no-offer"]);
  });
});
