import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import { type Corner, cornersOf } from "../corners.ts";
import type { Model } from "../model.ts";
import { hostOf, viewOf } from "../testing.ts";
import {
  arrangeBatch,
  arrangementsOf,
  cannotArrange,
  joinOpenBatch,
  matchingCorners,
  nextArrangement,
  RULES,
  takeOut,
} from "./arrangements.ts";
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
    // The cart's top rail b7 butts into the front rail b5 through c1 at its end a.
    expect(endWords(cart, "b7", "a").text).toMatch(/^butts into b5 \(c1\)/);
    expect(endWords(cart, "b7", "a").refs).toEqual(["c1", "b5"]);
    // The splice c9 joins b11.b and b12.a.
    expect(endWords(cart, "b11", "b").text).toMatch(/^spliced to b12\.a \(c9\)/);
    // A post's foot: nothing joins it.
    expect(endWords(cart, "b1", "a")).toMatchObject({ open: true });
  });
});

describe("the length field", () => {
  it("is driven by the param a post's height is written with", () => {
    // base-frame/cli's posts end at [0, 0, "H"]: H = 900 drives them.
    expect(lengthMode(frame, "b1")).toEqual({
      kind: "driven",
      len: 900,
      params: ["H"],
      expr: "H",
    });
    expect(lengthPatch(frame, "b1", 950)).toEqual({ why: "driven by H: edit it" });
    // The base rail b9 runs along x to W.
    expect(lengthMode(frame, "b9")).toMatchObject({ kind: "driven", params: ["W"] });
  });

  it("moves end b along the bar when it is written as numbers, keeping the other coordinates", async () => {
    const m = await viewOf(await empty(), [
      { cmd: "addBar", args: { a: [100, 0, 0], b: [100, 0, 800] } },
      { cmd: "addBar", args: { a: [0, 0, 0], b: [300, 400, 0] } },
      { cmd: "addBar", args: { a: [0, 0, 0], b: { len_mm: 250, dir: "+x" } } },
    ]);
    expect(lengthMode(m, "b1")).toEqual({ kind: "edit", len: 800, how: "coords" });
    expect(lengthPatch(m, "b1", 950)).toEqual({ set: { b: [100, 0, 950] } });
    // A diagonal 500 long: 3-4-5, so 1000 doubles both.
    expect(lengthPatch(m, "b2", 1000)).toEqual({ set: { b: [600, 800, 0] } });
    expect(lengthMode(m, "b3")).toEqual({ kind: "edit", len: 250, how: "free" });
    expect(lengthPatch(m, "b3", 400)).toEqual({ set: { b: { len_mm: 400 } } });
    expect(lengthPatch(m, "b3", 0)).toEqual({ why: "a length is a number above 0" });
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
        { cmd: "removeEntity", args: { id: (c.connections[0] as string) } },
      ]);
      const answers = await Promise.all(
        RULES.map(async (rule) => ({ rule, dry: await h.dry(arrangeBatch(m, [c], rule)) })),
      );
      const { list, refused } = arrangementsOf(m, c, answers);
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
    // A splice and a pattern copy's butt are not arranged here.
    expect(cannotArrange(cart, at(corners, "700,300,900"))).toMatch(/^c9 is a splice/);
    expect(cannotArrange(cart, at(corners, "300,0,100"))).toMatch(/^c26@1 is a pattern copy/);

    const open = await viewOf(await empty(), RECTANGLE);
    // Corners come in the order of their first end: b1.a, b1.b, b2.b, b3.b.
    expect(joinOpenBatch(cornersOf(open))).toEqual(
      CORNERS.map((p) => ({ cmd: "autoConnect", args: { at: p, optional: true } })),
    );
  });
});
