import { signal } from "@preact/signals";
import type { ComponentChildren, ComponentType } from "preact";
import type { Model } from "../model.ts";

/**
 * The sheets (docs/ux/plan.md §5.3, D-UX-2): the outputs, problems and records below the
 * viewport. Each sheet registers itself from its own module, so the container (Sheets.tsx) never
 * imports one; the container lists what is registered, by `order`, and shows the active one.
 * Owner: S2, which regroups them in S2.2 (Cut list, BOM, Machining, Order & costs, Problems,
 * Records), collapsible, splittable and maximizable.
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

/** The sheet shown, by id. */
export const activeSheet = signal<string>("cutlist");
/** Whether the sheets are open (their body shown) or collapsed to the rail. */
export const sheetsOpen = signal(true);

/** Shows a sheet, opening the sheets when collapsed. `maximize` waits for S2.2. */
export function openSheet(id: string, _opts: { maximize?: boolean } = {}): void {
  activeSheet.value = id;
  sheetsOpen.value = true;
}

/** Every table shows only the rows of the selection (S4.4); not yet honoured. */
export const selectionOnly = signal(false);
