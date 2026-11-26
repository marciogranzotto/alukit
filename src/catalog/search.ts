import { compareIds } from "#core/ids.ts";
import type { Lock } from "#core/lock/schema.ts";
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
        pinned: lock !== undefined && Object.hasOwn(lock.items, li.id),
        live: true,
      });
    }
  }
  for (const [id, e] of Object.entries(lock?.items ?? {})) {
    if (seen.has(id)) continue;
    const catalog = id.slice(0, id.indexOf(":"));
    const cat = live.catalogs.get(catalog);
    out.push({
      id,
      catalog,
      vendor: cat?.vendor ?? lock?.catalogs[catalog]?.vendor ?? catalog,
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
  limit?: number;
  offset?: number;
}

/** The most items one answer holds: an agent's context, and the browser's list, stay bounded. */
export const SEARCH_LIMIT = 200;

/**
 * Items matching every word of `q` (in the id, code, name or family, accents and case aside) and
 * the vendor, kind and family given, ranked: an exact id or code first; then codes that start
 * with the query; then items where every word of the query is a whole word of theirs (`M8` is a
 * word of "Parafuso M8", not of "M8x16"); then the rest. Within a rank the shorter name comes
 * first (the more of it the query says), then id order; with no query, browsing, id order alone.
 * `total` counts every match; `items` is
 * the page `offset` and `limit` (50 by default, at most `SEARCH_LIMIT`) cut from them.
 */
export function searchCatalog(
  entries: readonly CatalogEntry[],
  query: SearchQuery,
): { total: number; items: CatalogEntry[] } {
  const words = fold(query.q ?? "")
    .split(/\s+/)
    .filter((w) => w !== "");
  const whole = fold((query.q ?? "").trim());
  const rank = (e: CatalogEntry, text: string): number => {
    if (whole === "") return 3;
    const id = fold(e.id);
    const code = fold(e.code ?? localId(e.id) ?? "");
    if (id === whole || code === whole) return 0;
    if (code.startsWith(whole) || fold(localId(e.id) ?? "").startsWith(whole)) return 1;
    const own = tokens(text);
    return words.every((w) => [...tokens(w)].every((t) => own.has(t))) ? 2 : 3;
  };
  const hits = entries
    .filter(
      (e) =>
        (query.vendor === undefined || e.vendor === query.vendor) &&
        (query.kind === undefined || e.kind === query.kind) &&
        (query.family === undefined || e.family === query.family),
    )
    .map((e) => ({ e, text: fold(`${e.id} ${e.code ?? ""} ${e.name} ${e.family}`) }))
    .filter(({ text }) => words.every((w) => text.includes(w)))
    .map(({ e, text }) => ({ e, r: rank(e, text) }))
    .sort(
      (a, b) =>
        a.r - b.r ||
        (whole === "" ? 0 : a.e.name.length - b.e.name.length) ||
        compareIds(a.e.id, b.e.id),
    )
    .map(({ e }) => e);
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(Math.max(1, query.limit ?? 50), SEARCH_LIMIT);
  return { total: hits.length, items: hits.slice(offset, offset + limit) };
}
