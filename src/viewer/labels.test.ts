import { describe, expect, it } from "vitest";
import { clearOf, nudgeInside } from "./labels.ts";

/** A box as getBoundingClientRect gives it. */
const box = (left: number, top: number, w: number, h: number) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe("nudgeInside: a label at a point stays inside the view", () => {
  const view = box(100, 50, 800, 600);

  it("leaves a box already inside where it is", () => {
    expect(nudgeInside(box(300, 200, 120, 20), view, 4)).toEqual([0, 0]);
  });

  it("moves a box past the right edge left, by its overflow and the gap", () => {
    // Right at 980 against the view's 900, less a 4 px gap: 84 to the left.
    expect(nudgeInside(box(860, 200, 120, 20), view, 4)).toEqual([-84, 0]);
  });

  it("moves a box past the bottom up, and one above the top down", () => {
    expect(nudgeInside(box(300, 640, 120, 20), view, 4)).toEqual([0, -14]);
    expect(nudgeInside(box(300, 30, 120, 20), view, 4)).toEqual([0, 24]);
  });

  it("moves a box left of the view right", () => {
    expect(nudgeInside(box(60, 200, 120, 20), view, 4)).toEqual([44, 0]);
  });

  it("puts a box wider than the view at its left edge", () => {
    expect(nudgeInside(box(500, 200, 1000, 20), view, 4)).toEqual([-396, 0]);
  });
});

describe("clearOf: a label keeps clear of the gizmo, inside the view", () => {
  const view = box(100, 50, 800, 600);
  // The gizmo's footprint: a square round its point, as `gizmoFootprint` gives it.
  const gizmo = box(400, 250, 200, 200);

  it("leaves a box clear of every footprint where it is", () => {
    expect(clearOf(box(150, 100, 120, 20), view, [gizmo], 4)).toEqual([0, 0]);
    expect(clearOf(box(150, 100, 120, 20), view, [], 4)).toEqual([0, 0]);
  });

  it("moves a box over the gizmo the shortest way out, by the gap", () => {
    // Its top 10 px inside the square's bottom: down by 14.
    expect(clearOf(box(450, 440, 120, 20), view, [gizmo], 4)).toEqual([0, 14]);
    // Its top-left at the gizmo's point: down and right are both 104 (100 to the square's edge,
    // and the gap); up and left are farther. On a tie the vertical move wins.
    expect(clearOf(box(500, 350, 120, 20), view, [gizmo], 4)).toEqual([0, 104]);
  });

  it("goes another way when the shortest would leave the view", () => {
    // Near the view's bottom: down would put it outside, so up, above the square.
    const low = box(400, 520, 200, 120);
    expect(clearOf(box(450, 600, 120, 20), view, [low], 4)).toEqual([0, -104]);
  });

  it("clears every footprint at once, or stays where it is when nothing fits", () => {
    // A selected bar's two end handles either side of its label: left or right would land on
    // the other handle, so down, below both.
    const a = box(430, 340, 24, 24);
    const b = box(560, 340, 24, 24);
    expect(clearOf(box(440, 345, 130, 20), view, [a, b], 4)).toEqual([0, 23]);
    // A footprint as big as the view leaves no place clear: the box keeps its place in the view.
    expect(clearOf(box(450, 300, 120, 20), view, [view], 4)).toEqual([0, 0]);
  });
});
