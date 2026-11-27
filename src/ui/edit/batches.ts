import type { Expr } from "#core/project/schema.ts";
import type { Model } from "../model.ts";
import type { Landing } from "../tools/ends.ts";
import type { MoveSet, Vec } from "../tools/moves.ts";
import type { Cmd } from "../tools/preview.ts";

/**
 * The batches an edit in the 3D view sends (docs/ux/editing-audit.md E0.7): one function per
 * edit, pure, which the tools, the menu's actions and the unit tests share. Each gives the
 * commands of one step, sent as `alukit do` would send them (CLI parity, design §6), or why it
 * cannot. The Move tool's and the end handles' are built; the others are their streams' to
 * fill, and say "not available yet" until then. A builder's signature changes only by adding.
 * Owner: E3 (each builder's body: the stream its task names).
 */

/** A world vector as the document writes it: each coordinate a number or an expression. */
export type { Vec };

/** A step's commands, or why it cannot be built. */
export type Batch = Cmd[] | { why: string };

const notYet = (task: string): { why: string } => ({ why: `not available yet (${task})` });

const q2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Move (E-UX-3; docs/ux/drag-ends-decisions.md, "The Move tool"): one `transform`, then an
 * `autoConnect` at each end of the bars it moves (the first 12), as drawing a bar sends one per
 * end, so an end that lands on a bar joins it by the corner rule. `detach` frees what joins the
 * selection to the rest (Alt).
 */
export function transformBatch(
  set: MoveSet,
  written: Vec,
  detach: boolean,
  prefer: string | undefined,
): Cmd[] {
  const join = set.bars.slice(0, 12).flatMap((b) =>
    (["a", "b"] as const).map((e) => ({
      cmd: "autoConnect",
      args: { end: `${b}.${e}`, optional: true, ...(prefer ? { prefer } : {}) },
    })),
  );
  return [
    {
      cmd: "transform",
      args: { ids: set.ids, by: written, ...(detach ? { joined: "detach" } : {}) },
    },
    ...join,
  ];
}

/**
 * An end's move (docs/ux/drag-ends-decisions.md): `moveEnd` onto the bar it lands on, to the cut
 * typed, or to the length dragged, freeing a held end; then `autoConnect` at the end, by the
 * corner rule given or the project's.
 */
export function endBatch(
  ref: string,
  l: Landing,
  detach: boolean,
  prefer: string | undefined,
): Cmd[] {
  const move: Record<string, unknown> = l.stop?.to
    ? { end: ref, to: l.stop.to }
    : l.typed
      ? { end: ref, cut_mm: l.written ?? q2(l.cut) }
      : { end: ref, len_mm: q2(l.len) };
  if (detach) move.detach = true;
  return [
    { cmd: "moveEnd", args: move },
    { cmd: "autoConnect", args: { end: ref, optional: true, ...(prefer ? { prefer } : {}) } },
  ];
}

/**
 * Duplicate (E-UX-6): copies of `ids` offset by `by`, one `array` step; `count` makes that many
 * at that spacing (`4x`), `divide` splits the offset into that many gaps (`/4`). E3.3.
 */
export function duplicateBatch(
  _m: Model,
  _ids: readonly string[],
  _by: Vec,
  _opts: { count?: number; divide?: number } = {},
): Batch {
  return notYet("duplicate, E3.3");
}

/**
 * Mirror (E-UX-8): copies of `ids` across the plane square to `axis` at `at_mm`, one `mirror`
 * step; `removeOriginals` removes what was mirrored in the same step. E3.2.
 */
export function mirrorBatch(
  _m: Model,
  _ids: readonly string[],
  _plane: { axis: "x" | "y" | "z"; at_mm: number },
  _opts: { removeOriginals?: boolean } = {},
): Batch {
  return notYet("mirror, E3.2");
}

/**
 * An array as plain copies (E-UX-6): `ids` copied along a bar, a run or a direction, at a pitch
 * and count or at offsets, one `array` step. E3.3.
 */
export function arrayBatch(
  _m: Model,
  _ids: readonly string[],
  _along: string | { dir: Vec },
  _spacing: { pitch_mm: Expr; count: number } | { offsets_mm: Expr[] },
): Batch {
  return notYet("array, E3.3");
}

/**
 * Split (E-UX-21): `bar` cut in two at `at_mm` from end a's design point, one `splitBar` step,
 * with a splice when `splice` asks; a bar in a run gets one anyway (the core adds it, as the run
 * needs it), and no other connector is bought unasked. E4.3.
 */
export function splitBatch(
  m: Model,
  bar: string,
  at_mm: number,
  opts: { splice?: boolean } = {},
): Batch {
  const template = bar.split("@")[0] as string;
  if (bar.includes("@"))
    return { why: `${bar} is a pattern copy: split its template, ${template}` };
  const d = m.derived.bars[bar];
  if (!d) return { why: /^b\d+$/.test(bar) ? `${bar} does not derive` : `${bar} is not a bar` };
  const at = q2(at_mm);
  if (!(at > 0.01 && at < d.len_mm - 0.01)) {
    return { why: `split ${bar} inside it: between 0 and its length, ${q2(d.len_mm)} mm` };
  }
  return [
    { cmd: "splitBar", args: { id: bar, at_mm: at, ...(opts.splice ? { splice: true } : {}) } },
  ];
}

/**
 * Align (E-UX-23): `ids` moved along the target face's normal until their matching face is flush
 * with it, one `transform` step. E3.6.
 */
export function alignBatch(
  _m: Model,
  _ids: readonly string[],
  _target: { bar: string; face: "+x" | "-x" | "+y" | "-y" },
): Batch {
  return notYet("align, E3.6");
}
