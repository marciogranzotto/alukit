import { cp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import { type Corner, cornersOf } from "../corners.ts";
import type { Model } from "../model.ts";
import { hostOf, viewOf } from "../testing.ts";
import {
  type Arrangement,
  arrangeBatch,
  arrangementBatch,
  arrangementsOf,
  cannotArrange,
  joinOpenBatch,
  matchingCorners,
  nextArrangement,
  RULES,
  takeOut,
} from "./arrangements.ts";
import { contextBatch, contextOf } from "./context.ts";
import { lengthMode, lengthPatch } from "./length.ts";
import {
  copyMembers,
  deletePlan,
  deleteTargets,
  removalOrder,
  removeBatch,
  skipBatch,
  withoutVanished,
} from "./remove.ts";
import { barsLike, chosenOption, replaceBatch } from "./replace.ts";
import { endWords, entityName, refKind } from "./words.ts";

/**
 * The inspector's pure logic (docs/ux/plan.md S5.3–S5.5) on fixtures, with the dry runs the
 * server answers: the length a field writes, Delete's plan and its retry, and a corner's
 * arrangements with the cut lengths each gives. Every expected number is worked by hand.
 */

let root: string;
let cart: Model;
let frame: Model;
beforeAll(async () => {
  root = await scratchFixtures();
  cart = await viewOf(join(root, "cart"));
  frame = await viewOf(join(root, "base-frame", "cli"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

let copies = 0;
/** A fresh copy of the empty project beside it (its catalogs' relative path holds), for a test to write to. */
async function empty(): Promise<string> {
  const dir = join(root, "base-frame", `empty-${++copies}`);
  await cp(join(root, "base-frame", "empty"), dir, { recursive: true });
  return dir;
}

/** A 1000 × 600 rectangle on the ground, drawn bar by bar and auto-connected at each corner. */
const RECTANGLE = [
  { cmd: "addBar", args: { a: [0, 0, 0], b: [1000, 0, 0] } },
  { cmd: "addBar", args: { a: [1000, 0, 0], b: [1000, 600, 0] } },
  { cmd: "addBar", args: { a: [1000, 600, 0], b: [0, 600, 0] } },
  { cmd: "addBar", args: { a: [0, 600, 0], b: [0, 0, 0] } },
];
const CORNERS: [number, number, number][] = [
  [0, 0, 0],
  [1000, 0, 0],
  [1000, 600, 0],
  [0, 600, 0],
];
const JOIN = CORNERS.map((at) => ({ cmd: "autoConnect", args: { at } }));

describe("words (U12, U18)", () => {
  it("calls an item an item and only an id with @ a pattern copy", () => {
    expect(refKind(cart, "test:TS40")).toBe("item");
    expect(refKind(cart, "forseti:PF40-01")).toBe("item");
    expect(refKind(cart, "project:plate-a")).toBe("item");
    expect(refKind(cart, "b26@2")).toBe("copy");
    expect(refKind(cart, "b1")).toBe("bar");
    expect(refKind(cart, "c9")).toBe("connection");
    expect(refKind(cart, "b1.a")).toBe("end");
    expect(refKind(cart, "corner:0,0,900")).toBe("corner");
    expect(refKind(cart, "O1")).toBe("open-item");
    expect(refKind(cart, "b99")).toBe("unknown");
    expect(entityName(cart, "b7")).toBe("bar b7 (top rail, left)");
    expect(entityName(cart, "c9")).toBe("splice c9");
  });

  it("says what claims a bar's end", () => {
    // The cart's top rail b7 butts on the front rail b5 through c1 at its end a, as the end
    // handles say it ("butts on b5 (c1)").
    expect(endWords(cart, "b7", "a").text).toMatch(/^butts on b5 \(c1\), square/);
    expect(endWords(cart, "b7", "a").refs).toEqual(["c1", "b5"]);
    // The splice c9 joins b11.b and b12.a.
    expect(endWords(cart, "b11", "b").text).toMatch(/^spliced to b12\.a \(c9\)/);
    // A post's foot: nothing joins it, and nothing meets it there, so the check finds no open
    // corner and no Join is offered (review m12: autoConnect would refuse it).
    expect(endWords(cart, "b1", "a")).toMatchObject({ open: false });
    expect(endWords(cart, "b1", "a").text).toMatch(/^nothing joins it, /);
  });

  it("names the joint that claims an end even when the joint fails (D2)", async () => {
    // The audit's brace, its butts made by autoConnect, then its cuts undeclared: each butt
    // makes a 36.87° end that declares no cut, so the claim fails and the end falls back to
    // its default plane (`by: "default"`). It is claimed, not open, and no Join is offered.
    const dir = join(root, "brace");
    const brace = JSON.parse(await readFile(join(dir, "brace.json"), "utf8")) as {
      commands: unknown[];
    };
    const m = await viewOf(dir, brace.commands, [
      { cmd: "setBar", args: { id: "b13", set: { ends: null } } },
    ]);
    expect(m.derived.bars.b13?.ends.a.by).toBe("default");
    const a = endWords(m, "b13", "a");
    expect(a.text).toBe("butts on b3 (c9); the joint fails, so it is square");
    expect(a).toMatchObject({ open: false, refs: ["c9", "b3"] });
    expect(endWords(m, "b13", "b")).toMatchObject({
      text: "butts on b4 (c10); the joint fails, so it is square",
      open: false,
    });
    // G11: two butts claim b2.a, so neither holds it.
    const g11 = await viewOf(join(root, "golden-ends", "G11"));
    expect(endWords(g11, "b2", "a")).toMatchObject({
      text: "butts on b1 (c1) and butts on b1 (c2); two joints claim it, so it is square",
      open: false,
      refs: ["c1", "b1", "c2"],
    });
    // G10: a miter of two sections cannot be cut; its ends are still the miter's.
    const g10 = await viewOf(join(root, "golden-ends", "G10"));
    expect(endWords(g10, "b1", "b")).toMatchObject({
      text: "mitred with b2.a (c1); the joint fails, so it is square",
      open: false,
    });
  });
});

/** A typed number as the length field reads it. */
const n = (x: number) => ({ value: x, written: x });

describe("the length field", () => {
  it("is driven by the param a post's height is written with", () => {
    // base-frame/cli's posts end at [0, 0, "H"]: H = 900 drives them.
    expect(lengthMode(frame, "b1")).toEqual({
      kind: "driven",
      len: 900,
      params: ["H"],
      expr: "H",
    });
    expect(lengthPatch(frame, "b1", n(950))).toEqual({ why: "driven by H: edit it" });
    // The base rail b9 runs along x to W.
    expect(lengthMode(frame, "b9")).toMatchObject({ kind: "driven", params: ["W"] });
    // The post's foot is a number: moving end a is not driven.
    expect(lengthMode(frame, "b1", "a")).toEqual({ kind: "edit", len: 900, how: "coords" });
    expect(lengthPatch(frame, "b1", n(950), "a")).toEqual({ set: { a: [0, 0, -50] } });
    expect(lengthMode(frame, "b1", "middle")).toMatchObject({ kind: "driven", params: ["H"] });
  });

  it("moves end b along the bar when it is written as numbers, keeping the other coordinates", async () => {
    const m = await viewOf(await empty(), [
      { cmd: "addBar", args: { a: [100, 0, 0], b: [100, 0, 800] } },
      { cmd: "addBar", args: { a: [0, 0, 0], b: [300, 400, 0] } },
      { cmd: "addBar", args: { a: [0, 0, 0], b: { len_mm: 250, dir: "+x" } } },
    ]);
    expect(lengthMode(m, "b1")).toEqual({ kind: "edit", len: 800, how: "coords" });
    expect(lengthPatch(m, "b1", n(950))).toEqual({ set: { b: [100, 0, 950] } });
    // A diagonal 500 long: 3-4-5, so 1000 doubles both.
    expect(lengthPatch(m, "b2", n(1000))).toEqual({ set: { b: [600, 800, 0] } });
    expect(lengthMode(m, "b3")).toEqual({ kind: "edit", len: 250, how: "free" });
    expect(lengthPatch(m, "b3", n(400))).toEqual({ set: { b: { len_mm: 400 } } });
    expect(lengthPatch(m, "b3", n(0))).toEqual({ why: "a length is a number above 0" });
    // A free end b is counted from end a: only end b's length moves it.
    expect(lengthMode(m, "b3", "a")).toEqual({
      kind: "none",
      why: "end b is a free length from end a: move end b",
    });
  });

  it("binds a length to a param as typed (E-UX-16), from either end or the middle", async () => {
    const m = await viewOf(await empty(), [
      { cmd: "setParam", args: { name: "D", value: 600 } },
      { cmd: "addBar", args: { a: [0, 0, 0], b: [0, 600, 0] } },
      { cmd: "addBar", args: { a: [100, 0, 0], b: [100, 600, 0] } },
      { cmd: "addBar", args: { a: [0, 0, 0], b: [300, 400, 0] } },
      { cmd: "addBar", args: { a: [0, 0, 0], b: { len_mm: 250, dir: "+x" } } },
    ]);
    const D = { value: 600, written: "D" };
    // `=D` on a side rail: its end b is D from end a's y, 0, so D itself.
    expect(lengthPatch(m, "b1", D)).toEqual({ set: { b: [0, "D", 0] } });
    expect(lengthPatch(m, "b4", D)).toEqual({ set: { b: { len_mm: "D" } } });
    // End a moves instead: D back from end b.
    expect(lengthPatch(m, "b2", D, "a")).toEqual({ set: { a: [100, "600 - D", 0] } });
    // From the middle, y = 300: each end half the length from it.
    expect(lengthPatch(m, "b2", n(400), "middle")).toEqual({
      set: { a: [100, 100, 0], b: [100, 500, 0] },
    });
    expect(lengthPatch(m, "b2", D, "middle")).toEqual({
      set: { a: [100, "300 - (D / 2)", 0], b: [100, "300 + (D / 2)", 0] },
    });
    // A diagonal can keep no expression in one coordinate: a number is asked for, as moveEnd asks.
    expect(lengthPatch(m, "b3", D)).toEqual({
      why: "D reads D, which b3 keeps only along a world axis: give a number",
    });
  });

  it("says what sets it when end b is a reference", () => {
    // The cart's slat b26 ends on b10 at 150 mm.
    expect(lengthMode(cart, "b26")).toMatchObject({
      kind: "ref",
      text: "end b is on b10 at 150 mm",
      refs: ["b10"],
    });
    // The hanger b13 hangs 300 below the middle rail, counted from its end a's cut.
    expect(lengthMode(cart, "b13")).toEqual({
      kind: "edit",
      len: 300,
      how: "free",
      note: "counted from end a's cut",
    });
    // A pattern copy has no fields of its own.
    expect(lengthMode(cart, "b26@2").kind).toBe("none");
  });
});

describe("Replace profile", () => {
  it("finds the bars like one: the same item and options, a copy standing for its template", () => {
    // base-frame/cli: the posts b1–b4 and the rails b7–b10 are TS40, anodised by the default.
    expect(barsLike(frame, "b7")).toEqual(["b1", "b2", "b3", "b4", "b7", "b8", "b9", "b10"]);
    expect(barsLike(frame, "b5")).toEqual(["b5", "b6"]);
    // The cart's slat copies are b26's: b26 stands for them.
    expect(barsLike(cart, "b26@1")).toContain("b26");
    expect(barsLike(cart, "b26@1").some((id) => id.includes("@"))).toBe(false);
  });

  it("writes the new item, its options picked, and drops the options it had", () => {
    expect(replaceBatch(frame, ["b7"], "test:TS40E", {})).toEqual([
      { cmd: "setBar", args: { id: "b7", set: { item: "test:TS40E" } } },
    ]);
    expect(replaceBatch(frame, ["b5"], "test:TS40", { finish: "black" })).toEqual([
      { cmd: "setBar", args: { id: "b5", set: { item: "test:TS40", opt: { finish: "black" } } } },
    ]);
    // The project's default is left to the default.
    expect(replaceBatch(frame, ["b5"], "test:TS40", { finish: "" })).toEqual([
      { cmd: "setBar", args: { id: "b5", set: { item: "test:TS40", opt: { finish: null } } } },
    ]);
    expect(chosenOption(frame, "b7", "finish")).toBe("");
  });
});

describe("Delete's plan (D-UX-13)", () => {
  it("sorts the selection so referrers go first, and leaves out what is no entity", () => {
    expect(removalOrder(["b1", "c3", "b9", "p2", "n4", "pt1"])).toEqual([
      "pt1",
      "p2",
      "c3",
      "b9",
      "b1",
      "n4",
    ]);
    const t = deleteTargets(cart, ["b1", "corner:0,0,900", "test:TS40", "b26@2", "c1"]);
    expect(t.entities).toEqual(["c1", "b1"]);
    expect(t.copies).toEqual([{ id: "b26@2", pattern: "pt1", k: 2 }]);
    expect(t.others.map((o) => o.id)).toEqual(["corner:0,0,900", "test:TS40"]);
  });

  it("leaves a copy out of its pattern with everything of that copy", () => {
    expect(skipBatch(cart, [{ id: "b26@2", pattern: "pt1", k: 2 }])).toEqual([
      { cmd: "setPattern", args: { id: "pt1", set: { skip: [2, 3] } } },
    ]);
    expect(copyMembers(cart, { id: "b26@2", pattern: "pt1", k: 2 })).toEqual([
      "b26@2",
      "c26@2",
      "c27@2",
    ]);
  });

  it("knows a plain removal, a cascade and a changed list from the dry run", async () => {
    const dir = join(root, "base-frame", "cli");
    const h = await hostOf(dir);
    try {
      // b9's ends are c3's and c4's only ends: they go with it.
      const b9 = await h.dry(removeBatch(["b9"]));
      if (!b9.ok) throw new Error(b9.why);
      expect(deletePlan(["b9"], b9)).toEqual({
        removed: ["b9", "c3", "c4"],
        extra: ["c3", "c4"],
        changed: [],
        plain: false,
      });
      // b7's ends are two of c1's four and two of c2's: they stay, each losing one.
      const b7 = await h.dry(removeBatch(["b7"]));
      if (!b7.ok) throw new Error(b7.why);
      expect(deletePlan(["b7"], b7)).toEqual({
        removed: ["b7"],
        extra: [],
        changed: ["c1", "c2"],
        plain: false,
      });
      // b9 with its butts selected: nothing beyond the selection.
      const all = deleteTargets(h.view(), ["b9", "c3", "c4"]).entities;
      expect(all).toEqual(["c4", "c3", "b9"]);
      const plain = await h.dry(removeBatch(all));
      if (!plain.ok) throw new Error(plain.why);
      expect(deletePlan(all, plain).plain).toBe(true);
      // In the wrong order, b9's cascade takes c3 first: the retry drops it, and the rest passes.
      const wrong = ["b9", "c3"];
      const refused = await h.dry(removeBatch(wrong));
      expect(refused.ok).toBe(false);
      expect(withoutVanished(wrong, refused)).toEqual(["b9"]);
      // Any other refusal is shown, not retried.
      const other = await h.dry([{ cmd: "removeEntity", args: { id: "b9" } }]);
      expect(withoutVanished(["b9"], other)).toBeUndefined();
    } finally {
      await h.close();
    }
  });
});

describe("a corner's arrangements (S5.5)", () => {
  const at = (cs: readonly Corner[], key: string) => cs.find((c) => c.key === key) as Corner;

  it("offers each distinct arrangement with the cut lengths its dry run gives", async () => {
    const h = await hostOf(await empty());
    try {
      await h.apply(RECTANGLE);
      await h.apply(JOIN);
      const m = h.view();
      const corners = cornersOf(m);
      const c = at(corners, "1000,600,0");
      // Drawn by the default rule: no post, so the lowest id, b2, runs through.
      expect(c).toMatchObject({ state: "joined", through: "b2", ends: ["b2.b", "b3.a"] });
      expect(cannotArrange(m, c)).toBeUndefined();
      expect(takeOut(m, [c])).toEqual([
        { cmd: "removeEntity", args: { id: c.connections[0] as string } },
      ]);
      // One request answers every rule, in RULES order, as a dry run of that rule's batch would.
      const got = await h.arrange([c.at]);
      expect(got.rev).toBe(m.rev);
      expect(got.corners).toEqual([{ at: c.at, ends: c.ends, butts: c.connections }]);
      expect(got.rules.map((r) => r.rule)).toEqual([...RULES]);
      for (const r of got.rules) {
        const batch = arrangeBatch(m, [c], r.rule);
        const dry = await h.dry(batch);
        if (!r.ok || !dry.ok) throw new Error(`${r.rule} was refused`);
        expect(r.commands).toEqual(batch);
        expect(r.effects).toEqual(dry.effects);
        expect(r.plans).toEqual([{ at: c.at, ...(dry.results.at(-1)?.info as object) }]);
      }
      const { list, refused } = arrangementsOf(m, c, got.rules);
      expect(refused).toEqual([]);
      // vertical (no post: the lowest id), y and first all give b2; x gives b3.
      expect(list.map((a) => [a.title, a.rules, a.current])).toEqual([
        ["Rail Y runs through", ["vertical", "y", "first"], true],
        ["Rail X runs through", ["x"], false],
      ]);
      // A through bar reaches 20 past its corner, a butting one stops 20 short (s1 decision 19):
      // as drawn, b2 600 and b3 1000; with b3 through, b2 560 and b3 1040.
      expect(list[0]?.cuts).toEqual([
        { bar: "b2", cut: 600, was: 600 },
        { bar: "b3", cut: 1000, was: 1000 },
      ]);
      expect(list[1]?.cuts).toEqual([
        { bar: "b2", cut: 560, was: 600 },
        { bar: "b3", cut: 1040, was: 1000 },
      ]);
      expect(list[1]?.detail).toBe("b3 runs through; b2 butts into it.");
      expect(nextArrangement(list)).toBe(list[1]);

      // Every ground corner is an L of an x rail and a y rail: the four match. Rail X runs
      // through at (0,0,0) and (1000,0,0) already (b1) and at (0,600,0) (b3), so x changes one.
      const x = list[1];
      if (!x) throw new Error("no x arrangement");
      expect(matchingCorners(m, corners, c, x).map((k) => k.key)).toEqual(["1000,600,0"]);
      const y = list[0];
      if (!y) throw new Error("no y arrangement");
      expect(
        matchingCorners(m, corners, c, y)
          .map((k) => k.key)
          .sort(),
      ).toEqual(["0,0,0", "0,600,0", "1000,0,0"]);

      // Applying x there gives what its dry run said.
      await h.apply(arrangeBatch(m, [c], "x"));
      const after = h.view();
      expect(after.derived.bars.b2?.cut_mm).toBe(560);
      expect(after.derived.bars.b3?.cut_mm).toBe(1040);
      expect(at(cornersOf(after), "1000,600,0")).toMatchObject({ state: "joined", through: "b3" });
    } finally {
      await h.close();
    }
  });

  it("offers a mitre beside the butts at a corner of two ends, with derive's cut lengths (E5.5)", async () => {
    const h = await hostOf(await empty());
    try {
      await h.apply(RECTANGLE);
      await h.apply(JOIN);
      const m = h.view();
      const corners = cornersOf(m);
      const c = at(corners, "1000,600,0");
      const got = await h.arrange([c.at]);
      const { list, refused } = arrangementsOf(m, c, got.rules, got.joints);
      expect(list.map((a) => [a.kind, a.title, a.current])).toEqual([
        ["butt", "Rail Y runs through", true],
        ["butt", "Rail X runs through", false],
        ["miter", "Mitre", false],
      ]);
      // A splice joins two ends in line; these two meet square, and derive says so.
      expect(refused).toEqual([{ rule: "splice", why: expect.stringMatching(/collinear/) }]);
      const mitre = list[2] as Arrangement;
      expect(mitre.detail).toBe("b2 and b3 are cut to meet; no bar runs through.");
      // By hand: a mitre's cut is measured on its long point, at the corner's outer edge, 20 past
      // the design point on each bar. b2 ran through, 20 past already: 600. b3 stopped 20 short of
      // the corner and now reaches 20 past it: 1000 + 40 = 1040.
      expect(mitre.cuts).toEqual([
        { bar: "b2", cut: 600, was: 600 },
        { bar: "b3", cut: 1040, was: 1000 },
      ]);
      // Apply sends the batch the server dry-ran: the corner's butt out, a mitre of its ends.
      const batch = arrangementBatch(m, [c], mitre);
      const answer = got.joints.find((j) => j.kind === "miter");
      expect(answer?.ok && answer.commands).toEqual(batch);
      expect(batch).toEqual([
        { cmd: "removeEntity", args: { id: c.connections[0] as string } },
        { cmd: "addConnection", args: { type: "miter", ends: ["b2.b", "b3.a"] } },
      ]);
      const dry = await h.dry(batch);
      if (!dry.ok) throw new Error("the mitre was refused");
      expect(dry.effects.cuts).toEqual({ b3: [1000, 1040] });
      // Every ground corner is an L of the same section, and none is mitred yet: all four match.
      expect(
        matchingCorners(m, corners, c, mitre)
          .map((k) => k.key)
          .sort(),
      ).toEqual(["0,0,0", "0,600,0", "1000,0,0", "1000,600,0"]);

      await h.apply(batch);
      const after = h.view();
      const mitred = at(cornersOf(after), "1000,600,0");
      expect(cannotArrange(after, mitred)).toBeUndefined();
      const again = await h.arrange([mitred.at]);
      const now = arrangementsOf(after, mitred, again.rules, again.joints).list;
      expect(now.map((a) => [a.kind, a.current])).toEqual([
        ["butt", false],
        ["butt", false],
        ["miter", true],
      ]);
      // Flip changes which bar runs through; at a mitre none does, so there is nothing to flip.
      expect(nextArrangement(now)).toBeUndefined();
      // Before the mitre, Flip went between the two butts and passed the mitre by.
      expect(nextArrangement(list)).toBe(list[1]);
      // The mitred corner is no longer one the mitre would change.
      expect(
        matchingCorners(after, cornersOf(after), mitred, now[2] as Arrangement).map((k) => k.key),
      ).not.toContain("1000,600,0");
    } finally {
      await h.close();
    }
  });

  it("takes out only a corner's ends from a butt that has ends elsewhere, and joins open corners", async () => {
    // The cart's c1 holds four ends at two corners: b1.b and b7.a at (0,0,900), b2.b and b8.a
    // at (1200,0,900). Arranging the first corner keeps c1 for the second.
    const corners = cornersOf(cart);
    const c = at(corners, "0,0,900");
    expect(takeOut(cart, [c])).toEqual([
      { cmd: "setConnection", args: { id: "c1", set: { ends: ["b2.b", "b8.a"] } } },
    ]);
    // Both corners: c1 goes.
    expect(takeOut(cart, [c, at(corners, "1200,0,900")])).toEqual([
      { cmd: "removeEntity", args: { id: "c1" } },
    ]);
    // A pattern copy's butt is not arranged here: its template is. A splice is (E5.5).
    expect(cannotArrange(cart, at(corners, "700,300,900"))).toBeUndefined();
    expect(cannotArrange(cart, at(corners, "300,0,100"))).toMatch(/^c26@1 is a pattern copy/);

    const open = await viewOf(await empty(), RECTANGLE);
    // Corners come in the order of their first end: b1.a, b1.b, b2.b, b3.b.
    expect(joinOpenBatch(cornersOf(open))).toEqual(
      CORNERS.map((p) => ({ cmd: "autoConnect", args: { at: p, optional: true } })),
    );
  });
});

describe("the Context field (X11)", () => {
  it("reads and sets context on a bar and a placed part, never on a copy or an unplaced line", async () => {
    const bench = await viewOf(join(root, "golden-gen", "G51"));
    expect(contextOf(bench, "b3")).toEqual({ can: true, on: true, cmd: "setBar" });
    expect(contextOf(bench, "b1")).toEqual({ can: true, on: false, cmd: "setBar" });
    expect(contextOf(bench, "p2")).toEqual({ can: true, on: true, cmd: "setPart" });
    expect(contextBatch(bench, "b1", true)).toEqual([
      { cmd: "setBar", args: { id: "b1", set: { context: true } } },
    ]);
    expect(contextBatch(bench, "p2", false)).toEqual([
      { cmd: "setPart", args: { id: "p2", set: { context: null } } },
    ]);
    // A copy follows its template; a line counted and never drawn has no body to be context.
    expect(contextOf(cart, "b26@1").can).toBe(false);
    expect(contextOf(cart, "c1").can).toBe(false);
    const parts = cart.doc.parts as Record<string, { unplaced?: boolean }>;
    const unplaced = Object.keys(parts).find((id) => parts[id]?.unplaced) as string;
    expect(unplaced).toBeDefined();
    expect(contextOf(cart, unplaced).can).toBe(false);
  });
});
