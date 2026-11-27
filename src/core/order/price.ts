import type { OfferInfo, OfferPrice, PriceField } from "../items.ts";
import { roundHalfAway } from "../quantum.ts";

/**
 * Prices (design §4.11, §5.2, §5.3). Money is an integer of minor units: every amount is rounded
 * once, half away from zero, where it is made (a piece of a bar priced per metre, a band's low or
 * high, a conversion), and amounts made that way are then only added or multiplied by counts.
 */

/** The project's price basis (§4.11): `regular` by default (call 12). */
export type Basis = "regular" | "sale" | "lowest";

/**
 * The price an offer is bought at on the project's basis: the regular price by default; `sale`
 * takes the sale price where there is one, else the regular; `lowest` the lower of the two, the
 * regular on a tie.
 */
export function basisPrice(
  price: OfferPrice,
  basis: Basis,
): PriceField & { field: "regular" | "sale" } {
  const sale = price.sale;
  const useSale =
    sale !== null && (basis === "sale" || (basis === "lowest" && sale.v < price.regular.v));
  return useSale ? { ...sale, field: "sale" } : { ...price.regular, field: "regular" };
}

/**
 * The minor units for one offer unit, or for a length of a price per metre: the price times the
 * length in metres, rounded once (review M7's 1,240 mm at R$ 126.50/m is R$ 156.86).
 */
export function amount(minor: number, per: OfferPrice["per"], len_mm?: number): number {
  return per === "m" && len_mm !== undefined ? roundHalfAway((minor * len_mm) / 1000) : minor;
}

/** A stock bar's price on the basis, from an offer priced per bar, per metre or per unit. */
export function barPrice(o: OfferInfo, len_mm: number, basis: Basis): number {
  return amount(basisPrice(o.price, basis).v, o.price.per, len_mm);
}

/** The lowest regular price an item is sold at, as a list row shows it (BE-12). */
export interface FromPrice {
  /** Minor units of `currency`. */
  minor: number;
  currency?: string;
  /** Per metre for an item sold by length, else per unit. */
  per: "m" | "unit";
}

/**
 * The lowest regular price of an item's offers ("from R$ 126.50/m"), for a list row: per metre
 * when it is sold by length (cut, or in stock lengths, whose bar price is over its length), else
 * per unit (a pack's price over its count). A kit is left out, its price being the kit's, and so
 * is an offer whose price cannot be put that way (a length priced per unit). The likely value of
 * a quoted range. Undefined with no such offer, or when the offers are in several currencies,
 * which no rate here compares.
 */
export function fromPrice(offers: readonly OfferInfo[]): FromPrice | undefined {
  const byLength = offers.some((o) => o.sale !== undefined);
  let best: FromPrice | undefined;
  const currencies = new Set<string | undefined>();
  for (const o of offers) {
    if (o.kit) continue;
    const v = o.price.regular.v;
    let minor: number | undefined;
    if (!byLength) minor = o.price.per === "unit" ? roundHalfAway(v / o.pack) : undefined;
    else if (o.price.per === "m") minor = v;
    else if (o.sale?.mode === "stock" && o.sale.length_mm !== undefined) {
      const metres = (o.sale.length_mm * (o.price.per === "unit" ? o.pack : 1)) / 1000;
      minor = roundHalfAway(v / metres);
    }
    if (minor === undefined) continue;
    currencies.add(o.currency);
    if (!best || minor < best.minor) {
      best = {
        minor,
        ...(o.currency ? { currency: o.currency } : {}),
        per: byLength ? "m" : "unit",
      };
    }
  }
  return currencies.size > 1 ? undefined : best;
}

/** Low, likely and high, in minor units. */
export interface Money {
  low: number;
  likely: number;
  high: number;
}

export const ZERO: Money = { low: 0, likely: 0, high: 0 };

export function addMoney(a: Money, b: Money): Money {
  return { low: a.low + b.low, likely: a.likely + b.likely, high: a.high + b.high };
}

export function times(m: Money, n: number): Money {
  return { low: m.low * n, likely: m.likely * n, high: m.high * n };
}

/**
 * A price field's low, likely and high through `f` (one unit, a piece's length): a quoted range
 * gives its own low and high (a side it leaves out is the price itself); otherwise all three are
 * the price.
 */
export function fieldMoney(
  p: PriceField,
  f: (minor: number) => number,
): Money & { quoted: boolean } {
  return {
    low: f(p.low ?? p.v),
    likely: f(p.v),
    high: f(p.high ?? p.v),
    quoted: p.low !== undefined || p.high !== undefined,
  };
}

/**
 * A price band on a line's likely minor units (§4.11, G26): likely × (1 + pct / 100), computed on
 * the integer and rounded once, half away from zero, so 1005 at −10 % is 904.5 → 905, where
 * round-half-even would give 904.
 */
export function banded(likely: number, pct: number): number {
  return roundHalfAway((likely * (100 + pct)) / 100);
}

/** Minor units of another currency converted at `rate`, rounded once (§4.11: per line). */
export function convert(minor: number, rate: number): number {
  return roundHalfAway(minor * rate);
}

export function convertMoney(m: Money, rate: number): Money {
  return {
    low: convert(m.low, rate),
    likely: convert(m.likely, rate),
    high: convert(m.high, rate),
  };
}
