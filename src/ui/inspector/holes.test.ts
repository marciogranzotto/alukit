import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { V3 } from "../../mesh/model.ts";
import { type ActionContext, actionsFor, titleOf } from "../actions/registry.ts";
import type { Model } from "../model.ts";
import { viewOf } from "../testing.ts";
import { barActions, holeHere } from "./barActions.ts";
import { addHole, changeHole, holeOp, holesOf, holeWords, parseSize, removeHole } from "./holes.ts";

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
      "Add a hole on b1's face +y, 300 mm from end a's cut…",
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
      "Add a hole on b9's face +y, 260 mm from end a's cut…",
    );
    // On an end face, no hole: holes go in a side.
    const hit = c.hit;
    if (!hit) throw new Error("no hit");
    expect(holeHere({ ...c, hit: { ...hit, face: "b" } })).toBeUndefined();
  });
});
