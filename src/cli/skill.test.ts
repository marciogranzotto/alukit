import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SKILL_DIR } from "./skill.ts";
import { withReference } from "./skill-reference.ts";
import { capture } from "./testing.ts";

/**
 * The skill (design §7.5): its reference is generated from the code and current, its worked
 * example runs through the CLI as written and gives the numbers the skill states, and
 * `alukit skill install` links it without replacing anything.
 */

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));
const SKILL = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");

/** The shell commands of the worked example: the fenced block between its markers. */
function workedExample(text: string): string {
  const start = text.indexOf("<!-- worked example");
  const end = text.indexOf("<!-- end of the worked example -->");
  const block = /```sh\n([\s\S]*?)```/.exec(text.slice(start, end));
  if (start < 0 || end < start || !block) throw new Error("no worked example in the skill");
  return block[1] as string;
}

/**
 * Splits shell text into commands of words: single and double quotes (which may span lines),
 * backslash-newline continuations, and `#` comments. Enough for the example; anything else (a
 * pipe, a redirect, a variable) is refused, so the example stays runnable as written.
 */
function commands(sh: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word: string | undefined;
  const endWord = () => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) out.push(words);
    words = [];
  };
  for (let i = 0; i < sh.length; i++) {
    const c = sh[i] as string;
    if (c === "'") {
      const j = sh.indexOf("'", i + 1);
      word = (word ?? "") + sh.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      let s = "";
      i++;
      while (sh[i] !== '"') {
        if (sh[i] === "\\") i++;
        s += sh[i];
        i++;
      }
      word = (word ?? "") + s;
    } else if (c === "\\" && sh[i + 1] === "\n") {
      i++;
      endWord();
    } else if (c === "\n") endCommand();
    else if (c === " " || c === "\t") endWord();
    else if (c === "#" && word === undefined) {
      while (i < sh.length && sh[i] !== "\n") i++;
      endCommand();
    } else if ("|<>;&$`".includes(c))
      throw new Error(`the example uses "${c}", which a test cannot run as written`);
    else word = (word ?? "") + c;
  }
  endCommand();
  return out;
}

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

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "alukit-skill-"));
    for (const words of commands(workedExample(SKILL))) {
      expect(words[0]).toBe("alukit");
      const args = words.slice(1);
      runs.push({ args, ...alukit(dir, args) });
    }
  }, 120_000);

  it("runs every command with exit 0", () => {
    expect(runs.length).toBeGreaterThan(10);
    for (const r of runs) expect(r.code, `alukit ${r.args.join(" ")}\n${r.err}`).toBe(0);
  });

  const pieces = (args: string[]) => {
    const cl = JSON.parse(alukit(dir, ["cutlist", "table", "--format", "json", ...args]).out);
    const out: Record<string, number> = {};
    for (const g of cl.groups) {
      expect(g.item).toBe("forseti:PF40-01");
      for (const l of g.lines) out[l.cut_mm.toFixed(2)] = (out[l.cut_mm.toFixed(2)] ?? 0) + l.count;
    }
    return out;
  };

  it("gives the cut lists, the check and the verification the skill states", () => {
    expect(pieces([])).toEqual({ "750.00": 4, "920.00": 2, "520.00": 2 });
    expect(pieces(["--variant", "tall"])).toEqual({ "900.00": 4, "920.00": 4, "520.00": 2 });
    const check = JSON.parse(alukit(dir, ["check", "table", "--variant", "tall", "--json"]).out);
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
