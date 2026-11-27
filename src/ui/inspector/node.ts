import { compareIds } from "#core/ids.ts";
import type { Model } from "../model.ts";
import type { Cmd } from "../tools/preview.ts";
import type { Written } from "../tools/typed.ts";
import { isObject, written } from "./words.ts";

/**
 * A node's fields as the inspector edits them (docs/ux/editing-audit.md E4.7): where it is, a
 * point (`at`, each coordinate a number or an expression) or a station on a bar (`on`), and what
 * uses it. Each change is one `moveNode`, so what uses the node follows (§6), as `alukit do`
 * would send it. Pure. Owner: E4.
 */

type O = Record<string, unknown>;

export type NodePlace =
  | { kind: "at"; at: Written[] }
  | { kind: "on"; on: O }
  | { kind: "pivot"; pivot: string }
  | { kind: "none" };

/** Where a node is, as written. */
export function nodePlace(m: Model, id: string): NodePlace {
  const w = written(m, id);
  const at = Array.isArray(w) ? w : isObject(w) && Array.isArray(w.at) ? w.at : undefined;
  if (at && at.length === 3) return { kind: "at", at: at as Written[] };
  if (isObject(w) && isObject(w.on)) return { kind: "on", on: w.on };
  if (isObject(w) && typeof w.pivot === "string") return { kind: "pivot", pivot: w.pivot };
  return { kind: "none" };
}

/** The step that moves a node to a point: coordinate `i` as typed, the others as written. */
export function moveNodeAt(m: Model, id: string, i: 0 | 1 | 2, v: Written): Cmd | { why: string } {
  const p = nodePlace(m, id);
  if (p.kind !== "at") return { why: `${id} is not at a point of its own` };
  const at = [...p.at];
  at[i] = v;
  return { cmd: "moveNode", args: { id, at } };
}

/** The step that moves a node along its bar: the station's fields given replace its own. */
export function moveNodeOn(m: Model, id: string, patch: O): Cmd | { why: string } {
  const p = nodePlace(m, id);
  if (p.kind !== "on") return { why: `${id} is not on a bar` };
  const on: O = { ...p.on, ...patch };
  if (on.from === "a") delete on.from;
  for (const [k, v] of Object.entries(on))
    if (v === null || v === undefined || v === "") delete on[k];
  return { cmd: "moveNode", args: { id, on } };
}

/** What uses a node: the bar ends at it, the nodes and planes that name it, in id order. */
export function nodeUsers(m: Model, id: string): string[] {
  const out = new Set<string>();
  const bars = isObject(m.doc.bars) ? m.doc.bars : {};
  for (const [bid, b] of Object.entries(bars)) {
    if (!isObject(b)) continue;
    for (const e of ["a", "b"] as const) {
      if (b[e] === id) out.add(`${bid}.${e}`);
      const ends = isObject(b.ends) ? b.ends : {};
      const plane = isObject(ends[e]) ? (ends[e] as O).plane : undefined;
      if (isObject(plane) && plane.point === id) out.add(`${bid}.${e}`);
    }
  }
  return [...out].sort(compareIds);
}
