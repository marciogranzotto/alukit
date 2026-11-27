import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exampleBatch, exampleOf, whyNotExample } from "./example.ts";

/** The start card's example (D-UX-25): the skill's worked example, as one batch. */

const SKILL = readFileSync(new URL("../../../skills/alukit/SKILL.md", import.meta.url), "utf8");

describe("exampleOf", () => {
  it("reads the catalogs, the currency and every batch of the skill's worked example", () => {
    const ex = exampleOf(SKILL);
    expect(ex.catalogs).toEqual(["forseti"]);
    expect(ex.currency).toBe("BRL");
    const cmds = ex.commands.map((c) => c.cmd);
    // Params, legs and rails, butts, then the tall variant: as the skill writes them.
    expect(cmds.slice(0, 3)).toEqual(["setParam", "setParam", "setParam"]);
    expect(cmds.filter((c) => c === "addBar")).toHaveLength(10);
    expect(cmds.filter((c) => c === "addConnection")).toHaveLength(8);
    expect(cmds.at(-1)).toBe("addCheck");
  });
});

describe("exampleBatch", () => {
  const ex = exampleOf(SKILL);

  it("adds the catalog and the currency the project lacks, as the first command", () => {
    const batch = exampleBatch(ex, { catalogs: ["std"] });
    expect(batch[0]).toEqual({
      cmd: "setProject",
      args: { catalogs: ["std", "forseti"], currency: "BRL" },
    });
    expect(batch.slice(1)).toEqual(ex.commands);
  });

  it("is the example as written on a project made as the skill makes it", () => {
    expect(exampleBatch(ex, { catalogs: ["forseti"], currency: "EUR" })).toEqual(ex.commands);
  });
});

describe("whyNotExample", () => {
  it("allows an empty project, and refuses one whose ids have moved on or that has variants", () => {
    expect(whyNotExample({})).toBeUndefined();
    expect(whyNotExample({ bars: { b1: {} } })).toMatch(/empty project/);
    // Every bar removed, but the counter is past b1: the example's b1 would not be its b1.
    expect(whyNotExample({ bars: {}, ids: { b: 3 } })).toMatch(/empty project/);
    expect(whyNotExample({ variants: { list: {} } })).toMatch(/variants/);
  });
});
