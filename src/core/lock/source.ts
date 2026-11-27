import { CatalogSet } from "#catalog/link.ts";
import type { LoadedCatalog } from "#catalog/load.ts";
import { catalogItems, type ItemSource } from "../items.ts";
import { LOCK_FILE, type Lock } from "./schema.ts";

/**
 * The lock as catalogs (design §4.13): each catalog it pins becomes a loaded catalog holding only
 * the pinned entities, already merged and linked, so they are not linked again. Derive's item
 * source is then `catalogItems` over it, the same code that serves live catalogs: whatever reads
 * catalogs through a `CatalogSet` reads a lock the same way. Pure: the browser can derive from a
 * lock too.
 */

function split(full: string): [string, string] {
  const i = full.indexOf(":");
  return [full.slice(0, i), full.slice(i + 1)];
}

export function lockCatalogSet(lock: Lock): CatalogSet {
  const set = new CatalogSet();
  const cat = (id: string): LoadedCatalog => {
    let c = set.catalogs.get(id);
    if (!c) {
      const info = lock.catalogs[id];
      c = {
        id,
        dir: LOCK_FILE,
        name: info?.name ?? id,
        ...(info?.vendor !== undefined ? { vendor: info.vendor } : {}),
        ...(info?.currency !== undefined ? { currency: info.currency } : {}),
        materials: new Map(),
        grooves: new Map(),
        systems: new Map(),
        // A fastener's standard is read when catalogs are linked; the lock holds what it filled.
        standards: new Map(),
        items: new Map(),
        offers: new Map(),
        sections: new Map(),
        files: [LOCK_FILE],
      };
      set.catalogs.set(id, c);
    }
    return c;
  };
  for (const id of Object.keys(lock.catalogs)) cat(id);
  for (const [full, e] of Object.entries(lock.items)) {
    const [c, local] = split(full);
    cat(c).items.set(local, {
      id: full,
      catalog: c,
      item: e.item,
      sources: new Map(),
      corrected: [],
      accepted: [],
      files: [LOCK_FILE],
    });
  }
  for (const [full, e] of Object.entries(lock.offers)) {
    const [c, sku] = split(full);
    cat(c).offers.set(sku, e.offer);
  }
  for (const [full, e] of Object.entries(lock.sections)) {
    const [c, local] = split(full);
    cat(c).sections.set(local, { id: local, catalog: c, file: LOCK_FILE, section: e.section });
  }
  for (const [full, e] of Object.entries(lock.materials)) {
    const [c, local] = split(full);
    cat(c).materials.set(local, e.material);
  }
  for (const [full, e] of Object.entries(lock.grooves)) {
    const [c, local] = split(full);
    cat(c).grooves.set(local, e.groove);
  }
  for (const [full, e] of Object.entries(lock.systems)) {
    const [c, local] = split(full);
    cat(c).systems.set(local, e.system);
  }
  return set;
}

/** Derive's item source, read from the lock. */
export function lockItems(lock: Lock): ItemSource {
  return catalogItems(lockCatalogSet(lock));
}
