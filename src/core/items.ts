import {
  type BuiltSection,
  buildSection,
  type CatalogSet,
  generatorContext,
} from "#catalog/link.ts";
import { type LoadedSection, splitRef } from "#catalog/load.ts";
import { type Face, isValuedObject, num, type Src } from "#catalog/schema/common.ts";
import type { BarItem, Item } from "#catalog/schema/items.ts";
import { GENERATORS } from "#catalog/sections/generators/index.ts";
import { sectionProperties } from "./section-properties.ts";

/**
 * What derive needs from catalogs: items by full id, bar sections built, and offers. Derive
 * reads only this interface. M3a backs it with live catalogs (`catalogItems`); M3b's lock file
 * (§4.13) implements the same interface, so derive never reads live catalogs once a lock exists.
 */

/** A section's groove, with its groove type's lip where the type is known (§3.3, §4.5). */
export interface BarGroove {
  face: Face;
  at_mm: number;
  /** Its groove type, as a full id (`test:c8`), when known. */
  type?: string;
  /** The lip's thickness: a T-nut's grip counts the grooved layer to it (§4.5). */
  lip_mm?: number;
}

/** A mass with the provenance of the value it came from (§3.5's authority rule). */
export interface MassInfo {
  v: number;
  /** `src`, `meas` or `est` as published; `calc` when computed from an area and a density. */
  src: Src;
}

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
  /** The system, as a full id (`test:s40-c8`): what fits it (§3.3). */
  system?: string;
  /** The section's grooves, with their lips. */
  grooves: readonly BarGroove[];
  /** Mass per metre by §3.5's authority rule; undefined when nothing gives one. */
  mass_kg_per_m?: MassInfo;
  /** A threaded rod's thread (`M10`). */
  thread?: string;
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
  /**
   * stock, rails: the end distance at both ends of the stock length as the maker drills it
   * (§3.2, §4.7). Linking fills it with the centred layout's, tagged `est`, when the seller
   * does not state it.
   */
  factory_E_mm?: number;
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
                : {
                    mode: "stock",
                    length_mm: s.length_mm,
                    ...(s.factory_E_mm !== undefined ? { factory_E_mm: num(s.factory_E_mm) } : {}),
                  };
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
  const home = found.value.catalog;
  const system = item.system === undefined ? undefined : fullRef(item.system, home);
  const mass = barMass(set, item, home, ls.value, built);
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
      ...(system ? { system } : {}),
      grooves: barGrooves(set, built, ls.value.catalog, system),
      ...(mass ? { mass_kg_per_m: mass } : {}),
      ...(item.thread ? { thread: item.thread } : {}),
    },
  };
}

/** A reference written in catalog `from`, as a full id. */
export function fullRef(ref: string, from: string): string {
  const { catalog, local } = splitRef(ref, from);
  return `${catalog}:${local}`;
}

/**
 * Each groove with its type's lip: the groove's own type (resolved in the section's catalog),
 * else the bar system's groove type.
 */
function barGrooves(
  set: CatalogSet,
  built: BuiltSection,
  sectionCatalog: string,
  system: string | undefined,
): BarGroove[] {
  const sys = system ? set.get("system", system, "")?.value : undefined;
  const fallback =
    sys?.type === "tslot" ? fullRef(sys.groove, splitRef(system as string, "").catalog) : undefined;
  return built.grooves.map((g) => {
    const type = g.type ? fullRef(g.type, sectionCatalog) : fallback;
    const gt = type ? set.get("groove", type, "")?.value : undefined;
    return {
      face: g.face,
      at_mm: g.at_mm,
      ...(type ? { type } : {}),
      ...(gt ? { lip_mm: num(gt.lip_mm) } : {}),
    };
  });
}

/**
 * A bar's mass per metre (§3.5's authority rule): the published `mass_kg_per_m`, after
 * overrides; otherwise its area times its material's density, the area being the published
 * `area_mm2`, else the section's computed area when its `props_ok` is true. A parametric
 * section's computed area is its generator's closed form (exact); an outline's is the polygon's.
 */
function barMass(
  set: CatalogSet,
  item: BarItem,
  home: string,
  section: LoadedSection,
  built: BuiltSection,
): MassInfo | undefined {
  if (item.mass_kg_per_m !== undefined) {
    const m = item.mass_kg_per_m;
    return { v: num(m), src: (isValuedObject(m) ? m.src : undefined) ?? item.prov.src };
  }
  const density = item.material
    ? set.get("material", item.material, home)?.value.density_kg_per_m3
    : undefined;
  if (density === undefined) return undefined;
  let area: number | undefined;
  if (item.area_mm2 !== undefined) area = num(item.area_mm2);
  else if (built.props_ok) {
    const s = section.section;
    if (s.fidelity === "parametric") {
      area = GENERATORS[s.generator]?.closedForm(s.params, generatorContext(set, section)).area_mm2;
    } else area = sectionProperties([built.props]).area_mm2;
  }
  if (area === undefined) return undefined;
  return { v: (area * num(density)) / 1e6, src: "calc" };
}
