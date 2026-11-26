import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import { capture } from "./testing.ts";

/** `--variant` on the outputs and the check (design §4.10, §7.3), and the variant commands (§6). */

async function cartWithVariants() {
  const root = await scratchFixtures();
  const dir = join(root, "cart");
  const r = await capture([
    "do",
    dir,
    JSON.stringify([
      { cmd: "addVariant", args: { name: "base", variant: {}, default: true } },
      { cmd: "addVariant", args: { name: "tall", variant: { params: { H: "1100" } } } },
      {
        cmd: "addVariant",
        args: { name: "steel", variant: { swap: { "test:TS4080": "test:RHS-50x30x2" } } },
      },
      { cmd: "setBar", args: { id: "b13", set: { not_in: ["tall"] } } },
    ]),
  ]);
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  return dir;
}

describe("variants through the CLI", () => {
  it("derives the default variant, or the one --variant names", async () => {
    const dir = await cartWithVariants();
    const base = JSON.parse((await capture(["derive", dir, "--json"])).out);
    expect(base.variant).toBe("base");
    expect(base.bars.b1.len_mm).toBe(900);
    expect(base.bars.b13).toBeDefined();

    const tall = await capture(["derive", dir, "--json", "--variant", "tall"]);
    const t = JSON.parse(tall.out);
    expect(t.variant).toBe("tall");
    expect(t.bars.b1.len_mm).toBe(1100);
    expect(t.bars.b13).toBeUndefined();
    // The hanger's butt loses its only end, so it is left out with an info.
    expect(t.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "info", code: "variant", entity: "c12" }),
    );

    const cut = await capture(["cutlist", dir, "--variant", "tall", "--format", "json"]);
    const pieces = JSON.parse(cut.out).groups.flatMap((g: { lines: { sources: string[] }[] }) =>
      g.lines.flatMap((l) => l.sources),
    );
    expect(pieces).toContain("b1");
    expect(pieces).not.toContain("b13");

    const steel = JSON.parse(
      (await capture(["bom", dir, "--variant", "steel", "--format", "json"])).out,
    );
    const bars = steel.groups.find((g: { kind: string }) => g.kind === "bar").lines;
    expect(bars.map((l: { item: string }) => l.item)).toContain("test:RHS-50x30x2");
    expect(bars.map((l: { item: string }) => l.item)).not.toContain("test:TS4080");

    const check = await capture(["check", dir, "--variant", "tall", "--json"]);
    expect(JSON.parse(check.out).variant).toBe("tall");
  });

  it("refuses a variant the project does not have, on every output", async () => {
    const dir = await cartWithVariants();
    for (const cmd of ["derive", "cutlist", "bom", "order", "costs", "check"]) {
      const r = await capture([cmd, dir, "--variant", "wood"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain(
        `alukit ${cmd}: there is no variant wood; the project has base, steel, tall`,
      );
      expect(r.out).toBe("");
    }
  });

  it("refuses a variant whose swap names an item that does not resolve", async () => {
    const dir = await cartWithVariants();
    const r = await capture([
      "do",
      dir,
      JSON.stringify({
        cmd: "addVariant",
        args: { name: "odd", variant: { swap: { "test:TS40": "test:NOPE" } } },
      }),
    ]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("variants/list/odd/swap: no catalog item test:NOPE");
  });
});
