import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { type Action, type ActionContext, registerAction } from "../actions/registry.ts";
import { busy, sendCommands } from "../store.ts";
import { activeTool } from "../tools/state.ts";
import { startDelete } from "./Delete.tsx";
import { readOnly } from "./Fields.tsx";
import { endWords } from "./words.ts";

/**
 * The inspector's actions (docs/ux/editing-audit.md E0.2), registered while the inspector is
 * shown: Delete, with its keys; Join an open end; Replace a profile. Each runs what the
 * inspector's own button runs. Owner: E4.
 */

const END = /^(b\d+)\.([ab])$/;

/** The bars the Replace action asked a form for, as `replaceKey` writes them, until one opens. */
export const replaceAsked = signal<string | undefined>(undefined);
export const replaceKey = (bars: readonly string[]) => [...bars].sort().join(",");

/** Opens a Replace form (`open`) when the Replace action asks for these bars. */
export function useReplaceAsked(bars: readonly string[], open: () => void): void {
  const asked = replaceAsked.value;
  useEffect(() => {
    if (asked === undefined || asked !== replaceKey(bars)) return;
    replaceAsked.value = undefined;
    open();
  }, [asked]);
}

/** The one bar the context is about, a pattern copy being no bar of its own. */
function oneBar(c: ActionContext): string | undefined {
  const ids = [...c.selection];
  const id = ids.length === 1 ? (ids[0] as string) : undefined;
  return id && !id.includes("@") && c.m.derived.bars[id] ? id : undefined;
}

/**
 * The end Join is asked about: the one the asker names (a row's end, the end selected), else, on
 * a bar, the end nearer where the menu opened, else the bar's one open end.
 */
export function joinEnd(c: ActionContext): { bar: string; end: "a" | "b" } | { why: string } {
  const named = END.exec(c.ref ?? (c.selection.size === 1 ? ([...c.selection][0] as string) : ""));
  if (named) return { bar: named[1] as string, end: named[2] as "a" | "b" };
  const bar = oneBar(c);
  if (!bar) return { why: "select one bar" };
  const hit = c.hit?.id === bar ? c.hit : undefined;
  if (hit?.face === "a" || hit?.face === "b") return { bar, end: hit.face };
  const len = c.m.derived.bars[bar]?.len_mm ?? 0;
  if (hit?.station) return { bar, end: hit.station.at_mm <= len / 2 ? "a" : "b" };
  const open = (["a", "b"] as const).filter((e) => endWords(c.m, bar, e).open);
  if (open.length === 1) return { bar, end: open[0] as "a" | "b" };
  return open.length === 0
    ? { why: `both of ${bar}'s ends are joined` }
    : { why: `say which end of ${bar}: its row, or the menu by that end` };
}

const DELETE: Action = {
  id: "delete",
  title: (c) => ([...c.selection].every((id) => id.includes("@")) ? "Leave out" : "Delete"),
  group: "edit",
  keys: ["delete", "backspace"],
  help: "Delete the selection in Select; what else goes is listed first",
  applies: (c) => c.selection.size > 0,
  when(c) {
    if (c.selection.size === 0) return "select something to delete";
    if (activeTool.peek() !== "select") return "Delete works in Select: press Esc first";
    return true;
  },
  // Read-only and the plan's dry run are startDelete's to say, as the key always said them.
  run: () => startDelete(),
};

const JOIN_END: Action = {
  id: "join-end",
  title: (c) => {
    const e = joinEnd(c);
    return "why" in e ? "Join an end" : `Join ${e.bar}.${e.end}`;
  },
  group: "bar",
  applies: (c) => oneBar(c) !== undefined || END.test(c.ref ?? ""),
  when(c) {
    const e = joinEnd(c);
    if ("why" in e) return e.why;
    const w = endWords(c.m, e.bar, e.end);
    if (!w.open) return `${e.bar}.${e.end} ${w.text}`;
    if (readOnly()) return "the project is read-only";
    if (busy.peek()) return "a step is on its way";
    return true;
  },
  async run(c) {
    const e = joinEnd(c);
    if ("why" in e) return;
    const ref = `${e.bar}.${e.end}`;
    await sendCommands([{ cmd: "autoConnect", args: { end: ref } }], `join ${ref}`);
  },
};

/** The bars Replace would change: every one selected, when they share a profile. */
function replaced(c: ActionContext): { bars: string[] } | { why: string } {
  const ids = [...c.selection];
  if (ids.length === 0 || ids.some((id) => id.includes("@") || !c.m.derived.bars[id]))
    return { why: "select bars to replace their profile" };
  const items = new Set(ids.map((id) => c.m.derived.bars[id]?.item));
  return items.size === 1 ? { bars: ids } : { why: "select bars of one profile" };
}

const REPLACE: Action = {
  id: "replace",
  title: "Replace profile…",
  group: "bar",
  applies: (c) => c.selection.size > 0 && [...c.selection].every((id) => c.m.derived.bars[id]),
  when(c) {
    const r = replaced(c);
    if ("why" in r) return r.why;
    return readOnly() ? "the project is read-only" : true;
  },
  run(c) {
    const r = replaced(c);
    // The inspector shows the selection; its Replace form for these bars opens.
    if (!("why" in r)) replaceAsked.value = replaceKey(r.bars);
  },
};

/** Registers the inspector's actions; returns the undo. */
export function inspectorActions(): () => void {
  const offs = [DELETE, JOIN_END, REPLACE].map(registerAction);
  return () => {
    for (const off of offs) off();
  };
}
