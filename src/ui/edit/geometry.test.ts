import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { Model } from "../model.ts";
import { viewOf } from "../testing.ts";
import {
  barCorners,
  centreOf,
  extentAlong,
  facePlane,
  ghostsOf,
  membersOf,
  minCorner,
  reflection,
  snapAngle,
  splitCopies,
  turn,
  typedAngle,
} from "./geometry.ts";

/** The transform and copy tools' geometry, on tests/fixtures/brace (the 1000 × 600 × 750 frame). */

let frame: Model;
beforeAll(async () => {
  frame = await viewOf(join(await scratchFixtures(), "brace"));
});

describe("the tools' geometry", () => {
  it("reads copies after an offset: 4x, x4, /4; a division or a product stays a value", () => {
    const P = { x4: 10, W: 1000 };
    expect(splitCopies("0, 0, -300 4x", P)).toEqual({ rest: "0, 0, -300", count: 4 });
    expect(splitCopies("4x", P)).toEqual({ rest: "", count: 4 });
    expect(splitCopies("/3", P)).toEqual({ rest: "", divide: 3 });
    expect(splitCopies("-300 /3", P)).toEqual({ rest: "-300", divide: 3 });
    expect(splitCopies("0,0,-300,x5", P)).toEqual({ rest: "0,0,-300", count: 5 });
    expect(splitCopies("*4", P)).toEqual({ rest: "", count: 4 });
    // Divisions and products in a value, and a param named like a count, are values.
    expect(splitCopies("300/3", P)).toEqual({ rest: "300/3" });
    expect(splitCopies("W / 2", P)).toEqual({ rest: "W / 2" });
    expect(splitCopies("W *4", P)).toEqual({ rest: "W *4" });
    expect(splitCopies("x4", P)).toEqual({ rest: "x4" });
    expect(splitCopies("0x", P)).toEqual({ why: "a count of copies is 1 or more" });
    expect(splitCopies("101x", P)).toEqual({ why: "at most 100 copies in one step" });
  });

  it("reads a typed angle in degrees, and snaps a ring's drag to 15°", () => {
    expect(typedAngle("90", {})).toEqual({ deg: 90 });
    expect(typedAngle("-45°", {})).toEqual({ deg: -45 });
    expect(typedAngle("=A / 2", { A: 60 })).toEqual({ deg: 30 });
    expect(typedAngle("", {})).toBeUndefined();
    expect(typedAngle("1, 2", {})).toEqual({ why: "type one angle, in degrees" });
    expect(snapAngle(52)).toBe(45);
    expect(snapAngle(-98)).toBe(-105);
    expect(snapAngle(4)).toBe(0);
  });

  it("turns the right-handed way, exactly at quarter turns, and mirrors in a plane", () => {
    const t = turn("z", 90, [100, 0, 0]);
    expect(t.point([200, 0, 5])).toEqual([100, 100, 5]);
    expect(t.dir([1, 0, 0])).toEqual([0, 1, 0]);
    expect(turn("x", 90, [0, 0, 0]).dir([0, 1, 0])).toEqual([0, 0, 1]);
    expect(turn("y", 90, [0, 0, 0]).dir([0, 0, 1])).toEqual([1, 0, 0]);
    const r = reflection("x", 500);
    expect(r.point([300, 4, 5])).toEqual([700, 4, 5]);
    expect(r.dir([1, 2, 3])).toEqual([-1, 2, 3]);
  });

  it("finds a selection's centre, lowest corner and reach along a direction", () => {
    const top = membersOf(frame, ["b9", "b10", "b7@2"]);
    expect(top).toEqual({ bars: ["b9", "b10"], parts: [], nodes: [] });
    expect(centreOf(frame, top)).toEqual([500, 300, 750]);
    expect(minCorner(frame, top)).toEqual([0, 0, 750]);
    // The top rail's top face is at the posts' tops, 750; its front face at y = 0.
    expect(extentAlong(frame, membersOf(frame, ["b9"]), [0, 0, 1])).toBe(750);
    expect(extentAlong(frame, membersOf(frame, ["b9"]), [0, -1, 0])).toBe(0);
  });

  it("knows a bar's body and faces from its box and end planes", () => {
    const b1 = frame.derived.bars.b1;
    if (!b1) throw new Error("no b1");
    const corners = barCorners(b1);
    expect(corners).toHaveLength(8);
    expect(Math.max(...corners.map((p) => p[2]))).toBe(750);
    expect(facePlane(b1, "b")).toEqual({ n: [0, 0, 1], c: 750 });
    expect(facePlane(b1, "a")).toEqual({ n: [0, 0, -1], c: 0 });
    // The post sits inside the corner: its outer faces at x = 0 and y = 0.
    const outer = [
      facePlane(b1, "-x"),
      facePlane(b1, "+x"),
      facePlane(b1, "-y"),
      facePlane(b1, "+y"),
    ];
    expect(outer.map((f) => [f.n, Math.round(f.c * 100) / 100])).toContainEqual([[-1, 0, 0], 0]);
  });

  it("draws bars where a map puts them, frame and point together", () => {
    const [g] = ghostsOf(frame, ["b9"], turn("z", 90, [0, 0, 0]));
    expect(g?.t).toEqual([0, 1, 0]);
    expect(g?.len).toBeGreaterThan(0);
  });
});
