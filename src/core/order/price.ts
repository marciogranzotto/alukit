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
