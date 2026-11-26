import { compareIds } from "../ids.ts";

/**
 * Nesting cut pieces into stock bars (design §5.3): first-fit decreasing for each stock length,
 * then each bar moved down to the cheapest stock length that still holds its pieces, and the
 * cheapest result wins (ties: fewer bars, then the longer offcut). The result minimises cost, not
 * waste. A heuristic with fixed tie-breaks and no time limit, so it is deterministic (§5.2).
 *
 * Lengths are integers in hundredths of a millimetre, the output quantum, so every comparison
 * is exact. A stock bar of length L holds pieces p1 … pn when
 * (2 − f) × trim + Σ p + (n − 1) × kerf ≤ L: a kerf between neighbours, a trim at each end that
 * no factory end occupies, and the last cut's kerf taken from the offcut (G23's arithmetic:
 * 3 × 470 + 2 × 3 = 1416 in 1500).
 *
 * A factory-drilled rail piece (§4.7, §5.3) keeps a factory end, so it stands at one end of its
 * stock bar, with no trim there: a bar holds at most two of them, f ≤ 2. A piece that names its
 * stock length goes only into that length, and its bar is never moved to another (G23): so
 * nesting never moves a hole. Without such pieces this is M3a's nesting exactly.
 */

export interface NestPiece {
  id: string;
  len: number;
  /** Keeps a factory end: stands at an end of its stock bar. */
  factory?: boolean;
  /** The only stock length it may come from. */
  stock?: number;
}

export interface NestStock {
  sku: string;
  len: number;
  /** Per bar, in minor units. */
  price: number;
}

export interface NestBar {
  stock: NestStock;
  /** In order along the bar: a factory piece at each end it occupies. */
  pieces: (NestPiece & { end?: "start" | "end" })[];
  /** (2 − f) × trim + Σ pieces + (n − 1) × kerf. */
  used: number;
}

export interface NestResult {
  bars: NestBar[];
  cost: number;
  /** Pieces no allowed stock length can hold. */
  unplaced: NestPiece[];
}

function usedBy(pieces: readonly NestPiece[], kerf: number, trim: number): number {
  const f = pieces.filter((p) => p.factory).length;
  return (
    (2 - f) * trim + pieces.reduce((s, p) => s + p.len, 0) + Math.max(0, pieces.length - 1) * kerf
  );
}

function holds(len: number, pieces: readonly NestPiece[], kerf: number, trim: number): boolean {
  return pieces.filter((p) => p.factory).length <= 2 && usedBy(pieces, kerf, trim) <= len;
}

function cmpStock(a: NestStock, b: NestStock): number {
  return a.len - b.len || a.price - b.price || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
}

interface Open {
  stock: NestStock;
  pieces: NestPiece[];
  /** Holds a piece that names its stock length: the bar keeps that length. */
  pinned: boolean;
}

/**
 * First-fit decreasing: each piece into the first bar it may share that still holds it, else a
 * new bar of its own stock length, or of `stock` for a piece that names none.
 */
function ffd(
  pieces: readonly NestPiece[],
  stock: NestStock,
  stocks: readonly NestStock[],
  kerf: number,
  trim: number,
): Open[] {
  const order = [...pieces].sort((a, b) => b.len - a.len || compareIds(a.id, b.id));
  const bars: Open[] = [];
  for (const p of order) {
    const bar = bars.find(
      (b) =>
        (p.stock === undefined || b.stock.len === p.stock) &&
        holds(b.stock.len, [...b.pieces, p], kerf, trim),
    );
    if (bar) {
      bar.pieces.push(p);
      if (p.stock !== undefined) bar.pinned = true;
    } else {
      const own =
        p.stock === undefined ? stock : (stocks.find((s) => s.len === p.stock) as NestStock);
      bars.push({ stock: own, pieces: [p], pinned: p.stock !== undefined });
    }
  }
  return bars;
}

/** A bar's pieces in order along it: a factory piece at the start, the rest, one at the end. */
function laidOut(pieces: readonly NestPiece[]): NestBar["pieces"] {
  const factory = pieces.filter((p) => p.factory);
  const rest = pieces.filter((p) => !p.factory);
  const [first, second] = factory;
  return [
    ...(first ? [{ ...first, end: "start" as const }] : []),
    ...rest,
    ...(second ? [{ ...second, end: "end" as const }] : []),
  ];
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
  const allowed = (p: NestPiece) =>
    p.stock === undefined ? sorted : sorted.filter((s) => s.len === p.stock);
  const fits = (p: NestPiece) => allowed(p).some((s) => holds(s.len, [p], kerf, trim));
  const unplaced = pieces.filter((p) => !fits(p));
  const placeable = pieces.filter(fits);
  if (placeable.length === 0) return { bars: [], cost: 0, unplaced };

  let best: NestResult | undefined;
  for (const stock of sorted) {
    if (placeable.some((p) => p.stock === undefined && !holds(stock.len, [p], kerf, trim))) {
      continue;
    }
    const bars = ffd(placeable, stock, sorted, kerf, trim).map((b): NestBar => {
      // The cheapest stock length that still holds this bar's pieces; equal prices, the
      // shorter. A bar holding a piece that names its length keeps it.
      const into = b.pinned
        ? b.stock
        : sorted
            .filter((s) => holds(s.len, b.pieces, kerf, trim))
            .reduce((m, s) => (s.price < m.price ? s : m));
      return { stock: into, pieces: laidOut(b.pieces), used: usedBy(b.pieces, kerf, trim) };
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
