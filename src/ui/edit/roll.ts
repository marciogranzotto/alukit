import { negate } from "#core/commands/numbers.ts";
import { anchorPoint } from "#core/derive/frame.ts";
import { evalNumber } from "#core/expr.ts";
import type { Expr } from "#core/project/schema.ts";
import { TOL } from "#core/tolerances.ts";

/**
 * A roll that keeps the bar where its anchor put it (docs/ux/polish-editing-ui-decisions.md 1;
 * design §4.4). `roll_deg` turns a bar's section about its line, and the anchor, a point of the
 * section, stays on the line: so a roll alone turns the body round that point, and a 40 × 80
 * anchored on a corner swings out of the corner it filled (A4: each leg out of the frame's
 * footprint). A roll by whole quarter turns that the app sends also turns the anchor and the
 * offset back by as much, so the body stays on the same side of its line: a corner anchor keeps
 * the same corner of the bar's place, a face anchor the same face, and a 40 × 80 trades its long
 * side for its short one in place. §4.4 already asks this of any edit of a roll ("changing it is
 * an edit that rewrites those references, as reverseBar does"). A roll by another angle has no
 * named point to turn the anchor to, so it rolls about the anchor as the field says; a datum
 * (`mount`, `heel`) is a point of the section's own, so it stays. Pure, so the unit tests read it.
 * Shared by the inspector's Roll fields and the draw tool's R; owner: the editing polish.
 */

/** What a Roll field says under it, so the anchor's turn is no surprise. */
export const ROLL_WORDS = "a quarter turn keeps the bar on its anchor's side: the anchor turns too";

/**
 * A section box point's sides, −1, 0 or +1 along x and y, read by §4.4's own rule on a unit box;
 * undefined for a datum.
 */
function sides(anchor: string): readonly [number, number] | undefined {
  return anchorPoint(
    anchor,
    [
      [-1, -1],
      [1, 1],
    ],
    {},
  );
}

/** The name of a box point from its sides, x first: `c`, `+x`, `-y`, `+x-y`. */
function nameOf([x, y]: readonly [number, number]): string {
  const s = (v: number, axis: string) => (v === 0 ? "" : `${v > 0 ? "+" : "-"}${axis}`);
  return s(x, "x") + s(y, "y") || "c";
}

/**
 * The number of quarter turns, 0 to 3, a change of roll by `deg` makes, or undefined when it is
 * not a whole number of them (within `tol.snap`, as §4.4 reads a roll exact at multiples of 90°).
 */
export function quarterTurns(deg: number): number | undefined {
  const q = deg / 90;
  const n = Math.round(q);
  if (Math.abs(q - n) > TOL.snap * Math.max(1, Math.abs(q))) return undefined;
  return ((n % 4) + 4) % 4;
}

/**
 * A section vector turned back by `q` quarter turns: what keeps a point of the section where it
 * was in the world when the section turns forward by them. A roll of +90° makes the section's x
 * the old y and its y the old −x (§4.4's frame), so the point the old (x, y) was is (y, −x) now.
 */
function back<T>(q: number, [x, y]: readonly [T, T], neg: (v: T) => T): [T, T] {
  let p: [T, T] = [x, y];
  for (let i = 0; i < q; i++) p = [p[1], neg(p[0])];
  return p;
}

/** The anchor that keeps the body on the same side of its line after `q` quarter turns. */
export function turnedAnchor(anchor: string, q: number): string {
  const s = sides(anchor);
  return s ? nameOf(back(q, s, (v) => (v === 0 ? 0 : -v))) : anchor;
}

/** The offset that keeps the body where it was after `q` quarter turns; params kept as written. */
export function turnedOffset(off: readonly [Expr, Expr], q: number): [Expr, Expr] {
  return back(q, off, (v) => negate(v));
}

/** A written roll's value in degrees: a number, or an expression over the params. */
function rollValue(roll: unknown, params: Readonly<Record<string, number>>): number | undefined {
  if (roll === undefined || roll === null) return 0;
  if (typeof roll === "number") return roll;
  if (typeof roll !== "string") return undefined;
  try {
    return evalNumber(roll, { name: (n) => params[n] });
  } catch {
    return undefined;
  }
}

/** What a bar's roll field changes: the roll, and with a quarter turn its anchor and offset. */
export interface RollSet {
  /** The `setBar` patch. */
  set: Record<string, unknown>;
  /** The quarter turns the anchor and offset were turned back by; undefined when not turned. */
  turned?: number;
}

/**
 * The patch a bar's roll field sends for a roll typed as `next` (its value and how it is
 * written; a param stays as typed, D-UX-17): the roll, nought removed; and when the change is a
 * whole number of quarter turns, the anchor and the offset turned back by as much, so the body
 * keeps its side of the line. The anchor's centre and a nought offset are removed, as the fields
 * remove them.
 */
export function rollSet(
  bar: Readonly<Record<string, unknown>>,
  next: { value: number; written: Expr },
  params: Readonly<Record<string, number>> = {},
): RollSet {
  const set: Record<string, unknown> = { roll_deg: next.written === 0 ? null : next.written };
  const was = rollValue(bar.roll_deg, params);
  const q = was === undefined ? undefined : quarterTurns(next.value - was);
  if (!q) return { set };
  const anchor = typeof bar.anchor === "string" ? bar.anchor : "c";
  const turned = turnedAnchor(anchor, q);
  if (turned !== anchor) set.anchor = turned === "c" ? null : turned;
  const off = bar.off_mm;
  if (Array.isArray(off) && off.length === 2) {
    const o = turnedOffset(off as [Expr, Expr], q);
    if (o.some((v, i) => v !== off[i])) set.off_mm = o.every((v) => v === 0) ? null : o;
  }
  return { set, turned: q };
}
