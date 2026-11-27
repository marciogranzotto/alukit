import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { derive } from "../derive/derive.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { projectText } from "../project/canonical.ts";
import { FIXTURES, readJson } from "../testing.ts";
import { applyBatch } from "./apply.ts";
import { stepWords } from "./history.ts";
import { endHold } from "./hold.ts";
import type { CommandEnv, RawDoc, State } from "./types.ts";

/**
 * `moveEnd` (design §6, *2.3*; docs/ux/drag-ends-decisions.md): one end of a bar along its own
 * axis, to a length, a cut, by a distance or onto another bar, and what holds an end. G01's bars
 * are 40 × 40 TS40 on centre anchors: b1 along +X from the origin, 1000 long; b2 up +Y from b1's
 * end b, butted through b1 by c1, so its cut is 600 − 20 = 580.
 */

const ENV: CommandEnv = { today: "2026-11-27" };

function stateOf(dir: string): State {
  return {
    doc: readJson(join(dir, "alukit.json")) as RawDoc,
    lock: LockFile.parse(readJson(join(dir, "alukit.lock.json"))),
  };
}
const g01 = () => stateOf(join(FIXTURES, "golden-ends", "G01"));
const cart = () => stateOf(join(FIXTURES, "cart"));
const baseFrame = () => stateOf(join(FIXTURES, "base-frame", "cli"));

/** G01 with bars and connections replaced (same catalogs and lock). */
function withDoc(s: State, patch: Record<string, unknown>): State {
  return { ...s, doc: { ...s.doc, ...patch } };
}

/** G01 plus a free brace b3 along −Y at x = 500, from y = 600 to y = 300. */
const braced = () =>
  withDoc(g01(), {
    bars: {
      ...(g01().doc.bars as object),
      b3: { a: [500, 600, 0], b: [500, 300, 0] },
    },
  });

function run(s: State, ...commands: object[]) {
  const r = applyBatch(s, commands, ENV);
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.failed)}`);
  return { ...r, text: stepWords({ commands, results: r.results }) };
}
function refused(s: State, ...commands: object[]) {
  const r = applyBatch(s, commands, ENV);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.failed.errors;
}
const bars = (s: State) => s.doc.bars as Record<string, Record<string, unknown>>;
const derived = (s: State) => derive(s.doc, lockItems(s.lock));
const cut = (s: State, id: string) => derived(s).bars.get(id)?.lengths.cut;
const length = (s: State, id: string) => derived(s).bars.get(id)?.lengths.len;

describe("moveEnd", () => {
  it("moves a free end onto another bar's line, and autoConnect then butts it there, as one step", () => {
    const r = run(
      braced(),
      { cmd: "moveEnd", args: { end: "b3.b", to: "b1" } },
      { cmd: "autoConnect", args: { end: "b3.b", optional: true } },
    );
    expect(bars(r.state).b3?.b).toEqual([500, 0, 0]);
    expect(r.results[0]?.info).toEqual({ end: "b3.b", from_mm: 300, len_mm: 600 });
    expect(r.results[1]?.info).toEqual({ through: "b1", ends: ["b3.b"] });
    expect(r.text).toBe("lengthen b3 at end b to 600 mm, joined at 1 end");
    // b1's near face is 20 from its line, so the brace is cut 600 − 20.
    expect(cut(r.state, "b3")).toBe(580);
    expect(cut(r.state, "b1")).toBe(cut(braced(), "b1"));
  });

  it("sets a cut length, a design length, or moves by a distance, writing numbers", () => {
    const s = braced();
    const c = run(s, { cmd: "moveEnd", args: { end: "b3.b", cut_mm: 450 } });
    expect(bars(c.state).b3?.b).toEqual([500, 150, 0]);
    expect(cut(c.state, "b3")).toBe(450);
    const l = run(s, { cmd: "moveEnd", args: { end: "b3.a", len_mm: 250 } });
    expect(bars(l.state).b3?.a).toEqual([500, 550, 0]);
    expect(length(l.state, "b3")).toBe(250);
    const by = run(s, { cmd: "moveEnd", args: { end: "b3.b", by_mm: -100 } });
    expect(bars(by.state).b3?.b).toEqual([500, 400, 0]);
    // Words for the undo button and the log.
    expect(by.text).toBe("shorten b3 at end b to 200 mm");
  });

  it("keeps a param in an expression length on a bar along a world axis", () => {
    const s = withDoc(braced(), { params: { L: "400" } });
    const r = run(s, { cmd: "moveEnd", args: { end: "b3.b", len_mm: "L" } });
    expect(bars(r.state).b3?.b).toEqual([500, "600 - L", 0]);
    expect(length(r.state, "b3")).toBe(400);
    const text = projectText(r.state.doc);
    expect(projectText(JSON.parse(text))).toBe(text);
  });

  it("keeps a param in a cut length: the design length is the cut plus what the ends take", () => {
    // b2 butts on b1 at end a (cut = length − 20): a cut of C is a length of C + 20.
    const s = withDoc(g01(), { params: { C: "500" } });
    const r = run(s, { cmd: "moveEnd", args: { end: "b2.b", cut_mm: "C" } });
    expect(bars(r.state).b2?.b).toEqual([1000, "C + 20", 0]);
    expect(cut(r.state, "b2")).toBe(500);
    // The param keeps driving the cut afterwards.
    const later = { ...r.state, doc: { ...r.state.doc, params: { C: "450" } } };
    expect(cut(later, "b2")).toBe(450);
    // A free brace adds nothing: the length is the cut.
    const brace = run(withDoc(braced(), { params: { C: "250" } }), {
      cmd: "moveEnd",
      args: { end: "b3.b", cut_mm: "C" },
    });
    expect(bars(brace.state).b3?.b).toEqual([500, "600 - C", 0]);
    expect(cut(brace.state, "b3")).toBe(250);
  });

  it("refuses a length over params where it cannot be kept, rather than writing a number", () => {
    const s = withDoc(g01(), {
      params: { L: "500" },
      bars: { ...(g01().doc.bars as object), b3: { a: [0, 0, 0], b: [300, 400, 0] } },
    });
    const [e] = refused(s, { cmd: "moveEnd", args: { end: "b3.b", len_mm: "L" } });
    expect(e?.code).toBe("expr");
    expect(e?.message).toContain("reads L");
    expect(e?.message).toContain("give a number");
    // A number is taken on the same bar.
    const r = run(s, { cmd: "moveEnd", args: { end: "b3.b", len_mm: 1000 } });
    expect(bars(r.state).b3?.b).toEqual([600, 800, 0]);
  });

  it("refuses to overwrite a coordinate a param drives, naming the param", () => {
    const s = withDoc(braced(), {
      params: { Y: "300" },
      bars: { ...(braced().doc.bars as object), b3: { a: [500, 600, 0], b: [500, "Y", 0] } },
    });
    const [e] = refused(s, { cmd: "moveEnd", args: { end: "b3.b", by_mm: 10 } });
    expect(e?.code).toBe("driven");
    expect(e?.message).toContain("driven by Y");
    // The axes the move leaves alone may read params: b3.a's x does not move.
    const sideways = withDoc(s, {
      params: { X: "500" },
      bars: { ...(braced().doc.bars as object), b3: { a: ["X", 600, 0], b: ["X", 300, 0] } },
    });
    expect(
      bars(run(sideways, { cmd: "moveEnd", args: { end: "b3.b", by_mm: 10 } }).state).b3?.b,
    ).toEqual(["X", 290, 0]);
  });

  it("refuses a butted end unless asked to detach it, and then drops it from its butt", () => {
    const [e] = refused(g01(), { cmd: "moveEnd", args: { end: "b2.a", by_mm: 100 } });
    expect(e).toMatchObject({ code: "held", entity: "b2", refs: ["c1"] });
    expect(e?.message).toContain("butts on b1 (c1)");
    const r = run(g01(), { cmd: "moveEnd", args: { end: "b2.a", by_mm: 100, detach: true } });
    expect(bars(r.state).b2?.a).toEqual([1000, -100, 0]);
    // c1 had no other end, so it goes with it.
    expect((r.state.doc.connections as object) ?? {}).not.toHaveProperty("c1");
    expect(r.results[0]).toMatchObject({ removed: ["c1"] });
    expect(r.results[0]?.info).toMatchObject({ detached: ["c1"], len_mm: 700 });
    expect(r.text).toBe("lengthen b2 at end a to 700 mm, freed from c1");
  });

  it("detaches an end from a node, writing it as coordinates and keeping the node's other axes", () => {
    const s = withDoc(g01(), {
      params: { Z: "0" },
      nodes: { n1: [1000, 0, "Z"] },
      bars: { b1: { a: [0, 0, 0], b: [1000, 0, 0] }, b2: { a: "n1", b: [1000, 600, 0] } },
      connections: {},
    });
    const [e] = refused(s, { cmd: "moveEnd", args: { end: "b2.a", by_mm: 50 } });
    expect(e?.message).toContain("is at point n1");
    const r = run(s, { cmd: "moveEnd", args: { end: "b2.a", by_mm: 50, detach: true } });
    expect(bars(r.state).b2?.a).toEqual([1000, -50, "Z"]);
    expect(r.results[0]?.info).toMatchObject({ left: "n1" });
  });

  it("moves the through bar's end off a corner without detaching anything", () => {
    // b1's end b is c1's through end at the corner (cover, claimed automatically).
    const r = run(g01(), { cmd: "moveEnd", args: { end: "b1.b", by_mm: 100 } });
    expect(bars(r.state).b1?.b).toEqual([1100, 0, 0]);
    expect(r.state.doc.connections).toEqual(g01().doc.connections);
    expect(length(r.state, "b1")).toBe(1100);
    // b2 still butts on b1's side.
    expect(cut(r.state, "b2")).toBe(580);
  });

  it("refuses an end a pivot sets, even with detach, and says why", () => {
    const [e] = refused(cart(), {
      cmd: "moveEnd",
      args: { end: "b14.a", by_mm: 10, detach: true },
    });
    expect(e?.code).toBe("held");
    expect(e?.message).toMatch(/is at pivot c13, which sets it/);
  });

  it("refuses a post end a param drives even once freed from its butt (the base frame's H)", () => {
    const [e] = refused(baseFrame(), {
      cmd: "moveEnd",
      args: { end: "b1.b", by_mm: 10, detach: true },
    });
    expect(e?.code).toBe("driven");
    expect(e?.message).toContain("driven by H");
  });

  it("refuses a bar it cannot meet, and a length of nothing", () => {
    // b3 runs along Y, as b2 does: parallel lines never meet.
    expect(refused(braced(), { cmd: "moveEnd", args: { end: "b3.b", to: "b2" } })[0]?.code).toBe(
      "geometry",
    );
    expect(refused(braced(), { cmd: "moveEnd", args: { end: "b3.b", by_mm: -300 } })[0]?.code).toBe(
      "length",
    );
    expect(
      refused(braced(), { cmd: "moveEnd", args: { end: "b3.b", by_mm: 1, len_mm: 2 } })[0]?.code,
    ).toBe("args");
  });

  it("moves end a of a bar with a free end b, the free length taking up the move", () => {
    const s = withDoc(g01(), {
      bars: { b1: { a: [0, 0, 0], b: { len_mm: 500, dir: "+x" } } },
      connections: {},
    });
    const r = run(s, { cmd: "moveEnd", args: { end: "b1.a", by_mm: 100 } });
    expect(bars(r.state).b1).toEqual({ a: [-100, 0, 0], b: { len_mm: 600, dir: "+x" } });
    expect(derived(r.state).bars.get("b1")?.placed.B).toEqual([500, 0, 0]);
  });
});

/**
 * The editing audit's brace (tests/fixtures/brace; src/core/brace.test.ts): a box frame and a
 * diagonal b13 in its back plane, butted through the posts b3 (c9) and b4 (c10) by `autoConnect`,
 * which declares both cuts an angle. Undeclared, each butt makes a 36.87° end that declares no
 * cut: the joint fails and the end falls back to its default plane (`by: "default"`), though the
 * document still joins it (E4's D2).
 */
function brace(declared: boolean): State {
  const dir = join(FIXTURES, "brace");
  const { commands } = readJson(join(dir, "brace.json")) as { commands: object[] };
  const undeclare = { cmd: "setBar", args: { id: "b13", set: { ends: null } } };
  return run(stateOf(dir), ...commands, ...(declared ? [] : [undeclare])).state;
}
const g10 = () => stateOf(join(FIXTURES, "golden-ends", "G10"));
const g11 = () => stateOf(join(FIXTURES, "golden-ends", "G11"));

describe("moveEnd: an end a failing joint claims is held by that joint", () => {
  it("refuses the brace's end that c9 claims though c9 fails, as when c9 holds it", () => {
    const failing = brace(false);
    // The premise: c9 fails for b13.a, and still claims it.
    expect(derived(failing).bars.get("b13")?.ends.a.by).toBe("default");
    expect(derived(failing).claims.get("b13.a")).toEqual(["c9"]);
    const move = { cmd: "moveEnd", args: { end: "b13.a", by_mm: 10 } };
    const [e] = refused(failing, move);
    expect(e).toMatchObject({ code: "held", entity: "b13", field: "a", refs: ["c9"] });
    expect(e?.message).toBe(
      "b13.a butts on b3 (c9), and the joint fails: give detach: true to free it and move it",
    );
    // The same end, its cut declared, so c9 derives: refused alike.
    const [w] = refused(brace(true), move);
    expect(w).toMatchObject({ code: "held", entity: "b13", field: "a", refs: ["c9"] });
    expect(w?.message).toBe("b13.a butts on b3 (c9): give detach: true to free it and move it");
  });

  it("detaches the brace's end from c9 though c9 fails, as when c9 holds it", () => {
    const move = { cmd: "moveEnd", args: { end: "b13.a", by_mm: 10, detach: true } };
    const failing = run(brace(false), move);
    const working = run(brace(true), move);
    for (const r of [failing, working]) {
      // 10 outward along −t = (−0.8, 0, −0.6) from [0, 600, 0]; c9 goes with its last end.
      expect(bars(r.state).b13?.a).toEqual([-8, 600, -6]);
      expect(r.state.doc.connections).not.toHaveProperty("c9");
      expect(r.state.doc.connections).toHaveProperty("c10");
      expect(r.results[0]).toMatchObject({ removed: ["c9"] });
      expect(r.results[0]?.info).toMatchObject({ detached: ["c9"], len_mm: 1260 });
      expect(r.text).toBe("lengthen b13 at end a to 1260 mm, freed from c9");
    }
  });

  it("refuses an end a failing miter claims, as a miter that derives sets it (G10)", () => {
    // G10: a miter of a 40 × 40 and a 40 × 80 cannot be cut; b1.b is still c1's.
    expect(derived(g10()).bars.get("b1")?.ends.b.by).toBe("default");
    const [e] = refused(g10(), { cmd: "moveEnd", args: { end: "b1.b", by_mm: 10, detach: true } });
    expect(e).toMatchObject({ code: "held", entity: "b1", refs: ["c1"] });
    expect(e?.message).toBe(
      "b1.b is held by c1 (miter), and the joint fails: edit or delete c1 to move it",
    );
  });

  it("holds an end two butts claim by both, and detaching frees it from both (G11)", () => {
    // G11: c1 and c2 both butt b2.a through b1, so neither derives for it.
    expect(derived(g11()).bars.get("b2")?.ends.a.by).toBe("default");
    const [e] = refused(g11(), { cmd: "moveEnd", args: { end: "b2.a", by_mm: 10 } });
    expect(e).toMatchObject({ code: "held", refs: ["c1", "c2"] });
    expect(e?.message).toBe(
      "b2.a butts on b1 (c1) and butts on b1 (c2), and two joints claim it: give detach: true to free it and move it",
    );
    const r = run(g11(), { cmd: "moveEnd", args: { end: "b2.a", by_mm: 10, detach: true } });
    expect(bars(r.state).b2?.a).toEqual([1000, -10, 0]);
    // Each butt had only b2.a, so both go with it.
    expect(r.state.doc.connections).toEqual({});
    expect(r.results[0]).toMatchObject({ removed: ["c1", "c2"] });
    expect(r.results[0]?.info).toMatchObject({ detached: ["c1", "c2"] });
    expect(r.text).toBe("lengthen b2 at end a to 610 mm, freed from c1 and c2");
  });
});

describe("endHold", () => {
  it("names what holds each kind of end, from the providers that claim it", () => {
    const doc = g01().doc as Record<string, unknown>;
    expect(endHold(doc, "b2", "a", { claims: ["c1"], by: "c1" })).toEqual({
      kind: "detach",
      words: ["butts on b1 (c1)"],
      conns: ["c1"],
      refs: ["c1"],
    });
    expect(endHold(doc, "b1", "b", { claims: ["c1"], by: "c1" })).toEqual({
      kind: "free",
      corner: "c1",
    });
    expect(endHold(doc, "b2", "b", { claims: [], by: "default" })).toEqual({ kind: "free" });
    expect(endHold(doc, "b2", "b", { claims: ["b2.ends.b.plane"], by: "plane" }).kind).toBe(
      "fixed",
    );
  });

  it("holds an end by the joint that claims it whether or not the joint derives", () => {
    const doc = g01().doc as Record<string, unknown>;
    expect(endHold(doc, "b2", "a", { claims: ["c1"], by: "default" })).toEqual({
      kind: "detach",
      words: ["butts on b1 (c1)"],
      fails: "the joint fails",
      conns: ["c1"],
      refs: ["c1"],
    });
    // A plane of its own beside the butt: two providers, and the plane sets the end.
    expect(endHold(doc, "b2", "a", { claims: ["b2.ends.a.plane", "c1"], by: "default" })).toEqual({
      kind: "fixed",
      words:
        "b2.a is cut on its own plane (ends.a.plane), which does not follow the end, and two joints claim it",
      fails: "two joints claim it",
      refs: [],
    });
    // A free end counted from end a's cut (G21) is a provider, not a hold: as derive names it.
    const s = withDoc(g01(), {
      bars: {
        ...(g01().doc.bars as object),
        b2: { a: [1000, 0, 0], b: { len_mm: 580, dir: "+y", from: "a.cut" } },
      },
    });
    const d = derived(s);
    const claims = d.claims.get("b2.b") ?? [];
    expect(claims).toEqual(["b2.b (free end from a.cut)"]);
    const by = d.bars.get("b2")?.ends.b.by ?? "";
    expect(endHold(s.doc as Record<string, unknown>, "b2", "b", { claims, by })).toEqual({
      kind: "free",
    });
  });
});
