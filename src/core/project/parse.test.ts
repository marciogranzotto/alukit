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
      items: {
        "plate-a": {
          kind: "plate",
          name: "Plate A",
          material: "test:s235",
          thickness_mm: 4,
          outline: [
            [0, 0],
            [120, 0],
            [120, 80],
            [0, 80],
          ],
          holes: [
            { at: [20, 20], d_mm: 8.5 },
            { at: [100, 20], thread: "M8" },
          ],
        },
      },
      costs: [
        {
          id: "K1",
          label: "assembly",
          kind: "labour",
          low_minor: 50000,
          likely_minor: 80000,
          high_minor: 120000,
          src: "est",
        },
        { id: "K2", label: "contingency", kind: "contingency", pct: 10, of: "subtotal" },
      ],
      fx: { EUR: { v: 6.2, src: "src", ref: "a bank's rate", read: "2026-11-26" } },
      order_rules: { "est-price": "warn" },
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

  it("validates project items one by one, each named project:<id> (§4.8)", () => {
    const box = {
      kind: "placeholder",
      name: "Motor",
      bbox_mm: [
        [0, 0, 0],
        [100, 80, 60],
      ],
    };
    const { doc, diagnostics } = parseProject({
      ...base,
      items: {
        motor: box,
        // No outline; a hole with neither d_mm nor thread; an id that is not one.
        "plate-b": { kind: "plate", name: "B", material: "test:s235", thickness_mm: 4 },
        "angle-c": {
          kind: "bent-angle",
          name: "C",
          material: "test:s235",
          thickness_mm: 3,
          length_mm: 50,
          legs_mm: [40, 30],
          bend_radius_mm: 3,
          k_factor: 0.4,
          holes: { a: [{ at: [25, 20] }] },
        },
        "1": box,
      },
    });
    expect(Object.keys(doc.items)).toEqual(["motor"]);
    expect(diagnostics.map((d) => [d.entity, d.field])).toEqual([
      ["project:1", "items"],
      ["project:angle-c", "holes/a[0]"],
      ["project:plate-b", "outline"],
    ]);
  });

  it("validates cost lines, bands and open items one by one: a bad entry drops only itself", () => {
    const { doc, diagnostics } = parseProject({
      ...base,
      costs: [
        {
          id: "K1",
          label: "assembly",
          kind: "labour",
          low_minor: 1,
          likely_minor: 2,
          high_minor: 3,
        },
        {
          id: "K2",
          label: "freight",
          kind: "freight",
          low_minor: 5,
          likely_minor: 4,
          high_minor: 6,
        },
        { id: "K1", label: "again", kind: "other", low_minor: 0, likely_minor: 0, high_minor: 0 },
        {
          id: "K3",
          label: "machining",
          kind: "machining",
          low_minor: 0,
          likely_minor: 0,
          high_minor: 0,
          covers: { services: true },
        },
      ],
      price_bands: [
        { low_pct: -10, high_pct: 25 },
        { kind: "bar", low_pct: 5, high_pct: 25 },
        { kind: "bar", low_pct: -5, high_pct: 15 },
      ],
      open: [
        { id: "O1", text: "ask", blocks: "order", scope: ["supplier:x"] },
        { id: "X1", text: "?" },
      ],
      order_rules: { "est-price": "warn", "no-such-rule": "off" },
    });
    expect(doc.costs.map((c) => c.id)).toEqual(["K1"]);
    expect(doc.price_bands).toEqual([{ kind: "bar", low_pct: -5, high_pct: 15 }]);
    expect(doc.open.map((o) => o.id)).toEqual(["O1"]);
    expect(doc.order_rules).toEqual({});
    expect(
      diagnostics.map((d) => [d.entity ?? null, d.field?.replace(/\/.*$/, "") ?? null]),
    ).toEqual([
      [null, "order_rules"],
      [null, "price_bands[0]"],
      [null, "price_bands[1]"],
      ["K1", "costs[2]"],
      ["K2", "costs[1]"],
      ["K3", "costs[3]"],
      ["X1", "open[1]"],
    ]);
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
