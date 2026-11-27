import type { Model } from "../model.ts";
import type { Cmd } from "../tools/preview.ts";
import { parseTyped } from "../tools/typed.ts";
import { isObject, written } from "./words.ts";

/**
 * The holes a person adds to a bar (`ops`, design §4.4; docs/ux/editing-audit.md E4.4, E-UX-22):
 * each a hole on a side face, at a distance from end a or b, drilled (`d_mm`) or tapped
 * (`thread`), through or to a depth. Adding, changing and removing one is one `setBar` of the
 * whole list, as `alukit do` would send it. Pure. Owner: E4.
 */

type O = Record<string, unknown>;
export type Face = "+x" | "-x" | "+y" | "-y";
export const FACES: readonly Face[] = ["+x", "-x", "+y", "-y"];

/** A bar's holes as written. */
export function holesOf(m: Model, bar: string): O[] {
  const w = written(m, bar);
  return isObject(w) && Array.isArray(w.ops) ? (w.ops as O[]).filter(isObject) : [];
}

/** A hole's size as the field shows it: its drill (`7`) or its thread (`M6`). */
export function sizeText(op: O): string {
  return typeof op.thread === "string" ? op.thread : op.d_mm === undefined ? "" : String(op.d_mm);
}

/** A hole in words: "Ø7 on face +x, 20 mm from end a", "M6 … 12 deep". */
export function holeWords(op: O): string {
  const size = typeof op.thread === "string" ? op.thread : `Ø${String(op.d_mm)}`;
  const depth = op.depth_mm === undefined ? "" : `, ${String(op.depth_mm)} deep`;
  return `${size} on face ${String(op.face)}, ${String(op.at_mm)} mm from end ${String(op.from ?? "a")}${depth}`;
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
  from?: "a" | "b";
  size: { thread: string } | { d_mm: number | string };
  depth_mm?: number | string | undefined;
}): O {
  return {
    op: "hole",
    face: h.face,
    at_mm: h.at_mm,
    ...(h.from === "b" ? { from: "b" } : {}),
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

/** The step that removes hole `i`; the list goes with its last hole. */
export function removeHole(m: Model, bar: string, i: number): Cmd {
  return setOps(
    bar,
    holesOf(m, bar).filter((_, k) => k !== i),
  );
}
