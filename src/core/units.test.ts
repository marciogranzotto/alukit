import { describe, expect, it } from "vitest";
import { mFromMm, mmFromM } from "./units.ts";

describe("units", () => {
  it("converts between mm and m", () => {
    expect(mmFromM(1.5)).toBe(1500);
    expect(mFromMm(2500)).toBe(2.5);
  });
});
