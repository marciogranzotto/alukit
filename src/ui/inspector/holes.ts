import { minus, plus } from "#core/commands/numbers.ts";
import type { Model } from "../model.ts";
import type { Cmd } from "../tools/preview.ts";
import { parseTyped } from "../tools/typed.ts";
import { isObject, written } from "./words.ts";

/**
 * The holes a person adds to a bar (`ops`, design §4.4; docs/ux/editing-audit.md E4.4, E-UX-22):
 * each a hole on a side face, at a distance from an end's cut (where the cut list and the shop
 * measure from, the app's default; review M3) or from a design point, drilled (`d_mm`) or tapped
 * (`thread`), through or to a depth. Adding, changing and removing one is one `setBar` of the
 * whole list, as `alukit do` would send it. Pure. Owner: E4.
 */

type O = Record<string, unknown>;
export type Face = "+x" | "-x" | "+y" | "-y";
export const FACES: readonly Face[] = ["+x", "-x", "+y", "-y"];

/** Where a hole's distance counts from (§4.3's `from`): an end's cut, or a design point. */
export type From = "a.cut" | "b.cut" | "a" | "b";

/** The choices, the cuts first: what the cut list prints and the shop measures from. */
export const FROMS: readonly { value: From; label: string }[] = [
  { value: "a.cut", label: "end a's cut" },
  { value: "b.cut", label: "end b's cut" },
  { value: "a", label: "design point a" },
  { value: "b", label: "design point b" },
];

/** A hole's `from` as written; absent is design point a (§4.3). */
export function fromOf(op: O): From {
  return FROMS.some((f) => f.value === op.from) ? (op.from as From) : "a";
}

/** A bar's holes as written. */
export function holesOf(m: Model, bar: string): O[] {
  const w = written(m, bar);
  return isObject(w) && Array.isArray(w.ops) ? (w.ops as O[]).filter(isObject) : [];
}

/** A hole's size as the field shows it: its drill (`7`) or its thread (`M6`). */
export function sizeText(op: O): string {
  return typeof op.thread === "string" ? op.thread : op.d_mm === undefined ? "" : String(op.d_mm);
}

/** A hole in words: "Ø7 on face +x, 20 mm from end a's cut", "M6 … 12 deep". */
export function holeWords(op: O): string {
  const size = typeof op.thread === "string" ? op.thread : `Ø${String(op.d_mm)}`;
  const depth = op.depth_mm === undefined ? "" : `, ${String(op.depth_mm)} deep`;
  const from = FROMS.find((f) => f.value === fromOf(op))?.label as string;
  return `${size} on face ${String(op.face)}, ${String(op.at_mm)} mm from ${from}${depth}`;
}

/**
 * A size typed into a hole's field: a thread (`M6`, `M10x1.25`) or a drill diameter, an
 * expression over params written as typed (D-UX-17); or why it cannot be read.
 */
export function parseSize(
  text: string,
  params: Readonly<Record<string, number>>,
): { thread: string } | { d_mm: number | string } | { why: string } {
  const t = text.trim();
  if (/^M\d/i.test(t)) return { thread: `M${t.slice(1)}` };
  const v = parseTyped(t.replace(/^=\s*/, ""), params);
  if (v.kind === "empty") return { why: "give the hole's size: a drill (7) or a thread (M6)" };
  if (v.kind === "error") return { why: v.why };
  if (v.kind !== "value") return { why: "one size: a drill (7) or a thread (M6)" };
  if (!(v.value > 0)) return { why: "a drill is above 0" };
  return { d_mm: v.written };
}

/** A distance or depth typed into a hole's field (D-UX-17), or why it cannot be read. */
export function parseLength(
  text: string,
  params: Readonly<Record<string, number>>,
  what: string,
): { v: number | string } | { why: string } {
  const v = parseTyped(text.trim().replace(/^=\s*/, ""), params);
  if (v.kind === "error") return { why: v.why };
  if (v.kind !== "value") return { why: `give the ${what} in mm` };
  if (v.value < 0) return { why: `the ${what} is 0 or more` };
  return { v: v.written };
}

/** A hole as the document writes it, in its schema's order: op, face, at_mm, from, size, depth. */
export function holeOp(h: {
  face: Face;
  at_mm: number | string;
  from?: From;
  size: { thread: string } | { d_mm: number | string };
  depth_mm?: number | string | undefined;
}): O {
  return {
    op: "hole",
    face: h.face,
    at_mm: h.at_mm,
    ...(h.from !== undefined && h.from !== "a" ? { from: h.from } : {}),
    ...h.size,
    ...(h.depth_mm !== undefined && h.depth_mm !== "" ? { depth_mm: h.depth_mm } : {}),
  };
}

const setOps = (bar: string, ops: O[]): Cmd => ({
  cmd: "setBar",
  args: { id: bar, set: { ops: ops.length > 0 ? ops : null } },
});

/** The step that adds a hole after the bar's others. */
export function addHole(m: Model, bar: string, op: O): Cmd {
  return setOps(bar, [...holesOf(m, bar), op]);
}

/**
 * The step that changes hole `i`: the fields given replace its own (null removes one), a new size
 * replaces the old one whichever kind it was (a drill for a thread, or the other way), and what
 * the row does not show (a countersink, a counterbore) stays.
 */
export function changeHole(m: Model, bar: string, i: number, patch: O): Cmd {
  const ops = holesOf(m, bar).map((op, k) => {
    if (k !== i) return op;
    const next: O = { ...op, ...patch };
    if ("d_mm" in patch) delete next.thread;
    if ("thread" in patch) delete next.d_mm;
    if (next.from === "a") delete next.from;
    for (const [key, v] of Object.entries(next))
      if (v === null || v === undefined) delete next[key];
    return next;
  });
  return setOps(bar, ops);
}

/**
 * Where a distance from `from` counts from on a bar, as derive resolves a hole (`resolveOps`,
 * design §4.3): its origin along the axis from design point a, and the way it counts (+1 toward
 * end b). A cut end's origin is its long point, the view model's `long_mm`, where the cut list
 * measures; undefined when the bar does not derive.
 */
function originOf(m: Model, bar: string, from: From): { at: number; way: 1 | -1 } | undefined {
  const len = m.derived.bars[bar]?.len_mm;
  const long = m.display.bars[bar]?.long_mm;
  if (len === undefined || !long) return undefined;
  if (from === "a") return { at: 0, way: 1 };
  if (from === "a.cut") return { at: long[0], way: 1 };
  if (from === "b") return { at: len, way: -1 };
  return { at: long[1], way: -1 };
}

/**
 * The step that makes hole `i` count from `to` and keeps it where it is (re-check N6: the number
 * stayed and the hole moved 40 mm, unsaid). As a CAD dimension re-attached to another reference
 * keeps the geometry and reads the new distance, the distance is converted: a hole `x` from its
 * old origin lies at `o₁ + w₁·x` from design point a, so from the new one it is
 * `(o₁ − o₂)·w₂ + w₁·w₂·x`. The core's numbers do the arithmetic (`plus`, `minus`), so a distance
 * written over params stays an expression that follows them, and a number is quantised as every
 * command's is.
 */
export function switchFrom(m: Model, bar: string, i: number, to: From): Cmd | { why: string } {
  const op = holesOf(m, bar)[i];
  if (!op) return { why: `${bar} has no hole ${i + 1}` };
  const from = fromOf(op);
  if (from === to) return changeHole(m, bar, i, {});
  const at = op.at_mm;
  const x = originOf(m, bar, from);
  const y = originOf(m, bar, to);
  if (!x || !y || (typeof at !== "number" && typeof at !== "string")) {
    return { why: `${bar} does not derive, so the hole cannot be kept where it is` };
  }
  const k = (x.at - y.at) * y.way;
  return changeHole(m, bar, i, {
    from: to,
    at_mm: x.way === y.way ? plus(at, k) : minus(k, at),
  });
}

/** The step that removes hole `i`; the list goes with its last hole. */
export function removeHole(m: Model, bar: string, i: number): Cmd {
  return setOps(
    bar,
    holesOf(m, bar).filter((_, k) => k !== i),
  );
}
