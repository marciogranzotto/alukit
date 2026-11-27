import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { Model } from "../model.ts";
import { hostOf, viewOf } from "../testing.ts";
import { copyWords, moveSet } from "../tools/moves.ts";
import { mirrorWords } from "../tools/wire/mirror.ts";
import {
  alignBatch,
  arrayBatch,
  duplicateBatch,
  mirrorBatch,
  rotateBatch,
  transformBatch,
} from "./batches.ts";

/**
 * The transform and copy tools' batches (docs/ux/editing-audit.md §7.7; docs/ux/e3-decisions.md),
 * each one step, as `alukit do` would send it. On tests/fixtures/ux/move (b1 a rail along +X, b2
 * butted on its end b by c1, b3 and b4 free, p1 a bracket on b1 at 300) and tests/fixtures/brace
 * (the 1000 × 600 × 750 box frame of 40 × 40: posts b1–b4, base rails b5–b8, top rails b9–b12).
 */

let fx: string;
let move: Model;
let frame: Model;
beforeAll(async () => {
  fx = await scratchFixtures();
  move = await viewOf(join(fx, "ux", "move"));
  frame = await viewOf(join(fx, "brace"));
});

describe("mirror (E3.2)", () => {
  it("is one mirror step across a plane square to an axis, as alukit do mirror is", async () => {
    const batch = mirrorBatch(move, ["p1"], { axis: "x", at_mm: 500 });
    expect(batch).toEqual([
      { cmd: "mirror", args: { ids: ["p1"], plane: { axis: "x", at_mm: 500 } } },
    ]);
    const h = await hostOf(join(fx, "ux", "move"));
    try {
      const r = await h.dry(batch as unknown[]);
      if (!r.ok) throw new Error(r.why);
      expect(r.created).toEqual(["p2"]);
      expect(r.effects.parts.p2).toMatchObject({ item: "test:BRK-40", bar: "b1", s_mm: 700 });
      expect(mirrorWords(r).text).toBe("makes p2");
    } finally {
      await h.close();
    }
  });

  it("removes the originals in the same step when asked, referrers first", async () => {
    const batch = mirrorBatch(move, ["p1"], { axis: "x", at_mm: 500 }, { removeOriginals: true });
    expect(batch).toEqual([
      { cmd: "mirror", args: { ids: ["p1"], plane: { axis: "x", at_mm: 500 } } },
      { cmd: "removeEntity", args: { id: "p1", cascade: true } },
    ]);
    const h = await hostOf(join(fx, "ux", "move"));
    try {
      const r = await h.dry(batch as unknown[]);
      if (!r.ok) throw new Error(r.why);
      expect(r.created).toEqual(["p2"]);
      expect(r.effects.removed).toEqual(["p1"]);
      expect(mirrorWords(r).text).toBe("makes p2 · removes p1");
    } finally {
      await h.close();
    }
  });

  it("says why it cannot: nothing to mirror, a pattern copy", () => {
    expect(mirrorBatch(move, [], { axis: "x", at_mm: 0 })).toEqual({
      why: "select the bars, parts or points to mirror",
    });
    expect(mirrorBatch(move, ["b7@2"], { axis: "x", at_mm: 0 })).toEqual({
      why: "b7@2 is a pattern copy: mirror b7, its template, or explode the pattern",
    });
  });
});

describe("duplicate and array (E3.3)", () => {
  it("is one array step, then a join at each new bar's ends: a rail 300 down butts on the posts", async () => {
    const batch = duplicateBatch(frame, ["b9"], [0, 0, -300]);
    expect(batch).toEqual([
      { cmd: "array", args: { ids: ["b9"], along: { dir: [0, 0, -1] }, pitch_mm: 300, count: 2 } },
      { cmd: "autoConnect", args: { at: [0, 0, 450], optional: true } },
      { cmd: "autoConnect", args: { at: [1000, 0, 450], optional: true } },
    ]);
    const h = await hostOf(join(fx, "brace"));
    try {
      const r = await h.dry(batch as unknown[]);
      if (!r.ok) throw new Error(r.why);
      expect(r.created).toEqual(["b13", "c9", "c10"]);
      // Its cut is the top rail's: each end butts on a post, as b9's do.
      expect(r.effects.added.b13).toBe(920);
      // The preview says so before the step.
      expect(copyWords(r).text).toBe("makes b13 · joins b1 (c9) · joins b2 (c10) · cut 920");
      expect(r.effects.claimed).toEqual(expect.arrayContaining(["b13.a", "b13.b"]));
      // Nothing wrong: only the frame's own note that its butts name no connector.
      expect(r.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("makes several copies at the spacing (4x), or divides the offset into gaps (/3)", () => {
    const four = duplicateBatch(frame, ["b5"], [0, 100, 0], { count: 4 });
    if ("why" in four) throw new Error(four.why);
    expect(four[0]).toEqual({
      cmd: "array",
      args: { ids: ["b5"], along: { dir: [0, 1, 0] }, pitch_mm: 100, count: 5 },
    });
    // A join at both ends of each copy: 4 copies, 8 joins.
    expect(four.slice(1).map((c) => c.args.at)).toEqual([
      [0, 100, 0],
      [1000, 100, 0],
      [0, 200, 0],
      [1000, 200, 0],
      [0, 300, 0],
      [1000, 300, 0],
      [0, 400, 0],
      [1000, 400, 0],
    ]);
    const thirds = duplicateBatch(frame, ["b5"], [0, 600, 0], { divide: 3 });
    if ("why" in thirds) throw new Error(thirds.why);
    expect(thirds[0]).toEqual({
      cmd: "array",
      args: { ids: ["b5"], along: { dir: [0, 1, 0] }, pitch_mm: 200, count: 4 },
    });
  });

  it("copies parts and points without joins, and refuses no offset or a pattern copy", () => {
    expect(duplicateBatch(move, ["p1"], [100, 0, 0])).toEqual([
      { cmd: "array", args: { ids: ["p1"], along: { dir: [1, 0, 0] }, pitch_mm: 100, count: 2 } },
    ]);
    expect(duplicateBatch(move, ["b3"], [0, 0, 0])).toEqual({
      why: "move the copy away from the original: drag, or type an offset",
    });
    expect(duplicateBatch(move, ["b7@1"], [0, 0, 10])).toEqual({
      why: "b7@1 is a pattern copy: copy b7, its template, or explode the pattern",
    });
  });

  it("an array is the core's array, along a bar or a direction, at a pitch or offsets", () => {
    expect(arrayBatch(frame, ["b5"], "b7", { pitch_mm: "D / 3", count: 3 })).toEqual([
      { cmd: "array", args: { ids: ["b5"], along: "b7", pitch_mm: "D / 3", count: 3 } },
    ]);
    expect(arrayBatch(frame, ["b5"], { dir: [0, 1, 0] }, { offsets_mm: [100, 250] })).toEqual([
      { cmd: "array", args: { ids: ["b5"], along: { dir: [0, 1, 0] }, offsets_mm: [100, 250] } },
    ]);
    expect(arrayBatch(frame, [], "b7", { pitch_mm: 100, count: 2 })).toEqual({
      why: "select the bars, parts or points to copy",
    });
  });
});

describe("rotate (E3.1)", () => {
  it("is one transform turn, then a join at each turned bar's ends", () => {
    const set = moveSet(move, ["b1", "b2"]);
    if ("why" in set) throw new Error(set.why);
    expect(rotateBatch(set, { axis: "z", deg: 90, about: [0, 0, 0] }, false, undefined)).toEqual([
      {
        cmd: "transform",
        args: { ids: ["b1", "b2"], rotate: { axis: "z", deg: 90, about: [0, 0, 0] } },
      },
      { cmd: "autoConnect", args: { end: "b1.a", optional: true } },
      { cmd: "autoConnect", args: { end: "b1.b", optional: true } },
      { cmd: "autoConnect", args: { end: "b2.a", optional: true } },
      { cmd: "autoConnect", args: { end: "b2.b", optional: true } },
    ]);
  });
});

describe("align (E3.6)", () => {
  it("moves the selection along the target face's normal until its own face is flush", async () => {
    // The front top rail 7 mm below the posts' tops.
    const lowered = await viewOf(join(await scratchFixtures(), "brace"), [
      { cmd: "transform", args: { ids: ["b9"], by: [0, 0, -7] } },
    ]);
    const set = moveSet(lowered, ["b9"]);
    if ("why" in set) throw new Error(set.why);
    expect(alignBatch(lowered, ["b9"], { bar: "b1", face: "b" })).toEqual(
      transformBatch(set, [0, 0, 7], false, undefined),
    );
    // Flush already: nothing to do.
    expect(alignBatch(frame, ["b9"], { bar: "b1", face: "b" })).toEqual({
      why: "b9 is flush with b1's top already",
    });
    // A side face: b9's front (−Y) flush with the post's front face, already.
    expect(alignBatch(frame, ["b9"], { bar: "b1", face: "-y" })).toEqual({
      why: "b9 is flush with b1's -Y side already",
    });
    expect(alignBatch(frame, ["b1"], { bar: "b1", face: "b" })).toEqual({
      why: "b1 is what moves: pick a face of something else",
    });
  });
});
