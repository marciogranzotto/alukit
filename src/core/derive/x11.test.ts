import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glbScene } from "../../export/model.ts";
import { meshDisplay } from "../../mesh/display.ts";
import { modelExtent } from "../../mesh/extent.ts";
import { bom } from "../bom/bom.ts";
import { checkModel } from "../check/check.ts";
import { unjoinedButts } from "../check/joints.ts";
import { modelOutputs, outputAccessors } from "../check/outputs.ts";
import { History } from "../commands/history.ts";
import type { RawDoc } from "../commands/types.ts";
import { cutList } from "../cutlist/cutlist.ts";
import type { ItemSource } from "../items.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { machiningSheet } from "../machining/machining.ts";
import { order } from "../order/order.ts";
import { projectText } from "../project/canonical.ts";
import { parseProject } from "../project/parse.ts";
import { deriveOutputs } from "../revision/outputs.ts";
import { FIXTURES, mergePatch, readJson } from "../testing.ts";
import { type Derived, derive } from "./derive.ts";
import { derivedJson } from "./output.ts";

/**
 * Gap X11 (docs/notes/x11.md): a modelling aid, a wall, a floor or a bench a frame stands beside,
 * entered the cut list, the BOM, the order (as a placeholder that blocks it) and `bbox()`, since
 * nothing could say a member is context. A bar, a placed part and a butt's through body now take
 * `context: true`: drawn and checked against, not built or bought. A connection whose every member
 * is context is the context's own. G51 pins the outputs; these tests pin the schema, the rules at
 * their edges, the view, the GLB and the edit path.
 */

function load(dir: string, patch: unknown = {}) {
  const raw = mergePatch(readJson(join(dir, "alukit.json")), patch) as Record<string, unknown>;
  const lock = LockFile.parse(readJson(join(dir, "alukit.lock.json")));
  const items = lockItems(lock);
  return { raw, items, lock, derived: derive(raw, items) };
}

const G51 = join(FIXTURES, "golden-gen", "G51");
const g51 = (patch: unknown = {}) => load(G51, patch);

function outputs(d: Derived, items: ItemSource) {
  const cl = cutList({ derived: d, items });
  const b = bom({ derived: d, items });
  const o = order({
    derived: d,
    items,
    bom: b,
    cutList: cl,
    diagnostics: [...d.diagnostics, ...cl.diagnostics, ...b.diagnostics],
    asOf: "2026-11-26",
  });
  const sheet = machiningSheet({ derived: d, items, bom: b, cutList: cl });
  return { cl, b, o, sheet };
}

const bomItems = (b: ReturnType<typeof bom>) => b.groups.flatMap((g) => g.lines.map((l) => l.item));

describe("the schema (X11)", () => {
  const doc = (extra: Record<string, unknown>) => ({
    schema: "alukit.project/1",
    catalogs: [],
    ...extra,
  });

  it("takes context on a bar, a placed part and a butt's through body", () => {
    const r = parseProject(
      doc({
        bars: { b1: { item: "test:TS40", a: [0, 0, 0], b: [0, 0, 100], context: true } },
        parts: {
          p1: { item: "test:BRK-40", on: { bar: "b1", at_mm: 50, face: "+x" }, context: true },
          p2: { item: "test:BRK-40", at: { pos: [0, 0, 0] }, context: true },
        },
        connections: {
          c1: {
            type: "butt",
            through: { body: "project:wall", at: [0, 0, 0], context: true },
            ends: ["b1.a"],
          },
        },
      }),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.doc.bars.b1?.context).toBe(true);
  });

  it("refuses context: false and context on an unplaced line, which is counted, never drawn", () => {
    const no = parseProject(
      doc({ bars: { b1: { item: "test:TS40", a: [0, 0, 0], b: [0, 0, 100], context: false } } }),
    );
    expect(no.diagnostics.map((x) => [x.code, x.entity])).toEqual([["schema", "b1"]]);
    const unplaced = parseProject(
      doc({
        parts: {
          p1: { item: "test:BRK-40", qty: 2, unplaced: true, why: "spares", context: true },
        },
      }),
    );
    expect(unplaced.diagnostics.map((x) => [x.code, x.entity])).toEqual([["schema", "p1"]]);
  });
});

describe("what derive marks (X11)", () => {
  it("marks the members that say so, and a connection whose every member is context", () => {
    const { derived: d } = g51();
    expect([...d.context].sort()).toEqual(["b3", "b4", "b5", "c1", "p2", "p3"]);
    expect(d.bars.get("b3")?.context).toBe(true);
    expect(d.bars.get("b1")?.context).toBeUndefined();
    const p2 = d.parts.get("p2");
    expect(p2?.placed && p2.context).toBe(true);
    // The splice and its stud are still derived, as the context's own.
    expect(d.hardware.map((h) => [h.item, h.source, h.context])).toEqual([
      ["test:SPL-40", "c1", true],
      ["test:SPL-STUD", "c1", true],
    ]);
  });

  it("keeps a connection with a built member built, so what it brings is bought", () => {
    const { derived: d } = g51({ bars: { b4: { context: null } } });
    expect(d.context.has("c1")).toBe(false);
    expect(d.hardware.every((h) => h.context === undefined)).toBe(true);
  });

  it("does not pass context to a part on a context bar's station", () => {
    const { derived: d } = g51({ bars: { b1: { context: true } } });
    expect(d.context.has("b1")).toBe(true);
    expect(d.context.has("p1")).toBe(false);
  });

  it("gives a pattern's copies their template's context", () => {
    const { derived: d } = g51({
      patterns: { pt1: { template: ["p3"], along: { dir: [0, 1, 0] }, pitch_mm: 100, count: 2 } },
    });
    expect(d.context.has("p3@1")).toBe(true);
    const copy = d.parts.get("p3@1");
    expect(copy?.placed && copy.context).toBe(true);
  });

  it("leaves every geometric fact as it was: lengths, ends and holes of a context bar", () => {
    const marked = g51().derived;
    const built = g51({
      bars: { b3: { context: null }, b4: { context: null }, b5: { context: null } },
    }).derived;
    for (const id of ["b3", "b4", "b5"]) {
      expect(marked.bars.get(id)?.lengths).toEqual(built.bars.get(id)?.lengths);
      expect(marked.bars.get(id)?.ops).toEqual(built.bars.get(id)?.ops);
    }
    expect(marked.diagnostics).toEqual(built.diagnostics);
  });
});

describe("the outputs leave context out (X11)", () => {
  it("cuts, counts, buys and weighs only the build; the BOM lists the context apart", () => {
    const { derived: d, items } = g51();
    const { cl, b, o } = outputs(d, items);
    expect(cl.groups.map((g) => [g.item, g.lines.flatMap((l) => l.sources)])).toEqual([
      ["test:TS40", ["b1", "b2"]],
    ]);
    expect(bomItems(b)).toEqual(["test:TS40", "test:BRK-40"]);
    expect(b.context).toEqual([
      {
        id: "b3",
        kind: "bar",
        item: "test:TS40",
        name: "Profile 40x40 (parametric)",
        opt: { finish: "anodised" },
      },
      {
        id: "b4",
        kind: "bar",
        item: "test:TS40",
        name: "Profile 40x40 (parametric)",
        opt: { finish: "anodised" },
      },
      {
        id: "b5",
        kind: "bar",
        item: "test:TS40",
        name: "Profile 40x40 (parametric)",
        opt: { finish: "anodised" },
      },
      {
        id: "p2",
        kind: "part",
        item: "project:FLOOR",
        name: "The floor the frame stands on",
        opt: {},
      },
      { id: "p3", kind: "part", item: "project:WALL", name: "The wall behind the bench", opt: {} },
    ]);
    // No `mass` warning for a placeholder that gives none: it is not weighed.
    expect(b.diagnostics).toEqual([]);
    expect(b.mass_unknown).toEqual([]);
    expect(o.status).toBe("READY");
    expect(o.suppliers.map((s) => s.supplier)).toEqual(["test-vendor"]);
  });

  it("a context bar longer than any offer cuts asks for no splice: it is not cut", () => {
    const long = {
      item: "test:TS40",
      opt: { finish: "anodised" },
      a: [0, 2000, 0],
      b: [5000, 2000, 0],
    };
    const marked = g51({ bars: { b6: { ...long, context: true } } });
    expect(marked.derived.context.has("b6")).toBe(true);
    const codes = (d: ReturnType<typeof g51>) =>
      outputs(d.derived, d.items).cl.diagnostics.map((x) => `${x.code} ${x.entity}`);
    expect(codes(marked)).toEqual([]);
    expect(codes(g51({ bars: { b6: long } }))).toEqual(["length b6"]);
  });

  it("a placeholder not marked context still holds its group, as a part to buy later", () => {
    const { derived: d, items } = g51({ parts: { p2: { context: null } } });
    const { o } = outputs(d, items);
    const unsourced = o.suppliers.find((s) => s.supplier === null);
    expect(unsourced?.reasons.map((r) => [r.rule, r.message])).toEqual([
      ["placeholder", "project:FLOOR: a placeholder, not a part to order"],
    ]);
  });

  it("bbox() is the build's extent: the floor slab under z = 0 no longer moves a size check", () => {
    const check = { id: "C1", value: "bbox().z", op: "<=", limit: "1000", text: "under the bench" };
    const run = (patch: object) => {
      const { raw, derived, items } = g51({ ...patch, checks: [check] });
      return checkModel({
        raw,
        derived,
        items,
        accessors: outputAccessors(modelOutputs(derived, items)),
      }).checks[0];
    };
    expect(run({})).toMatchObject({ value: 1000, pass: true });
    expect(run({ parts: { p2: { context: null } } })).toMatchObject({ value: 1030, pass: false });
    const mass = { id: "C2", value: "mass()", op: "<=", limit: "10" };
    const { raw, derived, items } = g51({ checks: [mass] });
    const m = checkModel({
      raw,
      derived,
      items,
      accessors: outputAccessors(modelOutputs(derived, items)),
    }).checks[0];
    expect(m?.value).toBe(3.136);
  });

  it("a context part with no box leaves bbox() whole; a built one still cannot be measured", () => {
    // A T-nut gives no box: a part at a pose of it is drawn as a marker, not measured.
    const nut = { item: "test:TNUT-M8", at: { pos: [0, 0, 2000] } };
    const marked = g51({ parts: { p4: { ...nut, context: true } } });
    // Placed and drawn, as context: what leaves it out of bbox() is its flag, not a refusal.
    expect(marked.derived.context.has("p4")).toBe(true);
    expect(marked.derived.diagnostics).toEqual([]);
    const box = modelExtent(marked.derived, marked.items);
    expect(box.ok && box.extent).toEqual({ min: [-20, -20, 0], max: [420, 20, 1000] });
    const built = g51({ parts: { p4: nut } });
    expect(modelExtent(built.derived, built.items)).toEqual({
      ok: false,
      noBox: [{ id: "p4", item: "test:TNUT-M8" }],
    });
  });

  it("lists machining the build makes on a context member as made in place, not the context's own", () => {
    const base = g51();
    expect(outputs(base.derived, base.items).sheet.in_place).toEqual([
      {
        bar: "b3",
        item: "test:TS40",
        opt: { finish: "anodised" },
        ops: 1,
        machining: ["Ø8.50 hole 500.00 mm from end a on face +x"],
      },
    ]);
    const nothing = g51({ bars: { b3: { ops: null } } });
    expect(outputs(nothing.derived, nothing.items).sheet.in_place).toBeUndefined();
  });

  it("a butt between context members asks for no connector; one with a built member still does", () => {
    const bench = {
      bars: {
        b6: {
          item: "test:TS40",
          opt: { finish: "anodised" },
          a: [-300, 0, 600],
          b: [-300, -400, 600],
          context: true,
        },
      },
      connections: { c2: { type: "butt", through: "b3", ends: ["b6.a"] } },
    };
    const notes = (patch: unknown) => {
      const { raw, derived, items } = g51(patch);
      expect(derived.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
      const out = checkModel({ raw, derived, items });
      return [
        unjoinedButts(derived),
        out.diagnostics.filter((x) => x.code === "butt-no-connector").map((x) => x.entity),
      ];
    };
    expect(notes(bench)).toEqual([[], []]);
    expect(notes(mergePatch(bench, { bars: { b6: { context: null } } }))).toEqual([["c2"], ["c2"]]);
  });
});

describe("a connection's members (X11)", () => {
  const G25 = join(FIXTURES, "golden-gen", "G25");
  const all = {
    bars: Object.fromEntries(["b1", "b2", "b3", "b4", "b5"].map((b) => [b, { context: true }])),
  };

  it("a face connection between context layers buys no fastener, sleeve, washer or nut", () => {
    const { derived: d, items } = load(G25, all);
    expect(d.context.has("c1")).toBe(true);
    expect(d.fastenings.get("c1")?.context).toBe(true);
    expect(d.pieces.every((p) => p.context === true)).toBe(true);
    const { cl, b, sheet } = outputs(d, items);
    expect(cl.groups).toEqual([]);
    expect(b.groups).toEqual([]);
    expect(sheet.in_place).toBeUndefined();
    // Its fasteners are drawn as context, and no body of the build is left to measure.
    expect(meshDisplay(d, items).fasteners.every((f) => f.context === true)).toBe(true);
    expect(modelExtent(d, items)).toEqual({ ok: true, extent: undefined });
  });

  it("one built layer makes it the build's: its rods, sleeves and nuts are bought, its holes in a context layer made in place", () => {
    const { derived: d, items } = load(G25, { bars: { b3: { context: true } } });
    expect(d.context.has("c1")).toBe(false);
    const { cl, b, sheet } = outputs(d, items);
    expect(cl.groups.map((g) => [g.item, g.pieces])).toEqual([
      ["test-geo:FB-50x10", 2],
      ["test-geo:FB-50x20", 2],
      ["test-geo:TUBE-18x2", 4],
      ["test:M10-ROD", 4],
    ]);
    expect(bomItems(b)).toEqual([
      "test-geo:FB-50x10",
      "test-geo:FB-50x20",
      "test-geo:TUBE-18x2",
      "test:M10-ROD",
      "test-geo:NUT-M10",
      "test-geo:WSH-M10",
    ]);
    expect(sheet.in_place?.map((x) => [x.bar, x.ops])).toEqual([["b3", 8]]);
    expect(sheet.in_place?.[0]?.machining.every((m) => m.startsWith("Ø11.00 hole "))).toBe(true);
  });

  it("a butt through a context body counts no body", () => {
    const G28 = join(FIXTURES, "golden-ends", "G28");
    const through = { body: "project:motor", at: { pos: [600, 0, 0], rot_deg: [0, 0, 90] } };
    const marked = load(G28, { connections: { c1: { through: { ...through, context: true } } } });
    expect(marked.derived.context.has("c1")).toBe(false);
    const { b, o } = outputs(marked.derived, marked.items);
    expect(bomItems(b)).toEqual(["test:TS40"]);
    expect(b.context?.map((c) => [c.id, c.kind, c.item])).toEqual([
      ["c1", "body", "project:motor"],
    ]);
    expect(o.suppliers.flatMap((s) => s.reasons.map((r) => r.rule))).not.toContain("placeholder");
    // The ends still bear on its box.
    const built = load(G28);
    for (const id of ["b1", "b2", "b3"]) {
      expect(marked.derived.bars.get(id)?.lengths).toEqual(built.derived.bars.get(id)?.lengths);
    }
  });

  it("a context member still covers a cross hole's mouth: the checks read it (G50)", () => {
    const G50 = join(FIXTURES, "golden-gen", "G50");
    const wall = load(G50);
    const marked = load(G50, { parts: { p1: { context: true } } });
    expect(marked.derived.diagnostics).toEqual(wall.derived.diagnostics);
    expect(marked.derived.bars.get("b2")?.ops).toEqual(wall.derived.bars.get("b2")?.ops);
    expect(bomItems(outputs(wall.derived, wall.items).b)).toContain("project:WALL");
    expect(bomItems(outputs(marked.derived, marked.items).b)).not.toContain("project:WALL");
  });
});

describe("the view, derive --json and the GLB (X11)", () => {
  it("flags context in derive --json and the view model, and draws its parts translucent", () => {
    const { derived: d, items } = g51();
    const json = derivedJson(d) as {
      bars: Record<string, { context?: boolean }>;
      parts: Record<string, { context?: boolean }>;
      hardware: { item: string; context?: boolean }[];
    };
    expect(Object.entries(json.bars).map(([id, b]) => [id, b.context])).toEqual([
      ["b1", undefined],
      ["b2", undefined],
      ["b3", true],
      ["b4", true],
      ["b5", true],
    ]);
    expect(json.parts.p2?.context).toBe(true);
    expect(json.parts.p1?.context).toBeUndefined();
    expect(json.hardware.map((h) => [h.item, h.context])).toEqual([
      ["test:SPL-40", true],
      ["test:SPL-STUD", true],
    ]);
    const view = meshDisplay(d, items).parts;
    expect(view.p2).toMatchObject({ context: true, translucent: true, placeholder: true });
    expect(view.p1?.context).toBeUndefined();
  });

  it("keeps context in the GLB, flagged and in its own material, with no SKU or cut length", () => {
    const { raw, items, lock } = g51();
    const { derived, outputs: out } = deriveOutputs({ raw, items, lock, asOf: "2026-11-26" });
    const scene = glbScene({
      derived,
      items,
      outputs: out,
      stamp: {},
      generator: "test",
      name: "G51",
    });
    const node = (id: string) => scene.nodes.find((n) => n.extras?.id === id);
    expect(node("b3")?.extras).toEqual({
      kind: "bar",
      id: "b3",
      item: "test:TS40",
      opt: { finish: "anodised" },
      context: true,
    });
    expect(node("b1")?.extras).toMatchObject({ sku: "TS40-c7", cut_mm: 1000 });
    expect(node("p2")?.extras).toMatchObject({ kind: "part", context: true });
    const mat = (id: string) =>
      scene.materials[scene.meshes[node(id)?.mesh as number]?.material as number];
    expect(mat("b3")?.name).toBe("context, translucent");
    expect(mat("p2")?.name).toBe("context, translucent");
    expect(mat("b1")?.name).toBe("anodised");
  });
});

describe("the edit path (X11)", () => {
  it("sets context with setBar and setPart, in canonical form, and undo takes it back", () => {
    const state = {
      doc: readJson(join(G51, "alukit.json")) as RawDoc,
      lock: LockFile.parse(readJson(join(G51, "alukit.lock.json"))),
    };
    const h = new History(state);
    const before = projectText(h.current.doc);
    const env = { today: "2026-11-26" };
    expect(h.apply([{ cmd: "setBar", args: { id: "b1", set: { context: true } } }], env).ok).toBe(
      true,
    );
    expect(h.apply([{ cmd: "setPart", args: { id: "p2", set: { context: null } } }], env).ok).toBe(
      true,
    );
    const text = projectText(h.current.doc);
    expect(text).toContain('"b": [0, 0, 1000], "context": true, "label": "a post of the frame"');
    expect(text).toContain(
      '"p2": { "item": "project:FLOOR", "at": { "pos": [-1000, -1000, -30] }, "label"',
    );
    expect(h.undo().ok).toBe(true);
    expect(h.undo().ok).toBe(true);
    expect(projectText(h.current.doc)).toBe(before);
    // A value other than true is refused, and nothing changes.
    const r = h.apply([{ cmd: "setBar", args: { id: "b1", set: { context: false } } }], env);
    expect(r.ok).toBe(false);
    expect(projectText(h.current.doc)).toBe(before);
  });
});
