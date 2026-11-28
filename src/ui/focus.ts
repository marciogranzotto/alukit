import { signal } from "@preact/signals";
import { compareIds } from "#core/ids.ts";
import type { Ref } from "#core/problems/types.ts";
import type { CrossedEnds, SelectMode } from "../viewer/scene.ts";
import { extendHook } from "./hook.ts";
import type { Model } from "./model.ts";
import { model } from "./store.ts";
import { resolveTargets } from "./targets.ts";

/**
 * What the person is looking at (docs/ux/plan.md §5.3): the selection, what the pointer is over,
 * and what was last shown (Show: a problem's, a row's or a chip's targets). Each region reacts to
 * these signals on its own: the scene paints the selection and the hover, the outline reveals the
 * row, the inspector points at the field. No region calls into another's components. Owner: S2.
 *
 * store.ts re-exports `selection` and `select`, whose home this was before S0; this module reads
 * the drawn model from store.ts only when `show` runs, so the two import each other safely.
 */

export type { CrossedEnds, Ref, SelectMode };

/** The selected refs: entities, ends' bars, copies, and corners (`corner:<key>`). */
export const selection = signal<ReadonlySet<string>>(new Set());

/** What the pointer is over, and where: the 3D view, a table row, a chip, the outline. */
export interface Hover {
  ids: readonly string[];
  from: "view" | "row" | "chip" | "tree";
}
export const hover = signal<Hover | undefined>(undefined);

/** A request to show something: its refs, the problem it is, the field to point at. */
export interface ShowRequest {
  refs: readonly Ref[];
  /** The problem's id (src/core/problems/types.ts), when a problem is shown. */
  problem?: string;
  /** The field the inspector points at, as `opt.finish`. */
  field?: string;
  /** Ghost everything else in the scene. */
  isolate?: boolean;
}

/**
 * What was last shown, until `clearShow`. `n` counts the requests, so showing the same refs
 * again is a new request (the scene pulses again).
 */
export interface Shown {
  refs: readonly Ref[];
  problem?: string;
  field?: string;
  isolate: boolean;
  n: number;
}
export const shown = signal<Shown | undefined>(undefined);

/**
 * What the boxes that made the selection held only in part (docs/ux/polish-editing-decisions.md,
 * AutoCAD's STRETCH): for each bar a crossing box took without holding it whole, its ends inside
 * the box (none, one or both). It belongs to the selection those boxes made, by identity: any
 * other change of the selection (a click, the outline, a verb) leaves it behind. Move reads it
 * (`crossedEnds`): those bars stretch, their ends inside moving and the rest staying.
 */
let crossing: { of: ReadonlySet<string>; ends: CrossedEnds } | undefined;

/** The bars the selection's crossing boxes held in part, and their ends inside; or undefined. */
export function crossedEnds(sel: ReadonlySet<string> = selection.peek()): CrossedEnds | undefined {
  return crossing && crossing.of === sel && crossing.ends.size > 0 ? crossing.ends : undefined;
}

/**
 * Selects ids. A box gives `crossed` (empty for a window): an added box keeps what the boxes
 * before it held in part, except a bar it holds whole, or one that was selected whole already.
 */
export function select(ids: readonly string[], mode: SelectMode, crossed?: CrossedEnds): void {
  const before = selection.peek();
  if (mode === "replace") selection.value = new Set(ids);
  else {
    const next = new Set(before);
    for (const id of ids) {
      if (mode === "toggle" && next.has(id)) next.delete(id);
      else next.add(id);
    }
    selection.value = next;
  }
  if (!crossed) return;
  const prior = mode === "replace" ? undefined : crossedEnds(before);
  const ends = new Map(prior ?? []);
  for (const id of ids) if (!crossed.has(id)) ends.delete(id);
  for (const [id, e] of crossed) {
    const wholeBefore = mode !== "replace" && before.has(id) && !prior?.has(id);
    if (!wholeBefore) ends.set(id, e);
  }
  crossing = { of: selection.peek(), ends };
}

let shows = 0;

/**
 * Shows refs: selects the entities they stand for (src/ui/targets.ts) and records the request in
 * `shown`, which the scene frames, pulses and isolates (S3.6), the outline reveals (S2.5, S2.9)
 * and the inspector points at (S5.3).
 */
export function show(req: ShowRequest): void {
  const m = model.peek();
  select(m ? resolveTargets(m, req.refs).ids : [], "replace");
  shown.value = {
    refs: [...req.refs],
    ...(req.problem !== undefined ? { problem: req.problem } : {}),
    ...(req.field !== undefined ? { field: req.field } : {}),
    isolate: req.isolate === true,
    n: ++shows,
  };
}

export function clearShow(): void {
  shown.value = undefined;
}

/**
 * What the view hides and isolates (docs/ux/editing-audit.md E-UX-9, E2.4): view state, like the
 * section plane, never a step, per tab. `hidden` are the bodies not drawn (bars, parts, pattern
 * copies, a connection's fasteners, by id); picks and snaps pass them over (the tools give it as
 * their `skip`, and the viewer's own pick reads it through `setHidden`). `isolated` is what
 * Isolate keeps, the rest being in `hidden`; undefined when nothing is isolated. Isolate writes
 * the rest into `hidden` rather than keeping a second set, so every reader of `hidden` (the
 * tools' snaps, the viewer) passes over it with no change (e2 6).
 */
export const hidden = signal<ReadonlySet<string>>(new Set());
export const isolated = signal<ReadonlySet<string> | undefined>(undefined);

/**
 * The bodies the view draws for a model: every derived bar and placed part (pattern copies
 * included) and every connection that draws fasteners.
 */
export function drawnBodies(m: Model): string[] {
  const out = new Set<string>(Object.keys(m.derived.bars));
  for (const [id, p] of Object.entries(m.derived.parts)) if (!p.unplaced) out.add(id);
  for (const f of m.display.fasteners) out.add(f.connection);
  return [...out];
}

/** The bodies that draw some refs, as the view lights them on a hover (src/ui/targets.ts). */
export function bodiesOf(m: Model, refs: readonly string[]): string[] {
  return resolveTargets(m, refs).bodies;
}

/** Hides what draws the refs, and takes what it hid out of the selection. */
export function hide(m: Model, refs: readonly string[]): void {
  const off = bodiesOf(m, refs);
  hidden.value = new Set([...hidden.peek(), ...off]);
  const gone = new Set(off);
  select(
    [...selection.peek()].filter((id) => !gone.has(id)),
    "replace",
  );
}

/** Shows only what draws the refs: every other body is hidden. */
export function isolate(m: Model, refs: readonly string[]): void {
  const keep = new Set(bodiesOf(m, refs));
  isolated.value = keep;
  hidden.value = new Set(drawnBodies(m).filter((id) => !keep.has(id)));
}

/** Shows again what draws the refs, where it is hidden (the menu's Show, review m10). */
export function unhide(m: Model, refs: readonly string[]): void {
  const on = new Set(bodiesOf(m, refs));
  const next = [...hidden.peek()].filter((id) => !on.has(id));
  if (next.length !== hidden.peek().size) hidden.value = new Set(next);
}

/** Shows everything again. */
export function showAll(): void {
  if (hidden.peek().size > 0) hidden.value = new Set();
  if (isolated.peek() !== undefined) isolated.value = undefined;
}

/** How many of the model's bodies are hidden now: what the strip says. */
export function hiddenCount(m: Model | undefined, h: ReadonlySet<string>): number {
  if (!m || h.size === 0) return 0;
  return drawnBodies(m).filter((id) => h.has(id)).length;
}

declare module "./hook.ts" {
  interface AlukitHook {
    /** The selected refs, in id order. */
    selection(): string[];
    /** The entities the view hides, in id order. */
    hidden(): string[];
  }
}

extendHook({
  selection: () => [...selection.value].sort(compareIds),
  hidden: () => [...hidden.value].sort(compareIds),
});

/**
 * Esc first leaves Show, and the dimming of what it did not show, before it steps back any
 * further (D-UX-18: Esc steps back one level). The app registers it above the tools' Esc; the
 * status bar says "Esc to leave" while Show is on.
 */
export function showKey(e: KeyboardEvent): boolean {
  if (e.key !== "Escape" || !shown.value) return false;
  clearShow();
  return true;
}
