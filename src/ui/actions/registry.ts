import { computed, signal } from "@preact/signals";
import type { Hit } from "../../viewer/scene.ts";
import { selection } from "../focus.ts";
import { type KeyHelpRow, type KeyHelpSection, type KeyScope, keyHelp, onKey } from "../keys.ts";
import type { Model } from "../model.ts";
import { model } from "../store.ts";

/**
 * The action registry (docs/ux/editing-audit.md E-UX-1, E0.2): every edit is an action, an id, a
 * title, a group, its keys, a `when` that says why it cannot run, and a `run`, registered once.
 * The context menu, the keys and the help read it; the selection header's buttons and the
 * inspector's action row will (E2.1). No action exists only as a key or only as a button.
 *
 * Keys bind through keys.ts, in the action's scope (`app` by default): a key runs the action when
 * its `when` says yes, and is left to the next handler otherwise, as a hand-written handler that
 * returns false. A key names its modifiers: `mod` is Ctrl or Cmd, then `shift`, `alt`, and the
 * key as `KeyboardEvent.key` names it, lower case (`delete`, `f10`, `d`). A binding holds exactly
 * the modifiers it names; a printable symbol (`?`, `/`) already says whether Shift was held, so
 * Shift is not checked for one. Two actions never share a key in one scope: registering the
 * second throws.
 *
 * The help (`helpSections`) lists every action that has keys, under its group's section, before
 * the rows a region describes itself (`describeKeys`) for keys that are not actions: a gesture's,
 * a tool's letter. Owner: E2.
 */

export type ActionGroup =
  | "select"
  | "view"
  | "edit"
  | "transform"
  | "bar"
  | "connection"
  | "pattern"
  | "part";

/** What an action is asked about. */
export interface ActionContext {
  m: Model;
  selection: ReadonlySet<string>;
  /** What the pointer was on when the menu opened in the view. */
  hit?: Hit;
  /**
   * A part of the selection the action is asked about, when the asker knows it: an end (`b1.a`)
   * from its row in the inspector, or the end nearer the pointer when the menu opened on a bar.
   */
  ref?: string;
  from: "view" | "outline" | "key" | "button";
}

export interface Action {
  id: string;
  title: string | ((c: ActionContext) => string);
  group: ActionGroup;
  /** Its keys, each `mod+d`, `h`, `shift+h`, `delete`: any of them runs it. */
  keys?: readonly string[];
  /** The keys' scope in keys.ts; `app` unless it says. */
  scope?: KeyScope;
  /** What the help says the keys do; the title when the title is words. */
  help?: string;
  /** Whether it belongs in this context's menu at all (a bar's action, on a bar); yes when absent. */
  applies?(c: ActionContext): boolean;
  /** True, or why it cannot run now (a menu shows it greyed with this). */
  when(c: ActionContext): true | string;
  run(c: ActionContext): void | Promise<void>;
}

/** The actions registered, in the order they were. */
export const actions = signal<readonly Action[]>([]);

/** A key as the registry reads it. */
interface Binding {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Reads a key: `mod+shift+h` is Ctrl or Cmd, Shift, and H. */
export function parseKey(k: string): Binding {
  const parts = k.toLowerCase().split("+");
  // A binding of the plus key itself ends in an empty part: `shift++`.
  const key = parts[parts.length - 1] === "" ? "+" : (parts[parts.length - 1] as string);
  const mods = new Set(parts.slice(0, -1).filter((p) => p !== ""));
  for (const m of mods) {
    if (m !== "mod" && m !== "shift" && m !== "alt") throw new Error(`${k}: unknown modifier ${m}`);
  }
  return { mod: mods.has("mod"), shift: mods.has("shift"), alt: mods.has("alt"), key };
}

/** A printable character that is not a letter: Shift is part of what it is. */
const symbol = (key: string) => key.length === 1 && key.toLowerCase() === key.toUpperCase();

/**
 * The key an event names, lower case, as `KeyboardEvent.key` gives it; but where Alt composes a
 * character in place of a letter or a digit (Option+H types ˙ on a Mac), the letter or digit of
 * the key pressed, from `code`. A layout whose Alt gives the letter itself keeps it (an AZERTY
 * A is `KeyQ` and stays a).
 */
function keyOf(e: Pick<KeyboardEvent, "key" | "altKey"> & { code?: string }): string {
  const k = e.key.toLowerCase();
  if (!e.altKey || /^[a-z0-9]$/.test(k) || e.code === undefined) return k;
  const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(e.code);
  return m ? ((m[1] ?? m[2]) as string).toLowerCase() : k;
}

/** Whether a key event is the binding `k`. */
export function keyMatches(
  k: string,
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & {
    code?: string;
  },
): boolean {
  const b = parseKey(k);
  if (keyOf(e) !== b.key) return false;
  if ((e.ctrlKey || e.metaKey) !== b.mod || e.altKey !== b.alt) return false;
  return symbol(b.key) || e.shiftKey === b.shift;
}

/** The keys' names as written on their caps, for the help and the menu. */
const CAPS: Readonly<Record<string, string>> = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  delete: "Delete",
  backspace: "Backspace",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  " ": "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  contextmenu: "Menu",
};

/** A binding as caps: `mod+d` is ["Ctrl", "D"]. */
export function keyCaps(k: string): string[] {
  const b = parseKey(k);
  const cap = CAPS[b.key] ?? (/^f\d+$/.test(b.key) ? b.key.toUpperCase() : b.key.toUpperCase());
  return [
    ...(b.mod ? [CAPS.mod as string] : []),
    ...(b.shift ? [CAPS.shift as string] : []),
    ...(b.alt ? [CAPS.alt as string] : []),
    cap,
  ];
}

/** A binding's identity within a scope, for the clash check: `app mod+shift+d`. */
function slot(scope: KeyScope, k: string): string {
  const b = parseKey(k);
  const shift = symbol(b.key) ? "" : b.shift ? "shift+" : "";
  return `${scope} ${b.mod ? "mod+" : ""}${shift}${b.alt ? "alt+" : ""}${b.key}`;
}

/** The context a key gives: the selection, asked from the keyboard. */
function keyContext(): ActionContext | undefined {
  const m = model.peek();
  return m ? { m, selection: selection.peek(), from: "key" } : undefined;
}

/**
 * Registers an action and binds its keys; returns the undo. An action registered again under its
 * id replaces the one before (a module loaded again). A key another action holds in the same
 * scope throws: one key, one action.
 */
export function registerAction(a: Action): () => void {
  const scope = a.scope ?? "app";
  const others = actions.peek().filter((x) => x.id !== a.id);
  const taken = new Map<string, string>();
  for (const x of others) for (const k of x.keys ?? []) taken.set(slot(x.scope ?? "app", k), x.id);
  for (const k of a.keys ?? []) {
    const holder = taken.get(slot(scope, k));
    if (holder) throw new Error(`${a.id}: ${k} is ${holder}'s key in the ${scope} scope`);
  }
  // The one this replaces lets its keys go first.
  unbind.get(a.id)?.();
  actions.value = [...others, a];
  const offKey = a.keys?.length
    ? onKey(scope, (e) => {
        if (!a.keys?.some((k) => keyMatches(k, e))) return false;
        const c = keyContext();
        if (!c || a.when(c) !== true) return false;
        void a.run(c);
        return true;
      })
    : undefined;
  const off = () => {
    offKey?.();
    if (unbind.get(a.id) === off) unbind.delete(a.id);
    actions.value = actions.peek().filter((x) => x !== a);
  };
  unbind.set(a.id, off);
  return off;
}
const unbind = new Map<string, () => void>();

/** An action's title in a context. */
export function titleOf(a: Action, c: ActionContext): string {
  return typeof a.title === "function" ? a.title(c) : a.title;
}

/** The actions that belong in a context, each with whether it can run now, or why not. */
export function actionsFor(c: ActionContext): { action: Action; enabled: true | string }[] {
  return actions.value
    .filter((a) => a.applies?.(c) ?? true)
    .map((a) => ({ action: a, enabled: a.when(c) }));
}

/** Runs an action by its id: true when it ran, else why not. */
export function runAction(id: string, c: ActionContext): true | string {
  const a = actions.peek().find((x) => x.id === id);
  if (!a) return `no action ${id}`;
  const ok = a.when(c);
  if (ok !== true) return ok;
  void a.run(c);
  return true;
}

/** Where each group's keys go in the help: a section of its own, or one a region describes. */
export const GROUP_HELP: Readonly<Record<ActionGroup, Omit<KeyHelpSection, "rows">>> = {
  select: { id: "selecting", title: "Selecting", order: 25 },
  edit: { id: "editing", title: "Editing", order: 30 },
  transform: { id: "transforming", title: "Moving and copying", order: 32 },
  bar: { id: "bars", title: "Bars", order: 34 },
  connection: { id: "connections", title: "Connections", order: 36 },
  pattern: { id: "patterns", title: "Patterns", order: 38 },
  part: { id: "parts", title: "Parts", order: 39 },
  view: { id: "view", title: "View", order: 50 },
};

/** An action's line in the help: its first key, the others as alternatives. */
function helpRow(a: Action): KeyHelpRow {
  const [first, ...rest] = a.keys ?? [];
  return {
    keys: keyCaps(first as string),
    ...(rest.length > 0 ? { or: rest.map(keyCaps) } : {}),
    does: a.help ?? (typeof a.title === "string" ? a.title : a.id),
  };
}

/**
 * The help's sections: each group's actions with keys, then the rows a region described under
 * the same section's id; then the sections that are descriptions only. By order.
 */
export const helpSections = computed((): readonly KeyHelpSection[] => {
  const byId = new Map<string, KeyHelpSection>();
  for (const a of actions.value) {
    if (!a.keys?.length) continue;
    const g = GROUP_HELP[a.group];
    const s = byId.get(g.id) ?? { ...g, rows: [] };
    byId.set(g.id, { ...s, rows: [...s.rows, helpRow(a)] });
  }
  for (const d of keyHelp.value) {
    const s = byId.get(d.id);
    byId.set(d.id, s ? { ...s, rows: [...s.rows, ...d.rows] } : d);
  }
  return [...byId.values()].sort((a, b) => a.order - b.order);
});
