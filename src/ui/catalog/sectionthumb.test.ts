import { describe, expect, it } from "vitest";
import { isPlainBox } from "./SectionThumb.tsx";

/** A section that is only its box is drawn outlined, not solid (docs/ux/review-phase4.md N6). */

type P = [number, number];
const BOX: P[] = [
  [0, 0],
  [15, 0],
  [15, 15],
  [0, 15],
];

describe("isPlainBox", () => {
  it("is true for four corners and no holes, open or closed", () => {
    expect(isPlainBox({ outline: BOX, holes: [] })).toBe(true);
    expect(isPlainBox({ outline: [...BOX, [0, 0]], holes: [] })).toBe(true);
  });

  it("is false for a section with a hole, more corners, or a slanted quadrilateral", () => {
    expect(isPlainBox({ outline: BOX, holes: [[[5, 5]]] as never })).toBe(false);
    expect(isPlainBox({ outline: [...BOX, [0, 5]], holes: [] })).toBe(false);
    expect(
      isPlainBox({
        outline: [
          [0, 0],
          [15, 0],
          [10, 15],
          [0, 15],
        ],
        holes: [],
      }),
    ).toBe(false);
  });
});
