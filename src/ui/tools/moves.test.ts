import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { applyBatch } from "#core/commands/apply.ts";
import type { State } from "#core/commands/types.ts";
import { LockFile } from "#core/lock/schema.ts";
import { projectText } from "#core/project/canonical.ts";
import { scratchFixtures } from "#core/testing.ts";
import type { V3 } from "../../mesh/model.ts";
import type { DryRun } from "../client/dryrun.ts";
import { transformBatch } from "../edit/batches.ts";
import type { Model } from "../model.ts";
import { hostOf, viewOf } from "../testing.ts";
import { moveSet, moveWords, slideAxis, typedOffset } from "./moves.ts";

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
    expect(transformBatch(set, [0, -280, 0], true, "x")).toEqual([
      { cmd: "transform", args: { ids: ["b3"], by: [0, -280, 0], joined: "detach" } },
      { cmd: "autoConnect", args: { end: "b3.a", optional: true, prefer: "x" } },
      { cmd: "autoConnect", args: { end: "b3.b", optional: true, prefer: "x" } },
    ]);
  });

  it("stretches what a crossing box held in part: its ends inside move, in one step", async () => {
    // tests/fixtures/brace: a box over the right side holds the right posts and side rails whole,
    // and crosses the front and back rails with their ends b inside.
    const frameDir = join(dir, "..", "..", "brace");
    const frame = await viewOf(frameDir);
    const crossed = new Map<string, ("a" | "b")[]>([
      ["b5", ["b"]],
      ["b6", ["b"]],
      ["b9", ["b"]],
      ["b10", ["b"]],
      ["b7", []],
    ]);
    const sel = ["b2", "b4", "b5", "b6", "b7", "b8", "b9", "b10", "b12"];
    const set = moveSet(frame, sel, crossed);
    if ("why" in set) throw new Error(set.why);
    expect(set).toEqual({
      ids: ["b12", "b2", "b4", "b8", "b10.b", "b5.b", "b6.b", "b9.b"],
      bars: ["b12", "b2", "b4", "b8"],
      parts: [],
      nodes: [],
      ends: ["b10.b", "b5.b", "b6.b", "b9.b"],
    });
    expect(slideAxis(frame, set)).toBeUndefined();
    // The joins: both ends of each bar moved whole, then each stretched end.
    const batch = transformBatch(set, [100, 0, 0], false, undefined);
    expect(batch[0]).toEqual({
      cmd: "transform",
      args: { ids: set.ids, by: [100, 0, 0] },
    });
    expect(batch.slice(1).map((c) => (c.args as { end: string }).end)).toEqual([
      "b12.a",
      "b12.b",
      "b2.a",
      "b2.b",
      "b4.a",
      "b4.b",
      "b8.a",
      "b8.b",
      "b10.b",
      "b5.b",
      "b6.b",
      "b9.b",
    ]);
    const h = await hostOf(frameDir);
    try {
      const r = await h.dry(batch);
      if (!r.ok) throw new Error(r.why);
      expect(moveWords(r as DryRun, false).text).toBe(
        "stretches b5, b6 and 2 more · cut b5 920 → 1020, b6 920 → 1020, b9 920 → 1020 …",
      );
    } finally {
      await h.close();
    }
    // Only crossed, with no end inside: nothing moves.
    expect(moveSet(frame, ["b7"], crossed)).toEqual({
      why: "the crossing box holds no end of the bars it crosses: nothing in it moves",
    });
  });

  it("says what a move does before it: what follows and what is cut, or why not", async () => {
    const h = await hostOf(dir);
    try {
      const set = moveSet(m, ["b1"]);
      if ("why" in set) throw new Error(set.why);
      const follow = await h.dry(transformBatch(set, [0, -100, 0], false, undefined));
      if (!follow.ok) throw new Error(follow.why);
      expect(moveWords(follow as DryRun, false).text).toBe("b2.a, p1 follow · cut b2 580 → 680");
      const two = moveSet(m, ["b2"]);
      if ("why" in two) throw new Error(two.why);
      const up = await h.dry(transformBatch(two, [0, 0, 100], false, undefined));
      expect(moveWords(up as DryRun, false).text).toMatch(
        /^this move would break a joint: .* · hold Alt to detach it$/,
      );
      const freed = await h.dry(transformBatch(two, [0, 0, 100], true, undefined));
      // b1 no longer covers b2's end at the corner, so it loses its 20 too.
      expect(moveWords(freed as DryRun, true).text).toBe(
        "frees c1 · cut b1 1020 → 1000, b2 580 → 600",
      );
    } finally {
      await h.close();
    }
  });
});

describe("the joins a move sends (review M6)", () => {
  type Set = Extract<ReturnType<typeof moveSet>, { ids: string[] }>;
  const setOf = (model: Model, ids: string[]): Set => {
    const s = moveSet(model, ids);
    if ("why" in s) throw new Error(s.why);
    return s;
  };
  /** The batch as it was before: a join at every moved end, the first 24. */
  const everyEnd = (set: Set, by: V3, detach: boolean) => [
    { cmd: "transform", args: { ids: set.ids, by, ...(detach ? { joined: "detach" } : {}) } },
    ...[...set.bars.flatMap((b) => [`${b}.a`, `${b}.b`]), ...(set.ends ?? [])]
      .slice(0, 24)
      .map((end) => ({ cmd: "autoConnect", args: { end, optional: true } })),
  ];
  const ends = (batch: { args?: unknown }[]) =>
    batch.slice(1).map((c) => (c.args as { end: string }).end);
  const stateOf = (d: string): State => ({
    doc: JSON.parse(readFileSync(join(d, "alukit.json"), "utf8")),
    lock: LockFile.parse(JSON.parse(readFileSync(join(d, "alukit.lock.json"), "utf8"))),
  });

  /** ux/move's moves, and the brace's box frame moved whole: name, model, folder, ids, by, Alt. */
  const cases = async (): Promise<[string, Model, string, string[], V3, boolean][]> => {
    const braceDir = join(dir, "..", "..", "brace");
    const brace = await viewOf(braceDir);
    const twelve = Array.from({ length: 12 }, (_, i) => `b${i + 1}`);
    return [
      ["a free brace", m, dir, ["b3"], [0, -280, 0], false],
      ["a joined pair into open space", m, dir, ["b1", "b2"], [0, 0, 300], false],
      [
        "a joined pair whose corner lands on b4's free end",
        m,
        dir,
        ["b1", "b2"],
        [-800, 300, 0],
        false,
      ],
      ["a butting rail freed with Alt", m, dir, ["b2"], [0, 0, 100], true],
      ["a box frame moved whole", brace, braceDir, twelve, [0, 0, 300], false],
    ];
  };

  it("joins only where a moved end can join: free, freed, or brought onto a free end", async () => {
    const want: Record<string, string[]> = {
      "a free brace": ["b3.a", "b3.b"],
      "a joined pair into open space": ["b1.a", "b2.b"],
      "a joined pair whose corner lands on b4's free end": ["b1.a", "b1.b", "b2.a", "b2.b"],
      "a butting rail freed with Alt": ["b2.a", "b2.b"],
      // Every end stays joined and no free end waits where one lands: the transform alone.
      "a box frame moved whole": [],
    };
    for (const [name, model, , ids, by, detach] of await cases()) {
      const batch = transformBatch(setOf(model, ids), [...by], detach, undefined, { m: model, by });
      expect(ends(batch), name).toEqual(want[name]);
    }
  });

  it("makes the same step as a join at every moved end", async () => {
    for (const [name, model, d, ids, by, detach] of await cases()) {
      const set = setOf(model, ids);
      const s = stateOf(d);
      const env = { today: "2026-11-27" };
      const all = applyBatch(s, everyEnd(set, by, detach), env);
      const some = applyBatch(
        s,
        transformBatch(set, [...by], detach, undefined, { m: model, by }),
        env,
      );
      if (!all.ok || !some.ok) throw new Error(`${name}: refused`);
      expect(projectText(some.state.doc), name).toBe(projectText(all.state.doc));
      expect(
        some.results.flatMap((r) => r.created),
        name,
      ).toEqual(all.results.flatMap((r) => r.created));
    }
    // The corner that lands on b4's free end joins it: the case is not vacuous.
    const [, , , ids, by] = (await cases())[2] as [string, Model, string, string[], V3, boolean];
    const r = applyBatch(
      stateOf(dir),
      transformBatch(setOf(m, ids), [...by], false, undefined, { m, by }),
      {
        today: "2026-11-27",
      },
    );
    expect(r.ok && r.results.flatMap((x) => x.created)).toEqual(["c2"]);
  });
});
