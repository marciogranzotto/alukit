import { type BuiltSection, buildSection, type CatalogSet } from "#catalog/link.ts";
import { splitRef } from "#catalog/load.ts";
import { isValuedObject } from "#catalog/schema/common.ts";
import type { Item } from "#catalog/schema/items.ts";

/**
 * What derive needs from catalogs: items by full id, bar sections built, and offers. Derive
 * reads only this interface. M3a backs it with live catalogs (`catalogItems`); M3b's lock file
 * (§4.13) implements the same interface, so derive never reads live catalogs once a lock exists.
 */

export interface BarItemInfo {
  /** Full item id. */
  id: string;
  name: string;
  shape: string;
  /** Full section id. */
  sectionId: string;
  section: BuiltSection;
  /** A parametric section's generator params, for `sec()` (§4.9); empty otherwise. */
  sectionParams: Readonly<Record<string, number>>;
  options: Readonly<Record<string, readonly string[]>>;
}

export interface SaleInfo {
  mode: "cut" | "stock";
  /** cut */
  min_mm?: number;
  max_mm?: number;
  res_mm?: number;
  step_mm?: number;
  min_bill_mm?: number;
  bill?: "piece" | "line";
  /** stock */
  length_mm?: number;
}

export interface OfferInfo {
  /** `<catalog>:<sku>`. */
  sku: string;
  supplier: string;
  currency?: string;
  options: Readonly<Record<string, string>>;
  sale?: SaleInfo;
  per: "unit" | "m" | "bar";
  regular_minor: number;
  sale_minor: number | null;
}

export type ItemLookup =
  | { ok: true; id: string; item: Item; bar?: BarItemInfo }
  | { ok: false; message: string };

export interface ItemSource {
  /** An item by full id (`<catalog>:<code>`). */
  item(ref: string): ItemLookup;
  /** Every offer of an item, by SKU order. */
  offers(itemId: string): readonly OfferInfo[];
}

/** A price that may be a bare number or a valued field (draft 2.1 adds quoted ranges, §3.2). */
function priceValue(x: unknown): number | null {
  if (typeof x === "number") return x;
  if (isValuedObject(x)) return x.v;
  return null;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Items from linked catalogs, with sections built once per item. */
export function catalogItems(set: CatalogSet): ItemSource {
  const cache = new Map<string, ItemLookup>();
  const offerCache = new Map<string, OfferInfo[]>();
  return {
    item(ref: string): ItemLookup {
      const hit = cache.get(ref);
      if (hit) return hit;
      const out = lookup(set, ref);
      cache.set(ref, out);
      return out;
    },
    offers(itemId: string): readonly OfferInfo[] {
      const hit = offerCache.get(itemId);
      if (hit) return hit;
      const out = set
        .offersOf(itemId)
        .map(({ catalog, sku, offer }): OfferInfo => {
          const s = offer.sale;
          const sale: SaleInfo | undefined =
            s === undefined
              ? undefined
              : s.mode === "cut"
                ? {
                    mode: "cut",
                    min_mm: s.min_mm,
                    max_mm: s.max_mm,
                    res_mm: s.res_mm,
                    step_mm: s.step_mm,
                    ...(s.min_bill_mm !== undefined ? { min_bill_mm: s.min_bill_mm } : {}),
                    ...(s.bill !== undefined ? { bill: s.bill } : {}),
                  }
                : { mode: "stock", length_mm: s.length_mm };
          return {
            sku: `${catalog.id}:${sku}`,
            supplier: offer.supplier ?? catalog.vendor ?? catalog.id,
            ...(catalog.currency ? { currency: catalog.currency } : {}),
            options: offer.options ?? {},
            ...(sale ? { sale } : {}),
            per: offer.price.per,
            regular_minor: priceValue(offer.price.regular_minor) ?? 0,
            sale_minor: priceValue(offer.price.sale_minor),
          };
        })
        .sort((a, b) => cmp(a.sku, b.sku));
      offerCache.set(itemId, out);
      return out;
    },
  };
}

function lookup(set: CatalogSet, ref: string): ItemLookup {
  if (!ref.includes(":")) return { ok: false, message: `"${ref}" names no catalog` };
  const { catalog } = splitRef(ref, "");
  if (!set.catalogs.has(catalog)) {
    return { ok: false, message: `catalog "${catalog}" is not loaded (add it to "catalogs")` };
  }
  const found = set.get("item", ref, catalog);
  if (!found) return { ok: false, message: `no item ${ref}` };
  const item = found.value.item;
  if (item.kind !== "bar") return { ok: true, id: found.id, item };
  const ls = set.get("section", item.section, found.value.catalog);
  if (!ls) return { ok: false, message: `${found.id}: no section "${item.section}"` };
  const built = buildSection(set, ls.value);
  if ("problems" in built) {
    return { ok: false, message: `${found.id}: section ${ls.id}: ${built.problems.join("; ")}` };
  }
  const s = ls.value.section;
  const sectionParams: Record<string, number> = {};
  if (s.fidelity === "parametric") {
    for (const [k, v] of Object.entries(s.params as Record<string, unknown>)) {
      if (typeof v === "number") sectionParams[k] = v;
    }
  }
  return {
    ok: true,
    id: found.id,
    item,
    bar: {
      id: found.id,
      name: item.name,
      shape: item.shape,
      sectionId: ls.id,
      section: built,
      sectionParams,
      options: item.options ?? {},
    },
  };
}
