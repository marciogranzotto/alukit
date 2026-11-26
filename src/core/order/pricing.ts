import type { Diagnostics } from "../diagnostics.ts";
import type { Doc } from "../project/parse.ts";
import type { CostLine, PriceBand } from "../project/schema.ts";
import { banded, convertMoney, type Money } from "./price.ts";
import { cmp, moneyOut, type Work } from "./types.ts";

/**
 * Low and high, and the project's currency (design §4.11). A line's low and high come from its
 * offer's quoted range; else from the most specific price band that selects it (item; then
 * supplier with kind; then supplier or kind alone; two equally specific are an error naming both);
 * else they equal its likely price. A band works on the line's likely minor units and rounds once,
 * half away from zero (G26). Lines in another currency convert per line at the project's rate.
 */

/** Units of the project's currency per unit of `c`: 1 for the same currency, undefined if none. */
export function rateFor(
  doc: Doc,
  c: string | undefined,
  pc: string | undefined,
): number | undefined {
  if (c === undefined || pc === undefined || c === pc) return 1;
  const r = doc.fx[c];
  return r === undefined ? undefined : typeof r === "number" ? r : r.v;
}

/**
 * The project's currency: the one it names; else the one every price uses; else, with several,
 * the first by code, with an error asking for one.
 */
export function projectCurrency(
  doc: Doc,
  works: readonly Work[],
  costs: readonly CostLine[],
  d: Diagnostics,
): string | undefined {
  if (doc.currency !== undefined) return doc.currency;
  const currencies = new Set<string>();
  for (const w of works) if (w.money && w.offer?.currency) currencies.add(w.offer.currency);
  for (const c of costs) if ("currency" in c && c.currency) currencies.add(c.currency);
  const list = [...currencies].sort(cmp);
  if (list.length > 1) {
    d.error(
      "currency",
      undefined,
      `prices are in ${list.join(" and ")}: name the project's currency`,
      {
        field: "currency",
      },
    );
  }
  return list[0];
}

/** Bands, provenance, conversion: fills each priced line's money fields. */
export function priceLines(
  works: readonly Work[],
  doc: Doc,
  pc: string | undefined,
  d: Diagnostics,
): void {
  const bands = doc.price_bands;
  /** Bands that select some catalog-priced line, whether or not a more specific one wins it. */
  const selected = new Set<number>();
  for (const w of works) {
    if (!w.money || !w.field) continue;
    let m: Money = w.money;
    if (w.money.quoted) w.line.range = "quote";
    else if (w.offer) {
      const b = bandFor(bands, w.line.item, w.offer.supplier, w.line.kind, selected, d);
      if (b !== undefined) {
        const band = bands[b] as PriceBand;
        m = {
          low: banded(m.likely, band.low_pct),
          likely: m.likely,
          high: banded(m.likely, band.high_pct),
        };
        w.line.range = "band";
        w.line.band = b;
      }
    }
    const currency = w.offer?.currency ?? pc;
    if (currency) w.line.currency = currency;
    w.line.low_minor = m.low;
    w.line.likely_minor = m.likely;
    w.line.high_minor = m.high;
    const rate = rateFor(doc, currency, pc);
    if (rate === undefined) w.missing = "rate";
    else if (rate === 1) w.conv = { low: m.low, likely: m.likely, high: m.high };
    else {
      w.conv = convertMoney(m, rate);
      w.line.converted = { rate, ...moneyOut(w.conv) };
    }
    w.line.price_src = w.field.src;
    if (w.field.field === "sale") w.line.on_sale = true;
    if (w.offer) w.line.read = w.offer.price.read;
  }
  // A band that selects nothing is likely a misspelt supplier or item.
  bands.forEach((b, i) => {
    if (selected.has(i)) return;
    d.warn("price-band", undefined, `price_bands[${i}] selects no line${bandWhat(b)}`, {
      field: `price_bands[${i}]`,
    });
  });
}

/** The most specific band for a line, or undefined; an error when two tie. */
function bandFor(
  bands: readonly PriceBand[],
  item: string,
  supplier: string,
  kind: string,
  selected: Set<number>,
  d: Diagnostics,
): number | undefined {
  const rank = (b: PriceBand) =>
    b.item !== undefined ? 3 : b.supplier !== undefined && b.kind !== undefined ? 2 : 1;
  const hits = bands.flatMap((b, i) =>
    (b.item === undefined || b.item === item) &&
    (b.supplier === undefined || b.supplier === supplier) &&
    (b.kind === undefined || b.kind === kind)
      ? [{ i, r: rank(b) }]
      : [],
  );
  for (const h of hits) selected.add(h.i);
  if (hits.length === 0) return undefined;
  const top = Math.max(...hits.map((h) => h.r));
  const best = hits.filter((h) => h.r === top);
  if (best.length > 1) {
    d.error(
      "price-band",
      item,
      `${best.map((h) => `price_bands[${h.i}]`).join(" and ")} are equally specific for ${item} from ${supplier}`,
      { field: "price_bands" },
    );
    return undefined;
  }
  return (best[0] as { i: number }).i;
}

function bandWhat(b: PriceBand): string {
  const parts = [
    ...(b.item !== undefined ? [`item ${b.item}`] : []),
    ...(b.supplier !== undefined ? [`supplier ${b.supplier}`] : []),
    ...(b.kind !== undefined ? [`kind ${b.kind}`] : []),
  ];
  return ` (${parts.join(", ")})`;
}
