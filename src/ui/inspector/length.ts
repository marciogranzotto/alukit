import { type Ast, FUNCTIONS, freeNames, parseExpr } from "#core/expr.ts";
import type { Model } from "../model.ts";
import { isObject, written } from "./words.ts";

/**
 * A bar's length in the inspector (docs/ux/plan.md S5.3, F5): what sets it, and the `setBar`
 * patch that gives it a new one. The length is end b's distance from end a along the bar, so a new
 * length moves end b along the bar's own line and leaves end a where it is.
 *
 * - End b written as coordinates: the coordinates that change are written as numbers, the others
 *   stay as written (a post's `["W", 0, "H"]` keeps its `W`).
 * - End b written as `{ len_mm, dir }`: its `len_mm` is written.
 * - A coordinate (or `len_mm`) written as an expression over params: the length is driven by
 *   those params, and the inspector says so ("driven by H: edit H") rather than overwriting a
 *   param's link with a number. An expression that reads another entity (`len(b3)`) sets it too.
 * - End b at a reference (a node, another bar's end, a station, a pivot): that sets the length,
 *   and the inspector says what it is.
 *
 * Pure. Owner: S5.
 */

export type LengthMode =
  /** Editable: the design length, mm, and how end b is written. */
  | { kind: "edit"; len: number; how: "coords" | "free"; note?: string }
  /** Driven by params (`params`), or by an expression that reads other entities (none). */
  | { kind: "driven"; len: number; params: string[]; expr: string }
  /** End b is a reference: what it is, and the entities it names. */
  | { kind: "ref"; len: number; text: string; refs: string[] }
  | { kind: "none"; why: string };

/** Whether an expression reads another entity through an accessor (`len(b3)`, `sec(b3).t_mm`). */
function readsEntity(a: Ast): boolean {
  switch (a.t) {
    case "unary":
      return readsEntity(a.e);
    case "bin":
      return readsEntity(a.l) || readsEntity(a.r);
    case "member":
      return readsEntity(a.e);
    case "call":
      return !FUNCTIONS.has(a.name) || a.args.some(readsEntity);
    default:
      return false;
  }
}

/**
 * What drives a written value: the params it reads, or none when it reads another entity; undefined
 * when it is a constant (a number, or an expression of numbers alone), which a new length may
 * overwrite. Text that does not parse is left alone, as driven by nothing the inspector knows.
 */
function drivers(src: string): { params: string[] } | undefined {
  let ast: Ast;
  try {
    ast = parseExpr(src);
  } catch {
    return { params: [] };
  }
  const params = [...freeNames(ast)].sort();
  if (params.length > 0 || readsEntity(ast)) return { params };
  return undefined;
}

/** What an end written as a reference is, in words, and the entities it names. */
export function pointRefWords(v: unknown): { text: string; refs: string[] } | undefined {
  if (typeof v === "string") {
    if (/^b\d+\.[ab]$/.test(v)) {
      const [bar, e] = v.split(".") as [string, string];
      return { text: `at ${bar}'s end ${e}`, refs: [bar] };
    }
    if (/^n\d+$/.test(v)) return { text: `at point ${v}`, refs: [v] };
    return { text: `at ${v}`, refs: [] };
  }
  if (isObject(v) && isObject(v.on)) {
    const s = v.on;
    const where = [
      typeof s.face === "string" ? `face ${s.face}` : undefined,
      typeof s.groove === "string" ? `groove ${s.groove}` : undefined,
    ].filter((x) => x !== undefined);
    const bar = String(s.bar);
    return {
      text: `on ${bar} at ${String(s.at_mm)} mm${typeof s.from === "string" ? ` from ${s.from}` : ""}${where.length > 0 ? `, ${where.join(", ")}` : ""}`,
      refs: [bar],
    };
  }
  if (isObject(v) && typeof v.pivot === "string") {
    return { text: `at pivot ${v.pivot}`, refs: [v.pivot] };
  }
  return undefined;
}

const round = (x: number) => {
  const r = Math.round(x * 1e4) / 1e4;
  return r === 0 ? 0 : r;
};

/** The written coordinates of b that a move along the bar changes: those whose axis it has. */
function movingAxes(m: Model, id: string): number[] {
  const d = m.derived.bars[id];
  if (!d) return [];
  const len = d.len_mm;
  return [0, 1, 2].filter((i) => Math.abs((d.b[i] as number) - (d.a[i] as number)) / len > 1e-9);
}

export function lengthMode(m: Model, id: string): LengthMode {
  const w = written(m, id);
  const d = m.derived.bars[id];
  if (!isObject(w)) return { kind: "none", why: "a pattern copy: its template sets it" };
  if (!d) return { kind: "none", why: "it does not derive: see the problems" };
  const b = w.b;
  if (Array.isArray(b) && b.length === 3) {
    for (const i of movingAxes(m, id)) {
      const c = b[i];
      if (typeof c === "string") {
        const by = drivers(c);
        if (by) return { kind: "driven", len: d.len_mm, params: by.params, expr: c };
      }
    }
    return { kind: "edit", len: d.len_mm, how: "coords" };
  }
  if (isObject(b) && b.len_mm !== undefined) {
    const l = b.len_mm;
    const fromCut = b.from === "a.cut";
    if (typeof l === "string") {
      const by = drivers(l);
      if (by) return { kind: "driven", len: d.len_mm, params: by.params, expr: l };
    }
    const value = typeof l === "number" ? l : d.len_mm;
    return {
      kind: "edit",
      len: value,
      how: "free",
      ...(fromCut ? { note: "counted from end a's cut" } : {}),
    };
  }
  const ref = pointRefWords(b);
  if (ref) return { kind: "ref", len: d.len_mm, text: `end b is ${ref.text}`, refs: ref.refs };
  return { kind: "none", why: "end b is written in a form the inspector cannot edit" };
}

/**
 * The `setBar` patch that gives the bar a new length, or why it cannot: end b moved along the
 * bar's line from end a's design point (coordinates), or its `len_mm` (a free end).
 */
export function lengthPatch(
  m: Model,
  id: string,
  len: number,
): { set: Record<string, unknown> } | { why: string } {
  if (!Number.isFinite(len) || len <= 0) return { why: "a length is a number above 0" };
  const mode = lengthMode(m, id);
  if (mode.kind === "none") return { why: mode.why };
  if (mode.kind === "driven") {
    return {
      why:
        mode.params.length > 0
          ? `driven by ${mode.params.join(", ")}: edit ${mode.params.length > 1 ? "them" : "it"}`
          : `set by ${mode.expr}`,
    };
  }
  if (mode.kind === "ref") return { why: `${mode.text}, which sets its length` };
  if (mode.how === "free") return { set: { b: { len_mm: round(len) } } };
  const w = written(m, id) as { b: unknown[] };
  const d = m.derived.bars[id];
  if (!d) return { why: "it does not derive" };
  const t = [0, 1, 2].map((i) => ((d.b[i] as number) - (d.a[i] as number)) / d.len_mm);
  const moving = new Set(movingAxes(m, id));
  const b = w.b.map((c, i) =>
    moving.has(i) ? round((d.a[i] as number) + (t[i] as number) * len) : c,
  );
  return { set: { b } };
}
