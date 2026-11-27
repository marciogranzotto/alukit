import { compareIds } from "#core/ids.ts";
import { catalogItems, type ItemSource } from "#core/items.ts";
import type { Lock } from "#core/lock/schema.ts";
import { lockItems } from "#core/lock/source.ts";
import { type FromPrice, fromPrice } from "#core/order/price.ts";
import type { CatalogSet } from "./link.ts";
import type { Item } from "./schema/items.ts";

/**
 * Finding catalog items (design §7.3 `alukit catalog search`, §8's catalog browser): one index
 * and one ranking for both. An entry is an item of a live catalog, or one a project's lock pins
 * that no live catalog holds any more.
 *
 * A **family** is what groups items of one kind as a person looks for them: a bar's system
 * (`s40-c8`), else its shape; a connector's, fastener's or accessory's subtype; a carriage's rail
 * system; a generic item's category.
 */

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
  /** A live catalog holds it; false when only the lock does. A project item is always live. */
  live: boolean;
  /** One of the document's own items (`project:<id>`, §4.8), shown read only. */
  project?: true;
  /** A bar's own size: its section's box, width then height, mm (BE-8). */
  size_mm?: readonly [number, number];
  /** The lowest regular price it is sold at, per metre or per unit (BE-12). */
  from?: FromPrice;
}

export function localId(ref: string | undefined): string | undefined {
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
      return localId(str("system")) ?? str("shape") ?? "bar";
    case "carriage":
      return localId(str("rail_system")) ?? "carriage";
    case "generic":
      return str("category") ?? "other";
    default:
      return str("subtype") ?? item.kind;
  }
}

/**
 * Every item to search: the items of the catalogs asked for (`named`; all the live ones when not
 * given), then those a lock pins that none of them holds. Catalogs linked in only because another
 * refers to them (a reference catalog a clone points at) are not searched, though an item of
 * theirs the lock pins is.
 */
export function catalogIndex(
  live: CatalogSet,
  lock?: Lock,
  named?: readonly string[],
): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  const fromLive = catalogItems(live);
  const fromLock = lock ? lockItems(lock) : undefined;
  for (const cat of live.catalogs.values()) {
    if (named && !named.includes(cat.id)) continue;
    for (const li of cat.items.values()) {
      seen.add(li.id);
      const size = li.item.kind === "bar" ? sizeOf(fromLive, li.id) : undefined;
      const from = fromPrice(fromLive.offers(li.id));
      out.push({
        id: li.id,
        catalog: cat.id,
        vendor: cat.vendor ?? cat.id,
        kind: li.item.kind,
        family: familyOf(li.item),
        name: li.item.name,
        ...(li.item.code !== undefined ? { code: li.item.code } : {}),
        pinned: lock !== undefined && Object.hasOwn(lock.items, li.id),
        live: true,
        ...(size ? { size_mm: size } : {}),
        ...(from ? { from } : {}),
      });
    }
  }
  for (const [id, e] of Object.entries(lock?.items ?? {})) {
    if (seen.has(id)) continue;
    const catalog = id.slice(0, id.indexOf(":"));
    const cat = live.catalogs.get(catalog);
    const isLive = cat?.items.has(id.slice(catalog.length + 1)) === true;
    const source = isLive ? fromLive : fromLock;
    const size = e.item.kind === "bar" && source ? sizeOf(source, id) : undefined;
    const from = source ? fromPrice(source.offers(id)) : undefined;
    out.push({
      id,
      catalog,
      vendor: cat?.vendor ?? lock?.catalogs[catalog]?.vendor ?? catalog,
      kind: e.item.kind,
      family: familyOf(e.item),
      name: e.item.name,
      ...(e.item.code !== undefined ? { code: e.item.code } : {}),
      pinned: true,
      live: isLive,
      ...(size ? { size_mm: size } : {}),
      ...(from ? { from } : {}),
    });
  }
  return out.sort((a, b) => compareIds(a.id, b.id));
}

/**
 * Whether one of the catalogs `ids` sells T-slot profile: a bar whose section has grooves, with
 * an offer (D-UX-7). `alukit new` says so when none does, since a frame drawn then has no
 * profile to draw with.
 */
export function sellsTslot(live: CatalogSet, ids: readonly string[]): boolean {
  const items = catalogItems(live);
  for (const id of ids) {
    for (const li of live.catalogs.get(id)?.items.values() ?? []) {
      if (li.item.kind !== "bar") continue;
      const found = items.item(li.id);
      if (
        found.ok &&
        (found.bar?.section.grooves.length ?? 0) > 0 &&
        items.offers(li.id).length > 0
      )
        return true;
    }
  }
  return false;
}

/** A bar's size, its built section's box (width, height), or undefined when it does not build. */
function sizeOf(items: ItemSource, id: string): [number, number] | undefined {
  const found = items.item(id);
  if (!found.ok || !found.bar) return undefined;
  const [[x0, y0], [x1, y1]] = found.bar.section.bbox_mm;
  return [snapSize(x1 - x0), snapSize(y1 - y0)];
}

/** A size to the output quantum, 0.01 mm: a box computed from a drawing carries float noise. */
const snapSize = (x: number) => Math.round(x * 100) / 100;

/**
 * Lower case without accents, and the multiplication sign as an x: "Perfil Estrutural 40×40"
 * and "perfil estrutural 40x40" match alike (Forseti's names write sizes with ×).
 */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/×/g, "x").toLowerCase();
}

/** The words of a folded text: runs of letters and digits. */
function tokens(s: string): Set<string> {
  return new Set(s.split(/[^a-z0-9]+/).filter((t) => t !== ""));
}

export interface SearchQuery {
  q?: string;
  vendor?: string;
  kind?: string;
  family?: string;
  /** A kind to rank first within each rank, without leaving the others out: what a tool wants. */
  prefer?: string;
  limit?: number;
  offset?: number;
}

/** A size written in a query, `40x40` (folded: `40×40` and `40 x 40` too), as its two numbers. */
const SIZE = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/;

/** True when a bar's own size is the size `w` asks, either way round. */
function sizeIs(size: readonly [number, number] | undefined, w: string): boolean {
  const m = SIZE.exec(w);
  if (!m || !size) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const near = (x: number, y: number) => Math.abs(x - y) < 0.005;
  return (near(size[0], a) && near(size[1], b)) || (near(size[0], b) && near(size[1], a));
}

/** The most items one answer holds: an agent's context, and the browser's list, stay bounded. */
export const SEARCH_LIMIT = 200;

/**
 * Items matching every word of `q` (in the id, code, name or family, accents and case aside) and
 * the vendor, kind and family given, ranked:
 *
 * 0. an exact id or code;
 * 1. codes that start with the query;
 * 2. bars whose own size is a size the query writes (`40x40`, either way round: the section's
 *    box), every other word a whole word of theirs (BE-8). A bar of that size matches the size
 *    word whether or not its name says it;
 * 3. items where every word of the query is a whole word of theirs (`M8` is a word of
 *    "Parafuso M8", not of "M8x16"), so an accessory "for 40x40" comes after the profile;
 * 4. the rest.
 *
 * Within a rank, the kind `prefer` names comes first; then the shorter name (the more of it the
 * query says), then id order; with no query, browsing, id order alone. `total` counts every
 * match; `items` is the page `offset` and `limit` (50 by default, at most `SEARCH_LIMIT`) cut
 * from them.
 */
export function searchCatalog(
  entries: readonly CatalogEntry[],
  query: SearchQuery,
): { total: number; items: CatalogEntry[] } {
  // "40 x 40" is one size, as "40x40" is.
  const folded = fold(query.q ?? "").replace(/(\d)\s*x\s*(?=\d)/g, "$1x");
  const words = folded.split(/\s+/).filter((w) => w !== "");
  const whole = folded.trim();
  const sized = words.some((w) => SIZE.test(w));
  const isWhole = (own: Set<string>, w: string) => [...tokens(w)].every((t) => own.has(t));
  const rank = (e: CatalogEntry, text: string): number => {
    if (whole === "") return 3;
    const id = fold(e.id);
    const code = fold(e.code ?? localId(e.id) ?? "");
    if (id === whole || code === whole) return 0;
    if (code.startsWith(whole) || fold(localId(e.id) ?? "").startsWith(whole)) return 1;
    const own = tokens(text);
    if (sized && words.every((w) => (SIZE.test(w) ? sizeIs(e.size_mm, w) : isWhole(own, w)))) {
      return 2;
    }
    return words.every((w) => isWhole(own, w)) ? 3 : 4;
  };
  const preferred = (e: CatalogEntry) =>
    query.prefer !== undefined && e.kind === query.prefer ? 0 : 1;
  const hits = entries
    .filter(
      (e) =>
        (query.vendor === undefined || e.vendor === query.vendor) &&
        (query.kind === undefined || e.kind === query.kind) &&
        (query.family === undefined || e.family === query.family),
    )
    .map((e) => ({ e, text: fold(`${e.id} ${e.code ?? ""} ${e.name} ${e.family}`) }))
    .filter(({ e, text }) => words.every((w) => text.includes(w) || sizeIs(e.size_mm, w)))
    .map(({ e, text }) => ({ e, r: rank(e, text) }))
    .sort(
      (a, b) =>
        a.r - b.r ||
        preferred(a.e) - preferred(b.e) ||
        (whole === "" ? 0 : a.e.name.length - b.e.name.length) ||
        compareIds(a.e.id, b.e.id),
    )
    .map(({ e }) => e);
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(Math.max(1, query.limit ?? 50), SEARCH_LIMIT);
  return { total: hits.length, items: hits.slice(offset, offset + limit) };
}
