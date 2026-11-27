import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ItemSource } from "../items.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES, mergePatch, shown } from "../testing.ts";
import { derive } from "./derive.ts";
import { applyVariant } from "./variant.ts";

/**
 * Variants (design §4.10): params, swaps, `only_in` and `not_in`, a default variant, and what
 * happens to what names an entity a variant leaves out.
 */

let items: ItemSource;
beforeAll(async () => {
  // G1's catalogs (test, test-geo), live: the swaps below name items its lock does not pin.
  items = (await openProject(join(FIXTURES, "golden-ends", "G01"))).items;
});

const DOC = {
  schema: "alukit.project/1",
  catalogs: ["../../catalogs/test", "../../catalogs/test-geo"],
  defaults: { bar: { item: "test:TS40", opt: { finish: "anodised" } } },
  params: { L: 1000, S: "sec(b1).height_mm" },
  bars: {
    b1: { a: [0, 0, 0], b: ["L", 0, 0] },
    b2: { a: ["L", 0, 0], b: ["L", 600, 0], opt: { finish: "black" } },
    b3: { a: [0, 0, 0], b: [0, 600, 0], only_in: ["steel"] },
    b4: { a: { on: { bar: "b3", at_mm: 300 } }, b: [500, 300, 0] },
    b5: { a: [0, -200, 0], b: ["S", -200, 0], not_in: ["steel"] },
  },
  connections: {
    c1: { type: "butt", through: "b1", ends: ["b2.a", "b3.a"] },
    c2: { type: "butt", through: "b3", ends: ["b4.a"] },
  },
  variants: {
    default: "alu",
    list: {
      alu: {},
      steel: { params: { L: 1200 }, swap: { "test:TS40": "test:RHS-50x30x2" } },
    },
  },
};

const ids = (m: ReadonlyMap<string, unknown>) => [...m.keys()];

describe("variants (§4.10)", () => {
  it("derives the default variant when none is named, and leaves out what is scoped away", () => {
    const d = derive(DOC, items);
    expect(d.variant).toBe("alu");
    expect(ids(d.bars)).toEqual(["b1", "b2", "b5"]);
    expect(d.bars.get("b1")?.lengths.len).toBe(1000);
    // A connection drops the end of a bar the variant leaves out, and goes with its through bar.
    expect(shown(d.diagnostics, "info")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "variant", entity: "c1", refs: ["b3"] }),
        expect.objectContaining({ code: "variant", entity: "c2", refs: ["b3"] }),
      ]),
    );
    expect(d.doc.connections.c1).toMatchObject({ ends: ["b2.a"] });
    expect(d.doc.connections.c2).toBeUndefined();
    // A point on a left-out bar is an error: scope it too.
    expect(shown(d.diagnostics, "error")).toEqual([
      expect.objectContaining({ code: "variant", entity: "b4", refs: ["b3"] }),
    ]);
    expect(shown(d.diagnostics, "error")[0]?.message).toContain("scope b4");
  });

  it("overrides params, swaps items (defaults too) and drops options the new item lacks", () => {
    const d = derive(DOC, items, { variant: "steel" });
    expect(d.variant).toBe("steel");
    expect(ids(d.bars)).toEqual(["b1", "b2", "b3", "b4"]);
    expect(d.bars.get("b1")?.lengths.len).toBe(1200);
    for (const b of ["b1", "b2", "b3", "b4"]) {
      expect(d.bars.get(b)?.placed.item.id).toBe("test:RHS-50x30x2");
    }
    expect(d.bars.get("b2")?.placed.opt).toEqual({});
    expect(shown(d.diagnostics, "error")).toEqual([]);
    expect(shown(d.diagnostics, "info")).toEqual([
      expect.objectContaining({
        code: "variant",
        entity: "b2",
        message: expect.stringMatching(/^opt\/finish dropped/),
      }),
    ]);
  });

  it("drops the options a project item lacks when a swap puts one on a part (§4.8)", () => {
    const doc = mergePatch(DOC, {
      items: {
        spacer: {
          kind: "generic",
          name: "spacer",
          bbox_mm: [
            [0, 0, 0],
            [20, 20, 10],
          ],
        },
      },
      parts: { p1: { item: "test:TS4080", opt: { finish: "black" }, at: { pos: [0, 0, 0] } } },
      variants: { list: { alu: { swap: { "test:TS4080": "project:spacer" } } } },
    });
    const d = derive(doc, items);
    expect(d.parts.get("p1")?.item).toBe("project:spacer");
    expect(shown(d.diagnostics, "error").filter((x) => x.entity === "p1")).toEqual([]);
    expect(shown(d.diagnostics, "info")).toContainEqual(
      expect.objectContaining({
        code: "variant",
        entity: "p1",
        message:
          "opt/finish dropped: project:spacer, swapped in for test:TS4080, has no such option",
      }),
    );
  });

  it("sec() reads the section after the swap", () => {
    const steel = mergePatch(DOC, { bars: { b5: { not_in: null } } });
    expect(derive(steel, items).bars.get("b5")?.lengths.len).toBe(40);
    expect(derive(steel, items, { variant: "steel" }).bars.get("b5")?.lengths.len).toBe(50);
  });

  it("with no default, derives the document as written: only_in entities are out", () => {
    const doc = mergePatch(DOC, { variants: { default: null } });
    const d = derive(doc, items);
    expect(d.variant).toBeUndefined();
    expect(ids(d.bars)).toEqual(["b1", "b2", "b5"]);
    expect(d.bars.get("b1")?.placed.item.id).toBe("test:TS40");
  });

  it("reports a variant that does not exist, and scopes naming none", () => {
    const d = derive(DOC, items, { variant: "wood" });
    expect(d.variant).toBeUndefined();
    expect(shown(d.diagnostics, "error")).toContainEqual(
      expect.objectContaining({
        code: "variant",
        message: "there is no variant wood; it has alu, steel",
      }),
    );
    const typo = mergePatch(DOC, { bars: { b5: { not_in: ["stele"] } } });
    expect(shown(derive(typo, items).diagnostics, "error")).toContainEqual(
      expect.objectContaining({
        code: "variant",
        entity: "b5",
        message: expect.stringContaining("not_in names no variant stele"),
      }),
    );
    const bad = mergePatch(DOC, { variants: { default: "wood" } });
    expect(shown(derive(bad, items).diagnostics, "error")).toContainEqual(
      expect.objectContaining({
        code: "variant",
        message: "variants/default: there is no variant wood",
      }),
    );
  });

  it("warns about a swap of an item nothing names", () => {
    const doc = mergePatch(DOC, {
      variants: { list: { steel: { swap: { "test:TS4080": "test:RHS-50x30x2" } } } },
    });
    const d = derive(doc, items, { variant: "steel" });
    expect(shown(d.diagnostics, "warn")).toContainEqual(
      expect.objectContaining({
        code: "variant",
        message: "variant steel swaps test:TS4080, which nothing names",
      }),
    );
  });

  it("drops a connection left with no ends, and prunes runs and patterns", () => {
    const doc = mergePatch(DOC, {
      bars: { b4: null, b6: { a: [0, 0, 100], b: [0, 0, 400], only_in: ["steel"] } },
      connections: { c2: null, c3: { type: "butt", through: "b1", ends: ["b6.a"] } },
      patterns: { pt1: { template: ["b5", "b6"], along: "b1", pitch_mm: 100, count: 3 } },
    });
    const v = applyVariant(doc, items);
    expect(v.variant).toBe("alu");
    expect(v.omitted).toEqual(["b3", "b6", "c3"]);
    const raw = v.raw as typeof doc & { patterns: Record<string, { template: string[] }> };
    expect(raw.patterns.pt1?.template).toEqual(["b5"]);
    expect(shown(v.diagnostics, "info")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: "c3",
          message: "connection left out: it names b6, which is not in variant alu",
        }),
        expect.objectContaining({ entity: "pt1", message: "b6 dropped: b6 is not in variant alu" }),
      ]),
    );
    // The input is never changed.
    expect((doc as { patterns: { pt1: { template: string[] } } }).patterns.pt1.template).toEqual([
      "b5",
      "b6",
    ]);
  });

  it("scopes cost lines with only_in and not_in, as it scopes entities (acceptance gap A5)", () => {
    const cost = (id: string, likely: number, scope: Record<string, string[]> = {}) => ({
      id,
      label: `line ${id}`,
      kind: "machining",
      low_minor: likely,
      likely_minor: likely,
      high_minor: likely,
      ...scope,
    });
    const doc = {
      ...DOC,
      costs: [
        cost("K1", 41311, { not_in: ["steel"] }),
        cost("K2", 41023, { only_in: ["steel"] }),
        cost("K3", 5000),
      ],
      open: [{ id: "O1", text: "the steel quote", blocks: "order", scope: ["K2", "supplier:x"] }],
    };
    const costIds = (v?: string) =>
      derive(doc, items, v ? { variant: v } : {}).doc.costs.map((c) => c.id);
    expect(costIds()).toEqual(["K1", "K3"]);
    expect(costIds("steel")).toEqual(["K2", "K3"]);
    // What names a left-out cost line follows §6's cascade: an open item's scope loses it.
    const alu = derive(doc, items);
    expect(alu.doc.open[0]?.scope).toEqual(["supplier:x"]);
    expect(shown(alu.diagnostics, "info")).toContainEqual(
      expect.objectContaining({ code: "variant", entity: "O1", refs: ["K2"] }),
    );
    // A cost line naming no variant of the document is an error, as an entity's scope is.
    const typo = { ...doc, costs: [cost("K1", 1, { only_in: ["stele"] })] };
    expect(shown(derive(typo, items).diagnostics, "error")).toContainEqual(
      expect.objectContaining({
        code: "variant",
        entity: "K1",
        message: expect.stringContaining("only_in names no variant stele"),
      }),
    );
  });

  it("leaves a document with no variants and no scopes as it is", () => {
    const doc = mergePatch(DOC, {
      variants: null,
      bars: { b3: { only_in: null }, b5: { not_in: null } },
    });
    const v = applyVariant(doc, items);
    expect(v.raw).toBe(doc);
    expect(v.diagnostics).toEqual([]);
  });
});
