import type { Model } from "../model.ts";
import { isObject, mapOf, written } from "./words.ts";

/**
 * The Context field (gap X11, docs/notes/x11.md): whether a bar or a placed part is context, not
 * part of the build (a wall, a floor, a bench the frame stands beside), and the step that marks it
 * or not. A pattern's copy follows its template, and an unplaced line is counted, never drawn, so
 * neither takes it. Pure. Owner: S5.
 */

export interface ContextField {
  /** Whether the entity can be marked context: a bar, or a part placed on a station or at a pose. */
  can: boolean;
  on: boolean;
  cmd: "setBar" | "setPart";
}

export function contextOf(m: Model, id: string): ContextField {
  const map = mapOf(id);
  const w = written(m, id);
  const cmd = map === "parts" ? "setPart" : "setBar";
  const placed = map === "bars" || (map === "parts" && isObject(w) && w.unplaced !== true);
  return { can: isObject(w) && placed, on: isObject(w) && w.context === true, cmd };
}

/** One step: `context: true`, or the field removed. */
export function contextBatch(m: Model, id: string, on: boolean) {
  return [{ cmd: contextOf(m, id).cmd, args: { id, set: { context: on ? true : null } } }];
}
