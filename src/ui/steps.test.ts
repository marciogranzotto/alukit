import { describe, expect, it } from "vitest";
import type { Model } from "./model.ts";
import { ago, diffModels, hasConsequences, summaryText, who, whoWhat } from "./steps.ts";

/** Steps in the person's words (steps.ts): who, what, and what a step changed. */

/** A model of bars with these cut lengths, and nothing else. */
function bars(cuts: Record<string, number>): Model {
  return {
    doc: { bars: Object.fromEntries(Object.keys(cuts).map((id) => [id, {}])) },
    derived: {
      bars: Object.fromEntries(Object.entries(cuts).map(([id, cut_mm]) => [id, { cut_mm }])),
      parts: {},
    },
  } as unknown as Model;
}

describe("who", () => {
  it("names the source in words", () => {
    expect(who("ui")).toBe("you");
    expect(who("cli")).toBe("the CLI");
    expect(who("cli:e2e")).toBe("e2e");
    expect(who("agent:claude")).toBe("claude");
    expect(who("file")).toBe("a hand edit");
  });

  it("says who and what, the server's words first (BE-4), else the commands' names", () => {
    expect(whoWhat({ source: "agent:claude", what: "addBar", text: "add bar b35" })).toBe(
      "claude: add bar b35",
    );
    expect(whoWhat({ source: "cli:e2e", what: "addBar" })).toBe("e2e: addBar");
  });

  it("says how long ago in a few words", () => {
    expect(ago(1000)).toBe("just now");
    expect(ago(40_000)).toBe("40 s ago");
    expect(ago(3 * 60_000)).toBe("3 min ago");
  });
});

describe("diffModels", () => {
  it("finds what a step made and removed, and the cuts it moved (U4: 800 → 820)", () => {
    const before = bars({ b1: 800, b2: 600 });
    const after = bars({ b1: 820, b3: 580 });
    const d = diffModels(before, after);
    expect(d).toEqual({ created: ["b3"], removed: ["b2"], cuts: { b1: [800, 820] } });
    expect(hasConsequences(d)).toBe(true);
    expect(summaryText({ what: "addBar", text: "draw bar b3" }, d, after)).toBe(
      "draw bar b3 · b3 580.00 mm · b1 800.00 → 820.00 mm · removed b2",
    );
  });

  it("a step that only made something has no consequences to tell", () => {
    const d = diffModels(bars({ b1: 800 }), bars({ b1: 800, b2: 600 }));
    expect(d.created).toEqual(["b2"]);
    expect(hasConsequences(d)).toBe(false);
  });

  it("orders ids as people do: b2 before b10", () => {
    const d = diffModels(bars({}), bars({ b10: 1, b2: 1 }));
    expect(d.created).toEqual(["b2", "b10"]);
  });
});
