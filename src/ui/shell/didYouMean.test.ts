import { describe, expect, it } from "vitest";
import { didYouMean, editDistance, unknownFields } from "./didYouMean.ts";

/** "Did you mean" for an unknown field (S2.14, U34). */

describe("didYouMean", () => {
  const BAR = ["item", "opt", "a", "b", "anchor", "roll", "label", "tags", "ends"];

  it("finds the field a slip of the keyboard was meant to be", () => {
    expect(editDistance("lable", "label")).toBe(2);
    expect(didYouMean("lable", BAR)).toBe("label");
    expect(didYouMean("ancor", BAR)).toBe("anchor");
    expect(didYouMean("Tags", BAR)).toBe("tags");
  });

  it("guesses nothing for a word far from every field, or a short one", () => {
    expect(didYouMean("colour", BAR)).toBeUndefined();
    expect(didYouMean("x", BAR)).toBeUndefined();
  });

  it("reads the names out of the schema's message", () => {
    expect(unknownFields('unknown field "lable"')).toEqual(["lable"]);
    expect(unknownFields('unknown fields "lable", "ancor"')).toEqual(["lable", "ancor"]);
    expect(unknownFields("Expected ',' or '}' after property value")).toEqual([]);
  });
});
