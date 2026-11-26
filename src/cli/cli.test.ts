import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { at, FIXTURES, fixtureCopy, patchJson } from "#catalog/testing.ts";
import { helpText, run } from "./cli.ts";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const main = fileURLToPath(new URL("./main.ts", import.meta.url));

function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  return run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }).then((code) => ({
    code,
    out,
    err,
  }));
}

describe("cli", () => {
  it("prints the package version", async () => {
    const r = await capture(["--version"]);
    expect(r).toEqual({ code: 0, out: [pkg.version], err: [] });
  });

  it("lists planned commands as not implemented yet", () => {
    expect(helpText()).toContain("cutlist | bom | order | costs <dir>");
    expect(helpText()).toContain("(not implemented yet)");
  });

  it("refuses planned and unknown commands", async () => {
    expect((await capture(["cutlist"])).code).toBe(2);
    expect((await capture(["nope"])).code).toBe(2);
  });

  it("runs under Node with no flag and no warning", () => {
    // execFileSync throws on a non-zero exit; stdio "pipe" lets us see stderr.
    const stdout = execFileSync(process.execPath, [main, "--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(stdout.trim()).toBe(pkg.version);
  });
});

describe("alukit catalog", () => {
  const fixture = (name: string) => join(FIXTURES, name);

  it("checks a clean catalog: exit 0, the table, OK", async () => {
    const r = await capture(["catalog", "check", fixture("test")]);
    expect(r.code).toBe(0);
    const text = r.out.join("\n");
    expect(text).toMatch(
      /test:TS40E\s+forseti:PF40-01\s+exact\s+area_mm2\s+553\.53\s+553\s+\+0\.10 %\s+ok/,
    );
    expect(text).toMatch(/Iy_mm4 .* accepted: synthetic/);
    expect(text.trimEnd().endsWith("OK")).toBe(true);
  });

  it("exits 1 and names the stale override", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/catalog.json"), (d) => {
      at(d, "items", "TS4080").Ix_mm4 = 650000;
    });
    const r = await capture(["catalog", "check", join(root, "test"), "--json"]);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.out.join("\n")) as { ok: boolean; diagnostics: { code: string }[] };
    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((d) => d.code)).toEqual(["override-stale"]);
  });

  it("shows a merged item with its sources, corrections, section and offers", async () => {
    const r = await capture(["catalog", "show", "test:TS4080", "--catalog", fixture("test")]);
    expect(r.code).toBe(0);
    const shown = JSON.parse(r.out.join("\n"));
    expect(shown.id).toBe("test:TS4080");
    expect(shown.item.Ix_mm4.v).toBe(655000);
    expect(shown.corrected).toHaveLength(2);
    expect(shown.sources.Ix_mm4).toMatch(/overrides\.json \(layer 3\)$/);
    expect(shown.section).toMatchObject({
      id: "test:TS4080",
      fidelity: "parametric",
      props_ok: false,
    });
    expect(shown.offers.map((o: { sku: string }) => o.sku)).toEqual([
      "test:TS4080-c7",
      "test:TS4080-pp-c7",
    ]);
    expect(
      (await capture(["catalog", "show", "test:NOPE", "--catalog", fixture("test")])).code,
    ).toBe(1);
  });

  it("prints the JSON Schemas", async () => {
    const one = await capture(["catalog", "schema", "section"]);
    expect(one.code).toBe(0);
    expect(JSON.parse(one.out.join("\n")).title).toBe("alukit section");
    const all = JSON.parse((await capture(["catalog", "schema"])).out.join("\n"));
    expect(Object.keys(all)).toEqual([
      "catalog",
      "offers",
      "section",
      "family",
      "overrides",
      "item",
    ]);
    expect((await capture(["catalog", "schema", "nope"])).code).toBe(2);
  });

  it("refuses bad usage with exit 2", async () => {
    expect((await capture(["catalog"])).code).toBe(2);
    expect((await capture(["catalog", "check"])).code).toBe(2);
    expect((await capture(["catalog", "check", "x", "--frobnicate"])).code).toBe(2);
    expect((await capture(["catalog", "search", "x"])).code).toBe(2);
    expect((await capture(["catalog", "check", "no-such-catalog"])).code).toBe(1);
  });

  it("runs as a Node process, subpath imports included", () => {
    const stdout = execFileSync(
      process.execPath,
      [main, "catalog", "check", fixture("test"), "--json"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(JSON.parse(stdout).ok).toBe(true);
  });
});
