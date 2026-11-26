import { createHash } from "node:crypto";
import {
  type CatalogSet,
  type EntityKind,
  itemRefs,
  offerRefs,
  sectionRefs,
} from "#catalog/link.ts";
import type { LoadedCatalog } from "#catalog/load.ts";
import { compareIds } from "../ids.ts";
import type { DocRefs } from "./refs.ts";
import { emptyLock, LOCK_KINDS, type Lock, type LockKind, lockText } from "./schema.ts";
import { lockCatalogSet } from "./source.ts";

/**
 * Pinning catalog data into the lock (design §4.13), from linked live catalogs. Node only: it
 * hashes with node:crypto.
 *
 * - `add`, on every save and on a derive that meets a new reference: entries the document newly
 *   needs are added; an entry already there never changes.
 * - `refresh`, `alukit lock update`: every entry is taken again from the live catalogs, and
 *   entries the document no longer uses are dropped. With `only`, just those items (and what they
 *   pull in) are refreshed and nothing is dropped.
 */

/** Compact JSON with keys in code-point order at every level: the text a hash is taken of. */
export function sortedJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(sortedJson).join(",")}]`;
  if (typeof x === "object" && x !== null) {
    const keys = Object.keys(x).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const o = x as Record<string, unknown>;
    return `{${keys
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

export function contentHash(x: unknown): string {
  return `sha256:${createHash("sha256").update(sortedJson(x)).digest("hex")}`;
}

/**
 * The lock's content hash, the stamp an output carries (§4.13, §9): sha256 of its canonical text.
 * A lock file in canonical form hashes the same with any sha256 tool (`shasum -a 256`).
 */
export function lockHash(lock: Lock): string {
  return `sha256:${createHash("sha256").update(lockText(lock), "utf8").digest("hex")}`;
}

/** The hash of a catalog's loaded content (merged and linked), whatever its files' layout. */
export function catalogHash(cat: LoadedCatalog): string {
  const map = <T>(m: ReadonlyMap<string, T>, f: (v: T) => unknown = (v) => v) =>
    Object.fromEntries([...m].map(([k, v]) => [k, f(v)]));
  return contentHash({
    id: cat.id,
    name: cat.name,
    vendor: cat.vendor,
    currency: cat.currency,
    materials: map(cat.materials),
    grooves: map(cat.grooves),
    systems: map(cat.systems),
    items: map(cat.items, (li) => li.item),
    offers: map(cat.offers),
    sections: map(cat.sections, (ls) => ls.section),
  });
}

/** The value of a lock entry by kind, as `{ hash, <kind>: value }`. */
const VALUE_KEY = Object.fromEntries(LOCK_KINDS) as Record<LockKind, string>;

type Slice = Record<LockKind, Map<string, unknown>>;

/** Collects the catalog entities a set of roots needs, following references (§3.1). */
class Collector {
  readonly slice: Slice = {
    items: new Map(),
    offers: new Map(),
    sections: new Map(),
    materials: new Map(),
    grooves: new Map(),
    systems: new Map(),
  };
  readonly catalogs = new Set<string>();
  private readonly set: CatalogSet;

  constructor(set: CatalogSet) {
    this.set = set;
  }

  /** Follows one reference; returns false when it does not resolve. */
  ref(kind: EntityKind, ref: string, from: string): boolean {
    switch (kind) {
      case "item":
        return this.item(ref, from);
      case "section": {
        const r = this.set.get("section", ref, from);
        if (!r) return false;
        if (this.add("sections", r.id, r.value.section, r.catalog.id)) {
          for (const s of sectionRefs(r.value.section)) this.ref(s.kind, s.ref, r.catalog.id);
        }
        return true;
      }
      case "system": {
        const r = this.set.get("system", ref, from);
        if (!r) return false;
        if (this.add("systems", r.id, r.value, r.catalog.id) && r.value.type === "tslot") {
          this.ref("groove", r.value.groove, r.catalog.id);
        }
        return true;
      }
      case "material": {
        const r = this.set.get("material", ref, from);
        if (!r) return false;
        this.add("materials", r.id, r.value, r.catalog.id);
        return true;
      }
      case "groove": {
        const r = this.set.get("groove", ref, from);
        if (!r) return false;
        this.add("grooves", r.id, r.value, r.catalog.id);
        return true;
      }
      case "offer":
        return true;
    }
  }

  /** An item, the entities it names, and every offer of it with their kits' items. */
  item(ref: string, from: string): boolean {
    const r = this.set.get("item", ref, from);
    if (!r) return false;
    if (!this.add("items", r.id, r.value.item, r.catalog.id)) return true;
    for (const site of itemRefs(r.value.item)) {
      // A clone's ratings are already filled from its original by linking (§3.4).
      if (site.field === "clone_of/item") continue;
      this.ref(site.kind, site.ref, r.catalog.id);
    }
    for (const { catalog, sku, offer } of this.set.offersOf(r.id)) {
      this.add("offers", `${catalog.id}:${sku}`, offer, catalog.id);
      for (const s of offerRefs(offer)) {
        if (s.field !== "item") this.ref(s.kind, s.ref, catalog.id);
      }
    }
    return true;
  }

  private add(kind: LockKind, id: string, value: unknown, catalog: string): boolean {
    if (this.slice[kind].has(id)) return false;
    this.slice[kind].set(id, value);
    this.catalogs.add(catalog);
    return true;
  }
}

export type PinMode = { kind: "add" } | { kind: "refresh"; only?: readonly string[] };

export interface PinResult {
  lock: Lock;
  /** References that neither the live catalogs nor the lock hold. */
  missing: string[];
  /** Items newly pinned by an `add`. */
  added: string[];
  /**
   * A refresh: references the live catalogs no longer hold, kept as the lock had them, so a
   * project never loses an item silently.
   */
  kept: string[];
}

function sortedRecord<T>(entries: Iterable<[string, T]>): Record<string, T> {
  return Object.fromEntries([...entries].sort(([a], [b]) => compareIds(a, b)));
}

/** Pins what the document references, per the mode. */
export function pinLock(
  set: CatalogSet,
  refs: DocRefs,
  base: Lock | undefined,
  mode: PinMode,
): PinResult {
  const start = base ?? emptyLock();
  const live = new Collector(set);
  const old = new Collector(lockCatalogSet(start));
  const missing: string[] = [];
  const added: string[] = [];
  const kept: string[] = [];

  const roots =
    mode.kind === "refresh" && mode.only
      ? { items: [...mode.only], materials: [] as string[] }
      : mode.kind === "add"
        ? {
            items: refs.items.filter((r) => !Object.hasOwn(start.items, r)),
            materials: refs.materials.filter((r) => !Object.hasOwn(start.materials, r)),
          }
        : refs;
  const pin = (r: string, follow: (c: Collector) => boolean) => {
    if (follow(live)) {
      if (mode.kind === "add") added.push(r);
    } else if (mode.kind === "refresh" && follow(old)) kept.push(r);
    else missing.push(r);
  };
  for (const r of roots.items) pin(r, (c) => c.item(r, ""));
  for (const r of roots.materials) pin(r, (c) => c.ref("material", r, ""));

  const entry = (kind: LockKind, value: unknown) => ({
    hash: contentHash(value),
    [VALUE_KEY[kind]]: value,
  });
  const out = emptyLock();
  const full = mode.kind === "refresh" && !mode.only;
  for (const [kind] of LOCK_KINDS) {
    const merged = new Map<string, unknown>(full ? [] : Object.entries(start[kind]));
    // Kept entries stay exactly as they were.
    for (const id of old.slice[kind].keys()) {
      const e = (start[kind] as Record<string, unknown>)[id];
      if (e !== undefined && !live.slice[kind].has(id)) merged.set(id, e);
    }
    for (const [id, v] of live.slice[kind]) {
      // An add never changes an entry already there.
      if (mode.kind === "add" && Object.hasOwn(start[kind], id)) continue;
      merged.set(id, entry(kind, v));
    }
    (out as Record<LockKind, unknown>)[kind] = sortedRecord(merged);
  }

  const catalogs = new Map(full ? [] : Object.entries(start.catalogs));
  for (const id of old.catalogs) {
    const was = start.catalogs[id];
    if (was && !catalogs.has(id)) catalogs.set(id, was);
  }
  for (const id of live.catalogs) {
    const cat = set.catalogs.get(id);
    if (!cat) continue;
    // A full refresh records each catalog as it is now; otherwise a catalog keeps its recorded
    // hash, so `check` still sees that the lock is behind it.
    if (full || !catalogs.has(id)) {
      catalogs.set(id, {
        hash: catalogHash(cat),
        name: cat.name,
        ...(cat.vendor !== undefined ? { vendor: cat.vendor } : {}),
        ...(cat.currency !== undefined ? { currency: cat.currency } : {}),
      });
    }
  }
  out.catalogs = sortedRecord(catalogs);
  return {
    lock: out,
    missing: missing.sort(compareIds),
    added: added.sort(compareIds),
    kept: kept.sort(compareIds),
  };
}
