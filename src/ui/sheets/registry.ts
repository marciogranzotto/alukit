import { signal } from "@preact/signals";
import type { ComponentChildren, ComponentType } from "preact";
import type { Model } from "../model.ts";
import { isBoolean, isNumber, readPref, writePref } from "../shell/prefs.ts";

/**
 * The sheets (docs/ux/plan.md §5.3, D-UX-2): the outputs, problems and records below the
 * viewport. Each sheet registers itself from its own module, so the container (Sheets.tsx) never
 * imports one; the container lists what is registered, by `order`, and shows the active one.
 * Owner: S2.
 *
 * The sheets are collapsed (the rail alone), split (the rail and the active sheet, at a height
 * the person drags) or maximized (over the main area, the canvas left as it was underneath). The
 * person's choice of open or collapsed, and the height, are kept per browser; the app's own
 * openings and collapses (an empty project's collapse, the first output's opening) are not.
 */

export interface SheetDef {
  /** Stable, for `openSheet` and the rail: `cutlist`, `order`, … */
  id: string;
  /** Its tab's name. */
  title: string;
  /** Its place on the rail: lower first. */
  order: number;
  /** What its tab shows beside its name, read closed: a count, a figure, a status. */
  badge?: () => ComponentChildren;
  /** Its contents, for the drawn model. */
  Body: ComponentType<{ m: Model }>;
}

/** The registered sheets, by `order`. */
export const sheets = signal<readonly SheetDef[]>([]);

/** Registers a sheet; registering an id again replaces the sheet (a module reloaded). */
export function registerSheet(def: SheetDef): void {
  sheets.value = [...sheets.value.filter((s) => s.id !== def.id), def].sort(
    (a, b) => a.order - b.order,
  );
}

const OPEN = "alukit.sheets.open";
const HEIGHT = "alukit.sheets.height";

/** The height a split takes by default, and its limits (the canvas keeps at least the rest). */
export const SHEETS_HEIGHT = { initial: 280, min: 120 } as const;

/** The sheet shown, by id. */
export const activeSheet = signal<string>("cutlist");
/** Whether the sheets are open (their body shown) or collapsed to the rail. */
export const sheetsOpen = signal(readPref(OPEN, true, isBoolean));
/** Whether the open sheets are maximized over the main area. */
export const sheetsMax = signal(false);
/** The height of the split sheets, rail included, in CSS pixels. */
export const sheetsHeight = signal(
  Math.max(SHEETS_HEIGHT.min, readPref(HEIGHT, SHEETS_HEIGHT.initial, isNumber)),
);

/**
 * Whether the app is waiting to open the sheets by itself, once, on the project's first output
 * (B §4.3): set when the tab first draws an empty project, cleared when it opens them or the
 * person opens or collapses them first.
 */
export const firstOutputPending = signal(false);

/**
 * Opens, collapses or maximizes the sheets. `remember` is the person's own choice, kept for the
 * next visit; the app's openings and collapses pass false.
 */
export function setSheets(
  next: { open?: boolean; max?: boolean; height?: number },
  remember = true,
): void {
  if (next.open !== undefined) sheetsOpen.value = next.open;
  if (next.max !== undefined) sheetsMax.value = next.max;
  if (!sheetsOpen.value) sheetsMax.value = false;
  if (next.height !== undefined) sheetsHeight.value = Math.max(SHEETS_HEIGHT.min, next.height);
  if (remember) {
    firstOutputPending.value = false;
    if (next.open !== undefined) writePref(OPEN, sheetsOpen.value);
    if (next.height !== undefined) writePref(HEIGHT, sheetsHeight.value);
  }
}

/**
 * Shows a sheet, opening the sheets when collapsed. `maximize: true` maximizes them, `false`
 * restores the split; absent, a maximized view stays maximized.
 */
export function openSheet(id: string, opts: { maximize?: boolean } = {}): void {
  activeSheet.value = id;
  setSheets({ open: true, ...(opts.maximize !== undefined ? { max: opts.maximize } : {}) });
}

/** Every table shows only the rows of the selection (S4.4). */
export const selectionOnly = signal(false);
