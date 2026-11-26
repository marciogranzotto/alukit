import type { Derived, DerivedBar } from "../derive/derive.ts";
import { type Diagnostic, Diagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource, OfferInfo } from "../items.ts";
import type { Face } from "../project/schema.ts";
import { QUANTUM, quantize, roundHalfAway, snapCeil } from "../quantum.ts";
import { add, dot, scale, sub, type V3 } from "../vec.ts";
import { type NestStock, nest } from "./nesting.ts";

/**
 * The cut list (design §5.3). Pieces come from bars (and, from M3b, from fasteners and sleeves
 * cut from bar stock, through `extraPieces`). They are listed per bar item and option, in the
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
 */

export const CUTLIST_SCHEMA = "alukit.cutlist/1";
export const DEFAULT_KERF_MM = 3;
export const DEFAULT_TRIM_MM = 0;

/** An end's cut in the piece's own frame: square, or angled with its compound components. */
export type EndCut = "square" | { angle_deg: number; mitre_deg: number; bevel_deg: number };

/** A hole, measured along the axis from the named end's long point (§5.3). */
export interface Machining {
  op: "hole";
  face: Face;
  from: "a" | "b";
  at_mm: number;
  d_mm?: number;
  thread?: string;
  depth_mm?: number;
  csk?: { d_mm: number; angle_deg: number };
  cbore?: { d_mm: number; depth_mm: number };
}

export interface Piece {
  /** The entity it is cut for: a bar id. */
  source: string;
  item: string;
  opt: Readonly<Record<string, string>>;
  cut: number;
  centre: number;
  short: number;
  ends: { a: EndCut; b: EndCut };
  machining: Machining[];
}

export interface CutLine {
  count: number;
  cut_mm: number;
  /** For a piece with an angled end: its centre-line and short-point lengths. */
  centre_mm?: number;
  short_mm?: number;
  ends: { a: EndCut; b: EndCut };
  machining: Machining[];
  /** cut mode: each piece's ordered length (rounded to res_mm) and billed length. */
  ordered_mm?: number;
  billed_mm?: number;
  sources: string[];
}

export interface StockBar {
  sku: string;
  length_mm: number;
  price_minor: number;
  pieces: { source: string; cut_mm: number }[];
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

/** The bar's holes, each measured along the axis from its named end's long point (§5.3). */
function machiningOf(b: DerivedBar): Machining[] {
  if (b.ops.length === 0) return [];
  const lp = longPoints(b);
  return b.ops.map((op) => {
    const s = op.from === "a" ? op.at : b.lengths.len - op.at;
    return {
      op: "hole",
      face: op.face,
      from: op.from,
      at_mm: q(op.from === "a" ? s - lp.a : lp.b - s),
      ...(op.d !== undefined ? { d_mm: q(op.d) } : {}),
      ...(op.thread ? { thread: op.thread } : {}),
      ...(op.depth !== undefined ? { depth_mm: q(op.depth) } : {}),
      ...(op.csk ? { csk: { d_mm: q(op.csk.d), angle_deg: qa(op.csk.angle) } } : {}),
      ...(op.cbore ? { cbore: { d_mm: q(op.cbore.d), depth_mm: q(op.cbore.depth) } } : {}),
    };
  });
}

const FLIP_FACE: Record<Face, Face> = { "+x": "-x", "-x": "+x", "+y": "+y", "-y": "-y" };

/** The piece turned end for end (a rotation about local y): x → −x, ends swap. */
function flipped(p: Pick<Piece, "ends" | "machining">): Pick<Piece, "ends" | "machining"> {
  const flipEnd = (e: EndCut): EndCut =>
    e === "square" ? e : { ...e, mitre_deg: e.mitre_deg === 0 ? 0 : -e.mitre_deg };
  return {
    ends: { a: flipEnd(p.ends.b), b: flipEnd(p.ends.a) },
    machining: p.machining.map((m) => ({
      ...m,
      face: FLIP_FACE[m.face],
      from: m.from === "a" ? "b" : "a",
    })),
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

/** Holes in order: from end a first, then by position, face, size. */
function cmpMachining(a: Machining, b: Machining): number {
  return (
    cmpVal(a.from, b.from) ||
    cmpVal(a.at_mm, b.at_mm) ||
    cmpVal(a.face, b.face) ||
    cmpVal(a.d_mm, b.d_mm) ||
    cmpVal(a.thread, b.thread) ||
    cmpVal(a.depth_mm, b.depth_mm) ||
    cmpVal(a.csk?.d_mm, b.csk?.d_mm) ||
    cmpVal(a.csk?.angle_deg, b.csk?.angle_deg) ||
    cmpVal(a.cbore?.d_mm, b.cbore?.d_mm) ||
    cmpVal(a.cbore?.depth_mm, b.cbore?.depth_mm)
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

/** Orientations in order: the sorted machining list, then end a's cut, then end b's. */
function cmpOrientation(
  p: Pick<Piece, "ends" | "machining">,
  q: Pick<Piece, "ends" | "machining">,
) {
  const mp = [...p.machining].sort(cmpMachining);
  const mq = [...q.machining].sort(cmpMachining);
  for (let i = 0; i < Math.min(mp.length, mq.length); i++) {
    const c = cmpMachining(mp[i] as Machining, mq[i] as Machining);
    if (c !== 0) return c;
  }
  return mp.length - mq.length || cmpEnd(p.ends.a, q.ends.a) || cmpEnd(p.ends.b, q.ends.b);
}

/**
 * The canonical orientation (§5.3): of a piece and its end-for-end flip, the one whose sorted
 * machining list compares first; on a tie, the one whose end cuts compare first (a square end
 * before an angled one, then mitre and bevel by value).
 */
export function canonical(p: Piece): Piece {
  const f = flipped(p);
  return cmpOrientation(f, p) < 0 ? { ...p, ...f } : p;
}

/** Identical pieces share this key: cut length to the quantum, end cuts, machining. */
function identity(p: Pick<Piece, "ends" | "machining"> & { cut_mm: number }): string {
  return JSON.stringify([p.cut_mm, p.ends, [...p.machining].sort(cmpMachining)]);
}

export function barPieces(derived: Derived): Piece[] {
  const out: Piece[] = [];
  for (const [id, b] of derived.bars) {
    if (b.lengths.cut <= 0) continue; // reported by derive
    out.push({
      source: id,
      item: b.placed.item.id,
      opt: b.placed.opt,
      cut: b.lengths.cut,
      centre: b.lengths.centre,
      short: b.lengths.short,
      ends: { a: endCut(b.ends.a), b: endCut(b.ends.b) },
      machining: machiningOf(b),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Offers and modes

function matches(offer: OfferInfo, opt: Readonly<Record<string, string>>): boolean {
  return Object.entries(offer.options).every(([k, v]) => opt[k] === v);
}

function basisPrice(o: OfferInfo, basis: string): number {
  const sale = o.sale_minor;
  if (basis === "sale") return sale ?? o.regular_minor;
  if (basis === "lowest") return sale === null ? o.regular_minor : Math.min(sale, o.regular_minor);
  return o.regular_minor;
}

/** A stock bar's price in minor units, from an offer priced per bar, per metre or per unit. */
function barPrice(o: OfferInfo, len: number, basis: string): number {
  const p = basisPrice(o, basis);
  return o.per === "m" ? roundHalfAway((p * len) / 1000) : p;
}

// ---------------------------------------------------------------------------------------------

export interface CutListInput {
  derived: Derived;
  items: ItemSource;
  /** Pieces from later stages: fasteners and sleeves cut from bar stock (M3b). */
  extraPieces?: readonly Piece[];
}

export function cutList(input: CutListInput): CutList {
  const { derived, items } = input;
  const doc = derived.doc;
  const basis = doc.price_basis;
  const d = new Diagnostics();
  const pieces = [...barPieces(derived), ...(input.extraPieces ?? [])].map(canonical);

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
    const offers = items.offers(first.item).filter((o) => o.sale && matches(o, first.opt));
    const chosen = choice?.offer
      ? offers.find((o) => o.sku === choice.offer || o.sku.endsWith(`:${choice.offer}`))
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
        (chosen?.sale?.mode === "cut" ? chosen : undefined) ?? (cutOffers[0] as OfferInfo);
      const sale = offer.sale as NonNullable<OfferInfo["sale"]>;
      group.offer = offer.sku;
      group.supplier = offer.supplier;
      if (offer.currency) group.currency = offer.currency;
      for (const line of lines) {
        const res = sale.res_mm ?? 1;
        const step = sale.step_mm ?? res;
        const ordered = q(roundHalfAway(line.cut_mm / res) * res);
        let billed = q(snapCeil(ordered / step) * step);
        if (sale.min_bill_mm !== undefined && sale.bill !== "line")
          billed = Math.max(billed, sale.min_bill_mm);
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
        ps.map((p) => ({ id: p.source, len: h(p.cut) })),
        stocks,
        h(kerf),
        h(trim),
      );
      for (const u of res.unplaced) {
        d.error(
          "length",
          u.id,
          `${u.id} is ${u.len / 100} mm, longer than any stock length of ${first.item} less its trims: split it with a splice`,
        );
      }
      group.stock = res.bars.map((b) => {
        const sum = b.pieces.reduce((s, p) => s + p.len, 0);
        return {
          sku: b.stock.sku,
          length_mm: b.stock.len / 100,
          price_minor: b.stock.price,
          pieces: b.pieces.map((p) => ({ source: p.id, cut_mm: p.len / 100 })),
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
  return { schema: CUTLIST_SCHEMA, price_basis: basis, groups, diagnostics: d.sorted() };
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
      sources: group.map((x) => x.source).sort(compareIds),
    };
  });
  return lines.sort(
    (a, b) =>
      b.cut_mm - a.cut_mm ||
      cmpOrientation(a, b) ||
      compareIds(a.sources[0] as string, b.sources[0] as string),
  );
}
