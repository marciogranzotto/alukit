import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { type Action, type ActionContext, registerAction } from "../actions/registry.ts";
import { cornerKey, cornersOf } from "../corners.ts";
import { select } from "../focus.ts";
import type { Model } from "../model.ts";
import { busy, type CommandOutcome, sendCommands } from "../store.ts";
import { readOnly } from "./Fields.tsx";
import { explodeEdit } from "./pattern.ts";
import type { Edit } from "./rows.tsx";
import { connectionType, copyOf, isObject, patternOf, refKind, written } from "./words.ts";

/**
 * The connection, pattern and part actions (docs/ux/editing-audit.md E5.6, E-UX-1): Edit a
 * connection and Change its connector, which take the inspector to that field; Explode a pattern,
 * one step that selects what it made; Replace a part, which opens the part's Replace form.
 * Delete is the inspector's own action and already takes any of them. A joint marker's menu offers
 * its joint's, when one joint is there. Registered while the inspector is shown, as its other
 * actions are. Owner: E5.
 */

/** What an action asked the inspector to open for an entity, until the inspector takes it. */
export interface Asked {
  id: string;
  what: "edit" | "connector" | "replace";
  /** Counts the asks, so asking again for the same thing opens it again. */
  n: number;
}

export const asked = signal<Asked | undefined>(undefined);
let asks = 0;

function ask(id: string, what: Asked["what"]): void {
  asked.value = { id, what, n: ++asks };
}

/** Runs `then` when an action asks for `what` on `id`, once per ask. */
export function useAsked(id: string, what: Asked["what"], then: () => void): void {
  const a = asked.value;
  useEffect(() => {
    if (a?.id !== id || a.what !== what) return;
    asked.value = undefined;
    then();
  }, [a?.n]);
}

/** The one entity the context is about, when one is selected. */
function one(c: ActionContext): string | undefined {
  return c.selection.size === 1 ? ([...c.selection][0] as string) : undefined;
}

/** Why an edit cannot be made now, or true. */
function canEdit(): true | string {
  if (readOnly()) return "the project is read-only";
  if (busy.peek()) return "a step is on its way";
  return true;
}

/**
 * The connection the context is about (a pattern copy's, as itself), or undefined: one selected,
 * or the one joint at a corner whose marker the menu was opened on. A joint marker is a joint's
 * sign in the view, and most connections have no body of their own to point at.
 */
function oneConnection(c: ActionContext): string | undefined {
  const id = one(c);
  if (!id) return undefined;
  const key = cornerKey(id);
  if (key !== undefined) {
    const at = cornersOf(c.m).find((k) => k.key === key);
    return at?.connections.length === 1 ? at.connections[0] : undefined;
  }
  const own = copyOf(id)?.template ?? id;
  return refKind(c.m, own) === "connection" ? id : undefined;
}

/** A copy's connection is changed through its template. */
function notACopy(id: string): true | string {
  const copy = copyOf(id);
  return copy ? `${id} is a pattern copy: change ${copy.template}, its template` : true;
}

/** Asks the inspector for a connection's field, selecting the connection first (from a corner). */
function askConnection(c: ActionContext, what: "edit" | "connector"): void {
  const id = oneConnection(c);
  if (!id) return;
  if (!c.selection.has(id)) select([id], "replace");
  ask(id, what);
}

const EDIT_CONNECTION: Action = {
  id: "edit-connection",
  title: (c) => `Edit ${oneConnection(c) ?? "the connection"}…`,
  group: "connection",
  applies: (c) => oneConnection(c) !== undefined,
  when(c) {
    const id = oneConnection(c);
    if (!id) return "select one connection";
    const copy = notACopy(id);
    return copy === true ? canEdit() : copy;
  },
  run: (c) => askConnection(c, "edit"),
};

/** The connection types a connector is chosen for: a face joint names fasteners instead. */
const HAS_CONNECTOR = new Set(["butt", "miter", "splice", "pivot"]);

const CHANGE_CONNECTOR: Action = {
  id: "change-connector",
  title: "Change connector…",
  group: "connection",
  applies: (c) => {
    const id = oneConnection(c);
    return id !== undefined && HAS_CONNECTOR.has(connectionType(c.m, id) ?? "");
  },
  when(c) {
    const id = oneConnection(c);
    if (!id) return "select one connection";
    const copy = notACopy(id);
    return copy === true ? canEdit() : copy;
  },
  run: (c) => askConnection(c, "connector"),
};

/**
 * Explodes a pattern as one step and selects what it made (E-UX-13). With `edit` (a row's), its
 * refusal is shown under that row; otherwise in a toast, as a key's or a menu's is.
 */
export async function explodePattern(
  id: string,
  edit?: (e: Edit, what: string) => Promise<CommandOutcome>,
): Promise<CommandOutcome> {
  const e = explodeEdit(id) as { commands: { cmd: string; args?: unknown }[] };
  const what = `explode ${id}`;
  const o = edit ? await edit(e, what) : await sendCommands(e.commands, what);
  if (o.ok) select(o.created, "replace");
  return o;
}

/** The pattern the context is about: one selected, or the one that makes the copy selected. */
function onePattern(c: ActionContext): string | undefined {
  const id = one(c);
  if (!id) return undefined;
  if (refKind(c.m, id) === "pattern") return id;
  return copyOf(id) ? patternOf(c.m, id) : undefined;
}

const EXPLODE: Action = {
  id: "explode-pattern",
  title: (c) => `Explode ${onePattern(c) ?? "the pattern"}`,
  group: "pattern",
  help: "Turn a pattern's copies into entities of their own, as one step",
  applies: (c) => onePattern(c) !== undefined,
  when: (c) => (onePattern(c) ? canEdit() : "select a pattern or one of its copies"),
  async run(c) {
    const id = onePattern(c);
    if (id) await explodePattern(id);
  },
};

/**
 * Whether a part's item can be replaced from the catalog: a part of the document (not a copy) of a
 * catalog item, on a station or at a pose. A project item is the document's own, edited where it
 * is written; an unplaced line is a count, not a body in the view.
 */
export function replaceable(m: Model, id: string): boolean {
  const w = written(m, id);
  return (
    refKind(m, id) === "part" &&
    isObject(w) &&
    typeof w.item === "string" &&
    !w.item.startsWith("project:") &&
    w.unplaced !== true
  );
}

/** The part the context is about: one whose item the catalog can replace. */
function onePart(c: ActionContext): string | undefined {
  const id = one(c);
  return id && replaceable(c.m, id) ? id : undefined;
}

const REPLACE_PART: Action = {
  id: "replace-part",
  title: "Replace part…",
  group: "part",
  applies: (c) => onePart(c) !== undefined,
  when: (c) => (onePart(c) ? canEdit() : "select one part"),
  run(c) {
    const id = onePart(c);
    if (id) ask(id, "replace");
  },
};

/** Registers the connection, pattern and part actions; returns the undo. */
export function editActions(): () => void {
  const offs = [EDIT_CONNECTION, CHANGE_CONNECTOR, EXPLODE, REPLACE_PART].map(registerAction);
  return () => {
    for (const off of offs) off();
  };
}
