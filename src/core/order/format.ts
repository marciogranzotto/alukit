import type { Diagnostic } from "../diagnostics.ts";
import { lockLines, oldestText } from "../stamp.ts";
// From types.ts, not order.ts: the viewer imports these helpers, and nothing of the pricing.
import {
  type CostOut,
  type MoneyOut,
  type Order,
  type OrderLine,
  optText,
  type SupplierOrder,
  type Totals,
} from "./types.ts";

/**
 * The order list and the costs as Markdown, CSV or JSON (design §5.4: "Output as Markdown, CSV or
 * JSON"). Money is printed from its integer minor units, two decimals, never through a float.
 */

export const COSTS_SCHEMA = "alukit.costs/1";

/** Minor units as a decimal: 15686 → "156.86", -5 → "-0.05". */
export function money(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const a = Math.abs(minor);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const mm = (x: number) => x.toFixed(2);

export function supplierName(s: SupplierOrder): string {
  return s.supplier ?? "Unsourced (no offer)";
}

export function qtyText(l: OrderLine): string {
  if (l.unit === "pack") return `${l.qty} × pack of ${l.pack}`;
  if (l.unit === "bar") return `${l.qty} × bar ${mm(l.length_mm ?? 0)} mm`;
  if (l.unit === "piece" && l.length_mm !== undefined) {
    const billed =
      l.billed_mm !== undefined && l.billed_mm !== l.length_mm ? `, billed ${mm(l.billed_mm)}` : "";
    const line = l.line_billed_mm !== undefined ? `; line billed ${mm(l.line_billed_mm)}` : "";
    return `${l.qty} × ${mm(l.length_mm)} mm${billed}${line}`;
  }
  return `${l.qty} ${l.unit}${l.qty === 1 ? "" : "s"}`;
}

/** Unit price, low, likely and high, as the order list prints them. */
export function priceText(l: OrderLine): string[] {
  if (l.covered_by) return [`see ${l.covered_by}`, "", "", ""];
  if (l.likely_minor === undefined) return ["no price", "", "", ""];
  const cur = l.currency ? ` ${l.currency}` : "";
  return [
    `${money(l.unit_price_minor ?? 0)}${cur}`,
    money(l.low_minor ?? 0),
    money(l.likely_minor),
    money(l.high_minor ?? 0),
  ];
}

export function itemsText(
  xs: readonly { item: string; opt: Record<string, string>; qty: number }[],
): string {
  return xs
    .map((x) => `${x.qty} ${x.item}${Object.keys(x.opt).length > 0 ? ` (${optText(x.opt)})` : ""}`)
    .join("; ");
}

export function detailText(l: OrderLine): string {
  const parts: string[] = [];
  if (l.kit) parts.push(`each kit: ${itemsText(l.kit)}`);
  if (l.pieces) {
    parts.push(
      `pieces: ${l.pieces.map((p) => `${p.count} × ${mm(p.cut_mm)} (${p.sources.join(", ")})`).join("; ")}`,
    );
  }
  for (const s of l.services ?? []) {
    const who = s.by === "buyer" ? ", by you or a shop" : "";
    parts.push(
      `${s.count} × ${s.what}${who}${s.covered_by ? `, in ${s.covered_by}` : ", unpriced"}`,
    );
  }
  if (l.surplus) parts.push(`surplus: ${itemsText(l.surplus)}`);
  if (l.range === "quote") parts.push("range quoted");
  if (l.range === "band") parts.push(`band ${l.band}`);
  if (l.converted) parts.push(`at ${l.converted.rate}: ${money(l.converted.likely_minor)}`);
  if (l.price_src && l.price_src !== "src") parts.push(`price ${l.price_src}`);
  return parts.join("; ");
}

function moneyRow(label: string, m: MoneyOut): string {
  return `| ${label} | ${money(m.low_minor)} | ${money(m.likely_minor)} | ${money(m.high_minor)} |`;
}

function totalsMarkdown(t: Totals): string[] {
  const out = [
    `## Totals${t.currency ? ` (${t.currency})` : ""}`,
    "",
    "| | Low | Likely | High |",
    "|---|---:|---:|---:|",
    moneyRow("Order lines", t.lines),
    moneyRow("Cost lines", t.costs),
    moneyRow("Subtotal", t.subtotal),
    moneyRow("Contingency", t.contingency),
    moneyRow("**Total**", t.total),
    "",
  ];
  if (t.by_currency.length > 1) {
    out.push(
      `In each currency: ${t.by_currency.map((c) => `${c.currency} ${money(c.likely_minor)} (${money(c.low_minor)}–${money(c.high_minor)})`).join("; ")}.`,
      "",
    );
  }
  if (t.share.length > 0) {
    out.push(
      `Share of the likely total by provenance: ${t.share.map((s) => `${s.src} ${s.pct.toFixed(2)} %`).join(", ")}.`,
      "",
    );
  }
  if (t.unpriced > 0) {
    out.push(
      `${t.unpriced} order line${t.unpriced === 1 ? " has" : "s have"} no price and ${t.unpriced === 1 ? "is" : "are"} left out.`,
      "",
    );
  }
  return out;
}

/** What a cost line covers, or the share a contingency takes. */
export function coversText(c: CostOut): string {
  if (c.pct !== undefined) return `${c.pct} % of the subtotal`;
  if (!c.covers) return "";
  return [
    ...(c.covers.services ? [`${c.covers.supplier}'s machining`] : []),
    ...(c.covers.services_on
      ? [
          `machining on ${(Array.isArray(c.covers.services_on) ? c.covers.services_on : [c.covers.services_on]).map((s) => `${s.supplier}'s`).join(" and ")} bars`,
        ]
      : []),
    ...(c.covers.items ?? []),
  ].join(", ");
}

function costsMarkdown(costs: readonly CostOut[]): string[] {
  if (costs.length === 0) return [];
  const out = [
    "## Cost lines",
    "",
    "| Id | Label | Kind | Supplier | Low | Likely | High | Src | Covers |",
    "|---|---|---|---|---:|---:|---:|---|---|",
  ];
  for (const c of costs) {
    const cur = c.currency ? ` ${c.currency}` : "";
    const covers = coversText(c);
    const conv = c.converted ? ` (${money(c.converted.likely_minor)} at ${c.converted.rate})` : "";
    out.push(
      `| ${c.id} | ${c.label} | ${c.kind} | ${c.supplier ?? ""} | ${money(c.low_minor ?? 0)} | ${money(c.likely_minor ?? 0)}${cur}${conv} | ${money(c.high_minor ?? 0)} | ${c.src} | ${covers} |`,
    );
  }
  out.push("");
  return out;
}

function problems(ds: readonly Diagnostic[]): string[] {
  if (ds.length === 0) return [];
  return [
    "## Problems",
    "",
    ...ds.map((d) => `- ${d.severity} ${d.code}${d.entity ? ` ${d.entity}` : ""}: ${d.message}`),
    "",
  ];
}

export function orderMarkdown(o: Order): string {
  const out: string[] = ["# Order list", ""];
  out.push(
    `${o.status}. Prices on the ${o.price_basis} basis${o.currency ? ` in ${o.currency}` : ""}, as of ${o.as_of}; ${oldestText(o.oldest_read)}.`,
    "",
    ...lockLines(o.lock),
  );
  for (const s of o.suppliers) {
    out.push(`## ${supplierName(s)}: ${s.status}`, "");
    for (const r of s.reasons) out.push(`- **${r.action}** ${r.rule}: ${r.message}`);
    if (s.reasons.length > 0) out.push("");
    if (s.lines.length > 0) {
      out.push(
        "| SKU | Item | Name | Options | Quantity | Unit price | Low | Likely | High | Details | For |",
        "|---|---|---|---|---|---:|---:|---:|---:|---|---|",
      );
      for (const l of s.lines) {
        out.push(
          `| ${l.sku ?? ""} | ${l.item} | ${l.name} | ${optText(l.opt)} | ${qtyText(l)} | ${priceText(l).join(" | ")} | ${detailText(l)} | ${itemsText(l.bom)} |`,
        );
      }
      out.push("");
    }
    if (s.costs.length > 0) out.push(`Cost lines: ${s.costs.join(", ")}.`, "");
    out.push(
      `Supplier total${o.currency ? ` in ${o.currency}` : ""}: ${money(s.totals.likely_minor)} (${money(s.totals.low_minor)} to ${money(s.totals.high_minor)}).`,
      "",
    );
  }
  out.push(...costsMarkdown(o.costs), ...totalsMarkdown(o.totals), ...problems(o.diagnostics));
  return out.join("\n");
}

/**
 * The stamp as the first CSV rows (§5.4): `stamp` rows, each naming its field in `name` with the
 * value in `details`: the lock when derived from one, then the price basis and the oldest read
 * date (empty when no price was read).
 */
function stampRows(
  row: Row,
  s: { lock?: string; price_basis: string; oldest_read: string | null },
): void {
  if (s.lock !== undefined) row({ row: "stamp", name: "lock", details: s.lock });
  row({ row: "stamp", name: "price_basis", details: s.price_basis });
  row({ row: "stamp", name: "oldest_read", details: s.oldest_read ?? undefined });
}

function csvCell(s: string | number | undefined): string {
  if (s === undefined) return "";
  const t = String(s);
  return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

/**
 * The CSV columns: one table for order lines, cost lines and totals, told apart by `row`. `id` is
 * a cost line's; `kind` is the item's kind on a line, the cost's kind on a cost line; `price_src`
 * is where the amount came from on both.
 */
const CSV_COLUMNS = [
  "row",
  "supplier",
  "status",
  "id",
  "sku",
  "offer",
  "item",
  "name",
  "kind",
  "options",
  "qty",
  "unit",
  "pack",
  "length_mm",
  "unit_price",
  "currency",
  "low",
  "likely",
  "high",
  "range",
  "price_src",
  "read",
  "covered_by",
  "for",
  "details",
] as const;

type Column = (typeof CSV_COLUMNS)[number];
type Row = (cells: Partial<Record<Column, string | number | undefined>>) => void;

/** The columns `alukit costs` prints: the cost lines' and the totals' only. */
const COSTS_COLUMNS: readonly Column[] = [
  "row",
  "supplier",
  "id",
  "name",
  "kind",
  "currency",
  "low",
  "likely",
  "high",
  "price_src",
  "details",
];

function csvTable(columns: readonly Column[], fill: (row: Row) => void): string {
  const rows: string[] = [columns.join(",")];
  fill((cells) => rows.push(columns.map((k) => csvCell(cells[k])).join(",")));
  return `${rows.join("\n")}\n`;
}

/** One row per order line, then one per cost line, then the totals. */
export function orderCsv(o: Order): string {
  const m = (x: number | undefined) => (x === undefined ? undefined : money(x));
  return csvTable(CSV_COLUMNS, (row) => {
    stampRows(row, o);
    for (const s of o.suppliers) {
      for (const l of s.lines) {
        row({
          row: "line",
          supplier: s.supplier ?? "",
          status: s.status,
          sku: l.sku,
          offer: l.offer,
          item: l.item,
          name: l.name,
          kind: l.kind,
          options: optText(l.opt),
          qty: l.qty,
          unit: l.unit,
          pack: l.pack,
          length_mm: l.length_mm === undefined ? undefined : mm(l.length_mm),
          unit_price: m(l.unit_price_minor),
          currency: l.currency,
          low: m(l.low_minor),
          likely: m(l.likely_minor),
          high: m(l.high_minor),
          range: l.range,
          price_src: l.price_src,
          read: l.read,
          covered_by: l.covered_by,
          for: itemsText(l.bom),
          details: detailText(l),
        });
      }
    }
    for (const c of o.costs) costRow(row, c);
    totalRows(row, o.totals);
  });
}

function costRow(row: Row, c: CostOut): void {
  const conv = c.converted
    ? `at ${c.converted.rate}: ${money(c.converted.low_minor)}, ${money(c.converted.likely_minor)}, ${money(c.converted.high_minor)}`
    : undefined;
  row({
    row: "cost",
    supplier: c.supplier,
    id: c.id,
    name: c.label,
    kind: c.kind,
    currency: c.currency,
    low: c.low_minor === undefined ? undefined : money(c.low_minor),
    likely: c.likely_minor === undefined ? undefined : money(c.likely_minor),
    high: c.high_minor === undefined ? undefined : money(c.high_minor),
    price_src: c.src,
    read: c.read,
    details: [coversText(c), conv].filter((x) => x).join("; ") || undefined,
  });
}

function totalRows(row: Row, t: Totals): void {
  const parts: [string, MoneyOut][] = [
    ["lines", t.lines],
    ["costs", t.costs],
    ["subtotal", t.subtotal],
    ["contingency", t.contingency],
    ["total", t.total],
  ];
  for (const [name, x] of parts) {
    row({
      row: "total",
      name,
      currency: t.currency ?? undefined,
      low: money(x.low_minor),
      likely: money(x.likely_minor),
      high: money(x.high_minor),
    });
  }
}

export function orderJson(o: Order): string {
  return `${JSON.stringify(o, null, 2)}\n`;
}

/** `alukit costs`: the cost lines and totals of the order (§4.11, §7.3). */
export interface CostsOutput {
  schema: typeof COSTS_SCHEMA;
  currency: string | null;
  price_basis: Order["price_basis"];
  as_of: string;
  /** The order's: the oldest read date of a price its lines use, which the totals add up. */
  oldest_read: string | null;
  /** The stamp: the content hash of the lock it was derived from. */
  lock?: string;
  costs: CostOut[];
  totals: Totals;
  diagnostics: Diagnostic[];
}

export function costsOf(o: Order): CostsOutput {
  return {
    schema: COSTS_SCHEMA,
    currency: o.currency,
    price_basis: o.price_basis,
    as_of: o.as_of,
    oldest_read: o.oldest_read,
    ...(o.lock !== undefined ? { lock: o.lock } : {}),
    costs: o.costs,
    totals: o.totals,
    diagnostics: o.diagnostics,
  };
}

export function costsMarkdownDoc(c: CostsOutput): string {
  const out = [
    "# Costs",
    "",
    `Prices on the ${c.price_basis} basis${c.currency ? ` in ${c.currency}` : ""}, as of ${c.as_of}; ${oldestText(c.oldest_read)}.`,
    "",
    ...lockLines(c.lock),
    ...costsMarkdown(c.costs),
    ...totalsMarkdown(c.totals),
    ...problems(c.diagnostics),
  ];
  return out.join("\n");
}

export function costsCsv(c: CostsOutput): string {
  return csvTable(COSTS_COLUMNS, (row) => {
    stampRows(row, c);
    for (const x of c.costs) costRow(row, x);
    totalRows(row, c.totals);
  });
}

export function costsJson(c: CostsOutput): string {
  return `${JSON.stringify(c, null, 2)}\n`;
}
