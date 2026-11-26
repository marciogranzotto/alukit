import { compareIds } from "../ids.ts";
import { QUANTUM, quantize } from "../quantum.ts";
import type { V3 } from "../vec.ts";
import type { Derived, DerivedBar } from "./derive.ts";
import type { EndReport } from "./types.ts";

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
    ...(b.ops.length > 0
      ? {
          ops: b.ops.map((o) => ({
            op: o.op,
            face: o.face,
            from: o.from,
            at_mm: len(o.at),
            ...(o.d !== undefined ? { d_mm: len(o.d) } : {}),
            ...(o.thread ? { thread: o.thread } : {}),
            ...(o.depth !== undefined ? { depth_mm: len(o.depth) } : {}),
          })),
        }
      : {}),
  };
}

export function derivedJson(d: Derived): Record<string, unknown> {
  return {
    schema: DERIVED_SCHEMA,
    params: Object.fromEntries([...d.params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    nodes: sortedObject([...d.nodes].map(([id, v]) => [id, pt(v)] as [string, number[]])),
    bars: sortedObject([...d.bars].map(([id, b]) => [id, barJson(b)] as [string, unknown])),
    runs: sortedObject(
      [...d.runs].map(([id, r]) => [id, { bars: r.bars.map((b) => b.id), len_mm: len(r.len) }]),
    ),
    pivots: sortedObject(
      [...d.pivots].map(([id, p]) => [id, { point: pt(p.P), normal: dir(p.n) }]),
    ),
    diagnostics: d.diagnostics,
  };
}

/** Canonical text: two-space indent, final newline (§2). */
export function jsonText(x: unknown): string {
  return `${JSON.stringify(x, null, 2)}\n`;
}
