import { describe, expect, it } from "vitest";
import { type AnchorSpot, anchorLayout, TARGET } from "./AnchorDots.tsx";

/**
 * The anchor pad's layout (AnchorDots.tsx; docs/ux/polish-editing-ui-decisions.md 2): on any
 * section every dot is a 24 × 24 px target that overlaps no other (WCAG 2.2, 2.5.8), and the box
 * keeps the section's proportions up to 2 : 1. Before, a 40 × 80 put its narrow face's dots 6.5 px
 * apart (docs/ux/integration-editing.md, defect 3).
 */

const BOX = ["c", "-x-y", "+x-y", "+x+y", "-x+y", "-x", "+x", "-y", "+y"];

type Box = [[number, number], [number, number]];
const box = (w: number, h: number): Box => [
  [-w / 2, -h / 2],
  [w / 2, h / 2],
];

/** Two targets of TARGET px centred on these points overlap. */
const overlap = (p: AnchorSpot, q: AnchorSpot) =>
  Math.abs(p.x - q.x) < TARGET - 1e-9 && Math.abs(p.y - q.y) < TARGET - 1e-9;

describe("the anchor pad's layout", () => {
  it.each([
    [40, 40],
    [40, 80],
    [80, 40],
    [20, 80],
    [80, 20],
    [20, 20],
    [1, 400],
    [45, 90],
    [30, 60],
  ])("puts no two of a %i × %i section's dots' targets over each other", (w, h) => {
    const l = anchorLayout(box(w, h), {}, BOX);
    expect(l.dots.map((d) => d.anchor)).toEqual(BOX);
    for (let i = 0; i < l.dots.length; i++) {
      for (let j = i + 1; j < l.dots.length; j++) {
        const p = l.dots[i] as AnchorSpot;
        const q = l.dots[j] as AnchorSpot;
        expect(overlap(p, q), `${p.anchor} and ${q.anchor}`).toBe(false);
      }
    }
    // Every target lies on the pad.
    for (const d of l.dots) {
      expect(d.x - TARGET / 2).toBeGreaterThanOrEqual(0);
      expect(d.y - TARGET / 2).toBeGreaterThanOrEqual(0);
      expect(d.x + TARGET / 2).toBeLessThanOrEqual(l.width);
      expect(d.y + TARGET / 2).toBeLessThanOrEqual(l.height);
    }
  });

  it("draws a 40 × 80 to scale, its long side up, and a 20 × 80 no longer than 2 : 1", () => {
    const tall = anchorLayout(box(40, 80), {}, BOX);
    expect(tall.box.h / tall.box.w).toBe(2);
    expect(tall.box.w).toBe(2 * TARGET);
    const at = (l: typeof tall, a: string) => l.dots.find((d) => d.anchor === a);
    // y up in the section is up on the pad: +y is above -y, +x right of -x.
    expect((at(tall, "+y")?.y ?? 0) < (at(tall, "-y")?.y ?? 0)).toBe(true);
    expect((at(tall, "+x")?.x ?? 0) > (at(tall, "-x")?.x ?? 0)).toBe(true);
    expect(at(tall, "-x+y")).toEqual({ anchor: "-x+y", x: TARGET / 2, y: TARGET / 2 });
    const flat = anchorLayout(box(20, 80), {}, BOX);
    expect(flat.box).toEqual(tall.box);
    const square = anchorLayout(box(40, 40), {}, BOX);
    expect(square.box.w).toBe(square.box.h);
  });

  it("marks a datum on the box, by its place in the section, and draws no dot for it", () => {
    const l = anchorLayout(box(40, 20), { mount: [0, -10] }, [...BOX, "mount"]);
    expect(l.dots.map((d) => d.anchor)).toEqual(BOX);
    const below = l.dots.find((d) => d.anchor === "-y");
    expect(l.datums).toEqual([{ anchor: "mount", x: below?.x, y: below?.y }]);
  });

  it("offers only the anchors the bar has", () => {
    expect(anchorLayout(box(40, 40), {}, ["c"]).dots.map((d) => d.anchor)).toEqual(["c"]);
  });
});
