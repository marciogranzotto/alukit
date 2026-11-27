import type { V3 } from "../../../mesh/model.ts";
import type { DrawPoint } from "../../../viewer/draw.ts";
import type { MarkerKind } from "../../../viewer/overlay.ts";
import type { ToolHandler, ToolPointer, Viewer } from "../../../viewer/scene.ts";
import type { Ray, Snap, SnapTargets } from "../../../viewer/snap.ts";
import { type CommandOutcome, model } from "../../store.ts";
import { lastResult, type ToolName } from "../state.ts";
import type { Typed } from "../typed.ts";

/**
 * What every tool's wiring shares (docs/ux/editing-audit.md E0.1): the router in `wiring.ts`
 * makes one `WireContext` per viewer and hands it to each tool's module under `wire/`; each
 * module gives back a `Wire`, which the router offers the pointer, the keys and the command bar's
 * field. A module keeps its own gesture's state; what several tools show lives in `state.ts`'s
 * signals. Owner: E3.
 */

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const fmt = (x: number) => String(Math.round(x * 100) / 100);

/** A character that starts a value in the command bar (D-UX-17). */
export const VALUE_START = /^[0-9.\-+([=]$/;

/** The marker a snap's kind and reference draw (C §5.3): a face centre and a part's datum apart. */
export function markerOf(s: Snap): MarkerKind {
  if (s.kind !== "point") return s.kind;
  if (s.ref.kind === "part") return / origin$| datum /.test(s.label) ? "datum" : "face";
  if (s.ref.kind === "station" && / face centre$/.test(s.label)) return "face";
  return "point";
}

/** A typed point (`[x, y, z]`) as a gesture's point: written with its expressions. */
export function typedPoint(t: Extract<Typed, { kind: "point" }>): DrawPoint {
  return {
    p: t.items.map((x) => x.value) as unknown as V3,
    written: t.items.map((x) => x.written),
    label: `typed [${t.items.map((x) => x.written).join(", ")}]`,
  };
}

/** What a step came to, for the command bar's result chip. */
export function noteResult(o: CommandOutcome): void {
  lastResult.value = o.ok
    ? { rev: o.rev, created: o.created }
    : { rev: model.peek()?.rev ?? 0, created: [], error: o.why };
}

/** A refusal shown in the command bar's result chip, where it happened (U30). */
export function refuse(error: string): void {
  lastResult.value = { rev: model.peek()?.rev ?? 0, created: [], error };
}

/** What the router gives each tool's module. */
export interface WireContext {
  viewer: Viewer;
  /** The model's snap targets, as of the revision drawn. */
  targets(): SnapTargets;
  /** The pointer's ray in world coordinates. */
  rayAt(e: ToolPointer): Ray;
  /** The snap under the pointer, in the targets `filter` keeps; the section's far side never snaps. */
  snapAt(e: ToolPointer, filter?: (s: SnapTargets) => SnapTargets): Snap | undefined;
  /** The text by the pointer, and the machine label of what it is on (`hint`). */
  show(e: ToolPointer | undefined, text: string | undefined, snap?: string): void;
  /** Where the pointer was last seen over the view, while a tool had it. */
  pointer(): ToolPointer | undefined;
  /** Remembers the pointer (each handler's `move` does). */
  track(e: ToolPointer): void;
  /** Shows the active tool again where the pointer is (or without it, for the keyboard). */
  refresh(): void;
  /** The command bar gives the keyboard back once a value is used. */
  used(): void;
  /** What is typed in the command bar, read with the project's params. */
  typedNow(): Typed;
  /** The params of the revision drawn. */
  params(): Readonly<Record<string, number>>;
}

/**
 * A tool's wiring, as its module gives it to the router. Every member but `handler` is optional;
 * the router asks the active tool's.
 */
export interface Wire {
  /** The viewport's pointer while the tool is active (`Viewer.setTool`). */
  handler: ToolHandler;
  /** Draws the tool's state without a pointer: after a key, or a value typed. */
  preview?(): void;
  /** Esc, one level back in the gesture (D-UX-18); true when there was a level to take back. */
  back?(): boolean;
  /** Enter: what is typed, or the gesture's next step. */
  enter?(): boolean;
  /** A key the gesture takes, outside the command bar's field. */
  key?(e: KeyboardEvent): boolean;
  /** Whether the tool takes a value from the command bar now (D-UX-17). */
  takesValue?(ch: string): boolean;
  /** Tab in the command bar's field: the previewed joint's next arrangement. */
  flip?(): void;
  /** Forgets the gesture's own state when the tool changes (before the overlay is cleared). */
  reset?(): void;
  /** The tool changed to `next`: what the module keeps across gestures, kept or cleared. */
  switched?(next: ToolName): void;
  dispose?(): void;
}
