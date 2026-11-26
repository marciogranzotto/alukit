/**
 * The cheapest cover (design §5.4): the combination of pack sizes with the lowest cost that covers
 * a quantity. 37 hammer screws sold in packs of 10 and 50 become the cheaper of 4 × 10 or 1 × 50.
 *
 * The search is exact and bounded by the quantity, with no time limit (§5.2). Covers compare by
 *
 * 1. cost;
 * 2. surplus, the units bought beyond the need;
 * 3. lines, the number of different SKUs bought;
 * 4. SKU order: the cover that buys more of the SKU first in SKU order, then of the next.
 *
 * It is a dynamic programme over (offer i, units still needed q, whether offer i is already
 * bought): from each state either buy one more unit of offer i, or move on to offer i + 1. All
 * three of cost, surplus and lines add up along a path (a pack's surplus is counted when it
 * overshoots what is left), so the lexicographic best of each state is built from its
 * successors' bests; a tie between buying and moving on goes to buying, which is rule 4. That is
 * (m + 1) × (N + 1) × 2 states for m offers and a need of N, each decided in constant time.
 */

export interface CoverOffer {
  /** The SKU, for rule 4's order. */
  sku: string;
  /** Units of the item per offer unit: a pack's size, a kit's main quantity. */
  size: number;
  /** The price of one offer unit, in minor units, on the basis. */
  cost: number;
}

export interface Cover {
  /** Offers bought, in SKU order, with how many of each. */
  lines: { offer: CoverOffer; count: number }[];
  cost: number;
  surplus: number;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The cheapest cover of `need` units (an integer ≥ 1) from `offers`, or undefined when there are
 * no offers. Every offer's size must be an integer ≥ 1 and its cost a finite number ≥ 0.
 */
export function cheapestCover(need: number, offers: readonly CoverOffer[]): Cover | undefined {
  if (!Number.isInteger(need) || need < 1) throw new RangeError(`need must be ≥ 1, not ${need}`);
  for (const o of offers) {
    if (!Number.isInteger(o.size) || o.size < 1) {
      throw new RangeError(`${o.sku}: a pack holds at least one unit, not ${o.size}`);
    }
    if (!Number.isFinite(o.cost) || o.cost < 0) throw new RangeError(`${o.sku}: cost ${o.cost}`);
  }
  if (offers.length === 0) return undefined;
  const list = [...offers].sort((a, b) => cmp(a.sku, b.sku));
  const m = list.length;
  const width = need + 1;
  // State (i, q, u) lives at ((i * width) + q) * 2 + u. Row m (no offers left) covers only q = 0.
  const size = (m + 1) * width * 2;
  const cost = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  // A surplus is below the largest pack; lines are at most the number of offers.
  const surplus = new Float64Array(size);
  const lines = new Uint16Array(size);
  const take = new Uint8Array(size);
  const at = (i: number, q: number, u: number) => (i * width + q) * 2 + u;
  for (let i = 0; i <= m; i++) {
    for (let u = 0; u < 2; u++) cost[at(i, 0, u)] = 0;
  }
  for (let i = m - 1; i >= 0; i--) {
    const o = list[i] as CoverOffer;
    for (let q = 1; q <= need; q++) {
      for (let u = 0; u < 2; u++) {
        const k = at(i, q, u);
        const skip = at(i + 1, q, 0);
        const rest = at(i, Math.max(0, q - o.size), 1);
        const tc = o.cost + (cost[rest] as number);
        const ts = Math.max(0, o.size - q) + (surplus[rest] as number);
        const tl = (u === 1 ? 0 : 1) + (lines[rest] as number);
        const sc = cost[skip] as number;
        const ss = surplus[skip] as number;
        const sl = lines[skip] as number;
        // Buying wins ties: rule 4.
        const buy = tc < sc || (tc === sc && (ts < ss || (ts === ss && tl <= sl)));
        if (buy && Number.isFinite(tc)) {
          cost[k] = tc;
          surplus[k] = ts;
          lines[k] = tl;
          take[k] = 1;
        } else {
          cost[k] = sc;
          surplus[k] = ss;
          lines[k] = sl;
        }
      }
    }
  }
  const counts = new Array<number>(m).fill(0);
  let i = 0;
  let q = need;
  let u = 0;
  while (q > 0) {
    if (take[at(i, q, u)] === 1) {
      counts[i] = (counts[i] as number) + 1;
      q = Math.max(0, q - (list[i] as CoverOffer).size);
      u = 1;
    } else {
      i += 1;
      u = 0;
    }
  }
  const chosen = list.flatMap((offer, j) => {
    const count = counts[j] as number;
    return count > 0 ? [{ offer, count }] : [];
  });
  const total = chosen.reduce((s, l) => s + l.count * l.offer.size, 0);
  return {
    lines: chosen,
    cost: chosen.reduce((s, l) => s + l.count * l.offer.cost, 0),
    surplus: total - need,
  };
}
