import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogSource } from "./load.ts";

/**
 * Reading catalog folders from disk (Node only; the loader itself is pure). Directory listings
 * are sorted by code point, so every machine reads files in the same order (design §5.2).
 */

const TOP = ["catalog.json", "offers.json", "overrides.json"];
const SUBDIRS = ["sections", "families"];

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Reads the files the loader uses from a catalog folder. `display` names the folder in
 * messages; it defaults to `dir` as given.
 */
export async function readCatalogDir(dir: string, display: string = dir): Promise<CatalogSource> {
  const files = new Map<string, string>();
  for (const name of TOP) {
    try {
      files.set(name, await readFile(join(dir, name), "utf8"));
    } catch {
      // Absent: offers.json and overrides.json are optional; the loader reports a missing catalog.json.
    }
  }
  for (const sub of SUBDIRS) {
    if (!(await isDir(join(dir, sub)))) continue;
    const names = (await readdir(join(dir, sub))).filter((n) => n.endsWith(".json")).sort(cmp);
    for (const name of names)
      files.set(`${sub}/${name}`, await readFile(join(dir, sub, name), "utf8"));
  }
  return { dir: display.replace(/\/+$/, "") || ".", files };
}

/** True when `dir` holds a catalog.json. */
export async function isCatalogDir(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, "catalog.json"))).isFile();
  } catch {
    return false;
  }
}
