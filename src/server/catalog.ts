import type { CatalogSet } from "#catalog/link.ts";
import { BUILTIN_DIR, builtinIds } from "#catalog/open.ts";
import { isValuedObject, num } from "#catalog/schema/common.ts";
import type { Item } from "#catalog/schema/items.ts";
import { type CatalogEntry, localId, sellsTslot } from "#catalog/search.ts";
import { compareIds } from "#core/ids.ts";
import { catalogItems, type ItemSource, type OfferInfo } from "#core/items.ts";
import type { Lock } from "#core/lock/schema.ts";
import { lockItems } from "#core/lock/source.ts";
import { openLiveCatalogs } from "#core/project/open.ts";
import { PROJECT_ITEM } from "#core/project/parse.ts";
import type { ProjectItem } from "#core/project/schema.ts";
import type { ResolvedProjectItem } from "#core/project-items/resolve.ts";
import { viewSection } from "../mesh/display.ts";
import type { ViewSection } from "../mesh/model.ts";
import { type P2, simplifyRing } from "../mesh/outline.ts";

/**
 * The catalog browser's data (design §8, left: vendor › kind › family, search, item cards with
 * a section thumbnail, fidelity and key data; options and offers). It reads the live catalogs the
 * document names, and the lock for an item the lock pins that no live catalog holds any more, so
 * a project whose catalogs are not at hand still shows what it uses (§4.13). The document's own
 * items (§4.8: plates, bent angles, generic items, placeholders) are listed too, under the vendor
 * `project`, read only: the browser shows them and can place them, and commands edit them.
 *
 * A **family** is what groups items of one kind as a person looks for them: a bar's system
 * (`s40-c8`), else its shape; a connector's, fastener's or accessory's subtype; a carriage's rail
 * system; a generic item's category; a project item's material, else its kind.
 */

export const CATALOG_SCHEMA = "alukit.catalog-index/1";

// The index and the search are the CLI's too (`alukit catalog search`).
export {
  type CatalogEntry,
  catalogIndex,
  familyOf,
  SEARCH_LIMIT,
  type SearchQuery,
  searchCatalog,
} from "#catalog/search.ts";

/** The catalog and vendor the browser lists the document's own items under. */
const PROJECT_CATALOG = PROJECT_ITEM.slice(0, -1);

/** The document's own items as browser entries (above), in id order. */
export function projectEntries(resolved: ReadonlyMap<string, ResolvedProjectItem>): CatalogEntry[] {
  return [...resolved.values()]
    .map(
      (r): CatalogEntry => ({
        id: r.id,
        catalog: PROJECT_CATALOG,
        vendor: PROJECT_CATALOG,
        kind: r.kind,
        family: localId(r.material) ?? r.kind,
        name: r.name,
        pinned: false,
        live: true,
        project: true,
      }),
    )
    .sort((a, b) => compareIds(a.id, b.id));
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

/**
 * A built-in catalog as Project settings and the start card offer it (S2, D-UX-6): its id (what
 * a document names), name and vendor, how many items and bars it holds, and whether it sells
 * T-slot profile, which `alukit new`'s notice asks too (D-UX-7).
 */
export interface BuiltinCatalog {
  id: string;
  name: string;
  vendor?: string;
  items: number;
  bars: number;
  tslot: boolean;
}

/** Each built-in catalog, opened alone as `alukit new` opens them, in id order. */
export async function builtinCatalogs(
  dir: string,
  builtinDir: string = BUILTIN_DIR,
): Promise<BuiltinCatalog[]> {
  const out: BuiltinCatalog[] = [];
  for (const id of await builtinIds(builtinDir)) {
    const { set } = await openLiveCatalogs(dir, { catalogs: [id] }, builtinDir);
    const c = set.catalogs.get(id);
    if (!c) continue;
    const items = [...c.items.values()];
    out.push({
      id,
      name: c.name,
      ...(c.vendor ? { vendor: c.vendor } : {}),
      items: items.length,
      bars: items.filter((li) => li.item.kind === "bar").length,
      tslot: sellsTslot(set, [id]),
    });
  }
  return out;
}

/** A section drawn small: its outline and holes, coarsened to a hundredth of its size. */
export interface Thumb {
  outline: P2[];
  holes: P2[][];
  bbox: [P2, P2];
}

/** A list entry as a card shows it: a bar's thumbnail, fidelity and mass per metre. */
export type ListedEntry = CatalogEntry & {
  thumb?: Thumb;
  fidelity?: string;
  mass_kg_per_m?: number;
};

/** The list's cards: each entry with what a glance needs, read from its catalog or the lock. */
export function listed(
  entries: readonly CatalogEntry[],
  live: CatalogSet,
  lock: Lock,
): ListedEntry[] {
  const sources = { live: catalogItems(live), lock: lockItems(lock) };
  return entries.map((e) => {
    const found = (e.live ? sources.live : sources.lock).item(e.id);
    const bar = found.ok ? found.bar : undefined;
    if (!bar) return e;
    const [[x0, y0], [x1, y1]] = bar.section.bbox_mm;
    const tol = Math.max(x1 - x0, y1 - y0) / 100;
    const ring = (r: readonly (readonly [number, number])[]) =>
      simplifyRing(r, tol).map(
        ([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as P2,
      );
    return {
      ...e,
      thumb: {
        outline: ring(bar.section.draw.outline),
        holes: bar.section.draw.holes.map(ring),
        bbox: [
          [x0, y0],
          [x1, y1],
        ],
      },
      fidelity: bar.section.fidelity,
      ...(bar.mass_kg_per_m ? { mass_kg_per_m: bar.mass_kg_per_m.v } : {}),
    };
  });
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
  /** The item as the catalogs (or the lock) hold it; a project item as the document writes it. */
  item: Item | ProjectItem;
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

const mm = (x: number) => Number(x.toFixed(2));

/**
 * A project item's card (§4.8): what the machining sheet and the BOM read of it, with the mass
 * computed from its material (`calc`) or entered. No options and no offers: it has neither.
 */
function projectCard(entry: CatalogEntry, r: ResolvedProjectItem): ItemCard {
  const data: CardValue[] = [];
  if (r.material) data.push({ key: "material", value: r.material });
  if (r.thickness !== undefined) data.push({ key: "thickness_mm", value: mm(r.thickness) });
  if (r.angle) {
    data.push({ key: "legs_mm", value: `${mm(r.angle.legs[0])} × ${mm(r.angle.legs[1])}` });
    data.push({ key: "length_mm", value: mm(r.angle.length) });
    data.push({ key: "bend_radius_mm", value: mm(r.angle.radius) });
    data.push({ key: "blank_mm", value: mm(r.angle.developed), src: "calc" });
  }
  const box = r.view.bbox_mm;
  if (box) {
    const [a, b] = box;
    data.push({
      key: "box_mm",
      value: [0, 1, 2].map((i) => mm((b[i] ?? 0) - (a[i] ?? 0))).join(" × "),
    });
  }
  if (r.holes.length > 0) data.push({ key: "holes", value: r.holes.length });
  const mass = r.view.mass_kg;
  if (mass) data.push({ key: "mass_kg", value: Number(mass.v.toFixed(3)), src: mass.src });
  data.push({ key: "supplier", value: r.supplier ?? "unsourced" });
  if (r.price) data.push({ key: "price_minor", value: r.price.v, src: r.price.src });
  return {
    schema: "alukit.catalog-item/1",
    entry,
    item: r.def,
    data,
    options: {},
    offers: [],
  };
}

/**
 * An item card: the browser's detail view of one item. `own` holds the document's own items,
 * resolved as derive resolves them.
 */
export function itemCard(
  id: string,
  live: CatalogSet,
  lock: Lock,
  entries: readonly CatalogEntry[],
  own?: ReadonlyMap<string, ResolvedProjectItem>,
): ItemCard | undefined {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return undefined;
  if (entry.project) {
    const r = own?.get(id);
    return r ? projectCard(entry, r) : undefined;
  }
  const source: ItemSource = entry.live ? catalogItems(live) : lockItems(lock);
  const found = source.item(id);
  if (!found.ok) return undefined;
  // The catalogs and the lock hold catalog items only; a project item comes through `own`.
  const item = found.item as Item;
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
