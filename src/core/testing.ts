import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Diagnostic } from "./diagnostics.ts";

/** Helpers for the geometry core's fixture tests. */

export const FIXTURES = fileURLToPath(new URL("../../tests/fixtures", import.meta.url));

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function subdirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name))
    .sort();
}

/** Every project folder under tests/fixtures. */
export function fixtureProjects(): string[] {
  return [
    join(FIXTURES, "cart"),
    ...subdirs(join(FIXTURES, "golden-ends")),
    ...subdirs(join(FIXTURES, "golden-gen")),
    join(FIXTURES, "order"),
    join(FIXTURES, "base-frame", "empty"),
    join(FIXTURES, "base-frame", "cli"),
    join(FIXTURES, "brace"),
  ];
}

/**
 * A scratch copy of tests/fixtures (catalogs and projects keep their relative paths), for tests
 * that write or change files. Returns the copy's root.
 */
export async function scratchFixtures(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "alukit-fixtures-"));
  await cp(FIXTURES, dir, { recursive: true });
  return dir;
}

/** Rewrites a JSON file through `edit`. */
// biome-ignore lint/suspicious/noExplicitAny: test edits reach into untyped JSON
export async function editJson(path: string, edit: (data: any) => void): Promise<void> {
  const data = JSON.parse(await readFile(path, "utf8"));
  edit(data);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** An RFC 7396 merge patch: objects merge key by key, `null` deletes, anything else replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> =
    typeof target === "object" && target !== null && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

/**
 * The lock a project's outputs state (design §5.4, §4.13): sha256 of its lock file's bytes, which
 * any sha256 tool gives for a canonical lock. Taken here on the file, not through AluKit.
 */
export function lockStamp(dir: string): string {
  const bytes = readFileSync(join(dir, "alukit.lock.json"));
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * A golden output's JSON text with the stamp's lines added after the top-level line of `after`:
 * what AluKit prints for it when it derives from a lock. The golden file holds the values; the
 * stamp (the lock, and the oldest price read date where the output carries prices) says where
 * they came from, so it is added here rather than written into the golden.
 */
export function withStamp(
  golden: string,
  after: string,
  stamp: Readonly<Record<string, string | null>>,
): string {
  const line = new RegExp(`^( {2}"${after}": .*\\n)`, "m");
  if (!line.test(golden)) throw new Error(`the golden has no top-level "${after}"`);
  const lines = Object.entries(stamp)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`)
    .join("");
  return golden.replace(line, `$1${lines}`);
}

/**
 * By hand, with no AluKit: the oldest read date of the offers a cut list chose (a supplier-cut
 * group's offer, a nested group's stock bars), as the project's lock file pins them; null when it
 * chose none.
 */
export function oldestCutRead(
  cutlist: { groups: readonly { offer?: string; stock?: readonly { sku: string }[] }[] },
  dir: string,
): string | null {
  const lock = JSON.parse(readFileSync(join(dir, "alukit.lock.json"), "utf8")) as {
    offers: Record<string, { offer: { price: { read?: string } } }>;
  };
  const skus = cutlist.groups.flatMap((g) => [
    ...(g.offer ? [g.offer] : []),
    ...(g.stock ?? []).map((s) => s.sku),
  ]);
  const reads = skus.flatMap((s) => {
    const read = lock.offers[s]?.offer.price.read;
    return read ? [read] : [];
  });
  return reads.sort()[0] ?? null;
}

/** Diagnostics of one severity as comparable `{ code, entity, refs }` records. */
export function shown(ds: readonly Diagnostic[], severity: Diagnostic["severity"]) {
  return ds
    .filter((d) => d.severity === severity)
    .map((d) => ({ code: d.code, entity: d.entity, refs: d.refs, message: d.message }));
}

/**
 * The batch that builds the 1,008-bar lattice in tests/fixtures/ux/lattice (review M6), the
 * large project the editing review timed a Move on: one box frame of 500 mm (`addFrame`, 12
 * bars, 8 butts), copied to 12 along X at 700 (`array`), and that row to 7 along Y: 1,008 bars
 * and 672 butts, made by the commands a person would send, not written by hand.
 */
export function latticeBatch(): object[] {
  const ids = (bars: number, butts: number) => [
    ...Array.from({ length: bars }, (_, i) => `b${i + 1}`),
    ...Array.from({ length: butts }, (_, i) => `c${i + 1}`),
  ];
  return [
    { cmd: "addFrame", args: { at: [0, 0, 0], size: [500, 500, 500] } },
    {
      cmd: "array",
      args: { ids: ids(12, 8), along: { dir: [1, 0, 0] }, pitch_mm: 700, count: 12 },
    },
    {
      cmd: "array",
      args: { ids: ids(144, 96), along: { dir: [0, 1, 0] }, pitch_mm: 700, count: 7 },
    },
  ];
}
