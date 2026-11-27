import type { Src } from "#catalog/schema/common.ts";
import type { Diagnostic } from "../diagnostics.ts";
import type { OfferInfo, PriceField } from "../items.ts";
import type { Covers, OrderRule, RuleAction } from "../project/schema.ts";
import type { Money } from "./price.ts";

/** The order list's output (`alukit.order/1`) and the state its stages share. */

export const ORDER_SCHEMA = "alukit.order/1";

export interface ItemQty {
  item: string;
  opt: Record<string, string>;
  qty: number;
}

export interface PiecesOut {
  count: number;
  cut_mm: number;
  sources: string[];
}

export interface ServiceOut {
  /** What is done, e.g. "hole Ø11.00", "tap M8 in an end, 20.00 deep", "angled cut". */
  what: string;
  count: number;
  /**
   * Who does it: the line's `supplier` (machining on bars it cuts, or a covered job), or the
   * `buyer` (machining on whole stock bars, done by you or a shop).
   */
  by: "supplier" | "buyer";
  /** The cost line that prices it. */
  covered_by?: string;
}

export interface MoneyOut {
  low_minor: number;
  likely_minor: number;
  high_minor: number;
}

export type Unit = "unit" | "pack" | "kit" | "piece" | "bar";

export interface OrderLine {
  item: string;
  name: string;
  kind: string;
  opt: Record<string, string>;
  /** The offer, `<catalog>:<key>`, and the SKU to order. */
  offer?: string;
  sku?: string;
  qty: number;
  unit: Unit;
  /** Units per pack. */
  pack?: number;
  /** Each kit's contents. */
  kit?: ItemQty[];
  /** Supplier-cut pieces: the ordered length; stock bars: the stock length. */
  length_mm?: number;
  /** Supplier-cut pieces: the length each is billed at, and the line's when a minimum applies. */
  billed_mm?: number;
  line_billed_mm?: number;
  /** The offer's price on the basis, per its own unit. */
  per?: "unit" | "m" | "bar";
  list_minor?: number;
  /** The price of one unit of this line: a piece, a bar, a pack, a kit or a unit. */
  unit_price_minor?: number;
  currency?: string;
  low_minor?: number;
  likely_minor?: number;
  high_minor?: number;
  /** Where low and high come from: the offer's quoted range or a price band (§4.11). */
  range?: "quote" | "band";
  /** The band, by its index in `price_bands`. */
  band?: number;
  /** In the project's currency, when the line's differs (§4.11). */
  converted?: { rate: number } & MoneyOut;
  price_src?: Src;
  /** True when the basis took the sale price. */
  on_sale?: true;
  read?: string;
  covered_by?: string;
  /** The BOM lines it serves, and how much of each. */
  bom: ItemQty[];
  /** Units bought beyond the need: a pack's or a kit's. */
  surplus?: ItemQty[];
  pieces?: PiecesOut[];
  services?: ServiceOut[];
}

/** An order line's keys in output order (the interface's), whatever order a stage set them in. */
const LINE_KEYS: readonly (keyof OrderLine)[] = [
  "item",
  "name",
  "kind",
  "opt",
  "offer",
  "sku",
  "qty",
  "unit",
  "pack",
  "kit",
  "length_mm",
  "billed_mm",
  "line_billed_mm",
  "per",
  "list_minor",
  "unit_price_minor",
  "currency",
  "low_minor",
  "likely_minor",
  "high_minor",
  "range",
  "band",
  "converted",
  "price_src",
  "on_sale",
  "read",
  "covered_by",
  "bom",
  "surplus",
  "pieces",
  "services",
];

export function lineOut(l: OrderLine): OrderLine {
  const out: Record<string, unknown> = {};
  for (const k of LINE_KEYS) if (l[k] !== undefined) out[k] = l[k];
  return out as unknown as OrderLine;
}

export interface Reason {
  rule: OrderRule;
  action: "block" | "warn";
  message: string;
  entities?: string[];
}

export interface SupplierOrder {
  /** null for the lines no offer sells (§5.5's "unsourced"). */
  supplier: string | null;
  status: "READY" | "BLOCKED";
  reasons: Reason[];
  lines: OrderLine[];
  /** The cost lines that name this supplier. */
  costs: string[];
  /** Its priced lines and cost lines, in the project's currency. */
  totals: MoneyOut;
}

export interface CostOut {
  id: string;
  label: string;
  kind: string;
  supplier?: string;
  /** A contingency as a share of the subtotal. */
  pct?: number;
  of?: "subtotal";
  currency?: string;
  low_minor?: number;
  likely_minor?: number;
  high_minor?: number;
  converted?: { rate: number } & MoneyOut;
  src: Src;
  ref?: string;
  read?: string;
  note?: string;
  blocks?: "order";
  covers?: Covers;
}

export interface Totals {
  currency: string | null;
  /** Priced order lines, converted. */
  lines: MoneyOut;
  /** Cost lines other than contingencies, converted. */
  costs: MoneyOut;
  subtotal: MoneyOut;
  contingency: MoneyOut;
  total: MoneyOut;
  /** Order lines and cost lines in their own currencies; percentage contingencies in the project's. */
  by_currency: ({ currency: string } & MoneyOut)[];
  /** The likely total by provenance tag: how much rests on prices actually read (§4.11). */
  share: { src: Src; likely_minor: number; pct: number }[];
  /** Order lines with no price, left out of the totals. */
  unpriced: number;
}

export interface Order {
  schema: typeof ORDER_SCHEMA;
  currency: string | null;
  price_basis: "regular" | "sale" | "lowest";
  /** The date prices are judged against (the stale-price rule). */
  as_of: string;
  /** The oldest read date of a price the order uses. */
  oldest_read: string | null;
  /**
   * The stamp (§4.13, §9): the content hash of the lock the order was derived from, when it was
   * derived from one. With the basis and the oldest read date, what §5.4 asks every output to state.
   */
  lock?: string;
  status: "READY" | "BLOCKED";
  rules: Record<OrderRule, RuleAction>;
  suppliers: SupplierOrder[];
  costs: CostOut[];
  totals: Totals;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------------------------
// Shared by the stages

/** A group key: the supplier, or "" for the unsourced lines (supplier ids are never empty). */
export type Key = string;
export const UNSOURCED: Key = "";
export const keyOf = (supplier: string | null | undefined): Key => supplier ?? UNSOURCED;
export const supplierOf = (k: Key): string | null => (k === UNSOURCED ? null : k);

/** An order line while it is being built. */
export interface Work {
  line: OrderLine;
  key: Key;
  offer?: OfferInfo;
  /** The price field it is bought at, for a priced line. */
  field?: PriceField & { field?: "regular" | "sale" };
  /** The line's money in its own currency, before a band; `quoted` when the price is a range. */
  money?: Money & { quoted: boolean };
  /** In the project's currency; undefined when unpriced or without a rate. */
  conv?: Money;
  /** The entities it serves: bars, the connections that cut pieces, parts. */
  sources: Set<string>;
  /** Why it has no price: `no-price` is a project item that gives none (§4.8). */
  missing?: "no-offer" | "by-length" | "option" | "rate" | "placeholder" | "no-price";
  /** For `missing: "option"`: the options the item's offers sell it in, in words (BE-7). */
  sold?: string;
  placeholder?: boolean;
  /** A project item's price (§4.8): the date it was read, when it says. An offer's is its own. */
  read?: string;
}

/** The date a line's price was read: its offer's, or a project item's own. */
export function readOf(w: Work): string | undefined {
  return w.offer ? w.offer.price.read : w.read;
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function optKey(opt: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.keys(opt)
      .sort()
      .map((k) => [k, opt[k]]),
  );
}

export function sortedOpt(opt: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(opt).sort(([a], [b]) => cmp(a, b)));
}

export function optText(opt: Readonly<Record<string, string>>): string {
  return Object.keys(opt)
    .sort()
    .map((k) => `${k} ${opt[k]}`)
    .join(", ");
}

/** "a", "a or b", "a, b or c". */
function orList(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`;
}

/**
 * The options an item's offers sell it in, in words (BE-7): each option's values, the options in
 * name order and each one's values sorted, as "finish anodised or black" or "finish raw and
 * length 3000 or 6000". Empty when the offers name no option.
 */
export function soldOptionsText(offers: readonly { options: Readonly<Record<string, string>> }[]) {
  const values = new Map<string, Set<string>>();
  for (const o of offers) {
    for (const [k, v] of Object.entries(o.options))
      values.set(k, (values.get(k) ?? new Set()).add(v));
  }
  return [...values.keys()]
    .sort(cmp)
    .map((k) => `${k} ${orList([...(values.get(k) as Set<string>)].sort(cmp))}`)
    .join(" and ");
}

export const moneyOut = (m: Money): MoneyOut => ({
  low_minor: m.low,
  likely_minor: m.likely,
  high_minor: m.high,
});
