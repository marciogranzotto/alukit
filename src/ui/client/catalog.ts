import type { ListedEntry } from "../../server/catalog.ts";
import { get } from "../api.ts";
import type { ClientAnswer } from "./answer.ts";

/**
 * The catalog list (design §8, BE-8, BE-12): `GET /api/catalog/items`, the items matching a
 * search, ranked as `alukit catalog search` ranks them. `prefer` names the kind the active tool
 * wants (a bar for Draw, a connector for Connect), which ranks first within each rank without
 * leaving the others out. Each entry carries what a list row shows: a bar's own size, its
 * thumbnail, its mass per metre and its `from` price, the lowest regular one, per metre for an
 * item sold by length, else per unit, in minor units of its currency. Owner: S1.
 */

export interface CatalogQuery {
  q?: string;
  vendor?: string;
  kind?: string;
  family?: string;
  /** A kind ranked first within each rank. */
  prefer?: string;
  limit?: number;
  offset?: number;
}

export interface CatalogItems {
  /** Every match; `items` is the page asked for. */
  total: number;
  items: ListedEntry[];
}

/** The query string of a catalog search, its fields in a fixed order. */
export function catalogParams(q: CatalogQuery): string {
  const p = new URLSearchParams();
  for (const k of ["q", "vendor", "kind", "family", "prefer", "limit", "offset"] as const) {
    const v = q[k];
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  return p.toString();
}

export async function fetchCatalogItems(q: CatalogQuery): Promise<ClientAnswer<CatalogItems>> {
  try {
    const params = catalogParams(q);
    const value = await get<CatalogItems>(`/api/catalog/items${params ? `?${params}` : ""}`);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}
