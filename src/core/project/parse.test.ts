import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { derive } from "../derive/derive.ts";
import type { ItemSource } from "../items.ts";
import { FIXTURES } from "../testing.ts";
import { openProject } from "./open.ts";
import { parseProject } from "./parse.ts";

const base = {
  schema: "alukit.project/1",
  catalogs: ["../../catalogs/test"],
  defaults: { bar: { item: "test:TS40", opt: { finish: "anodised" } } },
};

describe("reading a document leniently (design §5.1)", () => {
  it("keeps every valid entity and reports each bad one", () => {
    const { doc, diagnostics } = parseProject({
      ...base,
      bars: {
        b10: { a: [0, 0, 0], b: [100, 0, 0] },
        b2: { a: [0, 0, 0], b: [100, 0, 0], colour: "red" },
        x1: { a: [0, 0, 0], b: [100, 0, 0] },
        b1: { a: [0, 0, 0], b: [100, 0, 0], anchor: "+x+x+x" },
      },
      surprise: true,
    });
    expect(Object.keys(doc.bars)).toEqual(["b10"]);
    expect(diagnostics.map((d) => [d.code, d.entity ?? "", d.message])).toEqual([
      ["schema", "", 'unknown top-level field "surprise"'],
      [
        "schema",
        "b1",
        "anchor: Invalid string: must match pattern /^(?:c|[+-][xy]|[+-]x[+-]y|[+-]y[+-]x|[a-z][a-z0-9_-]*)$/",
      ],
      ["schema", "b2", 'unknown field "colour"'],
      ["schema", "x1", '"x1" is not a valid id in bars'],
    ]);
  });

  it("sorts entity maps by id order", () => {
    const { doc } = parseProject({
      ...base,
      nodes: { n10: [0, 0, 0], n2: [0, 0, 0], n1: [0, 0, 0] },
    });
    expect(Object.keys(doc.nodes)).toEqual(["n1", "n2", "n10"]);
  });

  it("refuses a document that is not an object, or names another schema", () => {
    expect(parseProject([]).diagnostics[0]?.message).toMatch(/not a JSON object/);
    expect(parseProject({ schema: "alukit.project/9" }).diagnostics[0]?.message).toMatch(
      /schema must be "alukit.project\/1"/,
    );
  });

  it("accepts the fields later milestones fill in", () => {
    const { diagnostics } = parseProject({
      ...base,
      parts: {
        p1: { item: "test:CAR20", on: { bar: "b4", at_mm: 200, face: "+y" } },
        p2: { item: "test:SCR-M8x16", qty: "4 * 2", unplaced: true, why: "spares" },
      },
      items: { "plate-a": { kind: "plate", thickness_mm: 4 } },
      costs: [{ id: "K1", label: "assembly", kind: "labour" }],
      price_bands: [{ supplier: "test-vendor", low_pct: -10, high_pct: 25 }],
      order: { "test:SCR-M8x16": { offer: "SCR-M8x16-50" } },
      variants: { default: "base", list: { base: {} } },
      checks: [{ id: "C1", value: "bbox().z", op: "<=", limit: "950" }],
      open: [{ id: "O1", text: "ask", blocks: "order" }],
      decisions: [{ id: "D1", date: "2026-11-26", text: "40-series" }],
      views: { iso: { pos: [1, 2, 3], target: [0, 0, 0] } },
    });
    expect(diagnostics).toEqual([]);
  });
});

describe("derive never throws on document content", () => {
  let items: ItemSource;
  beforeAll(async () => {
    items = (await openProject(join(FIXTURES, "golden-ends", "G01"))).items;
  });

  const junk: unknown[] = [
    null,
    42,
    "text",
    [],
    {},
    { schema: "alukit.project/1", bars: 5 },
    { ...base, bars: { b1: { a: "n9", b: [0, 0, "1 / 0"] } } },
    { ...base, bars: { b1: { a: [0, 0, 0], b: [0, 0, 0] } } },
    { ...base, bars: { b1: { item: "nope:X", a: [0, 0, 0], b: [1, 0, 0] } } },
    { ...base, bars: { b1: { item: "test:BRK-40", a: [0, 0, 0], b: [100, 0, 0] } } },
    { ...base, params: { A: "B + 1", B: "A + 1" }, bars: { b1: { a: [0, 0, 0], b: ["A", 0, 0] } } },
    {
      ...base,
      bars: {
        b1: { a: { on: { bar: "b2", at_mm: 10 } }, b: [100, 0, 0] },
        b2: { a: { on: { bar: "b1", at_mm: 10 } }, b: [0, 100, 0] },
      },
    },
    {
      ...base,
      bars: { b1: { a: [0, 0, 0], b: [100, 0, 0], ends: { a: { plane: { of: "b1.a" } } } } },
    },
    {
      ...base,
      bars: { b1: { a: [0, 0, 0], b: [1000, 0, 0] } },
      connections: { c1: { type: "butt", through: "b1", ends: ["b1.a", "b7.b"] } },
      patterns: { pt1: { template: ["b1", "b9"], along: "b1", pitch_mm: 10, count: 3 } },
    },
  ];
  for (const [i, doc] of junk.entries()) {
    it(`case ${i}`, () => {
      expect(() => derive(doc, items)).not.toThrow();
    });
  }

  it("reports a cycle on every entity in it", () => {
    const d = derive(junk[11], items);
    const cyc = d.diagnostics.filter((x) => x.code === "cycle").map((x) => x.entity);
    expect(cyc.sort()).toEqual(["b1", "b2"]);
    const p = derive(junk[10], items);
    expect(
      p.diagnostics
        .filter((x) => x.code === "cycle")
        .map((x) => x.entity)
        .sort(),
    ).toEqual(["A", "B"]);
  });
});
