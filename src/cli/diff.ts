import { readFile, stat } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { parseJson } from "#catalog/json.ts";
import { isDate, localDate } from "#core/dates.ts";
import { jsonText } from "#core/derive/output.ts";
import { selectedVariant, variantsOf } from "#core/derive/variant.ts";
import { type DiffSide, diffSides } from "#core/diff/diff.ts";
import { diffMarkdown } from "#core/diff/format.ts";
import { compareIds } from "#core/ids.ts";
import { LOCK_FILE, type Lock, LockFile } from "#core/lock/schema.ts";
import { lockItems } from "#core/lock/source.ts";
import { gitShow } from "#core/project/git.ts";
import { DOCUMENT } from "#core/project/open.ts";
import { PROJECT_SCHEMA } from "#core/project/schema.ts";
import { projectOutputs } from "#core/revision/outputs.ts";
import {
  REVISION_SCHEMA,
  type Revision,
  readRevision,
  storedOutputs,
} from "#core/revision/revision.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { publishUsageOf } from "./publish-usage.ts";
import { revisionFile } from "./revision.ts";

/**
 * `alukit diff <a> [<b>]` (design §4.13, §4.10, §7.3): what moved between two sides. A side is
 * a project folder or its `alukit.json`, a revision file, `rev:<name>` (a revision of the project
 * in the current folder), or `git:<ref>:<path>` (the folder or file as committed at that ref).
 * Each side derives with its own lock, never the live catalogs, so a price changed between two
 * commits shows as a lock change and as its effect; a revision gives its stored outputs. With
 * one side, two `--variant` compare two variants of it. Read only. Exit 0 with the report, 1
 * when a side cannot be read, 2 on a usage error.
 */

const USAGE = publishUsageOf("diff");

/** A side as read: its document and lock, or a revision. */
interface Source {
  label: string;
  document: unknown;
  lock: Lock;
  revision?: Revision;
}

class SideError extends Error {}

function jsonOf(text: string, where: string): unknown {
  const p = parseJson(text);
  if (!p.ok) {
    const first = p.problems[0];
    throw new SideError(
      `${where}${first?.line ? `:${first.line}` : ""}: ${first?.message ?? "not JSON"}`,
    );
  }
  return p.value;
}

function lockOf(json: unknown, where: string): Lock {
  const r = LockFile.safeParse(json);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new SideError(
      `${where}: not a lock file (${i ? `${i.path.join("/")}: ${i.message}` : "invalid"})`,
    );
  }
  return r.data;
}

function schemaOf(json: unknown): unknown {
  return typeof json === "object" && json !== null
    ? (json as { schema?: unknown }).schema
    : undefined;
}

/** A document, a lock or a revision, read by `read(path)` relative to a project folder. */
async function fromFiles(
  label: string,
  path: string,
  isFile: boolean,
  read: (p: string) => Promise<string>,
  join2: (a: string, b: string) => string,
  dir2: (p: string) => string,
): Promise<Source> {
  const docPath = isFile ? path : join2(path, DOCUMENT);
  const json = jsonOf(await read(docPath), docPath);
  if (schemaOf(json) === REVISION_SCHEMA) {
    const r = readRevision(json);
    if (!r.ok) throw new SideError(`${docPath}: not a revision: ${r.problems[0]}`);
    return { label, document: r.value.document, lock: r.value.lock, revision: r.value };
  }
  if (schemaOf(json) !== PROJECT_SCHEMA) {
    throw new SideError(
      `${docPath}: neither a project (${PROJECT_SCHEMA}) nor a revision (${REVISION_SCHEMA})`,
    );
  }
  const lockPath = join2(isFile ? dir2(path) : path, LOCK_FILE);
  let lockText: string;
  try {
    lockText = await read(lockPath);
  } catch {
    throw new SideError(
      `${lockPath}: no lock beside the document; each side derives with its own (alukit lock update writes one)`,
    );
  }
  return { label, document: json, lock: lockOf(jsonOf(lockText, lockPath), lockPath) };
}

async function readSide(spec: string, cwd: string): Promise<Source> {
  if (spec.startsWith("git:")) {
    const rest = spec.slice("git:".length);
    const at = rest.indexOf(":");
    if (at <= 0) throw new SideError(`${spec}: write git:<ref>:<path>`);
    const ref = rest.slice(0, at);
    const path = rest.slice(at + 1) || ".";
    const read = async (p: string) => {
      try {
        return await gitShow(cwd, ref, p);
      } catch (e) {
        throw new SideError(`${spec}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    return fromFiles(spec, path, path.endsWith(".json"), read, posix.join, posix.dirname);
  }
  if (spec.startsWith("rev:")) {
    const path = revisionFile(cwd, spec.slice("rev:".length));
    return fromFiles(spec, path, true, (p) => readText(p), join, dirname);
  }
  const path = resolve(cwd, spec);
  let isFile: boolean;
  try {
    isFile = (await stat(path)).isFile();
  } catch {
    throw new SideError(`${spec}: no such file or folder`);
  }
  return fromFiles(spec, path, isFile, (p) => readText(p), join, dirname);
}

async function readText(p: string): Promise<string> {
  try {
    return await readFile(p, "utf8");
  } catch (e) {
    throw new SideError(`cannot read ${p}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function variantProblem(s: Source, variant: string | undefined): string | undefined {
  if (variant === undefined) return undefined;
  if (s.revision) {
    return storedOutputs(s.revision, variant)
      ? undefined
      : `${s.label}: the revision stores no variant ${variant}`;
  }
  if (selectedVariant(s.document, variant) !== undefined) return undefined;
  const names = Object.keys(variantsOf(s.document)?.list ?? {}).sort(compareIds);
  return `${s.label}: there is no variant ${variant}; ${names.length === 0 ? "it has none" : `it has ${names.join(", ")}`}`;
}

function sideOf(s: Source, variant: string | undefined, asOf: string): DiffSide {
  if (s.revision) {
    const stored = storedOutputs(s.revision, variant);
    if (!stored)
      throw new SideError(
        `${s.label}: the revision stores no outputs for the document without a variant`,
      );
    return { label: s.label, document: s.document, lock: s.lock, outputs: stored, stored: true };
  }
  const outputs = projectOutputs({
    raw: s.document,
    items: lockItems(s.lock),
    lock: s.lock,
    variant,
    asOf,
  });
  return { label: s.label, document: s.document, lock: s.lock, outputs };
}

export async function diffCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "diff",
    argv,
    {
      variant: { type: "string", multiple: true },
      "as-of": { type: "string" },
      format: { type: "string" },
      json: { type: "boolean" },
    },
    USAGE,
    io,
  );
  if (args === 2) return 2;
  const pos = args.positionals;
  const variants = args.values.variant ?? [];
  if (pos.length === 0 || pos.length > 2) {
    return usageError("diff", "name one side (with two --variant) or two sides", USAGE, io);
  }
  if (pos.length === 1 && variants.length !== 2) {
    return usageError(
      "diff",
      "one side compares two of its variants: give --variant twice",
      USAGE,
      io,
    );
  }
  if (variants.length > 2) return usageError("diff", "at most two --variant", USAGE, io);
  const format = args.values.json ? "json" : (args.values.format ?? "md");
  if (format !== "md" && format !== "json") {
    return usageError("diff", "--format takes md or json", USAGE, io);
  }
  const asOfArg = args.values["as-of"];
  if (asOfArg !== undefined && !isDate(asOfArg)) {
    return usageError("diff", "--as-of takes a date, YYYY-MM-DD", USAGE, io);
  }

  const first = pos[0] as string;
  const specs: [string, string] = [first, pos[1] ?? first];
  const vs: [string | undefined, string | undefined] =
    variants.length === 2 ? [variants[0], variants[1]] : [variants[0], variants[0]];
  const cwd = process.cwd();
  try {
    const a = await readSide(specs[0], cwd);
    const b = pos.length === 1 ? a : await readSide(specs[1], cwd);
    const problems = [variantProblem(a, vs[0]), variantProblem(b, vs[1])].filter(
      (p): p is string => p !== undefined,
    );
    if (problems.length > 0) {
      for (const p of problems) io.err(`alukit diff: ${p}`);
      return 1;
    }
    // A revision's outputs are as of its own date; a side derived now is judged on the same one.
    const asOf = asOfArg ?? a.revision?.as_of ?? b.revision?.as_of ?? localDate();
    const report = diffSides(sideOf(a, vs[0], asOf), sideOf(b, vs[1], asOf));
    io.out((format === "json" ? jsonText(report) : diffMarkdown(report)).trimEnd());
    return 0;
  } catch (e) {
    if (e instanceof SideError) {
      io.err(`alukit diff: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
