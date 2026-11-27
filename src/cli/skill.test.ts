import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SKILL_DIR } from "./skill.ts";
import { exampleCommands, workedExample } from "./skill-example.ts";
import { withReference } from "./skill-reference.ts";
import { capture } from "./testing.ts";

/**
 * The skill (design §7.5): its reference is generated from the code and current, its worked
 * example runs through the CLI as written and gives the numbers the skill states, and
 * `alukit skill install` links it without replacing anything.
 */

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));
const SKILL = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");

/** Runs `alukit <args>` as a process in `cwd`, as a person would. */
function alukit(cwd: string, args: readonly string[]) {
  const r = spawnSync(process.execPath, [MAIN, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("the skill (§7.5)", () => {
  it("carries the reference generated from the CLI and the command schemas", () => {
    expect(withReference(SKILL)).toBe(SKILL);
    expect(SKILL).toMatch(/^---\nname: alukit\ndescription: /);
    for (const cmd of ["addBar", "addConnection", "addVariant", "setParam", "removeEntity"]) {
      expect(SKILL).toContain(`**\`${cmd}\`**`);
    }
    expect(SKILL).toContain("alukit revision verify [<dir>] <name>");
  });

  it("keeps to generic, public content", () => {
    expect(SKILL).not.toMatch(/\/Users\/|\/home\/|C:\\\\/);
  });
});

describe("the skill's worked example, run as written", () => {
  let dir: string;
  const runs: { args: string[]; code: number | null; out: string; err: string }[] = [];

  /** Commands that need the built app: the end-to-end suite runs them (snapshot.spec.ts). */
  const later: string[][] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "alukit-skill-"));
    for (const words of exampleCommands(workedExample(SKILL))) {
      expect(words[0]).toBe("alukit");
      const args = words.slice(1);
      if (args[0] === "snapshot") later.push(args);
      else runs.push({ args, ...alukit(dir, args) });
    }
  }, 120_000);

  it("runs every command with exit 0", () => {
    expect(runs.length).toBeGreaterThan(10);
    for (const r of runs) expect(r.code, `alukit ${r.args.join(" ")}\n${r.err}`).toBe(0);
    // It looks at what it built: a snapshot, which the end-to-end suite runs.
    expect(later).toEqual([
      ["snapshot", "table", "-o", "table/exports/table.png", "--view", "iso"],
    ]);
  });

  // The example's own commands run above as processes, as written. The probes below only read
  // what they built, so they run the same CLI in-process: process start-up isn't what they test.
  const pieces = async (args: string[]) => {
    const r = await capture(["cutlist", join(dir, "table"), "--format", "json", ...args]);
    const cl = JSON.parse(r.out);
    const out: Record<string, number> = {};
    for (const g of cl.groups) {
      expect(g.item).toBe("forseti:PF40-01");
      for (const l of g.lines) out[l.cut_mm.toFixed(2)] = (out[l.cut_mm.toFixed(2)] ?? 0) + l.count;
    }
    return out;
  };

  it("gives the cut lists, the check and the verification the skill states", async () => {
    expect(await pieces([])).toEqual({ "750.00": 4, "920.00": 2, "520.00": 2 });
    expect(await pieces(["--variant", "tall"])).toEqual({ "900.00": 4, "920.00": 4, "520.00": 2 });
    const check = JSON.parse(
      (await capture(["check", join(dir, "table"), "--variant", "tall", "--json"])).out,
    );
    expect(check.ok).toBe(true);
    expect(check.checks).toEqual([expect.objectContaining({ id: "C1", pass: true, margin: 100 })]);
    const verify = runs.find((r) => r.args[0] === "revision" && r.args[1] === "verify");
    expect(verify?.out).toContain("zero drift in 2 variants");
    const diff = runs.find((r) => r.args[0] === "diff");
    expect(diff?.out).toContain("| H | 750 → 900 (+150) |");
    expect(existsSync(join(dir, "table", "exports", "table.glb"))).toBe(true);
  });
});

describe("alukit skill install", () => {
  it("links the skill, leaves its own link alone, and refuses to replace anything else", async () => {
    const skills = join(await mkdtemp(join(tmpdir(), "alukit-skills-")), "skills");
    const first = await capture(["skill", "install", "--dir", skills]);
    expect(first.code).toBe(0);
    expect(realpathSync(join(skills, "alukit"))).toBe(realpathSync(SKILL_DIR));
    expect(await readlink(join(skills, "alukit"))).toBe(SKILL_DIR);
    const again = await capture(["skill", "install", "--dir", skills]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("already links to");

    const other = join(await mkdtemp(join(tmpdir(), "alukit-skills-")), "skills");
    await mkdir(other);
    await symlink(tmpdir(), join(other, "alukit"));
    const elsewhere = await capture(["skill", "install", "--dir", other]);
    expect(elsewhere.code).toBe(1);
    expect(elsewhere.err).toContain("remove it first");

    const file = join(await mkdtemp(join(tmpdir(), "alukit-skills-")), "skills");
    await mkdir(file);
    await writeFile(join(file, "alukit"), "mine\n");
    const taken = await capture(["skill", "install", "--dir", file]);
    expect(taken.code).toBe(1);
    expect(readFileSync(join(file, "alukit"), "utf8")).toBe("mine\n");
  });
});
