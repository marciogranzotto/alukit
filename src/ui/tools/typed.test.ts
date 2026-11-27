import { describe, expect, it } from "vitest";
import { parseTyped, typedNumber, typedWords, withoutUnits } from "./typed.ts";

/** Values typed into the command bar (D-UX-17): the document's grammar, params, units, lists. */

const params = { W: 1200, D: 600, H: 900 };

describe("typed values", () => {
  it("reads units after a number as millimetres, and nowhere else", () => {
    expect(withoutUnits("1.2m")).toBe("1200");
    expect(withoutUnits("5 cm")).toBe("50");
    expect(withoutUnits("W - 25mm")).toBe("W - 25");
    expect(withoutUnits("0.25m + W")).toBe("250 + W");
    // A digit in a name is not a number; a word after a number is not a unit.
    expect(withoutUnits("W2m")).toBe("W2m");
    expect(withoutUnits("2 max(W, D)")).toBe("2 max(W, D)");
  });

  it("writes a plain value as the number it comes to, and one with params as typed", () => {
    expect(typedNumber("1.2m", params)).toEqual({ value: 1200, written: 1200, params: [] });
    expect(typedNumber("2 * 300", params)).toEqual({ value: 600, written: 600, params: [] });
    expect(typedNumber("W/2+20", params)).toEqual({ value: 620, written: "W/2+20", params: ["W"] });
    expect(typedNumber("-300", params)).toEqual({ value: -300, written: -300, params: [] });
    expect(typedNumber("(W - D) / 3", params)).toMatchObject({ value: 200 });
  });

  it("says why a value cannot be read", () => {
    expect(typedNumber("Q + 1", params)).toEqual({ why: '"Q" is no param of this project' });
    expect(typedNumber("W +", params)).toHaveProperty("why");
    expect(typedNumber("", params)).toEqual({ why: "a value is missing" });
  });

  it("tells one value, a list and a point apart", () => {
    expect(parseTyped("  ", params)).toEqual({ kind: "empty" });
    expect(parseTyped("900", params)).toMatchObject({ kind: "value", value: 900 });
    expect(parseTyped("1000, 600", params)).toMatchObject({
      kind: "list",
      items: [{ value: 1000 }, { value: 600 }],
    });
    // A comma inside a call's parentheses does not split.
    expect(parseTyped("max(W, D)", params)).toMatchObject({ kind: "value", value: 1200 });
    expect(parseTyped("[0, 0, H]", params)).toMatchObject({
      kind: "point",
      items: [{ written: 0 }, { written: 0 }, { written: "H", value: 900 }],
    });
    expect(parseTyped("[0, 0", params)).toMatchObject({ kind: "error" });
    expect(parseTyped("[0, 0]", params)).toMatchObject({ kind: "error" });
  });

  it("reads back what a value comes to", () => {
    const w = typedNumber("W/2+20", params);
    const n = typedNumber("1.2m", params);
    if ("why" in w || "why" in n) throw new Error("unreadable");
    expect(typedWords(w)).toBe("W/2+20 = 620 mm");
    expect(typedWords(n)).toBe("1200 mm");
  });
});
