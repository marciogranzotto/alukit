import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import { capture } from "../../cli/testing.ts";
import type { V3 } from "../../mesh/model.ts";
import { type ActionContext, actionsFor, titleOf } from "../actions/registry.ts";
import type { Model } from "../model.ts";
import { viewOf } from "../testing.ts";
import type { Cmd } from "../tools/preview.ts";
import { barActions, holeHere } from "./barActions.ts";
import {
  addHole,
  changeHole,
  holeOp,
  holesOf,
  holeWords,
  parseSize,
  removeHole,
  switchFrom,
} from "./holes.ts";

/**
 * The holes a person adds (docs/ux/editing-audit.md E4.4, E-UX-22) on base-frame/cli: b1 is the
 * post at the origin. Each edit is one setBar of the whole list.
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
const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
});

const HOLE = { op: "hole", face: "+x", at_mm: 20, d_mm: 7 };

describe("holes (E4.4)", () => {
  it("reads a size as a drill or a thread, an expression over params as typed", () => {
    expect(parseSize("7", {})).toEqual({ d_mm: 7 });
    expect(parseSize("m6", {})).toEqual({ thread: "M6" });
    expect(parseSize("M10x1.25", {})).toEqual({ thread: "M10x1.25" });
    expect(parseSize("=D / 100", { D: 600 })).toEqual({ d_mm: "D / 100" });
    expect(parseSize("", {})).toEqual({
      why: "give the hole's size: a drill (7) or a thread (M6)",
    });
    expect(parseSize("-3", {})).toEqual({ why: "a drill is above 0" });
  });

  it("adds a Ø7 hole 20 from end a on b1's +x face, as the CLI's setBar ops writes it", async () => {
    const op = holeOp({ face: "+x", at_mm: 20, size: { d_mm: 7 } });
    expect(op).toEqual(HOLE);
    const step = addHole(frame, "b1", op);
    expect(step).toEqual({ cmd: "setBar", args: { id: "b1", set: { ops: [HOLE] } } });
    const dir = join(root, "base-frame", "holes");
    await cp(join(root, "base-frame", "cli"), dir, { recursive: true });
    const m = await viewOf(dir, [step]);
    expect(holesOf(m, "b1")).toEqual([HOLE]);
    expect(holeWords(HOLE)).toBe("Ø7 on face +x, 20 mm from design point a");
    // Where it counts from, in the row's words (review M3).
    expect(holeWords({ ...HOLE, from: "a.cut" })).toBe("Ø7 on face +x, 20 mm from end a's cut");
    expect(holeWords({ ...HOLE, from: "b.cut" })).toBe("Ø7 on face +x, 20 mm from end b's cut");
    expect(holeWords({ ...HOLE, from: "b" })).toBe("Ø7 on face +x, 20 mm from design point b");
    // A thread for the drill, from end b, 12 deep: what the row shows changes; the rest stays.
    const withCsk = {
      ...m,
      doc: {
        ...m.doc,
        bars: {
          ...(m.doc.bars as object),
          b1: { ops: [{ ...HOLE, csk: { d_mm: 12, angle_deg: 90 } }] },
        },
      },
    } as Model;
    expect(changeHole(withCsk, "b1", 0, { thread: "M6", from: "b", depth_mm: 12 }).args).toEqual({
      id: "b1",
      set: {
        ops: [
          {
            op: "hole",
            face: "+x",
            at_mm: 20,
            thread: "M6",
            from: "b",
            depth_mm: 12,
            csk: { d_mm: 12, angle_deg: 90 },
          },
        ],
      },
    });
    expect(changeHole(m, "b1", 0, { from: "a" }).args).toEqual({ id: "b1", set: { ops: [HOLE] } });
    // Removing the last hole removes the list.
    expect(removeHole(m, "b1", 0).args).toEqual({ id: "b1", set: { ops: null } });
  });

  it("writes a hole counted from a cut end as it is counted (review M3)", () => {
    const op = holeOp({ face: "+y", at_mm: 260, from: "a.cut", size: { d_mm: 7 } });
    expect(op).toEqual({ op: "hole", face: "+y", at_mm: 260, from: "a.cut", d_mm: 7 });
    expect(holeOp({ face: "+y", at_mm: 30, from: "b.cut", size: { thread: "M6" } })).toEqual({
      op: "hole",
      face: "+y",
      at_mm: 30,
      from: "b.cut",
      thread: "M6",
    });
  });

  it("offers Add a hole here on a side face where the menu opened, from end a's cut", () => {
    offs.push(barActions());
    const at: V3 = [20, 40, 300];
    const c: ActionContext = {
      m: frame,
      selection: new Set(["b1"]),
      hit: { id: "b1", p: at, normal: [0, 1, 0], face: "+y", station: { bar: "b1", at_mm: 300.4 } },
      from: "view",
    };
    // b1 stands on the floor, square at its design point: its cut is there.
    expect(holeHere(c)).toEqual({ bar: "b1", face: "+y", at_mm: 300, from: "a.cut" });
    const entry = actionsFor(c).find((x) => x.action.id === "add-hole");
    expect(entry && titleOf(entry.action, c)).toBe(
      // The face with the way it looks in the world (review m9): b1's +y looks along world +Y,
      // the hit's normal.
      "Add a hole on b1's face +y (world +Y), 300 mm from end a's cut…",
    );
    // b9, the front base rail, is cut back 40 at each end where it butts on the posts: the
    // station 300.4 from its design point is 260 from its cut, as the cut list will say.
    const rail: ActionContext = {
      ...c,
      selection: new Set(["b9"]),
      hit: {
        id: "b9",
        p: [300, 0, 100],
        normal: [0, 0, 1],
        face: "+y",
        station: { bar: "b9", at_mm: 300.4 },
      },
    };
    expect(holeHere(rail)).toEqual({ bar: "b9", face: "+y", at_mm: 260, from: "a.cut" });
    const railEntry = actionsFor(rail).find((x) => x.action.id === "add-hole");
    expect(railEntry && titleOf(railEntry.action, rail)).toBe(
      // b9's +y face looks up, world +Z, the hit's normal.
      "Add a hole on b9's face +y (world +Z), 260 mm from end a's cut…",
    );
    // On an end face, no hole: holes go in a side.
    const hit = c.hit;
    if (!hit) throw new Error("no hit");
    expect(holeHere({ ...c, hit: { ...hit, face: "b" } })).toBeUndefined();
  });
});

describe("switching where a hole counts from keeps it where it is (review N6)", () => {
  /**
   * The brace's front base rail b5, 1000 between the design points, butted on the 40 × 40 posts
   * at both ends: end a's cut is 40 along the axis from design point a, end b's 960, and the
   * piece is 920. Its hole, written without `from`, is 300 from design point a: 260 on the cut
   * list. Each switch is one setBar whose number is converted, so the cut list puts the hole at
   * the same place on the piece after every switch (counted from end b, 660 is 920 − 260): the
   * hole stays on the metal, as a CAD dimension re-attached to another reference keeps the
   * geometry and reads the new distance.
   */
  const B5 = (ops: unknown[]) => ({ cmd: "setBar", args: { id: "b5", set: { ops } } });
  /** The cut list's holes on b5's piece, each counted from the piece's end a. */
  const machiningOf = async (dir: string) => {
    const out = JSON.parse((await capture(["cutlist", dir, "--format", "json"])).out) as {
      groups: {
        lines: {
          sources: string[];
          cut_mm: number;
          machining?: { from: string; at_mm: number }[];
        }[];
      }[];
    };
    const line = out.groups.flatMap((g) => g.lines).find((l) => l.sources.includes("b5"));
    return line?.machining?.map(({ from, at_mm, ...rest }) => ({
      ...rest,
      from: "a",
      at_mm: from === "b" ? line.cut_mm - at_mm : at_mm,
    }));
  };

  it.each([
    ["a.cut", 260],
    ["b.cut", 660],
    ["b", 700],
  ] as const)(
    "from design point a to %s: 300 becomes %s, and the cut list is unchanged",
    async (to, at) => {
      const dir = join(root, `brace-n6-${to}`);
      await cp(join(root, "brace"), dir, { recursive: true });
      const m = await viewOf(dir, [B5([{ op: "hole", face: "+y", at_mm: 300, d_mm: 7 }])]);
      const before = await machiningOf(dir);
      expect(before).toEqual([{ op: "hole", face: "+y", from: "a", at_mm: 260, d_mm: 7 }]);
      const step = switchFrom(m, "b5", 0, to);
      expect(step).toEqual(B5([{ op: "hole", face: "+y", at_mm: at, from: to, d_mm: 7 }]));
      const after = await viewOf(dir, [step as Cmd]);
      expect(await machiningOf(dir)).toEqual(before);
      // And back to where it started, the number with it.
      expect(switchFrom(after, "b5", 0, "a")).toEqual(
        B5([{ op: "hole", face: "+y", at_mm: 300, d_mm: 7 }]),
      );
    },
  );

  it("keeps a distance written over params an expression that follows them", async () => {
    const dir = join(root, "brace-n6-expr");
    await cp(join(root, "brace"), dir, { recursive: true });
    const m = await viewOf(dir, [B5([{ op: "hole", face: "+y", at_mm: "2 * 150", d_mm: 7 }])]);
    expect(switchFrom(m, "b5", 0, "a.cut")).toEqual(
      B5([{ op: "hole", face: "+y", at_mm: "2 * 150 - 40", from: "a.cut", d_mm: 7 }]),
    );
    expect(switchFrom(m, "b5", 0, "b.cut")).toEqual(
      B5([{ op: "hole", face: "+y", at_mm: "960 - (2 * 150)", from: "b.cut", d_mm: 7 }]),
    );
  });
});
