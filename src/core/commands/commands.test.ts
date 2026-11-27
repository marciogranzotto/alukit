import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogSet } from "#catalog/link.ts";
import { modelExtent } from "../../mesh/extent.ts";
import { checkModel } from "../check/check.ts";
import { modelOutputs, outputAccessors } from "../check/outputs.ts";
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

  it("autoConnect's prefer gives the three arrangements of a rectangle's corners (BE-5)", () => {
    // A 1000 × 600 ground rectangle of 40 × 40 bars, drawn b1 to b4 around, joined at each
    // corner. The bar that runs through reaches 20 past its corner, one that butts stops 20
    // short of it, so by hand: the lowest id through (today's rule, as nothing is vertical)
    // 1040 / 600 / 1000 / 560; x through 1040 / 560 / 1040 / 560; y through 960 / 640 / 960 / 640.
    const s0 = g("G01");
    const empty = { ...s0, doc: { ...s0.doc, bars: {}, connections: {} } };
    const corners = [
      [0, 0, 0],
      [1000, 0, 0],
      [1000, 600, 0],
      [0, 600, 0],
    ];
    const bars = corners.map((a, i) => ({
      cmd: "addBar",
      args: { a, b: corners[(i + 1) % 4] },
    }));
    const drawn = ok(empty, ...bars).state;
    const cuts = (s: State) =>
      ["b1", "b2", "b3", "b4"].map((id) => derived(s).bars.get(id)?.lengths.cut);
    const join = (s: State, prefer?: string) =>
      ok(
        s,
        ...corners.map((at) => ({
          cmd: "autoConnect",
          args: { at, ...(prefer ? { prefer } : {}) },
        })),
      ).state;
    expect(cuts(join(drawn))).toEqual([1040, 600, 1000, 560]);
    expect(cuts(join(drawn, "first"))).toEqual([1040, 600, 1000, 560]);
    expect(cuts(join(drawn, "vertical"))).toEqual([1040, 600, 1000, 560]);
    expect(cuts(join(drawn, "x"))).toEqual([1040, 560, 1040, 560]);
    expect(cuts(join(drawn, "y"))).toEqual([960, 640, 960, 640]);

    // Absent, prefer is the project's defaults.corner, which setProject sets.
    const ys = ok(drawn, { cmd: "setProject", args: { defaults: { corner: "y" } } }).state;
    expect((ys.doc.defaults as { corner?: string }).corner).toBe("y");
    expect(cuts(join(ys))).toEqual([960, 640, 960, 640]);
    expect(cuts(join(ys, "x"))).toEqual([1040, 560, 1040, 560]);

    // A bar passing through the point still wins first; where no bar runs along the axis asked,
    // the rule is today's: a vertical, else the lowest id.
    const post = ok(drawn, { cmd: "addBar", args: { a: [1000, 0, 0], b: [1000, 0, 500] } }).state;
    const at = (s: State, prefer: string, where: number[]) =>
      ok(s, { cmd: "autoConnect", args: { at: where, prefer } }).results[0]?.info;
    expect(at(post, "y", [1000, 0, 0])).toEqual({ through: "b2", ends: ["b1.b", "b5.a"] });
    expect(at(post, "first", [1000, 0, 0])).toEqual({ through: "b1", ends: ["b2.a", "b5.a"] });
    expect(at(post, "vertical", [1000, 0, 0])).toEqual({ through: "b5", ends: ["b1.b", "b2.a"] });
    const tee = ok(drawn, { cmd: "addBar", args: { a: [500, 0, 0], b: [500, 300, 0] } }).state;
    expect(at(tee, "y", [500, 0, 0])).toEqual({ through: "b1", ends: ["b5.a"] });
    const slope = ok(
      empty,
      { cmd: "addBar", args: { a: [0, 0, 0], b: [300, 300, 300] } },
      {
        cmd: "addBar",
        args: { a: [300, 300, 300], b: [300, 300, 900] },
      },
    ).state;
    expect(at(slope, "x", [300, 300, 300])).toEqual({ through: "b2", ends: ["b1.b"] });
    expect(no(drawn, { cmd: "autoConnect", args: { at: [0, 0, 0], prefer: "z" } })[0]?.code).toBe(
      "args",
    );
  });

  it("moveEnd lengthens a bar onto another's line, and autoConnect joins it there (move.test.ts)", () => {
    // G01's b2 freed from c1 and drawn short of b1, then moved back onto b1's line.
    const bare = ok(g("G01"), { cmd: "removeEntity", args: { id: "c1" } }).state;
    const short = ok(bare, { cmd: "setBar", args: { id: "b2", set: { a: [1000, 200, 0] } } });
    const r = ok(
      short.state,
      { cmd: "moveEnd", args: { end: "b2.a", to: "b1" } },
      { cmd: "autoConnect", args: { end: "b2.a", optional: true } },
    );
    expect(geometry(derived(r.state))).toEqual(geometry(derived(g("G01"))));
  });

  it("transform moves G01 and back as one step each, keeping c1 (transform.test.ts)", () => {
    const there = ok(g("G01"), { cmd: "transform", args: { ids: ["b1", "b2"], by: [0, 0, 250] } });
    expect(there.state.doc.connections).toEqual(g("G01").doc.connections);
    const back = ok(there.state, {
      cmd: "transform",
      args: { ids: ["b1", "b2"], by: [0, 0, -250] },
    });
    expect(back.state.doc).toEqual(g("G01").doc);
  });

  it("autoConnect with optional does nothing where nothing butts, and connects where something does", () => {
    // The draw tool sends one for each end of the bar it adds, in the same batch (§7.1).
    const s = g("G01");
    // At the corner, c1 already claims both ends.
    const none = ok(s, { cmd: "autoConnect", args: { at: [1000, 0, 0], optional: true } });
    expect(none.state).toBe(s);
    expect(none.results[0]).toMatchObject({
      created: [],
      info: { skipped: "every bar end at that point is joined already" },
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

  // The box frame of the audit's brace (tests/fixtures/brace, src/core/brace.test.ts).
  const frame = () => stateOf(join(FIXTURES, "brace"));
  const brace = (a: unknown[], b: unknown[], extra: object = {}) => ({
    cmd: "addBar",
    args: { a, b, anchor: "+x", ...extra },
  });
  const barSpec = (s: State, id: string) =>
    (s.doc.bars as Record<string, Record<string, unknown>>)[id];
  const connSpec = (s: State, id: string) =>
    (s.doc.connections as Record<string, Record<string, unknown>>)[id];

  it("autoConnect declares an angled end's cut in the same step, and nothing on a square one (E-UX-11)", () => {
    // A brace in the back plane from 100 above the bottom-left corner to 100 below the top
    // right: each end lies on a post, which runs through; the end meets its face at an angle.
    const drawn = ok(frame(), brace([0, 600, 100], [1000, 600, 650]));
    const a = ok(drawn.state, { cmd: "autoConnect", args: { at: [0, 600, 100] } });
    expect(a.results[0]).toMatchObject({
      created: ["c9"],
      changed: ["b13"],
      info: { through: "b3", ends: ["b13.a"] },
    });
    expect(barSpec(a.state, "b13")?.ends).toEqual({ a: { cut: "angle" } });
    // A post that runs on past the point has no end there to leave alone.
    expect(connSpec(a.state, "c9")).toEqual({ type: "butt", through: "b3", ends: ["b13.a"] });
    expect(errorsOf(derived(a.state))).toEqual([]);
    expect(derived(a.state).bars.get("b13")?.ends.a).toMatchObject({ by: "c9", cut: "angle" });

    // A rail butting square declares nothing, and the step changes no bar.
    const rail = ok(frame(), brace([0, 600, 300], [1000, 600, 300]));
    const r = ok(
      rail.state,
      { cmd: "autoConnect", args: { at: [0, 600, 300] } },
      { cmd: "autoConnect", args: { at: [1000, 600, 300] } },
    );
    expect(r.results.map((x) => x.changed)).toEqual([[], []]);
    expect(barSpec(r.state, "b13")?.ends).toBeUndefined();
    expect(errorsOf(derived(r.state))).toEqual([]);

    // A cut the end declares already is the end's own: autoConnect leaves it.
    const square = ok(
      frame(),
      brace([0, 600, 100], [1000, 600, 650], { ends: { a: { cut: "square" } } }),
    );
    const s = ok(square.state, { cmd: "autoConnect", args: { at: [0, 600, 100] } });
    expect(s.results[0]?.changed).toEqual([]);
    expect(barSpec(s.state, "b13")?.ends).toEqual({ a: { cut: "square" } });
  });

  it("autoConnect joins an end on a joined corner into the corner's through bar (E-UX-12)", () => {
    const drawn = ok(frame(), brace([0, 600, 0], [1000, 600, 750]));
    const a = ok(drawn.state, { cmd: "autoConnect", args: { end: "b13.a" } });
    expect(a.results[0]).toMatchObject({
      created: ["c9"],
      info: { through: "b3", ends: ["b13.a"] },
    });
    // Its own butt, leaving the post's end to the corner's butt c3, which is unchanged.
    expect(connSpec(a.state, "c9")).toEqual({
      type: "butt",
      through: "b3",
      ends: ["b13.a"],
      through_end: "none",
    });
    expect(connSpec(a.state, "c3")).toEqual(connSpec(frame(), "c3"));
    expect(derived(a.state).bars.get("b3")?.ends.a.by).toBe("c3");
    expect(errorsOf(derived(a.state))).toEqual([]);

    // A corner joined by a miter has no bar running through: nothing for the end to butt on.
    const mitred = ok(
      g("G01"),
      { cmd: "removeEntity", args: { id: "c1" } },
      { cmd: "addConnection", args: { type: "miter", ends: ["b1.b", "b2.a"] } },
      { cmd: "addBar", args: { a: [1000, 0, 0], b: [500, 300, 0] } },
    );
    expect(no(mitred.state, { cmd: "autoConnect", args: { end: "b3.a" } })[0]).toMatchObject({
      code: "geometry",
      message: expect.stringContaining("nothing butts on it"),
    });
  });

  it("autoConnect leaves an end a connection names, though its plane failed", () => {
    // G11: c1 and c2 both name b2.a, which falls back to its default (two providers). It is
    // claimed: joining it again would make a third.
    const r = no(g("G11"), { cmd: "autoConnect", args: { at: [1000, 0, 0] } });
    expect(r[0]).toMatchObject({
      code: "geometry",
      message: "every bar end at that point is joined already",
    });
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
        // The cart's parts run to p8 (its custom plate, bent angle and placeholder), so the new
        // part is p9.
        { cmd: "setPart", args: { id: "p9", set: { on: { at_mm: 120 } } } },
        { cmd: "addPattern", args: { template: ["p9"], along: "b7", pitch_mm: 100, count: 3 } },
        { cmd: "setPattern", args: { id: "pt3", set: { count: 4 } } },
      ],
      env,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.failed));
    for (const c of ["addPart", "setPart", "addPattern", "setPattern"]) exercised.add(c);
    expect(r.state.lock.items["test:FOOT-M8"]).toBeDefined();
    expect(cart().lock.items["test:FOOT-M8"]).toBeUndefined();
    expect((r.state.doc.parts as Record<string, unknown>).p9).toEqual({
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
    // Nothing new: the cart's own warnings, its three overhanging end faces (§4.5).
    expect(errorsOf(d1)).toEqual(errorsOf(d0));
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
    // The brace, rolled 30°, and its image overhang the beam's top alike (§4.5): two warnings.
    const m = derived(r.state);
    expect(errorsOf(m)).toEqual(["connection c1", "connection c2"]);
    const seat = (c: string) => m.butts.get(c)?.ends[0];
    expect(seat("c2")?.overhang).toBeCloseTo(seat("c1")?.overhang ?? Number.NaN, 9);
    expect(seat("c2")?.overhang_area).toBeCloseTo(seat("c1")?.overhang_area ?? Number.NaN, 9);
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

describe("addFrame (BE-6)", () => {
  /** G01's project with nothing drawn: 40 × 40 test:TS40, anodised, by default. */
  const empty = (): State => {
    const s = g("G01");
    return { ...s, doc: { ...s.doc, bars: {}, connections: {} } };
  };
  const tagged = (s: State, tag: string) =>
    Object.entries(s.doc.bars as Record<string, { tags?: string[] }>)
      .filter(([, b]) => b.tags?.includes(tag))
      .map(([id]) => id);
  /** The cut length of each bar of a role, sorted, mm. */
  const cuts = (s: State, tag: string) => {
    const d = derived(s);
    return tagged(s, tag).map((id) => d.bars.get(id)?.lengths.cut);
  };
  const checked = (s: State) => {
    const items = lockItems(s.lock);
    const d = derive(s.doc, items);
    const accessors = outputAccessors(modelOutputs(d, items));
    return checkModel({ raw: s.doc, derived: d, items, accessors }).diagnostics;
  };
  const extent = (s: State) => {
    const box = modelExtent(derived(s), lockItems(s.lock));
    if (!box.ok || !box.extent) throw new Error("no extent");
    return [box.extent.min, box.extent.max].map((p) => p.map((x) => Math.round(x * 100) / 100 + 0));
  };

  it("builds four posts, a base and a top ring, butted at all 8 corners, outside faces flush", () => {
    const r = ok(empty(), { cmd: "addFrame", args: { size: [1000, 600, 800] } });
    const s = r.state;
    expect(r.results[0]?.created).toEqual([
      ...Array.from({ length: 12 }, (_, i) => `b${i + 1}`),
      ...Array.from({ length: 8 }, (_, i) => `c${i + 1}`),
    ]);
    expect(r.results[0]?.info).toEqual({
      posts: ["b1", "b2", "b3", "b4"],
      rings: { base: ["b5", "b6", "b7", "b8"], top: ["b9", "b10", "b11", "b12"] },
      connections: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
    });
    // The typed size is the footprint and the height: every outside face on it.
    expect(extent(s)).toEqual([
      [0, 0, 0],
      [1000, 600, 800],
    ]);
    // The default rule, vertical: the posts run through, the rails butt between them.
    expect(cuts(s, "post")).toEqual([800, 800, 800, 800]);
    expect(cuts(s, "base")).toEqual([920, 920, 520, 520]);
    expect(cuts(s, "top")).toEqual([920, 920, 520, 520]);
    const conns = Object.values(s.doc.connections as Record<string, unknown>);
    expect(conns).toHaveLength(8);
    expect(conns.every((c) => (c as { type: string }).type === "butt")).toBe(true);
    // Nothing open, nothing wrong.
    const problems = checked(s);
    expect(problems.filter((p) => p.code === "unconnected")).toEqual([]);
    expect(problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("follows the corner rule, a shelf ring, the ring choice and the connector", () => {
    const at = (args: object) => ok(empty(), { cmd: "addFrame", args }).state;
    // By hand: a rail that runs through spans its whole side; one that butts loses 40 a corner.
    const x = at({ size: [1000, 600, 800], corner: "x" });
    expect([cuts(x, "base"), cuts(x, "post")]).toEqual([
      [1000, 1000, 520, 520],
      [720, 720, 720, 720],
    ]);
    const y = at({ size: [1000, 600, 800], corner: "y" });
    expect([cuts(y, "top"), cuts(y, "post")]).toEqual([
      [920, 920, 600, 600],
      [720, 720, 720, 720],
    ]);
    // The project's rule when the frame names none.
    const ys = ok(empty(), { cmd: "setProject", args: { defaults: { corner: "y" } } }).state;
    const yd = ok(ys, { cmd: "addFrame", args: { size: [1000, 600, 800] } }).state;
    expect(cuts(yd, "top")).toEqual([920, 920, 600, 600]);

    // A shelf ring, top face 300 above the base, butted on the posts, which pass it.
    const shelf = at({ size: [1000, 600, 800], at: [100, 50, 10], shelf_mm: 300, corner: "x" });
    expect(cuts(shelf, "shelf")).toEqual([920, 920, 520, 520]);
    expect(Object.keys(shelf.doc.connections as object)).toHaveLength(12);
    expect(extent(shelf)).toEqual([
      [100, 50, 10],
      [1100, 650, 810],
    ]);
    const top = derived(shelf).bars.get(tagged(shelf, "shelf")[0] as string)?.placed.A;
    expect(top?.[2]).toBe(310);
    expect(
      checked(shelf).filter((p) => p.code === "unconnected" || p.severity === "error"),
    ).toEqual([]);

    // Only a top ring: the posts stand free at the base, which is no open corner.
    const t = applyBatch(
      empty(),
      [
        {
          cmd: "addFrame",
          args: { size: [1000, 600, 750], rings: ["top"], connector: "test:BRK-40", qty: 2 },
        },
      ],
      { ...ENV, live },
    );
    if (!t.ok) throw new Error(JSON.stringify(t.failed));
    const table = t.state;
    expect(Object.keys(table.doc.bars as object)).toHaveLength(8);
    expect(Object.values(table.doc.connections as object)).toEqual([
      { type: "butt", through: "b1", ends: ["b5.a", "b7.a"], connector: "test:BRK-40", qty: 2 },
      { type: "butt", through: "b2", ends: ["b5.b", "b8.a"], connector: "test:BRK-40", qty: 2 },
      { type: "butt", through: "b3", ends: ["b6.a", "b7.b"], connector: "test:BRK-40", qty: 2 },
      { type: "butt", through: "b4", ends: ["b6.b", "b8.b"], connector: "test:BRK-40", qty: 2 },
    ]);
    expect(checked(table).filter((p) => p.code === "unconnected")).toEqual([]);
  });

  it("writes W, D and H as params when asked, and the frame follows them", () => {
    const r = ok(empty(), { cmd: "addFrame", args: { size: [1000, 600, 800], params: true } });
    expect(r.state.doc.params).toEqual({ D: 600, H: 800, W: 1000 });
    expect((r.state.doc.bars as Record<string, unknown>).b2).toMatchObject({
      a: ["W", 0, 0],
      b: ["W", 0, "H"],
    });
    const wider = ok(r.state, { cmd: "setParam", args: { name: "W", value: 1200 } }).state;
    expect(cuts(wider, "base")).toEqual([1120, 1120, 520, 520]);
    expect(extent(wider)[1]).toEqual([1200, 600, 800]);
    // A param of that name already there is not overwritten.
    expect(no(wider, { cmd: "addFrame", args: { size: [500, 500, 500], params: true } })).toEqual([
      expect.objectContaining({ code: "exists", field: "params" }),
    ]);
  });

  it("refuses a frame too small for its profile, a shelf outside the rings, and a bad size", () => {
    expect(no(empty(), { cmd: "addFrame", args: { size: [70, 600, 800] } })).toEqual([
      expect.objectContaining({ code: "geometry", field: "size" }),
    ]);
    expect(
      no(empty(), { cmd: "addFrame", args: { size: [1000, 600, 800], shelf_mm: 60 } }),
    ).toEqual([expect.objectContaining({ code: "geometry", field: "shelf_mm" })]);
    expect(
      no(empty(), { cmd: "addFrame", args: { size: [1000, 600, 800], shelf_mm: 790 } })[0]?.field,
    ).toBe("shelf_mm");
    expect(no(empty(), { cmd: "addFrame", args: { size: [1000, -600, 800] } })[0]?.code).toBe(
      "args",
    );
  });

  it("refuses a frame with no item to build it of, saying so, not that no end meets", () => {
    // A project made by `alukit new --catalog …`: no default bar until one is set.
    const s = empty();
    const bare = { ...s, doc: { ...s.doc, defaults: {} } };
    expect(no(bare, { cmd: "addFrame", args: { size: [1000, 600, 800] } })).toEqual([
      expect.objectContaining({
        code: "item",
        field: "item",
        message: expect.stringContaining("defaults.bar.item is not set"),
      }),
    ]);
    // Naming the item is enough.
    const item = (s.doc.defaults as { bar: { item: string } }).bar.item;
    expect(ok(bare, { cmd: "addFrame", args: { size: [1000, 600, 800], item } }).ok).toBe(true);
  });

  it("is one step, in words", () => {
    const h = new History(empty());
    const r = h.apply([{ cmd: "addFrame", args: { size: [1000, 600, 800] } }], ENV, "ui");
    expect(r.ok).toBe(true);
    expect(h.log()).toEqual([
      { rev: 1, source: "ui", what: "addFrame", text: "add a box frame of 12 bars and 8 butts" },
    ]);
    const p = h.apply(
      [{ cmd: "addFrame", args: { size: [1000, 600, 800], at: [2000, 0, 0], params: true } }],
      ENV,
      "ui",
    );
    expect(p.ok).toBe(true);
    expect(h.log().at(-1)?.text).toBe(
      "add a box frame of 12 bars and 8 butts, sized by W, D and H",
    );
  });
});

describe("setProject (BE-1)", () => {
  /** Built-in std and forseti; one folder inside the project, ./parts; anything else outside. */
  const places: CommandEnv = {
    ...ENV,
    catalogs: {
      builtin: ["forseti", "std"],
      folder: (p) => (p === "./parts" ? undefined : `${p} is outside the project's folder`),
    },
  };
  const set = (state: State, args: object, env = places) => {
    const r = applyBatch(state, [{ cmd: "setProject", args }], env);
    if (r.ok) exercised.add("setProject");
    return r;
  };

  it("round-trips each field, merging objects, replacing lists, null removing", () => {
    const fields: [string, unknown][] = [
      ["name", "Cart 2"],
      ["catalogs", ["../catalogs/test", "../catalogs/test-geo", "../catalogs/test-gen", "std"]],
      ["currency", "EUR"],
      ["price_basis", "lowest"],
      ["fx", { USD: 5.6, GBP: { v: 7.1, src: "src", read: "2026-11-26" } }],
      ["defaults", { bar: { item: "test:TS40", opt: { finish: "anodised" } }, butt: { qty: 2 } }],
      ["order_rules", { "stale-price": "block", "est-price": "warn" }],
    ];
    for (const [k, v] of fields) {
      const r = set(cart(), { [k]: v });
      expect(r.ok, k).toBe(true);
      if (!r.ok) continue;
      expect(r.results[0]?.changed, k).toEqual([k]);
      const want = k === "fx" ? { USD: 5.6, GBP: (v as { GBP: unknown }).GBP } : v;
      expect(r.state.doc[k], k).toEqual(
        k === "defaults" ? { ...(cart().doc.defaults as object), ...(v as object) } : want,
      );
      // Its document is in canonical form, and null takes the field away again.
      expect(projectText(JSON.parse(projectText(r.state.doc)))).toBe(projectText(r.state.doc));
      const gone = set(r.state, { [k]: null });
      expect(gone.ok && Object.hasOwn(gone.state.doc, k), k).toBe(false);
    }
    // A merge patch: one default's option changes, its item and the others stay.
    const black = set(cart(), { defaults: { bar: { opt: { finish: "black" } }, cutting: null } });
    expect(black.ok && black.state.doc.defaults).toEqual({
      bar: { item: "test:TS40", opt: { finish: "black" } },
    });
    // fx merges by currency: USD's rate is replaced, a new one added, null removes one.
    const fx = set(cart(), { fx: { USD: null, EUR: 6.2 } });
    expect(fx.ok && fx.state.doc.fx).toEqual({ EUR: 6.2 });
  });

  it("validates what it leaves, as the document's schema does, and names the field", () => {
    const refused = (args: object) => {
      const r = set(cart(), args);
      return r.ok ? [] : r.failed.errors.map((e) => [e.code, e.field]);
    };
    expect(refused({ currency: "euro" })).toEqual([["args", "currency"]]);
    expect(refused({ price_basis: "cheapest" })[0]).toEqual(["args", "price_basis"]);
    expect(refused({ order_rules: { "no-such-rule": "block" } })[0]?.[0]).toBe("args");
    expect(refused({ defaults: { butt: { qty: 0 } } })[0]?.[0]).toBe("args");
    expect(refused({ defaults: { bar: { item: "test:NOPE" } } })).toEqual([
      ["item", "defaults/bar/item"],
    ]);
    expect(refused({ bars: {} })[0]?.[0]).toBe("args");
    expect(refused({})[0]?.[0]).toBe("args");
  });

  it("adds a built-in catalog or a folder inside the project, and nothing else (§7.2)", () => {
    const named = (state: State) => state.doc.catalogs;
    const was = cart().doc.catalogs as string[];
    const ok2 = set(cart(), { catalogs: [...was, "forseti", "./parts"] });
    expect(ok2.ok && named(ok2.state)).toEqual([...was, "forseti", "./parts"]);
    // The cart's own folders outside it are kept: only what a command adds is judged.
    const outside = set(cart(), { catalogs: [...was, "../elsewhere"] });
    expect(outside.ok ? [] : outside.failed.errors).toEqual([
      {
        code: "catalog",
        field: "catalogs",
        refs: ["../elsewhere"],
        message: "../elsewhere is outside the project's folder",
      },
    ]);
    const unknown = set(cart(), { catalogs: ["nope"] });
    expect(unknown.ok ? "" : unknown.failed.errors[0]?.message).toBe(
      "there is no built-in catalog nope (built in: forseti, std)",
    );
    // With no project folder to resolve a path in, a folder is refused, a built-in id taken.
    expect(set(cart(), { catalogs: [...was, "./parts"] }, ENV).ok).toBe(false);
    expect(set(cart(), { catalogs: [...was, "std"] }, ENV).ok).toBe(true);
  });

  it("is one step that undo takes back whole", () => {
    const h = new History(cart());
    const before = projectText(h.current.doc);
    const r = h.apply(
      [
        {
          cmd: "setProject",
          args: { name: "Renamed", currency: "USD", order_rules: { "stale-price": "off" } },
        },
      ],
      places,
    );
    expect(r.ok).toBe(true);
    expect(h.current.doc).toMatchObject({ name: "Renamed", currency: "USD" });
    h.undo();
    expect(projectText(h.current.doc)).toBe(before);
  });
});

describe("items, params, costs and records", () => {
  it("addItem and setItem: a project item, checked against its kind's schema and its material", () => {
    // Design §4.2's example plate.
    const plate = {
      kind: "plate",
      name: "Plate X",
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
    };
    const r = ok(
      cart(),
      { cmd: "addItem", args: { id: "plate-x", item: plate } },
      { cmd: "setItem", args: { id: "project:plate-x", set: { thickness_mm: 5 } } },
      {
        cmd: "addPart",
        args: { item: "project:plate-x", on: { bar: "b9", at_mm: 300, face: "+y" } },
      },
    );
    expect(r.results[0]?.created).toEqual(["project:plate-x"]);
    expect((r.state.doc.items as Record<string, unknown>)["plate-x"]).toEqual({
      ...plate,
      thickness_mm: 5,
    });
    // The part derives, placed like a catalog part, and the plate has no problem.
    const d = derived(r.state);
    const id = r.results[2]?.created[0] as string;
    expect(d.parts.get(id)?.item).toBe("project:plate-x");
    expect(d.diagnostics.filter((x) => x.entity === "project:plate-x")).toEqual([]);
    expect(no(r.state, { cmd: "addItem", args: { id: "plate-x", item: plate } })[0]?.code).toBe(
      "exists",
    );
    // A plate needs its outline; its material must be a catalog's.
    const { outline: _, ...noOutline } = plate;
    expect(no(cart(), { cmd: "addItem", args: { id: "plate-y", item: noOutline } })[0]?.code).toBe(
      "schema",
    );
    expect(
      no(cart(), {
        cmd: "addItem",
        args: { id: "plate-y", item: { ...plate, material: "test:unobtainium" } },
      })[0],
    ).toMatchObject({ code: "item", field: "material", refs: ["test:unobtainium"] });
    // A part naming a project item that does not exist is refused.
    expect(
      no(cart(), {
        cmd: "addPart",
        args: { item: "project:nothing", on: { bar: "b9", at_mm: 300 } },
      })[0]?.code,
    ).toBe("ref");
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
      // The cart holds open items O1 (its order is held on c35) and O2 (the bracket's price), so
      // this one is O3.
      { cmd: "addOpen", args: { open: { text: "which feet?", blocks: "order", scope: ["b1"] } } },
      { cmd: "addDecision", args: { text: "40-series", why: "stiff enough" } },
      {
        cmd: "resolveOpen",
        args: { id: "O3", text: "levelling feet M8", why: "the floor is uneven" },
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
        resolves: "O3",
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
    ).toEqual([...(cart().doc.open as unknown[]), { id: "O3", text: "x", scope: ["b31"] }]);
  });

  it("open items: a scope names suppliers, items, and entities by their ends, pieces and copies", () => {
    // §4.12 and the order rules (§5.5): only an entity of the document is a reference.
    const scope = ["supplier:test-vendor", "test:SCR-M8x16", "b5.a", "c23.f1", "b26@2", "K2"];
    const r = ok(cart(), { cmd: "addOpen", args: { open: { text: "x", blocks: "order", scope } } });
    // The cart holds O1 and O2, so this one is O3.
    const o2 = (doc: RawDoc) => (doc.open as { id: string }[]).find((x) => x.id === "O3");
    expect(o2(r.state.doc)).toEqual({ id: "O3", text: "x", blocks: "order", scope });
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

  it("says each step in words, beside its command names (BE-4)", () => {
    const h = new History(cart());
    const step = (commands: object[]) => {
      const r = h.apply(commands, ENV, "ui");
      if (!r.ok) throw new Error(JSON.stringify(r.failed));
      return h.log().at(-1);
    };
    // The draw tool's step: a bar and one autoConnect per end, the second finding nothing.
    expect(
      step([
        { cmd: "addBar", args: { a: [0, -20, 0], b: [0, -20, 600] } },
        { cmd: "autoConnect", args: { end: "b35.b", optional: true } },
        { cmd: "addBar", args: { a: [0, -20, 600], b: [500, -20, 600] } },
        { cmd: "autoConnect", args: { end: "b36.a", optional: true } },
        { cmd: "autoConnect", args: { end: "b36.b", optional: true } },
      ]),
    ).toMatchObject({
      what: "addBar, autoConnect, addBar, autoConnect, autoConnect",
      text: "add bars b35 and b36, joined at 1 end",
    });
    expect(step([{ cmd: "autoConnect", args: { end: "b35.a", optional: true } }])?.text).toBe(
      "no change",
    );
    expect(
      step([{ cmd: "setBar", args: { id: "b1", set: { roll_deg: 90, opt: null } } }])?.text,
    ).toBe("change b1's roll and options");
    expect(
      step([
        { cmd: "setParam", args: { name: "W", value: 1300 } },
        { cmd: "label", args: { id: "b1", label: "Front rail" } },
        { cmd: "removeEntity", args: { id: "b36", cascade: true } },
        { cmd: "addDecision", args: { text: "keep the rails" } },
      ])?.text,
    ).toBe('set W to 1300, label b1 "Front rail" and 2 more');
    h.undo("cli:me");
    expect(h.log().at(-1)).toMatchObject({
      source: "cli:me",
      what: "undo setParam, label, removeEntity, addDecision",
      text: 'undo set W to 1300, label b1 "Front rail" and 2 more',
    });
    expect(step([{ cmd: "setProject", args: { name: "Cart 2", price_basis: "sale" } }])?.text).toBe(
      "change the project's name and price basis",
    );
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
