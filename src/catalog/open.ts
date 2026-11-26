import { readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Diagnostic, sortDiagnostics } from "./diagnostics.ts";
import { isCatalogDir, readCatalogDir } from "./fs.ts";
import { type CatalogSet, itemRefs, linkCatalogs, offerRefs, sectionRefs } from "./link.ts";
import { type LoadedCatalog, loadCatalog, splitRef } from "./load.ts";

/**
 * Opening a catalog from disk with every catalog it references (Node only). A catalog named by
 * id is found, in order, among the folders given explicitly, beside the target catalog, and in
 * the built-in `catalogs/` of this repository; a folder found by id must declare that id.
 */

/** The built-in catalogs (design §3.1). */
export const BUILTIN_DIR = fileURLToPath(new URL("../../catalogs", import.meta.url));

export interface OpenOptions {
  /** Further catalog folders to load. */
  extra?: readonly string[];
  /** Where built-in catalogs live; defaults to the repository's catalogs/. */
  builtinDir?: string;
  /** The working directory paths are shown relative to; defaults to process.cwd(). */
  cwd?: string;
}

export interface Opened {
  set: CatalogSet;
  /** The target's id, when it loaded. */
  target?: string;
  diagnostics: Diagnostic[];
}

function shown(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel === "" ? "." : rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

/** The catalog ids a loaded catalog refers to, other than its own. */
function referencedCatalogs(cat: LoadedCatalog): Set<string> {
  const out = new Set<string>();
  const note = (ref: string) => {
    const { catalog } = splitRef(ref, cat.id);
    if (catalog !== cat.id) out.add(catalog);
  };
  for (const li of cat.items.values()) for (const s of itemRefs(li.item)) note(s.ref);
  for (const o of cat.offers.values()) for (const s of offerRefs(o)) note(s.ref);
  for (const s of cat.sections.values()) for (const r of sectionRefs(s.section)) note(r.ref);
  for (const sys of cat.systems.values()) if (sys.type === "tslot") note(sys.groove);
  return out;
}

/** Opens the catalog at `target` (a folder, or a built-in id) and what it references. */
export async function openCatalog(target: string, options: OpenOptions = {}): Promise<Opened> {
  const cwd = options.cwd ?? process.cwd();
  const builtin = options.builtinDir ?? BUILTIN_DIR;
  const diagnostics: Diagnostic[] = [];
  const loaded: LoadedCatalog[] = [];
  const byId = new Map<string, LoadedCatalog>();

  const load = async (dir: string, expectId?: string): Promise<LoadedCatalog | undefined> => {
    const r = loadCatalog(await readCatalogDir(dir, shown(dir, cwd)));
    diagnostics.push(...r.diagnostics);
    if (!r.catalog) return undefined;
    if (expectId !== undefined && r.catalog.id !== expectId) {
      diagnostics.push({
        severity: "error",
        code: "catalog-id-mismatch",
        entity: expectId,
        files: [`${r.catalog.dir}/catalog.json`],
        message: `the folder for catalog "${expectId}" declares the id "${r.catalog.id}"`,
      });
      return undefined;
    }
    loaded.push(r.catalog);
    if (!byId.has(r.catalog.id)) byId.set(r.catalog.id, r.catalog);
    return r.catalog;
  };

  let targetDir = resolve(cwd, target);
  if (!(await isCatalogDir(targetDir))) {
    const named = join(builtin, target);
    if (!/[/\\]/.test(target) && (await isCatalogDir(named))) targetDir = named;
    else {
      diagnostics.push({
        severity: "error",
        code: "catalog-not-found",
        files: [],
        message: `no catalog folder at "${target}", and no built-in catalog with that id`,
      });
      return { set: linkCatalogs([]).set, diagnostics };
    }
  }
  const main = await load(targetDir);
  for (const dir of options.extra ?? []) await load(resolve(cwd, dir));

  // Load referenced catalogs until nothing new is named.
  const siblings = dirname(targetDir);
  const tried = new Set<string>();
  for (;;) {
    const wanted = [...new Set(loaded.flatMap((c) => [...referencedCatalogs(c)]))].filter(
      (id) => !byId.has(id) && !tried.has(id),
    );
    if (wanted.length === 0) break;
    for (const id of wanted.sort()) {
      tried.add(id);
      const candidates = [join(siblings, id), join(builtin, id)];
      for (const dir of candidates) {
        if (await isCatalogDir(dir)) {
          await load(dir, id);
          break;
        }
      }
    }
  }

  const linked = linkCatalogs(loaded);
  diagnostics.push(...linked.diagnostics);
  return {
    set: linked.set,
    ...(main ? { target: main.id } : {}),
    diagnostics: sortDiagnostics(diagnostics),
  };
}

/** The ids of the built-in catalogs present. */
export async function builtinIds(builtinDir: string = BUILTIN_DIR): Promise<string[]> {
  try {
    const names = await readdir(builtinDir);
    const out: string[] = [];
    for (const n of names.sort())
      if (await isCatalogDir(join(builtinDir, n))) out.push(basename(n));
    return out;
  } catch {
    return [];
  }
}
