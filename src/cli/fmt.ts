import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseJson } from "#catalog/json.ts";
import { canonicalText } from "#core/canonical.ts";
import { LOCK_CANONICAL, LOCK_FILE } from "#core/lock/schema.ts";
import { projectText } from "#core/project/canonical.ts";
import { DOCUMENT } from "#core/project/open.ts";
import { withEditLock, writeAtomic } from "#core/project/store.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit fmt <dir>... [--check]` (design §2, §7.3): rewrites a project's document and lock into
 * canonical form. `--check` writes nothing and exits 1 when a file would change, for CI.
 */

const FMT_USAGE = usageOf("fmt");

interface FileResult {
  path: string;
  /** The canonical text, or undefined when the file could not be read as JSON. */
  canonical?: string;
  changed: boolean;
  problems: string[];
}

async function formatFile(
  dir: string,
  name: string,
  format: (value: unknown) => string,
  optional: boolean,
): Promise<FileResult | undefined> {
  const path = join(dir, name);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if (optional && (e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return { path, changed: false, problems: [`cannot read: ${(e as Error).message}`] };
  }
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return {
      path,
      changed: false,
      problems: parsed.problems.map((p) => `${p.line ? `${p.line}:${p.col}: ` : ""}${p.message}`),
    };
  }
  const canonical = format(parsed.value);
  return { path, canonical, changed: canonical !== text, problems: [] };
}

export async function fmtCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions("fmt", argv, { check: { type: "boolean" } }, FMT_USAGE, io);
  if (args === 2) return 2;
  const dirs = args.positionals;
  if (dirs.length === 0) return usageError("fmt", "a project folder is needed", FMT_USAGE, io);
  const check = args.values.check === true;

  let failed = false;
  let changed = 0;
  for (const dir of dirs) {
    const files = [
      await formatFile(dir, DOCUMENT, projectText, false),
      await formatFile(dir, LOCK_FILE, (v) => canonicalText(v, LOCK_CANONICAL), true),
    ].filter((f): f is FileResult => f !== undefined);
    for (const f of files) {
      for (const p of f.problems) {
        io.err(`${f.path}: ${p}`);
        failed = true;
      }
    }
    const todo = files.filter((f) => f.changed && f.canonical !== undefined);
    changed += todo.length;
    if (check) {
      for (const f of todo) io.out(`would reformat ${f.path}`);
      continue;
    }
    if (todo.length === 0) continue;
    await withEditLock(dir, async () => {
      for (const f of todo) await writeAtomic(f.path, f.canonical as string);
    });
    for (const f of todo) io.out(`formatted ${f.path}`);
  }
  if (check && changed > 0) {
    io.err(`${changed} file${changed === 1 ? "" : "s"} not in canonical form; run alukit fmt`);
    return 1;
  }
  return failed ? 1 : 0;
}
