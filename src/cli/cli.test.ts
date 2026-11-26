import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
