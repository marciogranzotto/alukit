import { derivedJson } from "#core/derive/output.ts";
import { type Diagnostic, sortDiagnostics } from "#core/diagnostics.ts";
import { meshDisplay } from "../mesh/display.ts";
import type { Snapshot } from "./host.ts";

/**
 * What the app draws and shows for one revision (`alukit.view/1`), built once per revision on
 * the server, which owns the document (§7.1). One answer holds everything a tab shows, so every
 * panel is at the same revision:
 *
 * - `derived`: the derived model as `alukit.derived/1` (§7.3), the contract report builders read;
 * - `display`: what drawing and snapping need beyond it: each bar's section and where the
 *   section sits on the design line, the sections' display outlines (§3.5: simplified at
 *   0.05 mm) with their grooves and datums, parts' boxes and datums, the shapes and holes of the
 *   project's plates and bent angles (§4.8), and fasteners' positions (`meshDisplay`, which the
 *   GLB writer uses too, §9);
 * - `items`: the catalog entries the model uses, as the lock pins them, with their provenance
 *   (§1, principle 3), for the properties panel;
 * - `check`, `cutlist`, `bom`: the bottom drawer's tables (§8);
 * - `variant`: the variant all of it was derived in (§4.10), which `?variant=` chooses.
 *
 * The status (read-only or not) and the undo and redo steps are not here: they change without a
 * revision, and reach a tab on the event stream.
 */

export const VIEW_SCHEMA = "alukit.view/1";

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function viewModel(snap: Snapshot) {
  const { derived, items, state } = snap;
  const display = meshDisplay(derived, items);

  // The catalog entries the model uses, as pinned, with their provenance.
  const used = new Set<string>();
  for (const b of derived.bars.values()) used.add(b.placed.item.id);
  for (const p of derived.parts.values()) used.add(p.item);
  for (const h of derived.hardware) used.add(h.item);
  for (const r of derived.recipes) used.add(r.item);
  for (const p of derived.pieces) used.add(p.item);
  const catalogItems: Record<string, unknown> = {};
  for (const id of [...used].sort()) {
    const e = state.lock.items[id];
    if (e) catalogItems[id] = e.item;
  }

  const cl = snap.outputs.cutList();
  const b = snap.outputs.bom();
  const diagnostics: Diagnostic[] = sortDiagnostics([...snap.catalogs, ...snap.check.diagnostics]);
  const rawDoc = state.doc;
  return {
    schema: VIEW_SCHEMA,
    rev: snap.rev,
    ...(typeof rawDoc.name === "string" ? { name: rawDoc.name } : {}),
    /** The variant derived (§4.10): the one asked for, else the default; null for none. */
    variant: derived.variant ?? null,
    doc: rawDoc,
    derived: derivedJson(derived),
    display,
    items: catalogItems,
    defaults: isObject(rawDoc.defaults) ? rawDoc.defaults : {},
    check: { diagnostics, checks: snap.check.checks },
    cutlist: { ...cl, diagnostics: sortDiagnostics([...cl.diagnostics]) },
    bom: { ...b, diagnostics: sortDiagnostics([...b.diagnostics]) },
  };
}

export type ViewModel = ReturnType<typeof viewModel>;
