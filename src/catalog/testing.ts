import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckReport, checkCatalog } from "./check.ts";
import { type Opened, openCatalog } from "./open.ts";

/** Helpers for tests: a scratch copy of the fixture catalogs that a test may patch. */

export const FIXTURES = fileURLToPath(new URL("../../tests/fixtures/catalogs", import.meta.url));

/** A fresh copy of tests/fixtures/catalogs; returns the folder holding `test/` and `ref-test/`. */
export async function fixtureCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "alukit-catalogs-"));
  await cp(FIXTURES, dir, { recursive: true });
  return dir;
}

/** Rewrites a JSON file through `edit`. */
export async function patchJson(
  path: string,
  edit: (data: Record<string, unknown>) => void,
): Promise<void> {
  const data = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  edit(data);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Opens and checks the `test` catalog under `root`, naming files relative to `root`. */
export async function checkTest(
  root: string,
  extra: string[] = [],
): Promise<Opened & { report: CheckReport }> {
  const opened = await openCatalog(join(root, "test"), { cwd: root, extra });
  const report = checkCatalog(opened.set, opened.target ?? "test", opened.diagnostics);
  return { ...opened, report };
}

/** An object path into parsed JSON, for patches. */
// biome-ignore lint/suspicious/noExplicitAny: test patches reach into untyped JSON
export function at(data: Record<string, unknown>, ...keys: string[]): any {
  // biome-ignore lint/suspicious/noExplicitAny: as above
  let cur: any = data;
  for (const k of keys) cur = cur[k];
  return cur;
}
