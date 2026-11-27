import type { Src } from "#catalog/schema/common.ts";
import type { Doc } from "../project/parse.ts";
import type { CostLine, Covers } from "../project/schema.ts";
import { roundHalfAway } from "../quantum.ts";
import { addMoney, convertMoney, type Money, ZERO } from "./price.ts";
import { rateFor } from "./pricing.ts";
import { type CostOut, cmp, moneyOut, type Totals, type Work } from "./types.ts";

/**
 * Cost lines and totals (design §4.11). Totals carry low, likely and high: the priced order lines,
 * then the cost lines, each converted per line into the project's currency; a percentage
 * contingency applies its pct to each of the low, likely and high subtotals, rounded once. The
 * share of the likely total by provenance tag says how much rests on prices actually read.
 */

const SRC_ORDER: readonly Src[] = ["src", "meas", "est", "calc"];

export interface CostsResult {
  costs: CostOut[];
  /** Each cost line in the project's currency; absent when it has no rate. */
  converted: Map<string, Money>;
  totals: Totals;
}

export function costsAndTotals(
  doc: Doc,
  works: readonly Work[],
  costs: readonly CostLine[],
  pc: string | undefined,
): CostsResult {
  const converted = new Map<string, Money>();
  const byCurrency = new Map<string, Money>();
  const addCurrency = (c: string | undefined, m: Money) => {
    if (c !== undefined) byCurrency.set(c, addMoney(byCurrency.get(c) ?? ZERO, m));
  };
  const share = new Map<Src, number>();
  const addShare = (src: Src, likely: number) => share.set(src, (share.get(src) ?? 0) + likely);

  let lines: Money = ZERO;
  for (const w of works) {
    const l = w.line;
    if (l.likely_minor !== undefined) {
      addCurrency(l.currency, {
        low: l.low_minor as number,
        likely: l.likely_minor,
        high: l.high_minor as number,
      });
    }
    if (!w.conv) continue;
    lines = addMoney(lines, w.conv);
    addShare(l.price_src ?? "est", w.conv.likely);
  }

  let costSum: Money = ZERO;
  let contingency: Money = ZERO;
  for (const c of costs) {
    if ("pct" in c) continue;
    const own: Money = { low: c.low_minor, likely: c.likely_minor, high: c.high_minor };
    const currency = c.currency ?? pc;
    addCurrency(currency, own);
    const rate = rateFor(doc, currency, pc);
    if (rate === undefined) continue; // the missing-price rule says so
    const conv = rate === 1 ? own : convertMoney(own, rate);
    converted.set(c.id, conv);
    if (c.kind === "contingency") contingency = addMoney(contingency, conv);
    else costSum = addMoney(costSum, conv);
    addShare(c.src ?? "est", conv.likely);
  }
  const subtotal = addMoney(lines, costSum);
  for (const c of costs) {
    if (!("pct" in c)) continue;
    const pct = (x: number) => roundHalfAway((x * c.pct) / 100);
    const m: Money = {
      low: pct(subtotal.low),
      likely: pct(subtotal.likely),
      high: pct(subtotal.high),
    };
    converted.set(c.id, m);
    contingency = addMoney(contingency, m);
    addCurrency(pc, m);
    addShare(c.src ?? "est", m.likely);
  }
  const total = addMoney(subtotal, contingency);

  const out: CostOut[] = costs.map((c) => {
    const conv = converted.get(c.id);
    const head = {
      id: c.id,
      label: c.label,
      kind: c.kind,
      ...(c.supplier !== undefined ? { supplier: c.supplier } : {}),
    };
    const prov = {
      src: c.src ?? ("est" as const),
      ...(c.ref !== undefined ? { ref: c.ref } : {}),
      ...(c.read !== undefined ? { read: c.read } : {}),
      ...(c.note !== undefined ? { note: c.note } : {}),
      ...(c.blocks === "order" ? { blocks: "order" as const } : {}),
    };
    if ("pct" in c) {
      return {
        ...head,
        pct: c.pct,
        of: c.of,
        ...(pc ? { currency: pc } : {}),
        ...(conv ? moneyOut(conv) : {}),
        ...prov,
      };
    }
    const currency = c.currency ?? pc;
    const rate = rateFor(doc, currency, pc);
    return {
      ...head,
      ...(currency ? { currency } : {}),
      low_minor: c.low_minor,
      likely_minor: c.likely_minor,
      high_minor: c.high_minor,
      ...(conv && rate !== undefined && rate !== 1
        ? { converted: { rate, ...moneyOut(conv) } }
        : {}),
      ...prov,
      ...(c.covers ? { covers: normalCovers(c.covers) } : {}),
    };
  });

  return {
    costs: out,
    converted,
    totals: {
      currency: pc ?? null,
      lines: moneyOut(lines),
      costs: moneyOut(costSum),
      subtotal: moneyOut(subtotal),
      contingency: moneyOut(contingency),
      total: moneyOut(total),
      by_currency: [...byCurrency.entries()]
        .sort(([a], [b]) => cmp(a, b))
        .map(([currency, m]) => ({ currency, ...moneyOut(m) })),
      share: SRC_ORDER.filter((s) => share.has(s)).map((src) => {
        const likely = share.get(src) as number;
        return {
          src,
          likely_minor: likely,
          // To 0.01 %, half away from zero.
          pct: total.likely === 0 ? 0 : roundHalfAway((likely * 10000) / total.likely) / 100,
        };
      }),
      unpriced: works.filter((w) => !w.conv && !w.line.covered_by).length,
    },
  };
}

/** A cover as written, its keys in schema order. */
function normalCovers(c: Covers): Covers {
  return {
    ...(c.supplier !== undefined ? { supplier: c.supplier } : {}),
    ...(c.services !== undefined ? { services: c.services } : {}),
    ...(c.services_on !== undefined
      ? {
          services_on: Array.isArray(c.services_on)
            ? c.services_on.map((s) => ({ supplier: s.supplier }))
            : { supplier: c.services_on.supplier },
        }
      : {}),
    ...(c.items !== undefined ? { items: [...c.items] } : {}),
  };
}
