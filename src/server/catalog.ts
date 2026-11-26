import type { CatalogSet } from "#catalog/link.ts";
import { isValuedObject, num } from "#catalog/schema/common.ts";
import type { Item } from "#catalog/schema/items.ts";
import { compareIds } from "#core/ids.ts";
import { catalogItems, type ItemSource, type OfferInfo } from "#core/items.ts";
import type { Lock } from "#core/lock/schema.ts";
import { lockItems } from "#core/lock/source.ts";
import type { ViewSection } from "../mesh/model.ts";
import { viewSection } from "./view.ts";

/**
 * The catalog browser's data (design §8, left: vendor › kind › family, search, item cards with
 * a section thumbnail, fidelity and key data; options and offers). It reads the live catalogs the
 * document names, and the lock for an item the lock pins that no live catalog holds any more, so
 * a project whose catalogs are not at hand still shows what it uses (§4.13).
 *
 * A **family** is what groups items of one kind as a person looks for them: a bar's system
 * (`s40-c8`), else its shape; a connector's, fastener's or accessory's subtype; a carriage's rail
 * system; a generic item's category.
 */

export const CATALOG_SCHEMA = "alukit.catalog-index/1";

export interface CatalogEntry {
  /** Full id, `<catalog>:<code>`. */
  id: string;
  catalog: string;
  vendor: string;
  kind: string;
  family: string;
  name: string;
  code?: string;
  /** The project's lock pins it. */
  pinned: boolean;
  /** A live catalog holds it; false when only the lock does. */
  live: boolean;
}

function local(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const i = ref.indexOf(":");
  return i < 0 ? ref : ref.slice(i + 1);
}

/** The family an item is browsed under (above). */
export function familyOf(item: Item): string {
  const o = item as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  switch (item.kind) {
    case "bar":
      return local(str("system")) ?? str("shape") ?? "bar";
    case "carriage":
      return local(str("rail_system")) ?? "carriage";
    case "generic":
      return str("category") ?? "other";
    default:
      return str("subtype") ?? item.kind;
  }
}

/**
 * Every item the browser can show: the items of the catalogs the document names (`named`; all
 * the live ones when not given), then those the lock pins that none of them holds. Catalogs
 * linked in only because another refers to them (a reference catalog a clone points at) are not
 * browsed, though an item of theirs the lock pins is.
 */
export function catalogIndex(
  live: CatalogSet,
  lock: Lock,
  named?: readonly string[],
): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const cat of live.catalogs.values()) {
    if (named && !named.includes(cat.id)) continue;
    for (const li of cat.items.values()) {
      seen.add(li.id);
      out.push({
        id: li.id,
        catalog: cat.id,
        vendor: cat.vendor ?? cat.id,
        kind: li.item.kind,
        family: familyOf(li.item),
        name: li.item.name,
        ...(li.item.code !== undefined ? { code: li.item.code } : {}),
        pinned: Object.hasOwn(lock.items, li.id),
        live: true,
      });
    }
  }
  for (const [id, e] of Object.entries(lock.items)) {
    if (seen.has(id)) continue;
    const catalog = id.slice(0, id.indexOf(":"));
    const cat = live.catalogs.get(catalog);
    out.push({
      id,
      catalog,
      vendor: cat?.vendor ?? lock.catalogs[catalog]?.vendor ?? catalog,
      kind: e.item.kind,
      family: familyOf(e.item),
      name: e.item.name,
      ...(e.item.code !== undefined ? { code: e.item.code } : {}),
      pinned: true,
      live: cat?.items.has(id.slice(catalog.length + 1)) === true,
    });
  }
  return out.sort((a, b) => compareIds(a.id, b.id));
}

export interface CatalogTree {
  vendor: string;
  count: number;
  kinds: { kind: string; count: number; families: { family: string; count: number }[] }[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** vendor › kind › family, with counts, each level sorted by name. */
export function catalogTree(entries: readonly CatalogEntry[]): CatalogTree[] {
  const tree = new Map<string, Map<string, Map<string, number>>>();
  for (const e of entries) {
    const kinds = tree.get(e.vendor) ?? new Map<string, Map<string, number>>();
    tree.set(e.vendor, kinds);
    const fams = kinds.get(e.kind) ?? new Map<string, number>();
    kinds.set(e.kind, fams);
    fams.set(e.family, (fams.get(e.family) ?? 0) + 1);
  }
  return [...tree.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([vendor, kinds]) => {
      const ks = [...kinds.entries()]
        .sort(([a], [b]) => cmp(a, b))
        .map(([kind, fams]) => {
          const families = [...fams.entries()]
            .sort(([a], [b]) => cmp(a, b))
            .map(([family, count]) => ({ family, count }));
          return { kind, count: families.reduce((n, f) => n + f.count, 0), families };
        });
      return { vendor, count: ks.reduce((n, k) => n + k.count, 0), kinds: ks };
    });
}

/** Lower case without accents: "Perfil Estrutural" and "perfil estrutural" match alike. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface SearchQuery {
  q?: string;
  vendor?: string;
  kind?: string;
  family?: string;
  limit?: number;
  offset?: number;
}

export const SEARCH_LIMIT = 200;

/**
 * Items matching every word of `q` (in the id, code, name or family, accents and case aside) and
 * the vendor, kind and family given. An exact id or code comes first, then codes that start with
 * the query, then id order.
 */
export function searchCatalog(
  entries: readonly CatalogEntry[],
  query: SearchQuery,
): { total: number; items: CatalogEntry[] } {
  const words = fold(query.q ?? "")
    .split(/\s+/)
    .filter((w) => w !== "");
  const whole = fold((query.q ?? "").trim());
  const rank = (e: CatalogEntry): number => {
    if (whole === "") return 2;
    const id = fold(e.id);
    const code = fold(e.code ?? local(e.id) ?? "");
    if (id === whole || code === whole) return 0;
    if (code.startsWith(whole) || fold(local(e.id) ?? "").startsWith(whole)) return 1;
    return 2;
  };
  const hits = entries
    .filter(
      (e) =>
        (query.vendor === undefined || e.vendor === query.vendor) &&
        (query.kind === undefined || e.kind === query.kind) &&
        (query.family === undefined || e.family === query.family),
    )
    .filter((e) => {
      if (words.length === 0) return true;
      const text = fold(`${e.id} ${e.code ?? ""} ${e.name} ${e.family}`);
      return words.every((w) => text.includes(w));
    })
    .map((e) => ({ e, r: rank(e) }))
    .sort((a, b) => a.r - b.r || compareIds(a.e.id, b.e.id))
    .map(({ e }) => e);
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(Math.max(1, query.limit ?? 50), SEARCH_LIMIT);
  return { total: hits.length, items: hits.slice(offset, offset + limit) };
}

/** One number of an item card, with the provenance its valued field gives. */
export interface CardValue {
  key: string;
  value: number | string;
  src?: string;
}

export interface OfferCard {
  sku: string;
  code: string;
  supplier: string;
  currency?: string;
  options: Readonly<Record<string, string>>;
  pack: number;
  kit?: OfferInfo["kit"];
  sale?: OfferInfo["sale"];
  price: { regular_minor: number; sale_minor: number | null; per: string; read: string };
  in_stock?: boolean;
}

export interface ItemCard {
  schema: "alukit.catalog-item/1";
  entry: CatalogEntry;
  /** The item as the catalogs (or the lock) hold it. */
  item: Item;
  /** The numbers worth a glance: section and mass data for a bar, box and thread for a part. */
  data: CardValue[];
  options: Readonly<Record<string, readonly string[]>>;
  /** A bar's section, as the viewer draws it: the card's thumbnail and the draw tool's preview. */
  section?: ViewSection;
  /** A bar's anchors (§4.4): the box's centre, faces and corners, then the section's datums. */
  anchors?: string[];
  offers: OfferCard[];
}

/** Anchor names in the order the draw tool cycles them (A, §8). */
export const BOX_ANCHORS = ["c", "-x-y", "+x-y", "+x+y", "-x+y", "-x", "+x", "-y", "+y"] as const;

const BAR_KEYS = ["mass_kg_per_m", "area_mm2", "Ix_mm4", "Iy_mm4", "thread"] as const;
const PART_KEYS = ["mass_kg", "thread", "length_mm", "material"] as const;

function cardValue(key: string, v: unknown, itemSrc: string | undefined): CardValue | undefined {
  if (typeof v === "number" || typeof v === "string")
    return { key, value: v, ...(itemSrc ? { src: itemSrc } : {}) };
  if (isValuedObject(v)) {
    const src =
      typeof (v as { src?: unknown }).src === "string" ? (v as { src: string }).src : itemSrc;
    return { key, value: num(v), ...(src ? { src } : {}) };
  }
  return undefined;
}

/** An item card: the browser's detail view of one item. */
export function itemCard(
  id: string,
  live: CatalogSet,
  lock: Lock,
  entries: readonly CatalogEntry[],
): ItemCard | undefined {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return undefined;
  const source: ItemSource = entry.live ? catalogItems(live) : lockItems(lock);
  const found = source.item(id);
  if (!found.ok) return undefined;
  const item = found.item;
  const o = item as Record<string, unknown>;
  const itemSrc = (item.prov as { src?: string } | undefined)?.src;
  const data: CardValue[] = [];
  if (found.bar) {
    data.push({ key: "shape", value: found.bar.shape });
    if (found.bar.system) data.push({ key: "system", value: found.bar.system });
    const [[x0, y0], [x1, y1]] = found.bar.section.bbox_mm;
    data.push({ key: "section_mm", value: `${x1 - x0} × ${y1 - y0}` });
    data.push({ key: "fidelity", value: found.bar.section.fidelity });
    for (const k of BAR_KEYS) {
      const v =
        k === "mass_kg_per_m" && found.bar.mass_kg_per_m
          ? { key: k, value: found.bar.mass_kg_per_m.v, src: found.bar.mass_kg_per_m.src }
          : cardValue(k, o[k], itemSrc);
      if (v) data.push(v);
    }
  } else {
    const box = o.bbox_mm;
    if (Array.isArray(box) && box.length === 2) {
      const [a, b] = box as [number[], number[]];
      data.push({
        key: "box_mm",
        value: [0, 1, 2].map((i) => Number(((b[i] ?? 0) - (a[i] ?? 0)).toFixed(2))).join(" × "),
      });
    }
    for (const k of PART_KEYS) {
      const v = cardValue(k, o[k], itemSrc);
      if (v) data.push(v);
    }
  }
  const section = found.bar ? viewSection(found.bar.section) : undefined;
  const offers: OfferCard[] = source.offers(id).map((f) => ({
    sku: f.sku,
    code: f.code,
    supplier: f.supplier,
    ...(f.currency !== undefined ? { currency: f.currency } : {}),
    options: f.options,
    pack: f.pack,
    ...(f.kit ? { kit: f.kit } : {}),
    ...(f.sale ? { sale: f.sale } : {}),
    price: {
      regular_minor: f.price.regular.v,
      sale_minor: f.price.sale?.v ?? null,
      per: f.price.per,
      read: f.price.read,
    },
    ...(f.in_stock !== undefined ? { in_stock: f.in_stock } : {}),
  }));
  return {
    schema: "alukit.catalog-item/1",
    entry,
    item,
    data,
    options: (item.options ?? {}) as Record<string, readonly string[]>,
    ...(section
      ? { section, anchors: [...BOX_ANCHORS, ...Object.keys(section.datums ?? {})] }
      : {}),
    offers,
  };
}
