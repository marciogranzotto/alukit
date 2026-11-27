import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { DryRun } from "../client/dryrun.ts";
import type { Model } from "../model.ts";
import { hostOf, viewOf } from "../testing.ts";
import { moveCommands, moveSet, moveWords, slideAxis, typedOffset } from "./moves.ts";

/**
 * The Move tool's rules (docs/ux/drag-ends-decisions.md, "The Move tool") on tests/fixtures/ux/move:
 * b1 a rail along +X, 1000 long; b2 up +Y from b1's end b, butted on it (c1, cut 580); b3 and b4
 * free; p1 a bracket on b1 at 300; D = 150.
 */

let m: Model;
let dir: string;
beforeAll(async () => {
  dir = join(await scratchFixtures(), "ux", "move");
  m = await viewOf(dir);
});

describe("the Move tool", () => {
  it("moves what is selected; a pattern copy points at its template", () => {
    expect(moveSet(m, ["b3", "p1"])).toEqual({
      ids: ["b3", "p1"],
      bars: ["b3"],
      parts: ["p1"],
      nodes: [],
    });
    expect(moveSet(m, ["b7@2"])).toEqual({ why: "b7@2 is a pattern copy: move b7, its template" });
    expect(moveSet(m, [])).toEqual({ why: "select the bars, parts or points to move" });
  });

  it("slides parts alone on one bar along that bar", () => {
    const set = moveSet(m, ["p1"]);
    if ("why" in set) throw new Error(set.why);
    expect(slideAxis(m, set)).toEqual({ bar: "b1", u: [1, 0, 0] });
    const both = moveSet(m, ["p1", "b3"]);
    if ("why" in both) throw new Error(both.why);
    expect(slideAxis(m, both)).toBeUndefined();
  });

  it("reads a typed offset: a distance along the way, x, y, z, or where the base goes", () => {
    const P = { D: 150 };
    const base: [number, number, number] = [500, 300, 0];
    expect(typedOffset("200", P, base, [0, 1, 0])).toEqual({
      d: [0, 200, 0],
      written: [0, 200, 0],
    });
    // A param along a world axis is written as typed, so transform keeps it.
    expect(typedOffset("=D", P, base, [0, -1, 0])).toEqual({
      d: [0, -150, 0],
      written: [0, "-D", 0],
    });
    expect(typedOffset("0, 0.2m, D", P, base, undefined)).toEqual({
      d: [0, 200, 150],
      written: [0, 200, "D"],
    });
    expect(typedOffset("[600, 300, 0]", P, base, undefined)).toEqual({
      d: [100, 0, 0],
      written: [100, 0, 0],
    });
    expect(typedOffset("200", P, base, undefined)).toEqual({
      why: "lock an axis (→ ← ↑) or move the pointer the way to go, or type x, y, z",
    });
    expect(typedOffset("1, 2", P, base, undefined)).toEqual({
      why: "type a distance, or the offset as x, y, z",
    });
    expect(typedOffset("", P, base, undefined)).toBeUndefined();
  });

  it("is one step: transform, then autoConnect at each moved bar's end; Alt detaches", () => {
    const set = moveSet(m, ["b3"]);
    if ("why" in set) throw new Error(set.why);
    expect(moveCommands(set, [0, -280, 0], true, "x")).toEqual([
      { cmd: "transform", args: { ids: ["b3"], by: [0, -280, 0], joined: "detach" } },
      { cmd: "autoConnect", args: { end: "b3.a", optional: true, prefer: "x" } },
      { cmd: "autoConnect", args: { end: "b3.b", optional: true, prefer: "x" } },
    ]);
  });

  it("says what a move does before it: what follows and what is cut, or why not", async () => {
    const h = await hostOf(dir);
    try {
      const set = moveSet(m, ["b1"]);
      if ("why" in set) throw new Error(set.why);
      const follow = await h.dry(moveCommands(set, [0, -100, 0], false, undefined));
      if (!follow.ok) throw new Error(follow.why);
      expect(moveWords(follow as DryRun, false).text).toBe("b2.a, p1 follow · cut b2 580 → 680");
      const two = moveSet(m, ["b2"]);
      if ("why" in two) throw new Error(two.why);
      const up = await h.dry(moveCommands(two, [0, 0, 100], false, undefined));
      expect(moveWords(up as DryRun, false).text).toMatch(
        /^this move would break a joint: .* · Alt: detach$/,
      );
      const freed = await h.dry(moveCommands(two, [0, 0, 100], true, undefined));
      // b1 no longer covers b2's end at the corner, so it loses its 20 too.
      expect(moveWords(freed as DryRun, true).text).toBe(
        "frees c1 · cut b1 1020 → 1000, b2 580 → 600",
      );
    } finally {
      await h.close();
    }
  });
});
