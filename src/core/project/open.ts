import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseJson } from "#catalog/json.ts";
import { type CatalogSet, linkCatalogs } from "#catalog/link.ts";
import { BUILTIN_DIR, openCatalog } from "#catalog/open.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { catalogItems, type ItemSource } from "../items.ts";

/**
 * Opening a project folder from disk (Node only; derive itself is pure). Reads `alukit.json`
 * strictly (a duplicate key is an error, as for catalogs) and opens the catalogs it names: a
 * built-in id, or a folder path relative to the project (§3.1).
 */

export const DOCUMENT = "alukit.json";

export interface OpenedProject {
  dir: string;
  /** The parsed JSON, or undefined when the file could not be read or parsed. */
  raw: unknown;
  items: ItemSource;
  /** Problems with the file or its catalogs; derive adds the document's own. */
  diagnostics: Diagnostic[];
}

/** A catalog entry is a folder path (relative to the project) rather than a built-in id. */
export function isPath(name: string): boolean {
  return name.startsWith(".") || name.includes("/") || name.includes("\\");
}

export async function openProject(
  dir: string,
  builtinDir: string = BUILTIN_DIR,
): Promise<OpenedProject> {
  const diagnostics: Diagnostic[] = [];
  const file = join(dir, DOCUMENT);
  let raw: unknown;
  try {
    const parsed = parseJson(await readFile(file, "utf8"));
    if (parsed.ok) raw = parsed.value;
    else {
      for (const p of parsed.problems) {
        diagnostics.push({
          severity: "error",
          code: "json",
          message: `${DOCUMENT}${p.line ? `:${p.line}:${p.col}` : ""}: ${p.message}`,
        });
      }
    }
  } catch (e) {
    diagnostics.push({
      severity: "error",
      code: "json",
      message: `cannot read ${DOCUMENT}: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const live = await openLiveCatalogs(dir, raw, builtinDir);
  diagnostics.push(...live.diagnostics);
  return { dir, raw, items: catalogItems(live.set), diagnostics };
}

/**
 * The live catalogs a document names (§3.1), linked, with their errors as `catalog`
 * diagnostics. The lock pins from these (§4.13); derive reads the lock. `named` holds the ids of
 * the catalogs the document names, apart from those linked in only because they are referenced.
 */
export async function openLiveCatalogs(
  dir: string,
  raw: unknown,
  builtinDir: string = BUILTIN_DIR,
): Promise<{ set: CatalogSet; diagnostics: Diagnostic[]; named: string[] }> {
  const diagnostics: Diagnostic[] = [];
  const names =
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as { catalogs?: unknown }).catalogs)
      ? ((raw as { catalogs: unknown[] }).catalogs.filter((c) => typeof c === "string") as string[])
      : [];
  const dirs = names.map((n) => (isPath(n) ? resolve(dir, n) : join(builtinDir, n)));
  if (dirs.length === 0) return { set: linkCatalogs([]).set, diagnostics, named: [] };
  const [first, ...rest] = dirs as [string, ...string[]];
  const opened = await openCatalog(first, { extra: rest, cwd: dir, builtinDir });
  for (const d of opened.diagnostics) {
    if (d.severity !== "error") continue;
    diagnostics.push({
      severity: "error",
      code: "catalog",
      ...(d.entity ? { entity: d.entity } : {}),
      message: `${d.code}: ${d.message}`,
    });
  }
  return { set: opened.set, diagnostics, named: opened.named };
}
