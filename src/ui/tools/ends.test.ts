import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { Model } from "../model.ts";
import { hostOf, viewOf } from "../testing.ts";
import {
  endAxis,
  endCommands,
  endState,
  endStops,
  labelEnd,
  landing,
  typedCut,
  typedLanding,
} from "./ends.ts";

/**
 * The end handles' rules (docs/ux/drag-ends-decisions.md) on tests/fixtures/ux/ends: b1 a rail
 * along +X, 1000 long; b2 up +Y from b1's end b, butted on it (c1); b3 a free brace down −Y at
 * x = 500, ending 280 short of b1's near face; b4 a post whose top is at z = L. 40 × 40, centred.
 */

let m: Model;
let dir: string;
beforeAll(async () => {
  dir = join(await scratchFixtures(), "ux", "ends");
  m = await viewOf(dir);
});

describe("end handles", () => {
  it("measures an end along its bar from the other end's design point", () => {
    expect(endAxis(m, "b3", "b")).toMatchObject({
      Q: [500, 600, 0],
      u: [0, -1, 0],
      len: 300,
      face: 300,
      cut: 300,
      extend: 0,
    });
    // b2's end a butts on b1: its face is at b1's near face, 20 short of its design point.
    expect(endAxis(m, "b2", "a")).toMatchObject({ len: 600, face: 580 });
  });

  it("says what holds each end, by the rule moveEnd applies", () => {
    expect(endState(m, "b3", "b")).toEqual({ kind: "free" });
    expect(endState(m, "b2", "a")).toMatchObject({ kind: "detach", conn: "c1" });
    expect(endState(m, "b1", "b")).toEqual({ kind: "free", corner: "c1" });
    expect(endState(m, "b4", "b")).toMatchObject({ kind: "driven", params: ["L"] });
    // b4's foot moves along Z too, but its z is a number: free.
    expect(endState(m, "b4", "a")).toEqual({ kind: "free" });
  });

  it("finds where a dragged end may stop: on a bar's line, at a bar's end, touching a face", () => {
    const axis = endAxis(m, "b3", "b");
    if (!axis) throw new Error("no axis");
    const stops = endStops(m, axis);
    // b1's line at y = 0 is 600 from b3's end a; the axis is inside b1's box from 580 to 620.
    expect(stops[0]).toMatchObject({ kind: "line", bar: "b1", to: "b1", len: 600, face: 580 });
    expect(stops[0]?.span).toEqual([580, 620]);
    // Landing anywhere in b1's body falls onto its line; short of it, whole millimetres.
    expect(landing(axis, stops, 600, 8)).toMatchObject({ len: 600, face: 580 });
    expect(landing(axis, stops, 575, 8).stop?.bar).toBe("b1");
    expect(landing(axis, stops, 450.4, 8)).toEqual({ len: 450, face: 450, cut: 450 });
    // A corner: b2's end a is on b1's end b's design point, and b1's axis reaches it.
    const b1 = endAxis(m, "b1", "b");
    if (!b1) throw new Error("no axis");
    expect(endStops(m, b1).find((s) => s.bar === "b2")).toMatchObject({
      kind: "corner",
      to: "b2.a",
      len: 1000,
    });
  });

  it("picks the end the label moves: end b when free, else end a; says why when neither", () => {
    expect(labelEnd(m, "b3")).toEqual({ end: "b" });
    // b2's end b is free; its end a is held.
    expect(labelEnd(m, "b2")).toEqual({ end: "b" });
    expect(labelEnd(m, "b4")).toMatchObject({ driven: { params: ["L"] } });
  });

  it("reads a typed cut: units, a sign from the cut now, and a param kept as written", () => {
    const P = { L: 400 };
    expect(typedCut("0.45m", 300, P)).toEqual({ cut: 450, written: 450 });
    expect(typedCut("+50", 300, P)).toEqual({ cut: 350, written: 350 });
    expect(typedCut("=L - 40", 300, P)).toEqual({ cut: 360, written: "L - 40" });
    expect(typedCut("+L", 300, P)).toEqual({ cut: 700, written: "300 + L" });
    expect(typedCut("-400", 300, P)).toEqual({ why: "a cut length is above 0" });
    expect(typedCut("Q", 300, P)).toEqual({ why: '"Q" is no param of this project' });
  });

  it("sends a typed cut over a param as written; a cut that lands in a bar goes to it", () => {
    const b3 = endAxis(m, "b3", "b");
    if (!b3) throw new Error("no axis");
    const stops = endStops(m, b3);
    const open = typedLanding(b3, stops, 360, "L - 40");
    expect(endCommands("b3.b", open, false, undefined)[0]).toEqual({
      cmd: "moveEnd",
      args: { end: "b3.b", cut_mm: "L - 40" },
    });
    // 590 reaches into b1's body: the joint sets the cut, so the end goes to b1.
    const into = typedLanding(b3, stops, 590, 590);
    expect(endCommands("b3.b", into, false, "vertical")).toEqual([
      { cmd: "moveEnd", args: { end: "b3.b", to: "b1" } },
      { cmd: "autoConnect", args: { end: "b3.b", optional: true, prefer: "vertical" } },
    ]);
  });

  it("dry-runs the drag's batch as one step: moved onto b1's line and butted, cut 580", async () => {
    const h = await hostOf(dir);
    try {
      const r = await h.dry([
        { cmd: "moveEnd", args: { end: "b3.b", to: "b1" } },
        { cmd: "autoConnect", args: { end: "b3.b", optional: true } },
      ]);
      if (!r.ok) throw new Error(r.why);
      expect(r.effects.cuts.b3).toEqual([300, 580]);
      expect(r.results[1]?.info).toEqual({ through: "b1", ends: ["b3.b"] });
    } finally {
      await h.close();
    }
  });
});
