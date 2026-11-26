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

/** Diagnostics of one severity as comparable `{ code, entity, refs }` records. */
export function shown(ds: readonly Diagnostic[], severity: Diagnostic["severity"]) {
  return ds
    .filter((d) => d.severity === severity)
    .map((d) => ({ code: d.code, entity: d.entity, refs: d.refs, message: d.message }));
}
