import { drivers } from "#core/commands/hold.ts";
import { offsetBy } from "#core/commands/numbers.ts";
import type { Expr } from "#core/project/schema.ts";
import type { Model } from "../model.ts";
import type { Written } from "../tools/typed.ts";
import { isObject, written } from "./words.ts";

/**
 * A bar's length in the inspector (docs/ux/plan.md S5.3, F5; docs/ux/editing-audit.md E4.6,
 * E-UX-16): what sets it, and the `setBar` patch that gives it a new one. The length is the
 * distance between the bar's design points along its line; a new length moves end b (the
 * default), end a, or both ends from the middle, along the bar's own line, and leaves the
 * joints that claim the ends to derive, as the document holds them.
 *
 * - An end written as coordinates: the coordinates that change are written, the others stay as
 *   written (a post's `["W", 0, "H"]` keeps its `W`). A typed value that reads a param is written
 *   as typed (D-UX-17): along a world axis, the moving coordinate is the other end's plus the
 *   expression (`=D` on a rail from y = 0 writes `D`); off the world axes there is no one
 *   coordinate to hold it, and a number is asked for, as `moveEnd` asks.
 * - End b written as `{ len_mm, dir }`: its `len_mm` is written; end a or the middle cannot move
 *   it, since a free end counts from end a.
 * - A moving coordinate (or `len_mm`) written as an expression over params: the length is driven
 *   by those params, and the inspector says so ("driven by H: edit H") rather than overwriting a
 *   param's link. An expression that reads another entity (`len(b3)`) sets it too.
 * - A moving end at a reference (a node, another bar's end, a station, a pivot): that sets the
 *   length, and the inspector says what it is.
 *
 * Pure. Owner: E4.
 */

/** Which end a new length moves: end b, end a, or both, from the middle. */
export type LengthEnd = "b" | "a" | "middle";

export type LengthMode =
  /** Editable: the design length, mm, and how the moving ends are written. */
  | { kind: "edit"; len: number; how: "coords" | "free"; note?: string }
  /** Driven by params (`params`), or by an expression that reads other entities (none). */
  | { kind: "driven"; len: number; params: string[]; expr: string }
  /** A moving end is a reference: what it is, and the entities it names. */
  | { kind: "ref"; len: number; text: string; refs: string[] }
  | { kind: "none"; why: string };

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

/** The axes along which the bar runs: the coordinates a move along it changes. */
function movingAxes(m: Model, id: string): number[] {
  const d = m.derived.bars[id];
  if (!d) return [];
  const len = d.len_mm;
  return [0, 1, 2].filter((i) => Math.abs((d.b[i] as number) - (d.a[i] as number)) / len > 1e-9);
}

/** The ends a new length moves. */
const moving = (which: LengthEnd): ("a" | "b")[] => (which === "middle" ? ["a", "b"] : [which]);

export function lengthMode(m: Model, id: string, which: LengthEnd = "b"): LengthMode {
  const w = written(m, id);
  const d = m.derived.bars[id];
  if (!isObject(w)) return { kind: "none", why: "a pattern copy: its template sets it" };
  if (!d) return { kind: "none", why: "it does not derive: see the problems" };
  const freeB = isObject(w.b) && w.b.len_mm !== undefined;
  if (freeB && which !== "b") {
    return { kind: "none", why: "end b is a free length from end a: move end b" };
  }
  if (freeB) {
    const b = w.b as Record<string, unknown>;
    const l = b.len_mm;
    const by = drivers(l);
    if (by && typeof l === "string")
      return { kind: "driven", len: d.len_mm, params: by.params, expr: l };
    return {
      kind: "edit",
      len: typeof l === "number" ? l : d.len_mm,
      how: "free",
      ...(b.from === "a.cut" ? { note: "counted from end a's cut" } : {}),
    };
  }
  for (const e of moving(which)) {
    const p = w[e];
    if (Array.isArray(p) && p.length === 3) {
      for (const i of movingAxes(m, id)) {
        const c = p[i];
        const by = drivers(c);
        if (by && typeof c === "string") {
          return { kind: "driven", len: d.len_mm, params: by.params, expr: c };
        }
      }
      continue;
    }
    const ref = pointRefWords(p);
    if (ref) return { kind: "ref", len: d.len_mm, text: `end ${e} is ${ref.text}`, refs: ref.refs };
    return { kind: "none", why: `end ${e} is written in a form the inspector cannot edit` };
  }
  return { kind: "edit", len: d.len_mm, how: "coords" };
}

/** A length as the field reads it: what it comes to, mm, and how it is written (D-UX-17). */
export interface TypedLength {
  value: number;
  written: Written;
}

/**
 * The `setBar` patch that gives the bar a new length, or why it cannot: the moving ends along the
 * bar's line, from the other end's design point (or from the middle), or a free end's `len_mm`.
 */
export function lengthPatch(
  m: Model,
  id: string,
  t: TypedLength,
  which: LengthEnd = "b",
): { set: Record<string, unknown> } | { why: string } {
  if (!Number.isFinite(t.value) || t.value <= 0) return { why: "a length is a number above 0" };
  const mode = lengthMode(m, id, which);
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
  if (mode.how === "free") {
    return { set: { b: { len_mm: typeof t.written === "number" ? round(t.written) : t.written } } };
  }
  const w = written(m, id) as { a: unknown[]; b: unknown[] };
  const d = m.derived.bars[id];
  if (!d) return { why: "it does not derive" };
  const u = [0, 1, 2].map((i) => ((d.b[i] as number) - (d.a[i] as number)) / d.len_mm);
  const axes = movingAxes(m, id);
  const axial = axes.length === 1;
  if (typeof t.written === "string" && !axial) {
    const params = drivers(t.written)?.params ?? [];
    return {
      why: `${t.written} reads ${params.join(", ")}, which ${id} keeps only along a world axis: give a number`,
    };
  }
  const k = axes[0] as number;
  const sign: 1 | -1 = (u[k] as number) > 0 ? 1 : -1;
  // Where each end goes: a number on every moving axis, or along the one axis the expression.
  const at = (e: "a" | "b", from: readonly Expr[], dir: 1 | -1, len: number, expr?: string) =>
    w[e].map((c, i) => {
      if (!axes.includes(i)) return c;
      if (expr !== undefined) return offsetBy(from[i] as Expr, sign * dir > 0 ? 1 : -1, expr);
      return round((from[i] as number) + dir * (u[i] as number) * len);
    });
  const expr = typeof t.written === "string" ? t.written : undefined;
  // From the other end's coordinate as written, so an expression there is kept (`W + D`).
  if (which === "b") {
    return { set: { b: expr ? at("b", w.a as Expr[], 1, 0, expr) : at("b", d.a, 1, t.value) } };
  }
  if (which === "a") {
    return { set: { a: expr ? at("a", w.b as Expr[], -1, 0, expr) : at("a", d.b, -1, t.value) } };
  }
  // From the middle: each end half the length from the centre, which stays.
  const c = [0, 1, 2].map((i) => round(((d.a[i] as number) + (d.b[i] as number)) / 2));
  const half =
    expr !== undefined ? `${/^[A-Za-z_]\w*$/.test(expr) ? expr : `(${expr})`} / 2` : undefined;
  return {
    set: {
      a: at("a", c, -1, t.value / 2, half),
      b: at("b", c, 1, t.value / 2, half),
    },
  };
}
