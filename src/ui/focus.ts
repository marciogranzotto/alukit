import { signal } from "@preact/signals";
import { compareIds } from "#core/ids.ts";
import type { Ref } from "#core/problems/types.ts";
import type { SelectMode } from "../viewer/scene.ts";
import { extendHook } from "./hook.ts";
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

export type { Ref, SelectMode };

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

export function select(ids: readonly string[], mode: SelectMode): void {
  if (mode === "replace") {
    selection.value = new Set(ids);
    return;
  }
  const next = new Set(selection.value);
  for (const id of ids) {
    if (mode === "toggle" && next.has(id)) next.delete(id);
    else next.add(id);
  }
  selection.value = next;
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
 * What the view hides and isolates (docs/ux/editing-audit.md E-UX-9): view state, like the
 * section plane, never a step, per tab. `hidden` are the entities not drawn; picks and snaps pass
 * them over (the tools give it as their `skip`). `isolated` is what Isolate keeps, the rest
 * hidden; undefined when nothing is isolated. Nothing sets them until E2.4 builds hide and
 * isolate.
 */
export const hidden = signal<ReadonlySet<string>>(new Set());
export const isolated = signal<ReadonlySet<string> | undefined>(undefined);

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
