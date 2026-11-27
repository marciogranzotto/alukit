import { describe, expect, it } from "vitest";
import { anchorPoint, barFrame } from "#core/derive/frame.ts";
import { quarterTurns, rollSet, turnedAnchor, turnedOffset } from "./roll.ts";

/**
 * A roll that keeps the bar on its side of its line (roll.ts; docs/ux/polish-editing-ui-decisions.md
 * 1). The oracle is derive's own placement rule (§4.4: `barFrame`, `anchorPoint`, section point
 * `s` at `P + (s − anchor + off)` in the local frame), not the names the rule writes.
 */

type Box = readonly [readonly [number, number], readonly [number, number]];

/** The world box of a vertical bar's section at its foot (the line at the origin), x and y. */
function footprint(
  bbox: Box,
  bar: { roll?: number; anchor?: string; off?: readonly [number, number] },
): [[number, number], [number, number]] {
  const fr = barFrame([0, 0, 500], undefined, bar.roll ?? 0);
  if ("problem" in fr) throw new Error(fr.problem);
  const a = anchorPoint(bar.anchor ?? "c", bbox, {}) as readonly [number, number];
  const off = bar.off ?? [0, 0];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const sx of [bbox[0][0], bbox[1][0]]) {
    for (const sy of [bbox[0][1], bbox[1][1]]) {
      const u = sx - a[0] + off[0];
      const v = sy - a[1] + off[1];
      xs.push(u * fr.frame.x[0] + v * fr.frame.y[0]);
      ys.push(u * fr.frame.x[1] + v * fr.frame.y[1]);
    }
  }
  const r = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
  return [
    [r(Math.min(...xs)), r(Math.max(...xs))],
    [r(Math.min(...ys)), r(Math.max(...ys))],
  ];
}

/** Which side of the line the body lies on along an axis: −1, +1, or 0 when it straddles it. */
const side = ([lo, hi]: readonly [number, number]) => (lo >= 0 ? 1 : hi <= 0 ? -1 : 0);

const BOX = ["c", "-x-y", "+x-y", "+x+y", "-x+y", "-x", "+x", "-y", "+y"];
const SQUARE: Box = [
  [-20, -20],
  [20, 20],
];
const TALL: Box = [
  [-20, -40],
  [20, 40],
];

describe("a roll by quarter turns turns the anchor back (roll.ts)", () => {
  it("counts quarter turns, and nothing for another angle", () => {
    expect(quarterTurns(90)).toBe(1);
    expect(quarterTurns(-90)).toBe(3);
    expect(quarterTurns(180)).toBe(2);
    expect(quarterTurns(450)).toBe(1);
    expect(quarterTurns(0)).toBe(0);
    expect(quarterTurns(45)).toBeUndefined();
    expect(quarterTurns(90.5)).toBeUndefined();
  });

  it.each(BOX)("keeps a square's body exactly where it was, anchored at %s", (anchor) => {
    const was = footprint(SQUARE, { anchor });
    for (const q of [1, 2, 3]) {
      const now = footprint(SQUARE, { roll: 90 * q, anchor: turnedAnchor(anchor, q) });
      expect(now, `${q} quarter turns`).toEqual(was);
    }
  });

  it.each(BOX)("keeps a 40 × 80 on the same side of its line, anchored at %s", (anchor) => {
    const was = footprint(TALL, { anchor });
    for (const q of [1, 2, 3]) {
      const now = footprint(TALL, { roll: 90 * q, anchor: turnedAnchor(anchor, q) });
      expect(now.map(side), `${q} quarter turns`).toEqual(was.map(side));
    }
  });

  it("turns a 40 × 80 in its corner: the 80 along X after a quarter turn, the corner kept", () => {
    // A post at the frame's front-left corner, its body toward +X +Y of its line: 40 along X,
    // 80 along Y. A quarter roll keeps the corner and lays the 80 along X.
    expect(footprint(TALL, { anchor: "-x-y" })).toEqual([
      [0, 40],
      [0, 80],
    ]);
    expect(footprint(TALL, { roll: 90, anchor: turnedAnchor("-x-y", 1) })).toEqual([
      [0, 80],
      [0, 40],
    ]);
    // Rolled about its anchor alone, it would leave the corner (what A4 measured).
    expect(footprint(TALL, { roll: 90, anchor: "-x-y" })).toEqual([
      [-80, 0],
      [0, 40],
    ]);
  });

  it("turns the offset back too, a param kept as written", () => {
    const off: [number, number] = [-20, 5];
    const was = footprint(SQUARE, { anchor: "+x", off });
    for (const q of [1, 2, 3]) {
      const o = turnedOffset(off, q) as [number, number];
      expect(footprint(SQUARE, { roll: 90 * q, anchor: turnedAnchor("+x", q), off: o })).toEqual(
        was,
      );
    }
    expect(turnedOffset(["W / 2", 0], 1)).toEqual([0, "-(W / 2)"]);
  });

  it("leaves a datum as it is", () => {
    expect(turnedAnchor("mount", 1)).toBe("mount");
  });
});

describe("the roll field's patch (rollSet)", () => {
  it("turns the anchor and the offset with a quarter turn", () => {
    expect(rollSet({ anchor: "-x-y" }, { value: 90, written: 90 })).toEqual({
      set: { roll_deg: 90, anchor: "-x+y" },
      turned: 1,
    });
    expect(rollSet({ anchor: "-x+y", roll_deg: 90 }, { value: 0, written: 0 })).toEqual({
      set: { roll_deg: null, anchor: "-x-y" },
      turned: 3,
    });
    expect(rollSet({ anchor: "+x", off_mm: [-20, 0] }, { value: 180, written: 180 })).toEqual({
      set: { roll_deg: 180, anchor: "-x", off_mm: [20, 0] },
      turned: 2,
    });
  });

  it("removes the centre and a nought offset, and leaves what does not change", () => {
    expect(rollSet({}, { value: 90, written: 90 })).toEqual({
      set: { roll_deg: 90 },
      turned: 1,
    });
    expect(rollSet({ anchor: "c", off_mm: [0, 0] }, { value: 90, written: 90 })).toEqual({
      set: { roll_deg: 90 },
      turned: 1,
    });
  });

  it("rolls about the anchor for another angle, and reads a roll written over params", () => {
    expect(rollSet({ anchor: "-x-y" }, { value: 30, written: 30 })).toEqual({
      set: { roll_deg: 30 },
    });
    expect(rollSet({ anchor: "-x-y", roll_deg: "R" }, { value: 0, written: 0 }, { R: 90 })).toEqual(
      { set: { roll_deg: null, anchor: "+x-y" }, turned: 3 },
    );
    expect(rollSet({ anchor: "-x-y" }, { value: 90, written: "R" }, { R: 90 })).toEqual({
      set: { roll_deg: "R", anchor: "-x+y" },
      turned: 1,
    });
  });
});
