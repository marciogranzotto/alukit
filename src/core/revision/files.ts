import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseJson } from "#catalog/json.ts";
import { jsonText } from "../derive/output.ts";
import { writeAtomic } from "../project/store.ts";
import type { Outputs } from "./outputs.ts";
import {
  makeRevision,
  REVISION_SCHEMA,
  REVISIONS_DIR,
  type Revision,
  readRevision,
  revisionSlug,
  type SaveInput,
  type Stamp,
} from "./revision.ts";

/**
 * Revision files in a project folder (design §4.13), read and written by the CLI and by the
 * server that owns the project (Node only). `revisions/<slug>.json`; a saved revision is never
 * overwritten.
 */

/** The file a revision's name gives, relative to the project folder. */
export function revisionFileName(name: string): string {
  return join(REVISIONS_DIR, `${revisionSlug(name)}.json`);
}

export function revisionPath(root: string, name: string): string {
  return join(root, revisionFileName(name));
}

/**
 * Why a file is not a revision: `problems` are sentences about the file (a caller prefixes them
 * with its own name); `details`, when present, list the schema's complaints under the last one.
 */
export interface RevisionUnreadable {
  ok: false;
  problems: string[];
  details?: string[];
}

/** Reads and checks a revision file. `shown` is how a message names it (the path by default). */
export async function readRevisionFile(
  path: string,
  shown = path,
): Promise<{ ok: true; value: Revision } | RevisionUnreadable> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    return {
      ok: false,
      problems: [`cannot read ${shown}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return {
      ok: false,
      problems: parsed.problems.map((p) => `${shown}${p.line ? `:${p.line}` : ""}: ${p.message}`),
    };
  }
  const r = readRevision(parsed.value);
  if (!r.ok) {
    return {
      ok: false,
      problems: [`${shown} is not a revision (${REVISION_SCHEMA}):`],
      details: r.problems,
    };
  }
  return { ok: true, value: r.value };
}

export async function revisionExists(root: string, name: string): Promise<boolean> {
  try {
    await access(revisionPath(root, name));
    return true;
  } catch {
    return false;
  }
}

/** The revision files of a project, by file name; none when it has no `revisions/` folder. */
export async function revisionFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(join(root, REVISIONS_DIR))).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/** How a variant is named in a revision's summaries: the document as written has none. */
export const variantLabel = (v: string | undefined): string => v ?? "(no variant)";

/** What one variant's stored outputs come to: `revision save` and `show` print it, the app lists it. */
export interface OutputSummary {
  variant: string;
  bars: number;
  pieces: number;
  mass_kg: number;
  status: string;
  currency: string | null;
  total: { low_minor: number; likely_minor: number; high_minor: number };
}

export function outputSummary(o: Outputs): OutputSummary {
  const t = o.order.totals.total;
  return {
    variant: variantLabel(o.variant),
    bars: Object.keys((o.derived.bars as Record<string, unknown> | undefined) ?? {}).length,
    pieces: o.cutlist.groups.reduce((n, g) => n + g.pieces, 0),
    mass_kg: o.bom.mass_kg,
    status: o.order.status,
    currency: o.order.currency ?? null,
    total: { low_minor: t.low_minor, likely_minor: t.likely_minor, high_minor: t.high_minor },
  };
}

/** What `alukit revision save --json` prints about a saved revision. */
export interface Saved {
  file: string;
  name: string;
  as_of: string;
  stamp: Stamp;
  variants: string[];
  /** Errors in the stored check reports, every variant's together. */
  errors: number;
}

export function savedAnswer(file: string, rev: Revision): Saved {
  return {
    file,
    name: rev.name,
    as_of: rev.as_of,
    stamp: rev.stamp,
    variants: rev.outputs.map((o) => variantLabel(o.variant)),
    errors: rev.outputs.reduce(
      (n, o) => n + o.check.diagnostics.filter((d) => d.severity === "error").length,
      0,
    ),
  };
}

export type SaveResult =
  | { ok: true; file: string; rev: Revision }
  | { ok: false; kind: "name" | "exists"; message: string };

/**
 * Saves a revision of a document and its lock: makes it (every variant's outputs, the stamp) and
 * writes it atomically, unless a file already has its name. The caller holds the edit lock
 * (§7.1), so no other writer can take the name between the check and the write.
 */
export async function saveRevision(root: string, input: SaveInput): Promise<SaveResult> {
  if (revisionSlug(input.name) === "") {
    return {
      ok: false,
      kind: "name",
      message: `"${input.name}" has no letter or digit to name a file`,
    };
  }
  const file = revisionFileName(input.name);
  if (await revisionExists(root, input.name)) {
    return {
      ok: false,
      kind: "exists",
      message: `${file} exists; a revision is never overwritten`,
    };
  }
  const rev = makeRevision(input);
  await mkdir(join(root, REVISIONS_DIR), { recursive: true });
  await writeAtomic(join(root, file), jsonText(rev));
  return { ok: true, file, rev };
}
