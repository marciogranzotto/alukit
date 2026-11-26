import { compareIds } from "../ids.ts";

/**
 * Nesting cut pieces into stock bars (design §5.3): first-fit decreasing for each stock length,
 * then each bar moved down to the cheapest stock length that still holds its pieces, and the
 * cheapest result wins (ties: fewer bars, then the longer offcut). The result minimises cost, not
 * waste. A heuristic with fixed tie-breaks and no time limit, so it is deterministic (§5.2).
 *
 * Lengths are integers in hundredths of a millimetre, the output quantum, so every comparison
 * is exact. A stock bar of length L holds pieces p1 … pn when
 * 2 × trim + Σ p + (n − 1) × kerf ≤ L: a kerf between neighbours, a trim at each end, and the
 * last cut's kerf taken from the offcut (G23's arithmetic: 3 × 470 + 2 × 3 = 1416 in 1500).
 */

export interface NestPiece {
  id: string;
  len: number;
}

export interface NestStock {
  sku: string;
  len: number;
  /** Per bar, in minor units. */
  price: number;
}

export interface NestBar {
  stock: NestStock;
  pieces: NestPiece[];
  /** 2 × trim + Σ pieces + (n − 1) × kerf. */
  used: number;
}

export interface NestResult {
  bars: NestBar[];
  cost: number;
  /** Pieces no stock length can hold. */
  unplaced: NestPiece[];
}

function usedBy(pieces: readonly NestPiece[], kerf: number, trim: number): number {
  return 2 * trim + pieces.reduce((s, p) => s + p.len, 0) + Math.max(0, pieces.length - 1) * kerf;
}

function cmpStock(a: NestStock, b: NestStock): number {
  return a.len - b.len || a.price - b.price || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
}

/** First-fit decreasing into bars of one stock length. */
function ffd(
  pieces: readonly NestPiece[],
  stock: NestStock,
  kerf: number,
  trim: number,
): NestBar[] {
  const order = [...pieces].sort((a, b) => b.len - a.len || compareIds(a.id, b.id));
  const bars: NestBar[] = [];
  for (const p of order) {
    const bar = bars.find((b) => b.used + kerf + p.len <= stock.len);
    if (bar) {
      bar.pieces.push(p);
      bar.used += kerf + p.len;
    } else bars.push({ stock, pieces: [p], used: 2 * trim + p.len });
  }
  return bars;
}

function longestOffcut(bars: readonly NestBar[]): number {
  return Math.max(0, ...bars.map((b) => b.stock.len - b.used));
}

export function nest(
  pieces: readonly NestPiece[],
  stocks: readonly NestStock[],
  kerf: number,
  trim: number,
): NestResult {
  const sorted = [...stocks].sort(cmpStock);
  const longest = sorted[sorted.length - 1];
  const fits = (p: NestPiece) => longest !== undefined && 2 * trim + p.len <= longest.len;
  const unplaced = pieces.filter((p) => !fits(p));
  const placeable = pieces.filter(fits);
  if (placeable.length === 0) return { bars: [], cost: 0, unplaced };

  let best: NestResult | undefined;
  for (const stock of sorted) {
    if (placeable.some((p) => 2 * trim + p.len > stock.len)) continue;
    const bars = ffd(placeable, stock, kerf, trim).map((b) => {
      // The cheapest stock length that still holds this bar's pieces; equal prices, the shorter.
      const holds = sorted.filter((s) => s.len >= b.used);
      const cheapest = holds.reduce((m, s) => (s.price < m.price ? s : m));
      return { ...b, stock: cheapest, used: usedBy(b.pieces, kerf, trim) };
    });
    const cost = bars.reduce((s, b) => s + b.stock.price, 0);
    const cand: NestResult = { bars, cost, unplaced };
    if (
      !best ||
      cost < best.cost ||
      (cost === best.cost && bars.length < best.bars.length) ||
      (cost === best.cost &&
        bars.length === best.bars.length &&
        longestOffcut(bars) > longestOffcut(best.bars))
    ) {
      best = cand;
    }
  }
  return best ?? { bars: [], cost: 0, unplaced: pieces.slice() };
}
