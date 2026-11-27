import type { z } from "zod";
import { type Diagnostic, issueLines, pathString } from "./diagnostics.ts";
import { parseJson } from "./json.ts";
import {
  type Collision,
  deepEqual,
  getAt,
  isBranch,
  isPlainObject,
  Merged,
  type Source,
  setAt,
  type Tree,
} from "./merge.ts";
import { isValuedObject, num, type Prov, type Valued } from "./schema/common.ts";
import {
  CatalogEnvelope,
  FamilyEnvelope,
  GrooveType,
  type GrooveType as GrooveTypeT,
  Material,
  type Material as MaterialT,
  OffersEnvelope,
  Override,
  OverridesEnvelope,
  Standard,
  type Standard as StandardT,
  System,
  type System as SystemT,
} from "./schema/files.ts";
import { Item } from "./schema/items.ts";
import { Offer } from "./schema/offers.ts";
import { SectionFile } from "./schema/section.ts";

/**
 * Loading one catalog folder (design §3.1): parse its files, merge the three layers field by
 * field, and check each merged entity against its schema. Pure: the files come in as text, so
 * the same code runs in Node and in the browser. Never throws on content; every problem is a
 * diagnostic, and whatever is valid still loads.
 */

/** A catalog folder's files, by path relative to the folder ("catalog.json", "sections/x.json"). */
export interface CatalogSource {
  /** How the folder is named in messages: the path as the user gave it. */
  dir: string;
  files: ReadonlyMap<string, string>;
}

export interface Correction {
  field: string;
  was: unknown;
  now: unknown;
  why: string;
  src: string;
  ref?: string;
  read?: string;
  by?: string;
}

export interface Acceptance {
  field: string;
  why: string;
  by?: string;
}

export interface LoadedItem {
  /** Full id: `<catalog>:<local>`. */
  id: string;
  catalog: string;
  item: Item;
  /** Who set each field, by field path. */
  sources: ReadonlyMap<string, Source>;
  /** The overrides applied, computed; nobody writes it by hand (§3.1). */
  corrected: Correction[];
  /** Mismatches accepted by overrides (§3.6). */
  accepted: Acceptance[];
  /** Every file that contributed. */
  files: string[];
}

export interface LoadedSection {
  id: string;
  catalog: string;
  file: string;
  section: SectionFile;
}

export interface LoadedCatalog {
  id: string;
  dir: string;
  name: string;
  vendor?: string;
  currency?: string;
  /** Keyed by local id. */
  materials: Map<string, MaterialT>;
  grooves: Map<string, GrooveTypeT>;
  systems: Map<string, SystemT>;
  /** Standards fasteners are made to (F2a): read at link time, never locked. */
  standards: Map<string, StandardT>;
  items: Map<string, LoadedItem>;
  /** Keyed by SKU. */
  offers: Map<string, Offer>;
  sections: Map<string, LoadedSection>;
  /** Paths of the files read, as named in messages. */
  files: string[];
}

export interface LoadResult {
  catalog?: LoadedCatalog;
  diagnostics: Diagnostic[];
}

const DEFINITIONS = ["materials", "grooves", "systems", "standards"] as const;
type DefinitionMap = (typeof DEFINITIONS)[number];
const DEFINITION_SCHEMA = {
  materials: Material,
  grooves: GrooveType,
  systems: System,
  standards: Standard,
} as const;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Splits a reference into its catalog and local id; a bare id names `from`. */
export function splitRef(ref: string, from: string): { catalog: string; local: string } {
  const i = ref.indexOf(":");
  return i < 0
    ? { catalog: from, local: ref }
    : { catalog: ref.slice(0, i), local: ref.slice(i + 1) };
}

class Loader {
  readonly diagnostics: Diagnostic[] = [];
  readonly source: CatalogSource;
  constructor(source: CatalogSource) {
    this.source = source;
  }

  file(rel: string): string {
    return `${this.source.dir}/${rel}`;
  }

  error(code: string, message: string, files: string[], entity?: string, field?: string): void {
    this.diagnostics.push({ severity: "error", code, entity, field, files, message });
  }

  warn(code: string, message: string, files: string[], entity?: string, field?: string): void {
    this.diagnostics.push({ severity: "warn", code, entity, field, files, message });
  }

  /** Reads and parses one file; undefined (with a diagnostic) when it is not valid JSON. */
  json(rel: string): unknown {
    const text = this.source.files.get(rel);
    if (text === undefined) return undefined;
    const r = parseJson(text);
    if (r.ok) return r.value;
    for (const p of r.problems) {
      const at = p.line > 0 ? ` (line ${p.line}, column ${p.col})` : "";
      this.error("json", `${p.message}${at}`, [this.file(rel)]);
    }
    return undefined;
  }

  /** Checks a file's envelope; returns its data, or undefined when the envelope is unusable. */
  envelope<T>(rel: string, schema: z.ZodType<T>, raw: unknown): T | undefined {
    const r = schema.safeParse(raw);
    if (r.success) return r.data;
    for (const { path, message } of issueLines(r.error)) {
      this.error("schema", `${pathString(path) || "(file)"}: ${message}`, [this.file(rel)]);
    }
    return undefined;
  }

  /** Reports collisions between layers: a later layer changed a field an earlier one set. */
  collisions(cs: Collision[], entity: string): void {
    for (const c of cs) {
      this.error(
        c.first.layer === 1 ? "family-changes-importer-field" : "family-collision",
        `${c.path}: ${c.second.file} sets ${JSON.stringify(c.now)}, but ${c.first.file} already set ${JSON.stringify(c.was)}; a family may add fields, never change one (§3.1)`,
        [c.first.file, c.second.file],
        entity,
        c.path,
      );
    }
  }

  /** The files to blame for a schema issue at `path` in a merged tree. */
  blame(m: Merged, path: readonly PropertyKey[]): string[] {
    const keys: string[] = [];
    for (const p of path) {
      if (typeof p !== "string") break;
      keys.push(p);
    }
    // A field that is present: whoever set it, or the leaf above it (an array).
    for (let n = keys.length; n >= 1; n--) {
      const exact = m.sources.get(keys.slice(0, n).join("/"));
      if (exact) return [exact.file];
    }
    // A field that is missing, or a whole object: every file that contributed.
    return m.files();
  }
}

/** Loads one catalog folder. */
export function loadCatalog(source: CatalogSource): LoadResult {
  const L = new Loader(source);
  const relFiles = [...source.files.keys()].sort(cmp);

  // Layer 1: catalog.json.
  if (!source.files.has("catalog.json")) {
    L.error("catalog-missing", "no catalog.json in the folder", [L.file("catalog.json")]);
    return { diagnostics: L.diagnostics };
  }
  const cat = L.envelope("catalog.json", CatalogEnvelope, L.json("catalog.json"));
  if (!cat) return { diagnostics: L.diagnostics };
  const id = cat.id;
  const catalogFile = L.file("catalog.json");
  const layer1: Source = { file: catalogFile, layer: 1 };

  // Definitions: layer 1, then families.
  const defs = new Merged();
  for (const key of DEFINITIONS) {
    if (cat[key]) defs.add({ [key]: cat[key] } as Tree, layer1);
  }

  // Items: layer 1.
  const items = new Map<string, Merged>();
  for (const [local, frag] of Object.entries(cat.items ?? {})) {
    if (!isPlainObject(frag)) {
      L.error(
        "schema",
        `items/${local}: an item must be an object`,
        [catalogFile],
        `${id}:${local}`,
      );
      continue;
    }
    const m = new Merged();
    const withProv = frag.prov === undefined && cat.prov ? { ...frag, prov: cat.prov } : frag;
    m.add(withProv, layer1);
    items.set(local, m);
  }

  // Layer 2: families, in path order.
  for (const rel of relFiles.filter((f) => /^families\/[^/]+\.json$/.test(f))) {
    const fam = L.envelope(rel, FamilyEnvelope, L.json(rel));
    if (!fam) continue;
    const file = L.file(rel);
    for (const key of DEFINITIONS) {
      if (fam[key])
        L.collisions(
          defs.add({ [key]: fam[key] } as Tree, { file, layer: 2, prov: fam.prov }),
          `${id}:${key}`,
        );
    }
    for (const [local, frag] of Object.entries(fam.items ?? {})) {
      if (!isPlainObject(frag)) {
        L.error("schema", `items/${local}: an item must be an object`, [file], `${id}:${local}`);
        continue;
      }
      // A fragment's own prov is the default for what it sets; it becomes the item's `prov`
      // only when the family creates the item.
      const { prov: fragProv, ...fields } = frag as Tree & { prov?: Prov };
      const prov = fragProv ?? fam.prov;
      const existing = items.get(local);
      const src: Source = { file, layer: 2, prov };
      if (existing) {
        L.collisions(existing.add(fields, src), `${id}:${local}`);
      } else {
        const m = new Merged();
        m.add({ ...fields, prov }, src);
        items.set(local, m);
      }
    }
  }

  // Layer 3: overrides.
  const corrected = new Map<string, Correction[]>();
  const accepted = new Map<string, Acceptance[]>();
  if (source.files.has("overrides.json")) {
    const ov = L.envelope("overrides.json", OverridesEnvelope, L.json("overrides.json"));
    const file = L.file("overrides.json");
    const seen = new Map<string, number>();
    (ov?.overrides ?? []).forEach((raw, i) => {
      const r = Override.safeParse(raw);
      if (!r.success) {
        for (const { path, message } of issueLines(r.error, ["overrides", i])) {
          L.error("schema", `${pathString(path)}: ${message}`, [file]);
        }
        return;
      }
      const o = r.data;
      const ref = splitRef(o.item, id);
      const entity = `${ref.catalog}:${ref.local}`;
      if (ref.catalog !== id) {
        L.error(
          "override-foreign",
          `overrides[${i}] names ${entity}; a catalog corrects only its own items`,
          [file],
          entity,
          o.field,
        );
        return;
      }
      const m = items.get(ref.local);
      if (!m) {
        L.error(
          "override-unknown-item",
          `overrides[${i}] names an item that does not exist`,
          [file],
          entity,
          o.field,
        );
        return;
      }
      const key = `${ref.local}\n${o.field}\n${"accept" in o ? "accept" : "replace"}`;
      const prev = seen.get(key);
      if (prev !== undefined) {
        L.error(
          "override-duplicate",
          `overrides[${i}] repeats overrides[${prev}]`,
          [file],
          entity,
          o.field,
        );
        return;
      }
      seen.set(key, i);
      const current = getAt(m.tree, o.field);
      if ("accept" in o) {
        if (current === undefined) {
          L.error(
            "accept-unknown-field",
            `overrides[${i}] accepts a mismatch in a field the item does not have`,
            [file],
            entity,
            o.field,
          );
          return;
        }
        accepted.set(ref.local, [
          ...(accepted.get(ref.local) ?? []),
          { field: o.field, why: o.why, ...(o.by ? { by: o.by } : {}) },
        ]);
        return;
      }
      if (!sameValue(current, o.expect)) {
        const setBy = current === undefined ? undefined : m.sourceOf(o.field)?.file;
        L.error(
          "override-stale",
          `overrides[${i}] expects ${JSON.stringify(o.expect)} but the item has ${JSON.stringify(current ?? null)}${setBy ? ` (set by ${setBy})` : ""}: the source changed since the correction was written; review it. Not applied.`,
          setBy ? [file, setBy] : [file],
          entity,
          o.field,
        );
        return;
      }
      const now: unknown =
        typeof o.value === "number"
          ? {
              v: o.value,
              src: o.src,
              ...(o.ref ? { ref: o.ref } : {}),
              ...(o.read ? { read: o.read } : {}),
              note: o.why,
            }
          : o.value;
      m.forget(o.field);
      setAt(m.tree, o.field, now);
      m.sources.set(o.field, { file, layer: 3 });
      corrected.set(ref.local, [
        ...(corrected.get(ref.local) ?? []),
        {
          field: o.field,
          was: current ?? null,
          now,
          why: o.why,
          src: o.src,
          ...(o.ref ? { ref: o.ref } : {}),
          ...(o.read ? { read: o.read } : {}),
          ...(o.by ? { by: o.by } : {}),
        },
      ]);
    });
  }

  // Validate the merged definitions.
  const materials = new Map<string, MaterialT>();
  const grooves = new Map<string, GrooveTypeT>();
  const systems = new Map<string, SystemT>();
  const standards = new Map<string, StandardT>();
  const targets = { materials, grooves, systems, standards } as const;
  for (const key of DEFINITIONS) {
    const map = (defs.tree[key] ?? {}) as Tree;
    for (const [local, raw] of Object.entries(map)) {
      const r = DEFINITION_SCHEMA[key as DefinitionMap].safeParse(raw);
      if (r.success) (targets[key] as Map<string, unknown>).set(local, r.data);
      else {
        for (const { path, message } of issueLines(r.error)) {
          const full = [key, local, ...path];
          L.error(
            "schema",
            `${pathString(path) || "(entry)"}: ${message}`,
            L.blame(defs, full),
            `${id}:${key}/${local}`,
          );
        }
      }
    }
  }

  // Validate the merged items.
  const loadedItems = new Map<string, LoadedItem>();
  for (const [local, m] of [...items.entries()].sort(([a], [b]) => cmp(a, b))) {
    const entity = `${id}:${local}`;
    const r = Item.safeParse(m.tree);
    if (!r.success) {
      for (const { path, message } of issueLines(r.error)) {
        L.error(
          "schema",
          `${pathString(path) || "(item)"}: ${message}`,
          L.blame(m, path),
          entity,
          pathString(path) || undefined,
        );
      }
      continue;
    }
    loadedItems.set(local, {
      id: entity,
      catalog: id,
      item: r.data,
      sources: m.sources,
      corrected: corrected.get(local) ?? [],
      accepted: accepted.get(local) ?? [],
      files: m.files(),
    });
  }

  // Offers (layer 1).
  const offers = new Map<string, Offer>();
  if (source.files.has("offers.json")) {
    const file = L.file("offers.json");
    const of = L.envelope("offers.json", OffersEnvelope, L.json("offers.json"));
    for (const [sku, raw] of Object.entries(of?.offers ?? {})) {
      const r = Offer.safeParse(raw);
      if (r.success) offers.set(sku, r.data);
      else {
        for (const { path, message } of issueLines(r.error)) {
          L.error(
            "schema",
            `${pathString(path) || "(offer)"}: ${message}`,
            [file],
            `${id}:offers/${sku}`,
          );
        }
      }
    }
  }

  // Sections (layer 1): one per file; ids unique.
  const sections = new Map<string, LoadedSection>();
  for (const rel of relFiles.filter((f) => /^sections\/[^/]+\.json$/.test(f))) {
    const file = L.file(rel);
    const raw = L.json(rel);
    if (raw === undefined) continue;
    const r = SectionFile.safeParse(raw);
    if (!r.success) {
      const sid = isPlainObject(raw) && typeof raw.id === "string" ? raw.id : rel;
      for (const { path, message } of issueLines(r.error)) {
        L.error(
          "schema",
          `${pathString(path) || "(section)"}: ${message}`,
          [file],
          `${id}:sections/${sid}`,
        );
      }
      continue;
    }
    const s = r.data;
    const prev = sections.get(s.id);
    if (prev) {
      L.error(
        "duplicate-id",
        `section "${s.id}" is defined twice`,
        [prev.file, file],
        `${id}:sections/${s.id}`,
      );
      continue;
    }
    if (rel !== `sections/${s.id}.json`) {
      L.warn(
        "section-file-name",
        `the file of section "${s.id}" should be sections/${s.id}.json`,
        [file],
        `${id}:sections/${s.id}`,
      );
    }
    sections.set(s.id, { id: s.id, catalog: id, file, section: s });
  }

  return {
    catalog: {
      id,
      dir: source.dir,
      name: cat.name,
      ...(cat.vendor ? { vendor: cat.vendor } : {}),
      ...(cat.currency ? { currency: cat.currency } : {}),
      materials,
      grooves,
      systems,
      standards,
      items: loadedItems,
      offers,
      sections,
      files: relFiles.map((f) => L.file(f)),
    },
    diagnostics: L.diagnostics,
  };
}

/**
 * Whether an override's `expect` matches the current value: by number for valued fields (so a
 * re-import that only refreshes a read date does not make the correction stale), deeply
 * otherwise; `null` matches an absent field.
 */
export function sameValue(current: unknown, expect: unknown): boolean {
  if (current === undefined) return expect === null;
  const isNum = (x: unknown): x is Valued => typeof x === "number" || isValuedObject(x);
  if (isNum(current) && isNum(expect)) return num(current) === num(expect);
  if (isBranch(current) && isBranch(expect)) {
    const ka = Object.keys(current);
    const kb = Object.keys(expect);
    return (
      ka.length === kb.length &&
      ka.every((k) => Object.hasOwn(expect, k) && sameValue(current[k], expect[k]))
    );
  }
  return deepEqual(current, expect);
}
