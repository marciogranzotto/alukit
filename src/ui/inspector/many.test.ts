import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { Model } from "../model.ts";
import { viewOf } from "../testing.ts";
import {
  anchorBatch,
  labelBatch,
  manyBars,
  optionBatch,
  rollBatch,
  shared,
  tagBatch,
  tagsOf,
} from "./many.ts";

/**
 * Fields for several selected (docs/ux/editing-audit.md E4.5, E-UX-15): each shows the value they
 * share or "varies", and a change is one step, one patch per entity. On base-frame/cli: posts
 * b1–b4 (TS40, tagged post, the default finish), rails b5–b10 (b5, b6 TS4080 rolled 90°).
 */

let root: string;
let frame: Model;
beforeAll(async () => {
  root = await scratchFixtures();
  frame = await viewOf(join(root, "base-frame", "cli"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const POSTS = ["b1", "b2", "b3", "b4"];

describe("several selected (E-UX-15)", () => {
  it("shares a value, or says it varies", () => {
    expect(shared(["a", "a"])).toEqual({ value: "a" });
    expect(shared(["a", "b"])).toEqual({ varies: true });
    expect(shared([])).toEqual({ varies: true });
    // The posts and the rails are all bars; a connection among them is not.
    expect(manyBars(frame, [...POSTS, "b5"])).toEqual([...POSTS, "b5"]);
    expect(manyBars(frame, ["b1", "c1"])).toBeUndefined();
    expect(manyBars(frame, ["b1", "b26@2"])).toBeUndefined();
  });

  it("sets four legs' finish in one step, one setBar each", async () => {
    const batch = optionBatch(POSTS, "finish", "black");
    expect(batch).toEqual(
      POSTS.map((id) => ({ cmd: "setBar", args: { id, set: { opt: { finish: "black" } } } })),
    );
    const dir = join(root, "base-frame", "many");
    await cp(join(root, "base-frame", "cli"), dir, { recursive: true });
    const m = await viewOf(dir, batch);
    expect(POSTS.map((id) => m.derived.bars[id]?.opt.finish)).toEqual([
      "black",
      "black",
      "black",
      "black",
    ]);
    // "" is the project's default: the option is removed.
    expect(optionBatch(["b1"], "finish", "")[0]?.args).toEqual({
      id: "b1",
      set: { opt: { finish: null } },
    });
  });

  it("writes the anchor, the roll and the label for each, and the tags as one tag command", () => {
    expect(anchorBatch(["b1", "b2"], "c")).toEqual([
      { cmd: "setBar", args: { id: "b1", set: { anchor: null } } },
      { cmd: "setBar", args: { id: "b2", set: { anchor: null } } },
    ]);
    // The top rails, rolled 90°, back to nought: a quarter turn, so each anchor turns with it and
    // each rail keeps its side of its line (roll.ts), a different corner each.
    expect(rollBatch(frame, ["b5", "b6"], { value: 0, written: 0 })).toEqual([
      { cmd: "setBar", args: { id: "b5", set: { roll_deg: null, anchor: "-x+y" } } },
      { cmd: "setBar", args: { id: "b6", set: { roll_deg: null, anchor: "+x+y" } } },
    ]);
    // A param written as typed; 30° more is no quarter turn, so it rolls about the anchor.
    expect(rollBatch(frame, ["b6"], { value: 120, written: "A" })[0]?.args).toEqual({
      id: "b6",
      set: { roll_deg: "A" },
    });
    expect(labelBatch(["b1", "b2"], " leg ")).toEqual([
      { cmd: "label", args: { id: "b1", label: "leg" } },
      { cmd: "label", args: { id: "b2", label: "leg" } },
    ]);
    expect(labelBatch(["b1"], "")[0]?.args).toEqual({ id: "b1", label: null });
    // The posts share "post"; b5 has no tag: nothing is shared by all five.
    expect(tagsOf(frame, POSTS)).toEqual({ all: ["post"], some: [] });
    expect(tagsOf(frame, [...POSTS, "b5"])).toEqual({ all: [], some: ["post"] });
    // Typing the shared list again changes nothing; a new tag is added to all, a dropped shared
    // one removed from all, and one only some carry is left as it is.
    expect(tagBatch(frame, POSTS, "post")).toEqual([]);
    expect(tagBatch(frame, POSTS, "post, leg")).toEqual([
      { cmd: "tag", args: { ids: POSTS, add: ["leg"] } },
    ]);
    expect(tagBatch(frame, POSTS, "")).toEqual([
      { cmd: "tag", args: { ids: POSTS, remove: ["post"] } },
    ]);
    expect(tagBatch(frame, [...POSTS, "b5"], "frame")).toEqual([
      { cmd: "tag", args: { ids: [...POSTS, "b5"], add: ["frame"] } },
    ]);
  });
});
