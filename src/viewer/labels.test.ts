import { describe, expect, it } from "vitest";
import { nudgeInside } from "./labels.ts";

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
