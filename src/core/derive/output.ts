import { compareIds } from "../ids.ts";
import { QUANTUM, quantize } from "../quantum.ts";
import type { V3 } from "../vec.ts";
import type { Derived, DerivedBar, ResolvedOp } from "./derive.ts";
import type { DerivedPart, EndReport, FaceResult, HardwareUse } from "./types.ts";

/**
 * `derive --json` (design §7.3, §9): the derived model as `alukit.derived/1`, a contract for
 * report builders. Output is quantised (§2: lengths 0.01 mm, angles 0.01°; unit vectors to
 * 1e-9), keys come in a fixed order and entity maps in id order, so the same input gives the
 * same bytes (§5.2).
 */

export const DERIVED_SCHEMA = "alukit.derived/1";

const len = (x: number) => quantize(x, QUANTUM.len_mm);
const ang = (x: number) => quantize(x, QUANTUM.ang_deg);
const pt = (v: V3) => v.map(len);
const dir = (v: V3) => v.map((c) => quantize(c, 1e9));

function sortedObject<T>(entries: Iterable<[string, T]>): Record<string, T> {
  return Object.fromEntries([...entries].sort(([a], [b]) => compareIds(a, b)));
}

function endJson(e: EndReport) {
  return {
    by: e.by,
    point: pt(e.point),
    normal: dir(e.normal),
    move_mm: len(e.move),
    angle_deg: ang(e.angle),
    ...(e.cut ? { cut: e.cut } : {}),
    ...(e.mitre !== undefined ? { mitre_deg: ang(e.mitre) } : {}),
    ...(e.bevel !== undefined ? { bevel_deg: ang(e.bevel) } : {}),
  };
}

function barJson(b: DerivedBar) {
  const p = b.placed;
  const opt = Object.fromEntries(Object.entries(p.opt).sort(([x], [y]) => (x < y ? -1 : 1)));
  return {
    item: p.item.id,
    opt,
    ...(p.copy ? { pattern: p.copy.pattern } : {}),
    a: pt(p.A),
    b: pt(p.B as V3),
    len_mm: len(b.lengths.len),
    cut_mm: len(b.lengths.cut),
    centre_mm: len(b.lengths.centre),
    short_mm: len(b.lengths.short),
    frame: { x: dir(p.frame.x), y: dir(p.frame.y), z: dir(p.frame.t) },
    box_mm: [
      [len(p.box.x0), len(p.box.y0)],
      [len(p.box.x1), len(p.box.y1)],
    ],
    ends: { a: endJson(b.ends.a), b: endJson(b.ends.b) },
    ...(b.ops.length > 0 ? { ops: b.ops.map(opJson) } : {}),
    ...(b.rail
      ? {
          rail: {
            how: b.rail.how,
            ...(b.rail.factory ? { factory: b.rail.factory } : {}),
            ...(b.rail.stock_mm !== undefined ? { stock_mm: len(b.rail.stock_mm) } : {}),
            pitch_mm: len(b.rail.pitch),
            E_a_mm: len(b.rail.E_a),
            E_b_mm: len(b.rail.E_b),
            holes_mm: b.rail.holes.map(len),
          },
        }
      : {}),
  };
}

/** An op as written or generated; `by` names the connection that generated it. */
function opJson(o: ResolvedOp) {
  if (o.op === "end-tap") {
    return {
      op: o.op,
      from: o.from,
      ...(o.off ? { off_mm: [len(o.off[0]), len(o.off[1])] } : {}),
      thread: o.thread,
      ...(o.depth !== undefined ? { depth_mm: len(o.depth) } : {}),
      by: o.by,
    };
  }
  if (o.op === "end-hole") {
    return {
      op: o.op,
      from: o.from,
      ...(o.off ? { off_mm: [len(o.off[0]), len(o.off[1])] } : {}),
      ...(o.d !== undefined ? { d_mm: len(o.d) } : {}),
      ...(o.thread ? { thread: o.thread } : {}),
      ...(o.depth !== undefined ? { depth_mm: len(o.depth) } : {}),
      by: o.by,
    };
  }
  const across = o.across === undefined ? 0 : len(o.across);
  return {
    op: o.op,
    face: o.face,
    from: o.from,
    at_mm: len(o.at),
    ...(across !== 0 ? { across_mm: across } : {}),
    ...(o.d !== undefined ? { d_mm: len(o.d) } : {}),
    ...(o.thread ? { thread: o.thread } : {}),
    ...(o.depth !== undefined ? { depth_mm: len(o.depth) } : {}),
    ...(o.csk ? { csk: { d_mm: len(o.csk.d), angle_deg: ang(o.csk.angle) } } : {}),
    ...(o.cbore ? { cbore: { d_mm: len(o.cbore.d), depth_mm: len(o.cbore.depth) } } : {}),
    ...(o.by ? { by: o.by } : {}),
  };
}

function sortedOpt(opt: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(opt).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
}

/** A part as `alukit.derived/1` reports it: where the viewer, the GLB and `bbox()` place it. */
export function partJson(p: DerivedPart) {
  const head = { item: p.item, kind: p.kind, opt: sortedOpt(p.opt) };
  if (!p.placed) return { ...head, unplaced: true, qty: p.qty, why: p.why };
  return {
    ...head,
    ...(p.pattern ? { pattern: p.pattern } : {}),
    ...(p.bar !== undefined ? { bar: p.bar, s_mm: len(p.s as number) } : {}),
    datum: p.datum,
    point: pt(p.point),
    frame: { x: dir(p.frame.x), y: dir(p.frame.y), z: dir(p.frame.z) },
    origin: pt(p.origin),
  };
}

function fasteningJson(f: FaceResult) {
  return {
    fastening: f.fastening,
    layers: f.layers,
    contacts: f.contacts.map((c) => ({ faces: c.faces, gap_mm: len(c.gap) })),
    ...(f.fastener
      ? {
          fastener: {
            item: f.fastener.item,
            ...(f.fastener.len !== undefined ? { len_mm: len(f.fastener.len) } : {}),
          },
        }
      : {}),
    stack: f.stack,
    stations: f.stations.map((s) => ({
      k: s.k,
      bar: s.bar,
      s_mm: len(s.s),
      across_mm: len(s.across),
      point: pt(s.point),
      axis: dir(s.axis),
      grip_mm: len(s.grip),
      layers: s.layers.map((l) => ({ id: l.id, from_mm: len(l.from), to_mm: len(l.to) })),
      ...(s.piece ? { piece: s.piece } : {}),
      ...(s.sleeves.length > 0
        ? { sleeves: s.sleeves.map((x) => ({ piece: x.piece, len_mm: len(x.len) })) }
        : {}),
    })),
  };
}

/** Hardware uses summed per item, options and source, in id order. */
function hardwareJson(hw: readonly HardwareUse[]) {
  const sum = new Map<
    string,
    { item: string; opt: Record<string, string>; source: string; qty: number }
  >();
  for (const h of hw) {
    const opt = sortedOpt(h.opt);
    const k = JSON.stringify([h.item, opt, h.source]);
    const e = sum.get(k);
    if (e) e.qty += h.qty;
    else sum.set(k, { item: h.item, opt, source: h.source, qty: h.qty });
  }
  return [...sum.values()].sort(
    (a, b) =>
      compareIds(a.item, b.item) ||
      (JSON.stringify(a.opt) < JSON.stringify(b.opt)
        ? -1
        : JSON.stringify(a.opt) > JSON.stringify(b.opt)
          ? 1
          : 0) ||
      compareIds(a.source, b.source),
  );
}

/**
 * The derived model as `alukit.derived/1`. With `lock`, the content hash of the lock it was
 * derived from, it states it (the stamp, §5.4, §9); it carries no prices, so no basis and no read
 * date. The view model (§8) draws from it without one.
 */
export function derivedJson(d: Derived, stamp: { lock?: string } = {}): Record<string, unknown> {
  return {
    schema: DERIVED_SCHEMA,
    ...(d.variant !== undefined ? { variant: d.variant } : {}),
    ...(stamp.lock !== undefined ? { lock: stamp.lock } : {}),
    params: Object.fromEntries([...d.params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    nodes: sortedObject([...d.nodes].map(([id, v]) => [id, pt(v)] as [string, number[]])),
    bars: sortedObject([...d.bars].map(([id, b]) => [id, barJson(b)] as [string, unknown])),
    runs: sortedObject(
      [...d.runs].map(([id, r]) => [id, { bars: r.bars.map((b) => b.id), len_mm: len(r.len) }]),
    ),
    pivots: sortedObject(
      [...d.pivots].map(([id, p]) => [id, { point: pt(p.P), normal: dir(p.n) }]),
    ),
    parts: sortedObject([...d.parts].map(([id, p]) => [id, partJson(p)] as [string, unknown])),
    fastenings: sortedObject(
      [...d.fastenings].map(([id, f]) => [id, fasteningJson(f)] as [string, unknown]),
    ),
    pieces: d.pieces.map((p) => ({
      source: p.source,
      item: p.item,
      opt: sortedOpt(p.opt),
      len_mm: len(p.len),
    })),
    hardware: hardwareJson(d.hardware),
    ...(d.recipes.length > 0 ? { recipes: hardwareJson(d.recipes) } : {}),
    diagnostics: d.diagnostics,
  };
}

/** Canonical text: two-space indent, final newline (§2). */
export function jsonText(x: unknown): string {
  return `${JSON.stringify(x, null, 2)}\n`;
}
