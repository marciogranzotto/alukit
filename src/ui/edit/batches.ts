import { idList } from "#core/commands/words.ts";
import type { Expr } from "#core/project/schema.ts";
import type { V3 } from "../../mesh/model.ts";
import { removalOrder } from "../inspector/remove.ts";
import type { Model } from "../model.ts";
import type { Landing } from "../tools/ends.ts";
import { type MoveSet, moveSet, type Vec } from "../tools/moves.ts";
import type { Cmd } from "../tools/preview.ts";
import { type BarFace, extentAlong, facePlane, rounded, sideWords } from "./geometry.ts";

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

const q2 = (x: number) => {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
};
const q6 = (x: number) => {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

/**
 * Move (E-UX-3; docs/ux/drag-ends-decisions.md, "The Move tool"): one `transform`, then an
 * `autoConnect` at each end it moves (the first 24: both ends of each bar moved whole, then the
 * ends a crossing box stretches), as drawing a bar sends one per end, so an end that lands on a
 * bar joins it by the corner rule. `detach` frees what joins the selection to the rest (Alt).
 */
export function transformBatch(
  set: MoveSet,
  written: Vec,
  detach: boolean,
  prefer: string | undefined,
): Cmd[] {
  const moved = [...set.bars.flatMap((b) => [`${b}.a`, `${b}.b`]), ...(set.ends ?? [])];
  const join = moved.slice(0, 24).map((end) => ({
    cmd: "autoConnect",
    args: { end, optional: true, ...(prefer ? { prefer } : {}) },
  }));
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

/** Why ids cannot be copied or mirrored: none, or a pattern copy (its template is the entity). */
function refusedIds(ids: readonly string[], verb: string): { why: string } | undefined {
  if (ids.length === 0) return { why: `select the bars, parts or points to ${verb}` };
  const copy = ids.find((id) => id.includes("@"));
  if (copy) {
    return {
      why: `${copy} is a pattern copy: ${verb} ${copy.split("@")[0]}, its template, or explode the pattern`,
    };
  }
  return undefined;
}

/** At most this many joins in one copy step: each new bar's two ends, for the first bars made. */
const MAX_JOINS = 48;

/**
 * Duplicate (E-UX-6): copies of `ids` offset by `by`, one `array` step along the offset's
 * direction; `count` makes that many at that spacing (`4x`), `divide` splits the offset into
 * that many gaps (`/4`). An `autoConnect` follows at each end of every new bar (the first 48
 * ends), as drawing a bar sends one per end, so a copy whose end lands on a bar's line is joined
 * to it by the corner rule. The copies are numbers in the document (the core's `array` writes
 * each step as a number), so the offset is taken as the numbers it comes to. E3.3.
 */
export function duplicateBatch(
  m: Model,
  ids: readonly string[],
  by: Vec,
  opts: { count?: number; divide?: number; prefer?: string | undefined } = {},
): Batch {
  const no = refusedIds(ids, "copy");
  if (no) return no;
  const d = by.map((x) => (typeof x === "number" ? x : Number.NaN)) as unknown as V3;
  if (d.some((x) => !Number.isFinite(x))) return { why: "the offset must come to numbers" };
  const span = Math.hypot(d[0], d[1], d[2]);
  if (span < 0.005) return { why: "move the copy away from the original: drag, or type an offset" };
  const u = d.map((x) => q6(x / span)) as unknown as V3;
  const copies = opts.divide ?? opts.count ?? 1;
  const pitch = q2(span / (opts.divide ?? 1));
  const joins: Cmd[] = [];
  const bars = ids.filter((id) => m.derived.bars[id]);
  for (let k = 1; k <= copies && joins.length < MAX_JOINS; k++) {
    const shift = [u[0] * pitch * k, u[1] * pitch * k, u[2] * pitch * k] as const;
    for (const id of bars) {
      const b = m.derived.bars[id];
      if (!b) continue;
      for (const p of [b.a, b.b]) {
        if (joins.length >= MAX_JOINS) break;
        joins.push({
          cmd: "autoConnect",
          args: {
            at: [q2(p[0] + shift[0]), q2(p[1] + shift[1]), q2(p[2] + shift[2])],
            optional: true,
            ...(opts.prefer ? { prefer: opts.prefer } : {}),
          },
        });
      }
    }
  }
  return [
    {
      cmd: "array",
      args: { ids: [...ids], along: { dir: u }, pitch_mm: pitch, count: copies + 1 },
    },
    ...joins,
  ];
}

/**
 * Mirror (E-UX-8): copies of `ids` across the plane square to `axis` at `at_mm`, one `mirror`
 * step; `removeOriginals` removes what was mirrored in the same step, referrers first, each with
 * what refers to it (the Delete cascade, `removeEntity { cascade }`). E3.2.
 *
 * The core's `mirror` carries the bars' own joints (design §6); then, as Duplicate does, an
 * `autoConnect` at each image's end (the first 48 ends, after any removal), so an image end that
 * a joint shared with other bars held (a rail's corner) joins by the corner rule, and one landing
 * on a bar's face butts on it (docs/ux/review-fixes-joins-decisions.md 5).
 */
export function mirrorBatch(
  m: Model,
  ids: readonly string[],
  plane: { axis: "x" | "y" | "z"; at_mm: number },
  opts: { removeOriginals?: boolean; prefer?: string | undefined } = {},
): Batch {
  const no = refusedIds(ids, "mirror");
  if (no) return no;
  const at = q2(plane.at_mm);
  const mirror: Cmd = {
    cmd: "mirror",
    args: { ids: [...ids], plane: { axis: plane.axis, at_mm: at } },
  };
  const k = AXES.indexOf(plane.axis);
  const joins: Cmd[] = [];
  for (const id of ids) {
    const b = m.derived.bars[id];
    if (!b) continue;
    for (const p of [b.a, b.b]) {
      if (joins.length >= MAX_JOINS) break;
      joins.push({
        cmd: "autoConnect",
        args: {
          at: p.map((c, i) => q2(i === k ? 2 * at - c : c)),
          optional: true,
          ...(opts.prefer ? { prefer: opts.prefer } : {}),
        },
      });
    }
  }
  const removals = opts.removeOriginals
    ? removalOrder(ids).map((id) => ({ cmd: "removeEntity", args: { id, cascade: true } }))
    : [];
  return [mirror, ...removals, ...joins];
}

const AXES = ["x", "y", "z"] as const;

/**
 * An array as plain copies (E-UX-6): `ids` copied along a bar, a run or a direction, at a pitch
 * and count or at offsets, one `array` step, as `alukit do array` takes it. E3.3.
 */
export function arrayBatch(
  _m: Model,
  ids: readonly string[],
  along: string | { dir: Vec },
  spacing: { pitch_mm: Expr; count: number } | { offsets_mm: Expr[] },
): Batch {
  const no = refusedIds(ids, "copy");
  if (no) return no;
  return [{ cmd: "array", args: { ids: [...ids], along, ...spacing } }];
}

/**
 * Rotate (E-UX-5): one `transform` turn about a world axis through a point, then an
 * `autoConnect` at each end of the bars it turns (the first 12), as Move sends, so an end that
 * lands on a bar joins it. `detach` frees what joins the selection to the rest (Alt). E3.1.
 */
export function rotateBatch(
  set: MoveSet,
  rotate: { axis: "x" | "y" | "z"; deg: number; about: V3 },
  detach: boolean,
  prefer: string | undefined,
): Cmd[] {
  const [move, ...join] = transformBatch(set, [0, 0, 0], detach, prefer);
  const { by: _, ...args } = (move as Cmd).args;
  return [
    {
      cmd: "transform",
      args: {
        ids: args.ids,
        rotate: {
          axis: rotate.axis,
          deg: q6(rotate.deg),
          about: [q2(rotate.about[0]), q2(rotate.about[1]), q2(rotate.about[2])],
        },
        ...(detach ? { joined: "detach" } : {}),
      },
    },
    ...join,
  ];
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

/** The face a target is, in words: "b1's top", "b1's +X side". */
function faceWords(bar: string, n: V3): string {
  return `${bar}'s ${sideWords(n)}`;
}

/**
 * Align (E-UX-23): `ids` moved along the target face's outward normal until their own face that
 * looks the same way is flush with it (a rail's top with a post's top), one `transform` step,
 * Move's batch. The offset comes from the derived model: the target face's plane, and how far the
 * selection's bodies reach along its normal (each bar's box between its end planes). E3.6.
 */
export function alignBatch(
  m: Model,
  ids: readonly string[],
  target: { bar: string; face: BarFace },
  prefer?: string,
): Batch {
  const set = moveSet(m, ids);
  if ("why" in set) return set;
  const t = m.derived.bars[target.bar];
  if (!t) return { why: `${target.bar} is not a bar: pick a face of a bar` };
  if (set.ids.includes(target.bar.split("@")[0] as string)) {
    return { why: `${target.bar} is what moves: pick a face of something else` };
  }
  const { n, c } = facePlane(t, target.face);
  const reach = extentAlong(m, set, n);
  if (reach === undefined) return { why: "nothing selected has a body to align" };
  const delta = c - reach;
  const by = rounded([n[0] * delta, n[1] * delta, n[2] * delta]);
  if (Math.hypot(by[0], by[1], by[2]) < 0.005) {
    return { why: `${idList(set.ids)} is flush with ${faceWords(target.bar, n)} already` };
  }
  return transformBatch(set, [...by], false, prefer);
}
