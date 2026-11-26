import type { Diagnostic } from "../diagnostics.ts";
import {
  type CostOut,
  type MoneyOut,
  type Order,
  type OrderLine,
  optText,
  type SupplierOrder,
  type Totals,
} from "./order.ts";

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

function supplierName(s: SupplierOrder): string {
  return s.supplier ?? "Unsourced (no offer)";
}

function qtyText(l: OrderLine): string {
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

function priceText(l: OrderLine): string[] {
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

function itemsText(
  xs: readonly { item: string; opt: Record<string, string>; qty: number }[],
): string {
  return xs
    .map((x) => `${x.qty} ${x.item}${Object.keys(x.opt).length > 0 ? ` (${optText(x.opt)})` : ""}`)
    .join("; ");
}

function detailText(l: OrderLine): string {
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
    const covers = c.covers
      ? [
          ...(c.covers.services ? [`${c.covers.supplier}'s machining`] : []),
          ...(c.covers.services_on ? [`machining on ${c.covers.services_on.supplier}'s bars`] : []),
          ...(c.covers.items ?? []),
        ].join(", ")
      : c.pct !== undefined
        ? `${c.pct} % of the subtotal`
        : "";
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
    `${o.status}. Prices on the ${o.price_basis} basis${o.currency ? ` in ${o.currency}` : ""}, as of ${o.as_of}; the oldest was read ${o.oldest_read ?? "(none)"}.`,
    "",
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
      `Supplier total: ${money(s.totals.likely_minor)} (${money(s.totals.low_minor)} to ${money(s.totals.high_minor)}).`,
      "",
    );
  }
  out.push(...costsMarkdown(o.costs), ...totalsMarkdown(o.totals), ...problems(o.diagnostics));
  return out.join("\n");
}

function csvCell(s: string | number | undefined): string {
  if (s === undefined) return "";
  const t = String(s);
  return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

const ORDER_CSV = [
  "row",
  "supplier",
  "status",
  "sku",
  "offer",
  "item",
  "name",
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

/** One row per order line, then one per cost line, then the totals. */
export function orderCsv(o: Order): string {
  const rows: string[] = [ORDER_CSV.join(",")];
  const row = (cells: Partial<Record<(typeof ORDER_CSV)[number], string | number | undefined>>) =>
    rows.push(ORDER_CSV.map((k) => csvCell(cells[k])).join(","));
  const m = (x: number | undefined) => (x === undefined ? undefined : money(x));
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
  return `${rows.join("\n")}\n`;
}

type Row = (cells: Partial<Record<string, string | number | undefined>>) => void;

function costRow(row: Row, c: CostOut): void {
  row({
    row: "cost",
    supplier: c.supplier,
    sku: c.id,
    name: c.label,
    unit: c.kind,
    currency: c.currency,
    low: c.low_minor === undefined ? undefined : money(c.low_minor),
    likely: c.likely_minor === undefined ? undefined : money(c.likely_minor),
    high: c.high_minor === undefined ? undefined : money(c.high_minor),
    price_src: c.src,
    read: c.read,
    details: c.pct !== undefined ? `${c.pct} % of the subtotal` : undefined,
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
    costs: o.costs,
    totals: o.totals,
    diagnostics: o.diagnostics,
  };
}

export function costsMarkdownDoc(c: CostsOutput): string {
  const out = [
    "# Costs",
    "",
    `Prices on the ${c.price_basis} basis${c.currency ? ` in ${c.currency}` : ""}, as of ${c.as_of}.`,
    "",
    ...costsMarkdown(c.costs),
    ...totalsMarkdown(c.totals),
    ...problems(c.diagnostics),
  ];
  return out.join("\n");
}

export function costsCsv(c: CostsOutput): string {
  const head = [
    "row",
    "supplier",
    "sku",
    "name",
    "unit",
    "currency",
    "low",
    "likely",
    "high",
    "price_src",
    "read",
    "details",
  ];
  const rows: string[] = [head.join(",")];
  const row: Row = (cells) => rows.push(head.map((k) => csvCell(cells[k])).join(","));
  for (const x of c.costs) costRow(row, x);
  totalRows(row, c.totals);
  return `${rows.join("\n")}\n`;
}

export function costsJson(c: CostsOutput): string {
  return `${JSON.stringify(c, null, 2)}\n`;
}
