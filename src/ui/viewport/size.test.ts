import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { Model } from "../model.ts";
import { viewOf } from "../testing.ts";
import { sizeOf, sizeText } from "./size.ts";

/**
 * The size readout (editing audit E2.5): the bounding W × D × H of the selection's bodies, or of
 * the model's when nothing is selected, on the audit's box frame (1000 × 600 × 750 of 40 × 40).
 */

let frame: Model;
let root: string;
beforeAll(async () => {
  root = await scratchFixtures();
  frame = await viewOf(join(root, "brace"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("sizeOf", () => {
  it("reads the model's size when nothing is selected", () => {
    const box = sizeOf(frame);
    expect(box && sizeText(box)).toBe("1000 × 600 × 750 mm");
  });

  it("reads the selection's bodies: a post, a rail, a corner's bars", () => {
    expect(sizeText(sizeOf(frame, ["b1"]) as never)).toBe("40 × 40 × 750 mm");
    expect(sizeText(sizeOf(frame, ["b1", "b2"]) as never)).toBe("1000 × 40 × 750 mm");
    // A joint stands for the bars it joins: c1 butts the base rails b5 (x 40 to 960) and b7
    // (y 40 to 560) on the post b1.
    expect(sizeText(sizeOf(frame, ["c1"]) as never)).toBe("960 × 560 × 750 mm");
  });

  it("is nothing for a selection that draws nothing", () => {
    expect(sizeOf(frame, ["b99"])).toBeUndefined();
  });
});
