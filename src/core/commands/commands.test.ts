import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogSet } from "#catalog/link.ts";
import { type Derived, derive } from "../derive/derive.ts";
import { LockFile, lockText } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { projectText } from "../project/canonical.ts";
import { openLiveCatalogs } from "../project/open.ts";
import { select } from "../query.ts";
import { FIXTURES, readJson } from "../testing.ts";
import { applyBatch, applyCommand } from "./apply.ts";
import { History } from "./history.ts";
import { COMMAND_LIST } from "./registry.ts";
import type { CommandEnv, RawDoc, State } from "./types.ts";

/**
 * Commands (design §6). Every command has a test here (the last test holds the list to the
 * registry); the geometric ones are checked against derive: an edit that should keep the body
 * where it was must give the same derived positions and lengths.
 */

const ENV: CommandEnv = { today: "2026-11-26" };
const exercised = new Set<string>();

function stateOf(dir: string): State {
  return {
    doc: readJson(join(dir, "alukit.json")) as RawDoc,
    lock: LockFile.parse(readJson(join(dir, "alukit.lock.json"))),
  };
}

const cartDir = join(FIXTURES, "cart");
const cart = () => stateOf(cartDir);
const g = (n: string) => stateOf(join(FIXTURES, "golden-ends", n));

/** Applies commands that must succeed; records each as exercised. */
function ok(state: State, ...commands: object[]) {
  const r = applyBatch(state, commands, ENV);
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.failed)}`);
  for (const c of commands) exercised.add((c as { cmd: string }).cmd);
  return r;
}

/** Applies one command that must be refused; returns its errors. */
function no(state: State, command: object) {
  const r = applyBatch(state, [command], ENV);
  expect(r.ok, JSON.stringify(command)).toBe(false);
  return r.ok ? [] : r.failed.errors;
}

function derived(state: State): Derived {
  return derive(state.doc, lockItems(state.lock));
}

/** Every bar's design points and lengths, rounded to the output quantum, by id. */
function geometry(d: Derived, swap: ReadonlySet<string> = new Set()) {
  const r = (x: number) => Math.round(x * 100) / 100 + 0;
  return Object.fromEntries(
    [...d.bars].map(([id, b]) => {
      const [A, B] = swap.has(id) ? [b.placed.B, b.placed.A] : [b.placed.A, b.placed.B];
      return [
        id,
        {
          A: A?.map(r),
          B: B?.map(r),
          cut: r(b.lengths.cut),
          centre: r(b.lengths.centre),
          short: r(b.lengths.short),
          box: [b.placed.box.x1 - b.placed.box.x0, b.placed.box.y1 - b.placed.box.y0].map(r).sort(),
        },
      ];
    }),
  );
}

function errorsOf(d: Derived) {
  return d.diagnostics.filter((x) => x.severity !== "info").map((x) => `${x.code} ${x.entity}`);
}

let live: CatalogSet;
beforeAll(async () => {
  live = (await openLiveCatalogs(cartDir, readJson(join(cartDir, "alukit.json")))).set;
});

describe("structure commands", () => {
  it("addNode writes a bare point, or an object when it has a label; refuses unknown params", () => {
    const r = ok(
      cart(),
      { cmd: "addNode", args: { at: [0, 0, "H"] } },
      { cmd: "addNode", args: { at: [1, 2, 3], label: "x" } },
    );
    expect(r.results.map((x) => x.created)).toEqual([["n1"], ["n2"]]);
    expect((r.state.doc.nodes as Record<string, unknown>).n1).toEqual([0, 0, "H"]);
    expect((r.state.doc.nodes as Record<string, unknown>).n2).toEqual({
      at: [1, 2, 3],
      label: "x",
    });
    expect((r.state.doc.ids as Record<string, number>).n).toBe(2);
    expect(no(cart(), { cmd: "addNode", args: { at: ["Q", 0, 0] } })).toMatchObject([
      { code: "expr", field: "0" },
    ]);
    expect(no(cart(), { cmd: "addNode", args: { on: { bar: "b99", at_mm: 1 } } })).toMatchObject([
      { code: "ref", refs: ["b99"] },
    ]);
    expect(
      no(cart(), { cmd: "addNode", args: { at: [0, 0, 0], on: { bar: "b1", at_mm: 1 } } })[0]?.code,
    ).toBe("args");
  });

  it("moveNode moves to a point or by an offset, keeping expressions", () => {
    const s = ok(cart(), { cmd: "addNode", args: { at: ["W", 0, 10], tags: ["t"] } }).state;
    const m = ok(s, { cmd: "moveNode", args: { id: "n1", by: [-10, 0, 2.5] } }).state;
    expect((m.doc.nodes as Record<string, unknown>).n1).toEqual({
      at: ["W - 10", 0, 12.5],
      tags: ["t"],
    });
    const a = ok(m, { cmd: "moveNode", args: { id: "n1", on: { bar: "b1", at_mm: 100 } } }).state;
    expect((a.doc.nodes as Record<string, unknown>).n1).toEqual({
      on: { bar: "b1", at_mm: 100 },
      tags: ["t"],
    });
    expect(no(a, { cmd: "moveNode", args: { id: "n1", by: [1, 0, 0] } })[0]?.code).toBe("args");
    expect(no(a, { cmd: "moveNode", args: { id: "n9", at: [0, 0, 0] } })[0]?.code).toBe("missing");
  });

  it("addBar and setBar check the bar, its points and its item", () => {
    const s = ok(cart(), {
      cmd: "addBar",
      args: { item: "test:TS4080", a: [0, -500, 0], b: [500, -500, 0], roll_deg: 90 },
    });
    expect(s.results[0]?.created).toEqual(["b35"]);
    expect(derived(s.state).bars.get("b35")?.lengths.cut).toBe(500);
    const t = ok(s.state, {
      cmd: "setBar",
      args: { id: "b35", set: { roll_deg: null, b: [700, -500, 0] } },
    });
    expect((t.state.doc.bars as Record<string, Record<string, unknown>>).b35).toEqual({
      item: "test:TS4080",
      a: [0, -500, 0],
      b: [700, -500, 0],
    });
    expect(
      no(cart(), { cmd: "addBar", args: { item: "test:NOPE", a: [0, 0, 0], b: [1, 0, 0] } }),
    ).toMatchObject([{ code: "item", refs: ["test:NOPE"] }]);
    expect(no(cart(), { cmd: "addBar", args: { a: "n7", b: [1, 0, 0] } })).toMatchObject([
      { code: "ref", refs: ["n7"] },
    ]);
    expect(
      no(cart(), { cmd: "setBar", args: { id: "b1", set: { anchor: "nowhere!" } } })[0]?.code,
    ).toBe("schema");
    expect(no(cart(), { cmd: "setBar", args: { id: "c1", set: {} } })[0]?.code).toBe("args");
  });

  it("addRun and setRun write a list, or an object with a label", () => {
    const s = ok(cart(), { cmd: "addRun", args: { bars: ["b20", "b23"] } }).state;
    expect((s.doc.runs as Record<string, unknown>).r3).toEqual(["b20", "b23"]);
    const l = ok(s, { cmd: "setRun", args: { id: "r3", set: { label: "straps" } } }).state;
    expect((l.doc.runs as Record<string, unknown>).r3).toEqual({
      bars: ["b20", "b23"],
      label: "straps",
    });
    const back = ok(l, { cmd: "setRun", args: { id: "r3", set: { label: null } } }).state;
    expect((back.doc.runs as Record<string, unknown>).r3).toEqual(["b20", "b23"]);
    expect(no(cart(), { cmd: "addRun", args: { bars: ["b1"] } })[0]?.code).toBe("args");
  });

  it("removeEntity refuses while referred to, and cascade removes or prunes the referrers", () => {
    expect(no(g("G01"), { cmd: "removeEntity", args: { id: "b2" } })).toMatchObject([
      { code: "referenced", entity: "b2", refs: ["c1"] },
    ]);
    const r = ok(g("G01"), { cmd: "removeEntity", args: { id: "b2", cascade: true } });
    expect(r.results[0]).toMatchObject({ removed: ["b2", "c1"], changed: [] });

    // A butt that loses one of four ends keeps the others; a pivot that loses its only end goes,
    // and the brace hung on it, and the pivot at its other end.
    const c = ok(cart(), { cmd: "removeEntity", args: { id: "b1", cascade: true } }).results[0];
    expect(c?.removed).toEqual(["b1", "b14", "c5", "c13", "c14"]);
    expect(c?.changed).toEqual(["c1"]);

    // Ids are never reused.
    const gone = ok(cart(), { cmd: "removeEntity", args: { id: "b34", cascade: true } }).state;
    expect(
      ok(gone, { cmd: "addBar", args: { a: [0, 0, 0], b: [0, 0, 100] } }).results[0]?.created,
    ).toEqual(["b35"]);

    // An expression that reads the entity is not rewritten by cascade.
    const p = ok(cart(), {
      cmd: "setParam",
      args: { name: "T", value: "sec(b18).height_mm" },
    }).state;
    expect(no(p, { cmd: "removeEntity", args: { id: "b18", cascade: true } })).toMatchObject([
      { code: "referenced", refs: ["params/T"] },
    ]);
    expect(no(cart(), { cmd: "removeEntity", args: { id: "b26@2" } })[0]?.code).toBe("args");
  });
});

describe("reverseBar (§4.4)", () => {
  it("keeps every body where it was and rewrites what names its ends and stations", () => {
    const before = cart();
    const r = ok(before, { cmd: "reverseBar", args: { id: "b5" } });
    const after = r.state;
    const b5 = (after.doc.bars as Record<string, Record<string, unknown>>).b5 as Record<
      string,
      unknown
    >;
    expect(b5.a).toEqual(["W", 0, "H"]);
    expect(b5.b).toEqual([0, 0, "H"]);
    expect(b5.anchor).toBe("-x+y");
    expect(b5.roll_deg).toBe(270);
    expect((after.doc.connections as Record<string, Record<string, unknown>>).c1?.through).toBe(
      "b5",
    );
    // b24 stood on b5's +x face, measured from a: now from b, on the face that lands there.
    expect((after.doc.bars as Record<string, Record<string, unknown>>).b24?.a).toEqual({
      on: { bar: "b5", at_mm: 40, from: "b", face: "-x" },
    });
    expect(geometry(derived(after), new Set(["b5"]))).toEqual(geometry(derived(before)));
    expect(errorsOf(derived(after))).toEqual(errorsOf(derived(before)));
  });

  it("reverses a run: every piece, its order and the stations on it", () => {
    const before = cart();
    const r = ok(before, { cmd: "reverseBar", args: { id: "r1" } });
    expect((r.state.doc.runs as Record<string, unknown>).r1).toEqual(["b12", "b11"]);
    expect((r.state.doc.connections as Record<string, Record<string, unknown>>).c9?.ends).toEqual([
      "b11.a",
      "b12.b",
    ]);
    expect(geometry(derived(r.state), new Set(["b11", "b12"]))).toEqual(geometry(derived(before)));
    expect(no(before, { cmd: "reverseBar", args: { id: "b11" } })).toMatchObject([
      { code: "run", refs: ["r1"] },
    ]);
  });

  it("refuses a free end", () => {
    expect(no(cart(), { cmd: "reverseBar", args: { id: "b13" } })[0]?.code).toBe("geometry");
  });
});

describe("splitBar", () => {
  it("splits at a distance; stations past the point move to the new piece, as expressions", () => {
    const before = cart();
    const r = ok(before, {
      cmd: "splitBar",
      args: { id: "b9", at_mm: 300, run: true, splice: { connector: "test:SPL-40" } },
    });
    expect(r.results[0]?.created).toEqual(["n1", "b35", "r3", "c36"]);
    const doc = r.state.doc as Record<string, Record<string, Record<string, unknown>>>;
    expect(doc.nodes?.n1).toEqual([300, 0, "Hb"]);
    expect(doc.bars?.b9?.b).toBe("n1");
    expect(doc.bars?.b35).toMatchObject({ a: "n1", b: ["W", 0, "Hb"], anchor: "-x" });
    expect(doc.bars?.b18?.a).toEqual({ on: { bar: "b35", at_mm: "W / 2 - 300" } });
    expect(doc.connections?.c6?.ends).toEqual(["b35.b"]);
    expect(doc.connections?.c14?.base).toEqual({ bar: "b35", at_mm: 100, face: "+y" });
    expect(doc.connections?.c36).toEqual({
      type: "splice",
      ends: ["b9.b", "b35.a"],
      connector: "test:SPL-40",
    });
    expect(doc.patterns?.pt1?.along).toBe("r3");
    const a = geometry(derived(before));
    const b = geometry(derived(r.state));
    for (const id of Object.keys(a)) if (id !== "b9") expect(b[id], id).toEqual(a[id]);
    expect((b.b9?.cut ?? 0) + (b.b35?.cut ?? 0)).toBe(a.b9?.cut);
  });

  it("adds the splice a run needs, also when splitting a bar already in a run", () => {
    const r = ok(cart(), { cmd: "splitBar", args: { id: "b9", at_mm: 300, run: true } });
    expect(r.results[0]?.created).toEqual(["n1", "b35", "r3", "c36"]);
    expect((r.state.doc.connections as Record<string, unknown>).c36).toEqual({
      type: "splice",
      ends: ["b9.b", "b35.a"],
    });
    const inRun = ok(cart(), { cmd: "splitBar", args: { id: "b11", at_mm: 200 } });
    expect(inRun.results[0]?.created).toEqual(["n1", "b35", "c36"]);
    expect((inRun.state.doc.runs as Record<string, unknown>).r1).toEqual(["b11", "b35", "b12"]);
    expect(errorsOf(derived(inRun.state))).toEqual(errorsOf(derived(cart())));
  });

  it("moves the written holes past the point to the new piece, valued from their expressions", () => {
    const hole = (at_mm: number | string, from?: "b") => ({
      op: "hole",
      face: "+y",
      at_mm,
      ...(from ? { from } : {}),
      d_mm: 5,
    });
    const before = ok(cart(), {
      cmd: "setBar",
      args: { id: "b9", set: { ops: [hole(100), hole("W / 2"), hole(100, "b")] } },
    }).state;
    const r = ok(before, { cmd: "splitBar", args: { id: "b9", at_mm: 300, run: true } });
    const bars = r.state.doc.bars as Record<string, Record<string, unknown>>;
    expect(bars.b9?.ops).toEqual([hole(100)]);
    expect(bars.b35?.ops).toEqual([hole("W / 2 - 300"), hole(100, "b")]);
    // Each hole stays where it was along the line; derive appends generated machining after them.
    const at = (d: Derived, id: string) =>
      d.bars
        .get(id)
        ?.ops.filter((o) => o.op === "hole" && o.by === undefined)
        .map((o) => (o.op === "hole" ? [o.from, o.at] : []));
    const d = derived(r.state);
    expect(at(d, "b9")).toEqual([["a", 100]]);
    expect(at(d, "b35")).toEqual([
      ["a", 300],
      ["b", 100],
    ]);
  });

  it("refuses a point outside the bar, and a face layer without a run", () => {
    expect(no(cart(), { cmd: "splitBar", args: { id: "b9", at_mm: 1200 } })[0]?.code).toBe("args");
    expect(no(cart(), { cmd: "splitBar", args: { id: "b18", at_mm: 100 } })).toMatchObject([
      { code: "run", entity: "c23" },
    ]);
  });
});

describe("connections", () => {
  it("addConnection and setConnection", () => {
    const s = g("G01");
    const bare = ok(s, { cmd: "removeEntity", args: { id: "c1" } }).state;
    const r = ok(bare, {
      cmd: "addConnection",
      args: { type: "butt", through: "b1", ends: ["b2.a"] },
    });
    // G01 has no id counter: removing c1 records it, so c1 is never given again (§2).
    expect(bare.doc.ids).toEqual({ c: 1 });
    expect(r.results[0]?.created).toEqual(["c2"]);
    expect(derived(r.state).bars.get("b2")?.lengths.cut).toBe(580);
    const sp = ok(r.state, { cmd: "setConnection", args: { id: "c2", set: { spacer_mm: 8 } } });
    expect(derived(sp.state).bars.get("b2")?.lengths.cut).toBe(572);
    expect(
      no(r.state, { cmd: "setConnection", args: { id: "c2", set: { type: "miter" } } })[0]?.code,
    ).toBe("schema");
  });

  it("autoConnect butts through the bar passing the point, else a vertical, else the lowest id", () => {
    const bare = ok(g("G01"), { cmd: "removeEntity", args: { id: "c1" } }).state;
    const a = ok(bare, { cmd: "autoConnect", args: { at: [1000, 0, 0] } });
    expect(a.results[0]?.info).toEqual({ through: "b1", ends: ["b2.a"] });
    expect(geometry(derived(a.state))).toEqual(geometry(derived(g("G01"))));

    const post = ok(bare, { cmd: "addBar", args: { a: [1000, 0, 0], b: [1000, 0, 500] } }).state;
    expect(ok(post, { cmd: "autoConnect", args: { end: "b3.a" } }).results[0]?.info).toEqual({
      through: "b3",
      ends: ["b1.b", "b2.a"],
    });
    const span = ok(bare, { cmd: "addBar", args: { a: [1000, -300, 0], b: [1000, 300, 0] } }).state;
    expect(ok(span, { cmd: "autoConnect", args: { at: [1000, 0, 0] } }).results[0]?.info).toEqual({
      through: "b3",
      ends: ["b1.b", "b2.a"],
    });
    expect(no(g("G01"), { cmd: "autoConnect", args: { at: [1000, 0, 0] } })[0]?.code).toBe(
      "geometry",
    );
  });

  it("autoConnect with optional does nothing where nothing butts, and connects where something does", () => {
    // The draw tool sends one for each end of the bar it adds, in the same batch (§7.1).
    const s = g("G01");
    // At the corner, c1 already claims both ends.
    const none = ok(s, { cmd: "autoConnect", args: { at: [1000, 0, 0], optional: true } });
    expect(none.state).toBe(s);
    expect(none.results[0]).toMatchObject({
      created: [],
      info: { skipped: "no bar end meets at that point" },
    });
    const alone = ok(s, { cmd: "autoConnect", args: { at: [0, 0, 0], optional: true } });
    expect(alone.results[0]?.info).toEqual({
      skipped: "only b1 meets at that point: nothing butts on it",
    });
    const bare = ok(s, { cmd: "removeEntity", args: { id: "c1" } }).state;
    const a = ok(
      bare,
      { cmd: "addBar", args: { a: [1000, 600, 0], b: [1000, 900, 0] } },
      { cmd: "autoConnect", args: { at: [1000, 0, 0], optional: true } },
      { cmd: "autoConnect", args: { at: [1000, 600, 0], optional: true } },
    );
    expect(a.results.map((r) => r.info)).toEqual([
      undefined,
      { through: "b1", ends: ["b2.a"] },
      { through: "b2", ends: ["b3.a"] },
    ]);
  });
});

describe("parts and patterns", () => {
  it("addPart pins a newly named item into the lock; setPart, addPattern, setPattern", () => {
    // test:FOOT-M8 is in the test catalog and not in the cart, so the cart's lock lacks it.
    const env = { ...ENV, live };
    const r = applyBatch(
      cart(),
      [
        {
          cmd: "addPart",
          args: { item: "test:FOOT-M8", on: { bar: "b7", at_mm: 100, groove: "+y.1" } },
        },
        // The cart's parts run to p5 (its unplaced lines), so the new part is p6.
        { cmd: "setPart", args: { id: "p6", set: { on: { at_mm: 120 } } } },
        { cmd: "addPattern", args: { template: ["p6"], along: "b7", pitch_mm: 100, count: 3 } },
        { cmd: "setPattern", args: { id: "pt3", set: { count: 4 } } },
      ],
      env,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.failed));
    for (const c of ["addPart", "setPart", "addPattern", "setPattern"]) exercised.add(c);
    expect(r.state.lock.items["test:FOOT-M8"]).toBeDefined();
    expect(cart().lock.items["test:FOOT-M8"]).toBeUndefined();
    expect((r.state.doc.parts as Record<string, unknown>).p6).toEqual({
      item: "test:FOOT-M8",
      on: { bar: "b7", at_mm: 120, groove: "+y.1" },
    });
    expect((r.state.doc.patterns as Record<string, Record<string, unknown>>).pt3?.count).toBe(4);
    // Without the live catalogs the item cannot be resolved, so the part is refused.
    expect(
      no(cart(), {
        cmd: "addPart",
        args: { item: "test:FOOT-M8", on: { bar: "b7", at_mm: 100 } },
      })[0]?.code,
    ).toBe("item");
  });

  it("explodePattern makes ordinary entities exactly where derive put the copies", () => {
    const before = cart();
    const d0 = derived(before);
    const r = ok(before, { cmd: "explodePattern", args: { id: "pt1" } });
    expect(r.results[0]?.removed).toEqual(["pt1"]);
    expect(r.results[0]?.created).toEqual([
      "b35",
      "c36",
      "c37",
      "b36",
      "c38",
      "c39",
      "b37",
      "c40",
      "c41",
      "b38",
      "c42",
      "c43",
      "b39",
      "c44",
      "c45",
    ]);
    const d1 = derived(r.state);
    const g0 = geometry(d0);
    const g1 = geometry(d1);
    const copies = ["b26@1", "b26@2", "b26@4", "b26@5", "b26@6"];
    const made = ["b35", "b36", "b37", "b38", "b39"];
    copies.forEach((c, i) => {
      expect(g1[made[i] as string], c).toEqual(g0[c]);
    });
    expect((r.state.doc.bars as Record<string, Record<string, unknown>>).b35?.a).toEqual({
      on: { bar: "b9", at_mm: 300 },
    });
    expect(errorsOf(d1)).toEqual([]);
  });

  it("array copies at a pitch as ordinary entities", () => {
    const s = g("G06");
    const r = ok(s, {
      cmd: "array",
      args: { ids: ["b2", "c1"], along: "b1", pitch_mm: 100, count: 3 },
    });
    expect(r.results[0]?.created).toEqual(["b3", "c2", "b4", "c3"]);
    const bars = r.state.doc.bars as Record<string, Record<string, unknown>>;
    expect(bars.b3).toMatchObject({ a: { on: { bar: "b1", at_mm: 600 } }, b: [1100, 0, 500] });
    const d = geometry(derived(r.state));
    expect(d.b3?.cut).toBe(d.b2?.cut);
    expect(d.b4?.A).toEqual([700, 0, 0]);
    expect(
      no(s, { cmd: "array", args: { ids: ["b1"], along: "b1", pitch_mm: 1, count: 2 } })[0]?.code,
    ).toBe("args");
  });
});

describe("mirror", () => {
  /** A beam across the plane x = 600 and a brace on it, butting through it. */
  function braced(): State {
    const doc: RawDoc = {
      schema: "alukit.project/1",
      catalogs: ["../catalogs/test"],
      defaults: { bar: { item: "test:TS40", opt: { finish: "anodised" } } },
      bars: {
        b1: { a: [0, 0, 0], b: [1200, 0, 0], label: "beam" },
        b2: {
          a: { on: { bar: "b1", at_mm: 200 } },
          b: ["X", 0, 500],
          ends: { a: { cut: "angle" } },
          roll_deg: 30,
        },
      },
      params: { X: 300 },
      connections: { c1: { type: "butt", through: "b1", ends: ["b2.a"] } },
    };
    return { doc, lock: g("G01").lock };
  }

  it("copies a brace as its image, on the beam the plane maps onto itself", () => {
    const s = braced();
    const r = ok(s, {
      cmd: "mirror",
      args: { ids: ["b2", "c1"], plane: { axis: "x", at_mm: 600 } },
    });
    expect(r.results[0]?.created).toEqual(["b3", "c2"]);
    const bars = r.state.doc.bars as Record<string, Record<string, unknown>>;
    expect(bars.b3).toEqual({
      a: { on: { bar: "b1", at_mm: 200, from: "b" } },
      b: ["1200 - X", 0, 500],
      ends: { a: { cut: "angle" } },
      roll_deg: 330,
    });
    expect((r.state.doc.connections as Record<string, unknown>).c2).toEqual({
      type: "butt",
      through: "b1",
      ends: ["b3.a"],
    });
    const d = geometry(derived(r.state));
    expect(d.b3).toMatchObject({
      A: [1000, 0, 0],
      B: [900, 0, 500],
      cut: d.b2?.cut,
      centre: d.b2?.centre,
    });
    expect(errorsOf(derived(r.state))).toEqual([]);
  });

  it("refuses what the plane does not map onto itself, and keeps a node on the plane", () => {
    expect(
      no(braced(), { cmd: "mirror", args: { ids: ["b2"], plane: { axis: "x", at_mm: 500 } } }),
    ).toMatchObject([{ code: "geometry", refs: ["b1"] }]);
    const s = ok(braced(), { cmd: "addNode", args: { at: [600, 0, 500] } }).state;
    const t = ok(s, { cmd: "addBar", args: { a: [100, 0, 500], b: "n1" } }).state;
    const m = ok(t, { cmd: "mirror", args: { ids: ["b3"], plane: { axis: "x", at_mm: 600 } } });
    expect((m.state.doc.bars as Record<string, unknown>).b4).toEqual({
      a: [1100, 0, 500],
      b: "n1",
    });
    const off = ok(braced(), { cmd: "addNode", args: { at: [700, 0, 500] } }).state;
    const u = ok(off, { cmd: "addBar", args: { a: [100, 0, 500], b: "n1" } }).state;
    expect(
      no(u, { cmd: "mirror", args: { ids: ["b3"], plane: { axis: "x", at_mm: 600 } } }),
    ).toMatchObject([{ code: "geometry", refs: ["n1"] }]);
  });

  it("mirrors a part at a world pose: position reflected, rotation turned over", () => {
    const env = { ...ENV, live };
    const r = applyBatch(
      braced(),
      [
        {
          cmd: "addPart",
          args: { item: "test:FOOT-M8", at: { pos: [100, 50, 0], rot_deg: [0, 0, 90] } },
        },
        { cmd: "mirror", args: { ids: ["p1"], plane: { axis: "y", at_mm: 0 } } },
      ],
      env,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.failed));
    expect((r.state.doc.parts as Record<string, unknown>).p2).toEqual({
      item: "test:FOOT-M8",
      // Rz(90) points the part's x along +y; its image's x points along −y: Rz(270).
      at: { pos: [100, -50, 0], rot_deg: [0, 0, 270] },
    });
  });
});

describe("items, params, costs and records", () => {
  it("addItem and setItem", () => {
    const r = ok(
      cart(),
      { cmd: "addItem", args: { id: "plate-a", item: { kind: "plate", thickness_mm: 4 } } },
      {
        cmd: "setItem",
        args: { id: "project:plate-a", set: { thickness_mm: 5 } },
      },
    );
    expect(r.results[0]?.created).toEqual(["project:plate-a"]);
    expect((r.state.doc.items as Record<string, unknown>)["plate-a"]).toEqual({
      kind: "plate",
      thickness_mm: 5,
    });
    expect(no(r.state, { cmd: "addItem", args: { id: "plate-a", item: {} } })[0]?.code).toBe(
      "exists",
    );
  });

  it("setParam changes what derives from it, and refuses to remove a param in use", () => {
    const r = ok(cart(), { cmd: "setParam", args: { name: "W", value: 1300 } });
    expect(derived(r.state).bars.get("b9")?.lengths.cut).toBe(1220);
    expect(no(cart(), { cmd: "setParam", args: { name: "W", value: null } })[0]?.code).toBe(
      "referenced",
    );
    const u = ok(cart(), {
      cmd: "setParam",
      args: { name: "spare", value: { v: 3, src: "meas" } },
    });
    expect(
      ok(u.state, { cmd: "setParam", args: { name: "spare", value: null } }).state.doc.params,
    ).toEqual(cart().doc.params);
    expect(no(cart(), { cmd: "setParam", args: { name: "Z", value: "Q + 1" } })[0]?.code).toBe(
      "expr",
    );
  });

  it("cost lines, price bands and offer choices", () => {
    // The cart already holds cost lines K1–K5 and a chosen kit for test:BRK-40 (its order list).
    const before = cart().doc;
    const r = ok(
      cart(),
      {
        cmd: "addCost",
        args: {
          cost: { label: "painting", kind: "labour", low_minor: 1, likely_minor: 2, high_minor: 3 },
        },
      },
      { cmd: "setCost", args: { id: "K6", set: { high_minor: 4 } } },
      {
        cmd: "setPriceBands",
        args: { bands: [{ supplier: "test-vendor", low_pct: -10, high_pct: 25 }] },
      },
      { cmd: "chooseOffer", args: { item: "test:TS40", offer: "TS40-c7", kerf_mm: 2 } },
    );
    expect(r.state.doc.costs).toEqual([
      ...(before.costs as unknown[]),
      { id: "K6", label: "painting", kind: "labour", low_minor: 1, likely_minor: 2, high_minor: 4 },
    ]);
    // A cost line is checked against its schema (§4.11): low <= likely <= high.
    expect(
      no(r.state, { cmd: "setCost", args: { id: "K6", set: { likely_minor: 5 } } })[0]?.code,
    ).toBe("schema");
    expect(r.state.doc.price_bands).toEqual([
      { supplier: "test-vendor", low_pct: -10, high_pct: 25 },
    ]);
    expect(r.state.doc.order).toEqual({
      ...(before.order as object),
      "test:TS40": { offer: "TS40-c7", kerf_mm: 2 },
    });
    const cleared = ok(
      r.state,
      { cmd: "chooseOffer", args: { item: "test:TS40", offer: null, kerf_mm: null } },
      { cmd: "chooseOffer", args: { item: "test:BRK-40", offer: null } },
    );
    expect(cleared.state.doc.order).toBeUndefined();
    expect(
      ok(r.state, { cmd: "setPriceBands", args: { bands: [] } }).state.doc.price_bands,
    ).toBeUndefined();
    expect(
      no(cart(), { cmd: "chooseOffer", args: { item: "test:TS40", offer: "NOPE" } })[0]?.code,
    ).toBe("offer");
  });

  it("tag and label", () => {
    const s = ok(cart(), { cmd: "addNode", args: { at: [0, 0, 0] } }).state;
    const t = ok(s, { cmd: "tag", args: { ids: ["n1", "b1", "r1"], add: ["frame"] } }).state;
    expect((t.doc.nodes as Record<string, unknown>).n1).toEqual({ at: [0, 0, 0], tags: ["frame"] });
    expect((t.doc.bars as Record<string, Record<string, unknown>>).b1?.tags).toEqual([
      "post",
      "frame",
    ]);
    expect((t.doc.runs as Record<string, unknown>).r1).toEqual({
      bars: ["b11", "b12"],
      tags: ["frame"],
    });
    const u = ok(t, { cmd: "tag", args: { ids: ["n1", "b1", "r1"], remove: ["frame"] } }).state;
    expect((u.doc.bars as Record<string, Record<string, unknown>>).b1?.tags).toEqual(["post"]);
    expect((u.doc.nodes as Record<string, unknown>).n1).toEqual([0, 0, 0]);
    expect((u.doc.runs as Record<string, unknown>).r1).toEqual(["b11", "b12"]);
    const l = ok(u, { cmd: "label", args: { id: "b1", label: "front left post" } }).state;
    expect((l.doc.bars as Record<string, Record<string, unknown>>).b1?.label).toBe(
      "front left post",
    );
    expect(
      (
        ok(l, { cmd: "label", args: { id: "b1", label: null } }).state.doc.bars as Record<
          string,
          unknown
        >
      ).b1,
    ).toEqual((cart().doc.bars as Record<string, unknown>).b1);
  });

  it("variants, checks, open items and decisions", () => {
    const r = ok(
      cart(),
      { cmd: "addVariant", args: { name: "tall", variant: { params: { H: "1100" } } } },
      { cmd: "setVariant", args: { name: "tall", set: { params: { H: "1200" } }, default: true } },
      {
        cmd: "addCheck",
        args: {
          check: { value: "bbox().z", op: "<=", limit: "950", text: "fits under the bench" },
        },
      },
      // The cart holds open item O1 (its order is held on c35), so this one is O2.
      { cmd: "addOpen", args: { open: { text: "which feet?", blocks: "order", scope: ["b1"] } } },
      { cmd: "addDecision", args: { text: "40-series", why: "stiff enough" } },
      {
        cmd: "resolveOpen",
        args: { id: "O2", text: "levelling feet M8", why: "the floor is uneven" },
      },
    );
    expect(r.state.doc.variants).toEqual({
      default: "tall",
      list: { tall: { params: { H: "1200" } } },
    });
    expect(r.state.doc.checks).toEqual([
      { id: "C1", value: "bbox().z", op: "<=", limit: "950", text: "fits under the bench" },
    ]);
    expect(r.state.doc.open).toEqual(cart().doc.open);
    expect(r.state.doc.decisions).toEqual([
      { id: "D1", date: "2026-11-26", text: "40-series", why: "stiff enough" },
      {
        id: "D2",
        date: "2026-11-26",
        text: "levelling feet M8",
        why: "the floor is uneven",
        resolves: "O2",
      },
    ]);
    expect(
      no(cart(), { cmd: "addCheck", args: { check: { value: "1 +", op: "<=", limit: "2" } } })[0]
        ?.code,
    ).toBe("expr");
    expect(no(r.state, { cmd: "addVariant", args: { name: "tall", variant: {} } })[0]?.code).toBe(
      "exists",
    );
    // An open item's scope is pruned by a cascade, and one left with none is removed.
    const o = ok(cart(), {
      cmd: "addOpen",
      args: { open: { text: "x", scope: ["b31", "b32"] } },
    }).state;
    expect(
      ok(o, { cmd: "removeEntity", args: { id: "b32", cascade: true } }).state.doc.open,
    ).toEqual([...(cart().doc.open as unknown[]), { id: "O2", text: "x", scope: ["b31"] }]);
  });

  it("open items: a scope names suppliers, items, and entities by their ends, pieces and copies", () => {
    // §4.12 and the order rules (§5.5): only an entity of the document is a reference.
    const scope = ["supplier:test-vendor", "test:SCR-M8x16", "b5.a", "c23.f1", "b26@2", "K2"];
    const r = ok(cart(), { cmd: "addOpen", args: { open: { text: "x", blocks: "order", scope } } });
    const o2 = (doc: RawDoc) => (doc.open as { id: string }[]).find((x) => x.id === "O2");
    expect(o2(r.state.doc)).toEqual({ id: "O2", text: "x", blocks: "order", scope });
    for (const bad of ["b99.a", "c99.f1", "b99@2"]) {
      const e = no(cart(), { cmd: "addOpen", args: { open: { text: "x", scope: [bad] } } });
      expect(e[0]).toMatchObject({ code: "ref", refs: [bad.replace(/[.@].*$/, "")] });
    }
    // A bar named by its end follows the end when the bar is reversed.
    const rev = ok(r.state, { cmd: "reverseBar", args: { id: "b5" } }).state;
    expect(o2(rev.doc)).toMatchObject({ scope: [scope[0], scope[1], "b5.b", ...scope.slice(3)] });
    // Removing an entity it names prunes the scope; a supplier or an item is never pruned.
    const cut = ok(r.state, { cmd: "removeEntity", args: { id: "b5", cascade: true } }).state;
    expect(o2(cut.doc)).toMatchObject({ scope: [scope[0], scope[1], ...scope.slice(3)] });
  });

  it("saveView", () => {
    const r = ok(cart(), {
      cmd: "saveView",
      args: { name: "iso", view: { pos: [2500, -2000, 1800], target: [600, 300, 450] } },
    });
    expect(r.state.doc.views).toEqual({
      iso: { pos: [2500, -2000, 1800], target: [600, 300, 450] },
    });
    expect(
      ok(r.state, { cmd: "saveView", args: { name: "iso", view: null } }).state.doc.views,
    ).toBeUndefined();
  });

  it("lockUpdate refreshes the lock from the live catalogs, as a step", () => {
    const s = cart();
    const entry = s.lock.items["test:TS40"];
    if (!entry) throw new Error("the cart's lock pins test:TS40");
    const stale: State = {
      ...s,
      lock: {
        ...s.lock,
        items: { ...s.lock.items, "test:TS40": { ...entry, hash: `sha256:${"0".repeat(64)}` } },
      },
    };
    const r = applyBatch(stale, [{ cmd: "lockUpdate", args: {} }], { ...ENV, live });
    if (!r.ok) throw new Error(JSON.stringify(r.failed));
    exercised.add("lockUpdate");
    expect(r.state.lock).toEqual(s.lock);
    expect(r.results[0]?.info).toMatchObject({
      entries: [{ kind: "items", id: "test:TS40", change: "changed" }],
    });
    expect(no(s, { cmd: "lockUpdate", args: {} })[0]?.code).toBe("catalogs");
  });
});

describe("a plane's normal naming a bar (gap G-A, G27)", () => {
  const bars = (s: State) => s.doc.bars as Record<string, Record<string, unknown>>;
  const normalOf = (s: State, bar: string) => {
    const ends = bars(s)[bar]?.ends as { b?: { plane?: { normal?: unknown } } } | undefined;
    return ends?.b?.plane?.normal;
  };

  it("is a reference: query lists it, commands check it, removeEntity refuses or cascades", () => {
    const s = g("G27");
    const shoeRefs = ["b1", "b3"];
    expect(select(s.doc, "bars of b2")).toEqual({ ok: true, ids: shoeRefs });
    expect(select(s.doc, "bars of b3")).toEqual({ ok: true, ids: ["b2"] });

    expect(
      no(s, {
        cmd: "setBar",
        args: { id: "b2", set: { ends: { b: { plane: { point: "n1", normal: "b9" } } } } },
      }),
    ).toMatchObject([{ code: "ref", field: "ends/b/plane/normal", refs: ["b9"] }]);

    expect(no(s, { cmd: "removeEntity", args: { id: "b3" } })).toMatchObject([
      { code: "referenced", entity: "b3", refs: ["b2", "c2"] },
    ]);
    // The shoe holds the strut whole, as it holds a face's or an end's bar: it goes with it.
    const r = ok(s, { cmd: "removeEntity", args: { id: "b3", cascade: true } });
    expect(r.results[0]).toMatchObject({ removed: ["b2", "b3", "c1", "c2"], changed: [] });
  });

  it("array and explodePattern remap it inside the copied set and keep it outside", () => {
    const s = g("G27");
    const both = ok(s, {
      cmd: "array",
      args: { ids: ["n1", "b2", "b3", "c1", "c2"], along: "b1", pitch_mm: 200, count: 2 },
    });
    expect(both.results[0]?.created).toEqual(["b4", "b5", "c3", "c4", "n2"]);
    expect(normalOf(both.state, "b4")).toBe("b5");
    expect(errorsOf(derived(both.state))).toEqual([]);

    // A shoe copied without its strut stays square to the strut: a translation keeps its axis.
    const alone = ok(s, {
      cmd: "array",
      args: { ids: ["n1", "b2", "c1"], along: "b1", pitch_mm: -200, count: 2 },
    });
    expect(normalOf(alone.state, "b4")).toBe("b3");
    const d = derived(alone.state);
    expect(errorsOf(d)).toEqual([]);
    expect(d.bars.get("b4")?.ends.b.angle).toBeCloseTo(d.bars.get("b2")?.ends.b.angle as number, 9);

    // Exploding a pattern gives the copies derive made, normal included.
    const p = ok(s, {
      cmd: "addPattern",
      args: { template: ["n1", "b2", "b3", "c1", "c2"], along: "b1", pitch_mm: 300, count: 2 },
    }).state;
    const before = geometry(derived(p));
    const x = ok(p, { cmd: "explodePattern", args: { id: "pt1" } });
    expect(normalOf(x.state, "b4")).toBe("b5");
    const after = geometry(derived(x.state));
    expect(after.b4).toEqual(before["b2@1"]);
    expect(after.b5).toEqual(before["b3@1"]);
  });

  it("mirror remaps it, and keeps a bar outside the set only when the plane keeps its axis", () => {
    const s = g("G27");
    const m = ok(s, {
      cmd: "mirror",
      args: { ids: ["n1", "b2", "b3", "c1", "c2"], plane: { axis: "x", at_mm: 500 } },
    });
    expect(normalOf(m.state, "b4")).toBe("b5");
    const d = geometry(derived(m.state));
    expect(d.b4?.cut).toBe(d.b2?.cut);
    expect(d.b5?.cut).toBe(d.b3?.cut);
    expect(errorsOf(derived(m.state))).toEqual([]);

    // The strut's axis (0.6, 0, -0.8) is turned by a plane square to x: it must come along.
    expect(
      no(s, { cmd: "mirror", args: { ids: ["n1", "b2", "c1"], plane: { axis: "x", at_mm: 500 } } }),
    ).toMatchObject([{ code: "geometry", refs: ["b3"] }]);
    // A plane square to y leaves that axis as it is: the image is square to the same strut.
    const y = ok(s, { cmd: "mirror", args: { ids: ["b2", "c1"], plane: { axis: "y", at_mm: 0 } } });
    expect(normalOf(y.state, "b4")).toBe("b3");
    expect(errorsOf(derived(y.state))).toEqual([]);
  });

  it("stays a bar in canonical form, while a vector normal is not snapped as a length", () => {
    const s = g("G27");
    const text = projectText(s.doc);
    expect(text).toBe(readFileSync(join(FIXTURES, "golden-ends", "G27", "alukit.json"), "utf8"));
    expect(text).toContain('"plane": { "point": "n1", "normal": "b3" }');
    const vector = ok(s, {
      cmd: "setBar",
      args: {
        id: "b2",
        set: { ends: { b: { plane: { point: "n1", normal: [0.6000000000000001, 0, -0.8] } } } },
      },
    }).state;
    expect(projectText(vector.doc)).toContain('"normal": [0.6000000000000001, 0, -0.8]');
  });
});

describe("batches and history (§6)", () => {
  it("a batch with one refused command changes nothing", () => {
    const h = new History(cart());
    const before = h.current;
    const r = h.apply(
      [
        { cmd: "addNode", args: { at: [0, 0, 0] } },
        { cmd: "addBar", args: { a: "n1", b: [0, 0, 100] } },
        { cmd: "addBar", args: { a: "n1", b: "n99" } },
      ],
      ENV,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.failed).toMatchObject({
        index: 2,
        cmd: "addBar",
        errors: [{ code: "ref", refs: ["n99"] }],
      });
    expect(h.current).toBe(before);
    expect(h.rev).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it("undo and redo restore the document and the lock byte for byte", () => {
    const initial = cart();
    const fixtureText = readFileSync(join(cartDir, "alukit.json"), "utf8");
    const lockBytes = readFileSync(join(cartDir, "alukit.lock.json"), "utf8");
    const h = new History(initial);
    const steps = [
      [
        { cmd: "addNode", args: { at: [0, -600, 0] } },
        { cmd: "addBar", args: { a: "n1", b: [1200, -600, 0] } },
      ],
      [{ cmd: "reverseBar", args: { id: "b5" } }],
      [{ cmd: "splitBar", args: { id: "b9", at_mm: 300, run: true } }],
      [{ cmd: "explodePattern", args: { id: "pt1" } }],
      [{ cmd: "removeEntity", args: { id: "b1", cascade: true } }],
      [
        {
          cmd: "addPart",
          args: { item: "test:TNUT-M8", on: { bar: "b7", at_mm: 100, groove: "+y.1" } },
        },
      ],
    ];
    const texts: string[] = [projectText(h.current.doc)];
    const locks: string[] = [lockText(h.current.lock)];
    for (const s of steps) {
      const r = h.apply(s, { ...ENV, live }, "cli:test");
      if (!r.ok) throw new Error(JSON.stringify(r.failed));
      texts.push(projectText(h.current.doc));
      locks.push(lockText(h.current.lock));
    }
    expect(texts[0]).toBe(fixtureText);
    expect(locks[0]).toBe(lockBytes);
    expect(new Set(texts).size).toBe(texts.length);
    for (let i = steps.length; i > 0; i--) {
      expect(h.undo().ok).toBe(true);
      expect(projectText(h.current.doc)).toBe(texts[i - 1]);
      expect(lockText(h.current.lock)).toBe(locks[i - 1]);
    }
    expect(h.undo()).toEqual({ ok: false, message: "nothing to undo" });
    for (let i = 1; i <= steps.length; i++) {
      expect(h.redo().ok).toBe(true);
      expect(projectText(h.current.doc)).toBe(texts[i]);
    }
    expect(h.rev).toBe(steps.length * 3);
    expect(
      h
        .log()
        .map((e) => e.what)
        .slice(0, 2),
    ).toEqual(["addNode, addBar", "reverseBar"]);
    // A new step drops what could be redone.
    h.undo();
    h.apply([{ cmd: "addNode", args: { at: [0, 0, 0] } }], ENV);
    expect(h.canRedo).toBe(false);
  });

  it("writes canonical output: a command sequence's document is in canonical form", () => {
    const r = ok(
      cart(),
      { cmd: "addNode", args: { at: [0.1 + 0.2, 0, 0], label: "z" } },
      { cmd: "addBar", args: { a: "n1", b: [1199.9999999999998, 0, 0], tags: ["t"] } },
      { cmd: "mirror", args: { ids: ["b35"], plane: { axis: "y", at_mm: 0 } } },
      { cmd: "addCheck", args: { check: { value: "1", op: "<=", limit: "2" } } },
    );
    const text = projectText(r.state.doc);
    expect(projectText(JSON.parse(text))).toBe(text);
    expect(text).toContain('"n1": { "at": [0.3, 0, 0], "label": "z" }');
    expect(text).toContain('"b35": { "a": "n1", "b": [1200, 0, 0], "tags": ["t"] }');
  });

  it("never throws, whatever the arguments", () => {
    const junk: unknown[] = [
      undefined,
      null,
      1,
      "x",
      [],
      {},
      { id: 7 },
      { id: "b1", set: 3 },
      { ids: "b1" },
    ];
    for (const c of COMMAND_LIST) {
      for (const args of junk) {
        expect(() => applyCommand(cart(), { cmd: c.name, args }, ENV)).not.toThrow();
      }
    }
    expect(applyCommand(cart(), { cmd: "nope" }, ENV)).toMatchObject({
      ok: false,
      errors: [{ code: "command" }],
    });
    expect(applyCommand(cart(), 5, ENV)).toMatchObject({
      ok: false,
      errors: [{ code: "command" }],
    });
  });
});

afterAll(() => {
  // Every command of §6 has a successful test above.
  const missing = COMMAND_LIST.map((c) => c.name).filter((n) => !exercised.has(n));
  expect(missing).toEqual([]);
});
