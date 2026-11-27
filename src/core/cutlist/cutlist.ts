import type { Derived, DerivedBar } from "../derive/derive.ts";
import { type Diagnostic, Diagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource, OfferInfo, SaleInfo } from "../items.ts";
import { amount, type Basis, barPrice, basisPrice } from "../order/price.ts";
import type { Face } from "../project/schema.ts";
import { QUANTUM, quantize, roundHalfAway, snapCeil } from "../quantum.ts";
import { oldestRead } from "../stamp.ts";
import { add, dot, scale, sub, type V3 } from "../vec.ts";
import { type NestStock, nest } from "./nesting.ts";

/**
 * The cut list (design §5.3). Pieces come from the derived model: its bars, and the fasteners and
 * sleeves its face connections cut from bar stock. They are listed per bar item and option, in the
 * mode of the chosen offer's sale, overridable per project in `order`:
 *
 * - `cut`: the supplier cuts each piece, ordered at its cut length rounded to `res_mm` and
 *   billed in `step_mm` steps, rounded up, with `min_bill_mm` where set;
 * - `stock`: whole bars, nested with a kerf per cut and a trim at each bar end.
 *
 * Identical pieces group into one line with a count: same item and option, same cut length to
 * the quantum, same end cuts and the same machining. A piece and its end-for-end flip are the
 * same piece; the canonical orientation is the one whose sorted machining list, then end cuts,
 * compare first.
 *
 * It prices on the project's basis (the stock bars it nests, and the cheapest of several cut
 * offers), so it states that basis and the oldest read date of the offers it chose, and, derived
 * from a lock, the lock's hash (§5.4, `stamp.ts`).
 */

export const CUTLIST_SCHEMA = "alukit.cutlist/1";
export const DEFAULT_KERF_MM = 3;
export const DEFAULT_TRIM_MM = 0;

/** An end's cut in the piece's own frame: square, or angled with its compound components. */
export type EndCut = "square" | { angle_deg: number; mitre_deg: number; bevel_deg: number };

/** A hole, measured along the axis from the named end's long point (§5.3). */
export interface HoleMachining {
  op: "hole";
  face: Face;
  from: "a" | "b";
  at_mm: number;
  /** Across the face from its centre line, in §4.3's u; absent when 0. */
  across_mm?: number;
  d_mm?: number;
  thread?: string;
  depth_mm?: number;
  csk?: { d_mm: number; angle_deg: number };
  cbore?: { d_mm: number; depth_mm: number };
}

/**
 * A tapped hole in an end, along the axis (§5.3: "tap M8 at end a"): at the end's centre, or
 * `off_mm` from the section's box centre in its x and y (acceptance gap A8).
 */
export interface EndTapMachining {
  op: "end-tap";
  from: "a" | "b";
  off_mm?: [number, number];
  thread: string;
  depth_mm?: number;
}

/**
 * A hole into an end face (acceptance gap A4): `off_mm` from the section's box centre in its x
 * and y (absent at the centre), drilled `d_mm` or tapped, `depth_mm` deep or through the piece.
 * Along the axis, or, following a screw at an angle (after acceptance run 4), `angle_deg` off
 * square to the end face, coming out at `exit_mm` at the other end (or ending there, `depth_mm`
 * in).
 */
export interface EndHoleMachining {
  op: "end-hole";
  from: "a" | "b";
  off_mm?: [number, number];
  exit_mm?: [number, number];
  angle_deg?: number;
  d_mm?: number;
  thread?: string;
  depth_mm?: number;
}

export type Machining = HoleMachining | EndTapMachining | EndHoleMachining;

/** A rail piece's holes (§4.7, §5.3: "rails also list E at each end"). */
export interface PieceRail {
  holes: number;
  pitch_mm: number;
  E_a_mm: number;
  E_b_mm: number;
  /** A factory end: nesting keeps it at an end of a stock bar (§5.3). */
  factory?: "a" | "b";
  /** The stock length the piece must come from. */
  stock_mm?: number;
}

export interface Piece {
  /** The entity it is cut for: a bar id, or `<connection>.f<k>` / `.s<k>` for stock pieces. */
  source: string;
  item: string;
  opt: Readonly<Record<string, string>>;
  cut: number;
  centre: number;
  short: number;
  /** From end a's long point to end b's, along the axis: machining from b converts by it. */
  span: number;
  ends: { a: EndCut; b: EndCut };
  machining: Machining[];
  rail?: PieceRail;
}

export interface CutLine {
  count: number;
  cut_mm: number;
  /** For a piece with an angled end: its centre-line and short-point lengths. */
  centre_mm?: number;
  short_mm?: number;
  ends: { a: EndCut; b: EndCut };
  machining: Machining[];
  rail?: PieceRail;
  /** cut mode: each piece's ordered length (rounded to res_mm) and billed length. */
  ordered_mm?: number;
  billed_mm?: number;
  sources: string[];
}

export interface StockBar {
  sku: string;
  length_mm: number;
  price_minor: number;
  /** In order along the bar; a factory-drilled rail piece names the stock end it keeps. */
  pieces: { source: string; cut_mm: number; factory_end?: "start" | "end" }[];
  /** Kerfs and trims included. */
  used_mm: number;
  offcut_mm: number;
  /** Everything not a piece: kerfs, trims and the offcut. */
  waste_mm: number;
}

export interface CutGroup {
  item: string;
  name: string;
  opt: Readonly<Record<string, string>>;
  mode: "cut" | "stock" | "none";
  /** cut mode: the offer. */
  offer?: string;
  supplier?: string;
  currency?: string;
  /** stock mode. */
  kerf_mm?: number;
  trim_mm?: number;
  lines: CutLine[];
  pieces: number;
  total_mm: number;
  stock?: StockBar[];
  /** stock mode: the price of the stock bars on the project's price basis. */
  cost_minor?: number;
}

export interface CutList {
  schema: typeof CUTLIST_SCHEMA;
  price_basis: string;
  /** The oldest read date of the offers it chose: each cut group's, each stock bar's. */
  oldest_read: string | null;
  /** The stamp (§5.4, §4.13): the content hash of the lock it was derived from, when it was. */
  lock?: string;
  groups: CutGroup[];
  diagnostics: Diagnostic[];
}

const q = (x: number) => quantize(x, QUANTUM.len_mm);
const qa = (x: number) => quantize(x, QUANTUM.ang_deg);

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Options as a canonical string: keys sorted. */
function optKey(opt: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.keys(opt)
      .sort()
      .map((k) => [k, opt[k]]),
  );
}

// ---------------------------------------------------------------------------------------------
// Pieces from bars

function endCut(r: DerivedBar["ends"]["a"]): EndCut {
  if (r.mitre === undefined || r.bevel === undefined) return "square";
  return { angle_deg: qa(r.angle), mitre_deg: qa(r.mitre), bevel_deg: qa(r.bevel) };
}

/** A bar's long point at an end, as a distance along the axis from A. */
function longPoints(b: DerivedBar): { a: number; b: number; corners: V3[] } {
  const { placed: bar } = b;
  const { x, y, t } = bar.frame;
  const bx = bar.box;
  const corners: V3[] = [
    [bx.x0, bx.y0],
    [bx.x1, bx.y0],
    [bx.x1, bx.y1],
    [bx.x0, bx.y1],
  ].map(([lx, ly]) => add(scale(x, lx as number), scale(y, ly as number)));
  const sOn = (o: V3, p: V3, n: V3) => dot(sub(p, add(bar.A, o)), n) / dot(t, n);
  const fa = b.ends.a;
  const fb = b.ends.b;
  return {
    a: Math.min(...corners.map((o) => sOn(o, fa.point, fa.normal))),
    b: Math.max(...corners.map((o) => sOn(o, fb.point, fb.normal))),
    corners,
  };
}

/**
 * The bar's machining, each measured along the axis from its named end's long point (§5.3): the
 * holes a person wrote and those stage 4 generated (§5.1), and taps in its ends.
 */
function machiningOf(b: DerivedBar, lp: { a: number; b: number }): Machining[] {
  return b.ops.map((op): Machining => {
    if (op.op === "end-tap") {
      const off = op.off ? ([q(op.off[0]), q(op.off[1])] as [number, number]) : undefined;
      return {
        op: "end-tap",
        from: op.from,
        ...(off && (off[0] !== 0 || off[1] !== 0) ? { off_mm: off } : {}),
        thread: op.thread,
        ...(op.depth !== undefined ? { depth_mm: q(op.depth) } : {}),
      };
    }
    if (op.op === "end-hole") {
      const off = op.off ? ([q(op.off[0]), q(op.off[1])] as [number, number]) : undefined;
      return {
        op: "end-hole",
        from: op.from,
        ...(off && (off[0] !== 0 || off[1] !== 0) ? { off_mm: off } : {}),
        ...(op.exit ? { exit_mm: [q(op.exit[0]), q(op.exit[1])] as [number, number] } : {}),
        ...(op.angle !== undefined ? { angle_deg: qa(op.angle) } : {}),
        ...(op.d !== undefined ? { d_mm: q(op.d) } : {}),
        ...(op.thread ? { thread: op.thread } : {}),
        ...(op.depth !== undefined ? { depth_mm: q(op.depth) } : {}),
      };
    }
    const s = op.from === "a" ? op.at : b.lengths.len - op.at;
    const across = op.across === undefined ? 0 : q(op.across);
    return {
      op: "hole",
      face: op.face,
      from: op.from,
      at_mm: q(op.from === "a" ? s - lp.a : lp.b - s),
      ...(across !== 0 ? { across_mm: across } : {}),
      ...(op.d !== undefined ? { d_mm: q(op.d) } : {}),
      ...(op.thread ? { thread: op.thread } : {}),
      ...(op.depth !== undefined ? { depth_mm: q(op.depth) } : {}),
      ...(op.csk ? { csk: { d_mm: q(op.csk.d), angle_deg: qa(op.csk.angle) } } : {}),
      ...(op.cbore ? { cbore: { d_mm: q(op.cbore.d), depth_mm: q(op.cbore.depth) } } : {}),
    };
  });
}

/** A rail piece's holes and end distances (§4.7). */
function railOf(b: DerivedBar): PieceRail | undefined {
  const r = b.rail;
  if (!r) return undefined;
  return {
    holes: r.holes.length,
    pitch_mm: q(r.pitch),
    E_a_mm: q(r.E_a),
    E_b_mm: q(r.E_b),
    ...(r.factory ? { factory: r.factory } : {}),
    ...(r.stock_mm !== undefined ? { stock_mm: r.stock_mm } : {}),
  };
}

const FLIP_FACE: Record<Face, Face> = { "+x": "-x", "-x": "+x", "+y": "+y", "-y": "-y" };

type Oriented = Pick<Piece, "ends" | "machining" | "rail" | "span">;

/**
 * The piece turned end for end, a rotation about local y: t and x reverse, y stays. The ends
 * swap and a mitre changes sign; a hole's named end swaps, a `±x` face becomes the other, and an
 * offset across a `±y` face (along local x) changes sign, as does an end tap's or end hole's x.
 * A rail's end distances swap.
 */
function flipped(p: Oriented): Oriented {
  const flipEnd = (e: EndCut): EndCut =>
    e === "square" ? e : { ...e, mitre_deg: e.mitre_deg === 0 ? 0 : -e.mitre_deg };
  const other = (e: "a" | "b") => (e === "a" ? "b" : "a");
  return {
    span: p.span,
    ends: { a: flipEnd(p.ends.b), b: flipEnd(p.ends.a) },
    machining: p.machining.map((m): Machining => {
      if (m.op === "end-tap" || m.op === "end-hole") {
        // In the end face, local x reverses and y stays; so does an end hole's exit.
        return {
          ...m,
          from: other(m.from),
          ...(m.off_mm ? { off_mm: [0 - m.off_mm[0], m.off_mm[1]] as [number, number] } : {}),
          ...(m.op === "end-hole" && m.exit_mm
            ? { exit_mm: [0 - m.exit_mm[0], m.exit_mm[1]] as [number, number] }
            : {}),
        };
      }
      const out: HoleMachining = { ...m, face: FLIP_FACE[m.face], from: other(m.from) };
      if (m.across_mm !== undefined && (m.face === "+y" || m.face === "-y")) {
        out.across_mm = 0 - m.across_mm;
      }
      return out;
    }),
    ...(p.rail
      ? {
          rail: {
            ...p.rail,
            E_a_mm: p.rail.E_b_mm,
            E_b_mm: p.rail.E_a_mm,
            ...(p.rail.factory ? { factory: other(p.rail.factory) } : {}),
          },
        }
      : {}),
  };
}

/** Compares two values, undefined first, numbers by value, strings by code point. */
function cmpVal(a: number | string | undefined, b: number | string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return cmp(String(a), String(b));
}

/** End taps, then holes into an end, then holes in the faces. */
const OP_RANK: Record<Machining["op"], number> = { "end-tap": 0, "end-hole": 1, hole: 2 };

/**
 * Machining as listed: from end a first; at each end its taps by place, then its end holes by
 * place and size, then holes by position, face, offset across and size.
 */
function cmpMachining(a: Machining, b: Machining): number {
  const c = cmpVal(a.from, b.from) || cmpVal(OP_RANK[a.op], OP_RANK[b.op]);
  if (c !== 0) return c;
  if (a.op === "end-tap" || b.op === "end-tap") {
    const ta = a as EndTapMachining;
    const tb = b as EndTapMachining;
    return (
      cmpVal(ta.off_mm?.[0] ?? 0, tb.off_mm?.[0] ?? 0) ||
      cmpVal(ta.off_mm?.[1] ?? 0, tb.off_mm?.[1] ?? 0) ||
      cmpVal(a.thread, b.thread) ||
      cmpVal(a.depth_mm, b.depth_mm)
    );
  }
  if (a.op === "end-hole" || b.op === "end-hole") {
    const ea = a as EndHoleMachining;
    const eb = b as EndHoleMachining;
    return (
      cmpVal(ea.off_mm?.[0] ?? 0, eb.off_mm?.[0] ?? 0) ||
      cmpVal(ea.off_mm?.[1] ?? 0, eb.off_mm?.[1] ?? 0) ||
      cmpVal(ea.angle_deg, eb.angle_deg) ||
      cmpVal(ea.exit_mm?.[0], eb.exit_mm?.[0]) ||
      cmpVal(ea.exit_mm?.[1], eb.exit_mm?.[1]) ||
      cmpVal(ea.d_mm, eb.d_mm) ||
      cmpVal(ea.thread, eb.thread) ||
      cmpVal(ea.depth_mm, eb.depth_mm)
    );
  }
  return (
    cmpVal(a.at_mm, b.at_mm) ||
    cmpVal(a.face, b.face) ||
    cmpVal(a.across_mm ?? 0, b.across_mm ?? 0) ||
    cmpVal(a.d_mm, b.d_mm) ||
    cmpVal(a.thread, b.thread) ||
    cmpVal(a.depth_mm, b.depth_mm) ||
    cmpVal(a.csk?.d_mm, b.csk?.d_mm) ||
    cmpVal(a.csk?.angle_deg, b.csk?.angle_deg) ||
    cmpVal(a.cbore?.d_mm, b.cbore?.d_mm) ||
    cmpVal(a.cbore?.depth_mm, b.cbore?.depth_mm)
  );
}

type Key = (string | number)[];

/**
 * What a piece of machining is, whichever end it is written from: a hole by its position from
 * end a's long point (one from end b converts by the piece's span), and a plain through hole by
 * its axis only, since the same hole can be named from either face of it. Identity and the
 * canonical orientation compare these, so a hole written from b groups with the same hole
 * written from a.
 */
function physical(m: Machining, span: number): Key {
  if (m.op === "end-tap") {
    return [0, m.from, m.off_mm?.[0] ?? 0, m.off_mm?.[1] ?? 0, m.thread, m.depth_mm ?? -1];
  }
  if (m.op === "end-hole") {
    // A hole along the axis has no exit apart from its entry, and no angle.
    return [
      0.5,
      m.from,
      m.off_mm?.[0] ?? 0,
      m.off_mm?.[1] ?? 0,
      m.angle_deg ?? 0,
      m.exit_mm?.[0] ?? m.off_mm?.[0] ?? 0,
      m.exit_mm?.[1] ?? m.off_mm?.[1] ?? 0,
      m.d_mm ?? -1,
      m.thread ?? "",
      m.depth_mm ?? -1,
    ];
  }
  const pos = m.from === "a" ? m.at_mm : q(span - m.at_mm);
  const plain = m.depth_mm === undefined && !m.csk && !m.cbore;
  return [
    1,
    pos,
    plain ? `+${m.face[1]}` : m.face,
    m.across_mm ?? 0,
    m.d_mm ?? -1,
    m.thread ?? "",
    m.depth_mm ?? -1,
    m.csk?.d_mm ?? -1,
    m.csk?.angle_deg ?? -1,
    m.cbore?.d_mm ?? -1,
    m.cbore?.depth_mm ?? -1,
  ];
}

function cmpKey(a: Key, b: Key): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = cmpVal(a[i], b[i]);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

function physicalList(p: Oriented): Key[] {
  return p.machining.map((m) => physical(m, q(p.span))).sort(cmpKey);
}

function railKey(r: PieceRail | undefined): Key {
  return r ? [r.holes, r.pitch_mm, r.E_a_mm, r.E_b_mm, r.stock_mm ?? -1] : [];
}

/**
 * Orientations in order: the sorted machining, then a rail's end distances, then end a's cut,
 * then end b's.
 */
function cmpOrientation(p: Oriented, o: Oriented): number {
  const mp = physicalList(p);
  const mo = physicalList(o);
  for (let i = 0; i < Math.min(mp.length, mo.length); i++) {
    const c = cmpKey(mp[i] as Key, mo[i] as Key);
    if (c !== 0) return c;
  }
  return (
    mp.length - mo.length ||
    cmpKey(railKey(p.rail), railKey(o.rail)) ||
    cmpEnd(p.ends.a, o.ends.a) ||
    cmpEnd(p.ends.b, o.ends.b)
  );
}

/** A square end first; angled ends by mitre, then bevel, then angle, by value. */
function cmpEnd(a: EndCut, b: EndCut): number {
  if (a === "square" || b === "square") return a === b ? 0 : a === "square" ? -1 : 1;
  return (
    cmpVal(a.mitre_deg, b.mitre_deg) ||
    cmpVal(a.bevel_deg, b.bevel_deg) ||
    cmpVal(a.angle_deg, b.angle_deg)
  );
}

/**
 * The canonical orientation (§5.3): of a piece and its end-for-end flip, the one whose sorted
 * machining compares first; on a tie, a rail's end distances, then the end cuts (a square end
 * before an angled one, then mitre and bevel by value).
 */
export function canonical(p: Piece): Piece {
  const f = flipped(p);
  return cmpOrientation(f, p) < 0 ? { ...p, ...f } : p;
}

/**
 * Identical pieces share this key: cut length to the quantum, end cuts, machining as it is
 * physically, and a rail's holes. The factory end is not part of it: a rail piece and its flip
 * are the same piece.
 */
function identity(p: Oriented & { cut_mm: number }): string {
  const rail = p.rail && { ...p.rail, factory: undefined };
  return JSON.stringify([p.cut_mm, p.ends, physicalList(p), railKey(rail)]);
}

/** The pieces of the document's bars, with their machining and rail holes. */
export function barPieces(derived: Derived): Piece[] {
  const out: Piece[] = [];
  for (const [id, b] of derived.bars) {
    if (b.lengths.cut <= 0) continue; // reported by derive
    const lp = longPoints(b);
    const rail = railOf(b);
    out.push({
      source: id,
      item: b.placed.item.id,
      opt: b.placed.opt,
      cut: b.lengths.cut,
      centre: b.lengths.centre,
      short: b.lengths.short,
      span: lp.b - lp.a,
      ends: { a: endCut(b.ends.a), b: endCut(b.ends.b) },
      machining: machiningOf(b, lp),
      ...(rail ? { rail } : {}),
    });
  }
  return out;
}

/** Fasteners and sleeves cut from bar stock (§4.5): square pieces with no machining. */
export function stockPieces(derived: Derived): Piece[] {
  return derived.pieces.map((p) => ({
    source: p.source,
    item: p.item,
    opt: p.opt,
    cut: p.len,
    centre: p.len,
    short: p.len,
    span: p.len,
    ends: { a: "square", b: "square" },
    machining: [],
  }));
}

/** Every piece the derived model cuts from bar stock: its bars, then its fasteners and sleeves. */
export function derivedPieces(derived: Derived): Piece[] {
  return [...barPieces(derived), ...stockPieces(derived)];
}

// ---------------------------------------------------------------------------------------------
// Offers and modes

/** True when the offer sells these options: every option it names has the value asked for. */
export function offerMatches(offer: OfferInfo, opt: Readonly<Record<string, string>>): boolean {
  return Object.entries(offer.options).every(([k, v]) => opt[k] === v);
}

/** True when `choice` (as written in the project's `order` map) names this offer. */
export function namesOffer(offer: OfferInfo, choice: string): boolean {
  return offer.sku === choice || offer.sku.endsWith(`:${choice}`);
}

/**
 * A supplier-cut piece's ordered and billed lengths (§5.3): the cut length rounded to `res_mm`,
 * then billed in `step_mm` steps, rounded up, with `min_bill_mm` per piece where set. A line-level
 * minimum (`bill: "line"`) is the order list's.
 */
export function cutBilling(cut_mm: number, sale: SaleInfo): { ordered: number; billed: number } {
  const res = sale.res_mm ?? 1;
  const step = sale.step_mm ?? res;
  const ordered = q(roundHalfAway(cut_mm / res) * res);
  let billed = q(snapCeil(ordered / step) * step);
  if (sale.min_bill_mm !== undefined && sale.bill !== "line") {
    billed = Math.max(billed, sale.min_bill_mm);
  }
  return { ordered, billed };
}

/**
 * The cheapest of several cut offers for a group's lines on the project's basis: each piece is
 * billed by the offer's own steps and priced once; ties go to SKU order (the offers come sorted).
 */
function cheapestCut(offers: readonly OfferInfo[], lines: readonly CutLine[], basis: Basis) {
  let best: { offer: OfferInfo; cost: number } | undefined;
  for (const o of offers) {
    const p = basisPrice(o.price, basis).v;
    const sale = o.sale as SaleInfo;
    const cost = lines.reduce(
      (s, l) => s + l.count * amount(p, o.price.per, cutBilling(l.cut_mm, sale).billed),
      0,
    );
    if (!best || cost < best.cost) best = { offer: o, cost };
  }
  return best?.offer;
}

// ---------------------------------------------------------------------------------------------

export interface CutListInput {
  derived: Derived;
  items: ItemSource;
  /** The content hash of the lock the items come from: the cut list states it. */
  lock?: string;
}

export function cutList(input: CutListInput): CutList {
  const { derived, items } = input;
  const doc = derived.doc;
  const basis = doc.price_basis;
  const d = new Diagnostics();
  /** The read dates of the offers chosen. */
  const reads: (string | undefined)[] = [];
  const pieces = derivedPieces(derived).map(canonical);

  const byGroup = new Map<string, Piece[]>();
  for (const p of pieces) {
    const k = `${p.item}\u0000${optKey(p.opt)}`;
    const list = byGroup.get(k) ?? [];
    list.push(p);
    byGroup.set(k, list);
  }
  const keys = [...byGroup.keys()].sort((a, b) => {
    const [ia, oa] = a.split("\u0000") as [string, string];
    const [ib, ob] = b.split("\u0000") as [string, string];
    return compareIds(ia, ib) || cmp(oa, ob);
  });

  const groups: CutGroup[] = [];
  for (const k of keys) {
    const ps = byGroup.get(k) as Piece[];
    const first = ps[0] as Piece;
    const found = items.item(first.item);
    const name = found.ok ? (found.item.name ?? first.item) : first.item;
    const choice = doc.order[first.item];
    const offers = items.offers(first.item).filter((o) => o.sale && offerMatches(o, first.opt));
    const chosen = choice?.offer
      ? offers.find((o) => namesOffer(o, choice.offer as string))
      : undefined;
    if (choice?.offer && !chosen) {
      d.error(
        "order",
        first.item,
        `order: no offer "${choice.offer}" of ${first.item} for these options`,
      );
    }
    const cutOffers = offers.filter((o) => o.sale?.mode === "cut");
    const stockOffers = offers.filter((o) => o.sale?.mode === "stock");
    let mode: CutGroup["mode"] =
      choice?.sale ??
      chosen?.sale?.mode ??
      (cutOffers.length > 0 ? "cut" : stockOffers.length > 0 ? "stock" : "none");
    if (mode === "cut" && cutOffers.length === 0) mode = "none";
    if (mode === "stock" && stockOffers.length === 0) mode = "none";
    if (mode === "none") {
      d.warn(
        "no-offer",
        first.item,
        `${first.item} ${optKey(first.opt)} has no offer that sells it by length`,
      );
    }

    const lines = groupLines(ps);
    const group: CutGroup = {
      item: first.item,
      name,
      opt: first.opt,
      mode,
      lines,
      pieces: ps.length,
      total_mm: q(ps.reduce((s, p) => s + q(p.cut), 0)),
    };

    if (mode === "cut") {
      const offer =
        (chosen?.sale?.mode === "cut" ? chosen : undefined) ??
        (cheapestCut(cutOffers, lines, basis) as OfferInfo);
      const sale = offer.sale as SaleInfo;
      reads.push(offer.price.read);
      group.offer = offer.sku;
      group.supplier = offer.supplier;
      if (offer.currency) group.currency = offer.currency;
      for (const line of lines) {
        const { ordered, billed } = cutBilling(line.cut_mm, sale);
        line.ordered_mm = ordered;
        line.billed_mm = billed;
        if (sale.min_mm !== undefined && line.cut_mm < sale.min_mm) {
          for (const s of line.sources) {
            d.error(
              "length",
              s,
              `${s} is ${line.cut_mm} mm, shorter than ${offer.sku}'s minimum ${sale.min_mm} mm`,
            );
          }
        }
        if (sale.max_mm !== undefined && line.cut_mm > sale.max_mm) {
          for (const s of line.sources) {
            d.error(
              "length",
              s,
              `${s} is ${line.cut_mm} mm, longer than ${offer.sku}'s maximum ${sale.max_mm} mm: split it with a splice`,
            );
          }
        }
      }
    }

    if (mode === "stock") {
      const cutting = doc.defaults.cutting ?? {};
      const kerf = choice?.kerf_mm ?? cutting.kerf_mm ?? DEFAULT_KERF_MM;
      const trim = choice?.trim_mm ?? cutting.trim_mm ?? DEFAULT_TRIM_MM;
      group.kerf_mm = kerf;
      group.trim_mm = trim;
      const h = (x: number) => roundHalfAway(x * 100);
      const stocks: NestStock[] = stockOffers.map((o) => ({
        sku: o.sku,
        len: h(o.sale?.length_mm as number),
        price: barPrice(o, o.sale?.length_mm as number, basis),
      }));
      const supplierOf = new Map(stockOffers.map((o) => [o.sku, o]));
      const res = nest(
        ps.map((p) => ({
          id: p.source,
          len: h(p.cut),
          ...(p.rail?.factory ? { factory: true } : {}),
          ...(p.rail?.stock_mm !== undefined ? { stock: h(p.rail.stock_mm) } : {}),
        })),
        stocks,
        h(kerf),
        h(trim),
      );
      for (const u of res.unplaced) {
        d.error(
          "length",
          u.id,
          u.stock !== undefined
            ? `${u.id} is ${u.len / 100} mm and must come from ${first.item}'s ${u.stock / 100} mm stock length, which does not hold it`
            : `${u.id} is ${u.len / 100} mm, longer than any stock length of ${first.item} less its trims: split it with a splice`,
        );
      }
      group.stock = res.bars.map((b) => {
        reads.push(supplierOf.get(b.stock.sku)?.price.read);
        const sum = b.pieces.reduce((s, p) => s + p.len, 0);
        return {
          sku: b.stock.sku,
          length_mm: b.stock.len / 100,
          price_minor: b.stock.price,
          pieces: b.pieces.map((p) => ({
            source: p.id,
            cut_mm: p.len / 100,
            ...(p.end ? { factory_end: p.end } : {}),
          })),
          used_mm: b.used / 100,
          offcut_mm: (b.stock.len - b.used) / 100,
          waste_mm: (b.stock.len - sum) / 100,
        };
      });
      group.cost_minor = res.cost;
      const one = supplierOf.get(res.bars[0]?.stock.sku ?? "");
      if (one) {
        group.supplier = one.supplier;
        if (one.currency) group.currency = one.currency;
      }
    }
    groups.push(group);
  }
  return {
    schema: CUTLIST_SCHEMA,
    price_basis: basis,
    oldest_read: oldestRead(reads),
    ...(input.lock !== undefined ? { lock: input.lock } : {}),
    groups,
    diagnostics: d.sorted(),
  };
}

/** Groups identical pieces (in canonical orientation) into lines: longest first. */
function groupLines(ps: readonly Piece[]): CutLine[] {
  const byKey = new Map<string, Piece[]>();
  for (const p of ps) {
    const k = identity({ ...p, cut_mm: q(p.cut) });
    const list = byKey.get(k) ?? [];
    list.push(p);
    byKey.set(k, list);
  }
  const lines: CutLine[] = [...byKey.values()].map((group) => {
    const p = group[0] as Piece;
    const angled = p.ends.a !== "square" || p.ends.b !== "square";
    return {
      count: group.length,
      cut_mm: q(p.cut),
      ...(angled ? { centre_mm: q(p.centre), short_mm: q(p.short) } : {}),
      ends: p.ends,
      machining: [...p.machining].sort(cmpMachining),
      ...(p.rail ? { rail: p.rail } : {}),
      sources: group.map((x) => x.source).sort(compareIds),
    };
  });
  return lines.sort(
    (a, b) =>
      b.cut_mm - a.cut_mm ||
      cmpListed(a, b) ||
      compareIds(a.sources[0] as string, b.sources[0] as string),
  );
}

/** Lines of one length in order: their machining as listed, a rail's holes, then the end cuts. */
function cmpListed(a: CutLine, b: CutLine): number {
  for (let i = 0; i < Math.min(a.machining.length, b.machining.length); i++) {
    const c = cmpMachining(a.machining[i] as Machining, b.machining[i] as Machining);
    if (c !== 0) return c;
  }
  return (
    a.machining.length - b.machining.length ||
    cmpKey(railKey(a.rail), railKey(b.rail)) ||
    cmpEnd(a.ends.a, b.ends.a) ||
    cmpEnd(a.ends.b, b.ends.b)
  );
}
