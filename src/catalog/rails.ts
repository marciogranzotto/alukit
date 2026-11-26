import { snapInt } from "#core/quantum.ts";
import { num, type Valued } from "./schema/common.ts";
import type { BarItem } from "./schema/items.ts";
import type { Offer } from "./schema/offers.ts";

/**
 * Rails sold in stock lengths (design 2.1, §3.2, §4.7). A stock offer may state `factory_E_mm`, the
 * end distance at both ends of the stock length as the maker drills it. When it does not, the
 * layout is taken as centred: the most holes at the pitch that keep both ends at least `E_min_mm`,
 * with the remainder split between the ends,
 *
 *   E = ((length − 2 E_min) mod pitch) / 2 + E_min,
 *
 * tagged `est`, since the maker did not say so.
 */

export const CENTRED_NOTE =
  "not stated by the seller: the centred layout's, ((length − 2 E_min) mod pitch) / 2 + E_min (design §3.2)";

/**
 * The factory end distance of a rail's stock offer: as stated, or the centred layout's, tagged
 * `est`. Undefined when the offer is not a stock offer of a rail with hole data, or the length is
 * shorter than two minimum end distances.
 */
export function factoryE(rail: BarItem, offer: Offer): Valued | undefined {
  const sale = offer.sale;
  if (sale?.mode !== "stock" || rail.shape !== "rail" || !rail.rail) return undefined;
  if (sale.factory_E_mm !== undefined) return sale.factory_E_mm;
  const pitch = num(rail.rail.pitch_mm);
  const eMin = num(rail.rail.E_min_mm);
  const span = sale.length_mm - 2 * eMin;
  if (span < 0 || pitch <= 0) return undefined;
  // Snap the hole count so that a span of an exact number of pitches leaves no remainder.
  const holes = Math.floor(snapInt(span / pitch));
  const rest = Math.max(span - holes * pitch, 0);
  return { v: rest / 2 + eMin, src: "est", note: CENTRED_NOTE };
}
