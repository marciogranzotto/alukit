import { signal } from "@preact/signals";
import { isBoolean, readPref, writePref } from "./shell/prefs.ts";

/**
 * The keys (design §8; docs/ux/plan.md §5.3, D-UX-18): one listener on the window offers each key
 * to the handlers the regions register, in order, until one takes it. Each stream registers its
 * own keys from its own files; the text-entry guard lives here, in one place: a key typed into a
 * text field, a list or an editable is the field's, and no handler sees it. Owner: S2.
 *
 * Order: by scope, then by priority (higher first), then by registration (earlier first).
 *
 * - `overlay`: what sits over everything while open (the start card, help, a dialog);
 * - `tool`: the active tool's gesture (a typed length, Enter, R, A, W, Esc within a gesture);
 * - `app`: shortcuts (tool letters, views, Esc to leave a tool, undo and redo).
 *
 * A handler sees every key that passes the guard, Ctrl, Cmd or Alt held or not: one that takes
 * plain keys only starts with `if (chord(e)) return false`.
 *
 * Single-character shortcuts can be switched off (WCAG 2.1.4, U65): then no `app` handler sees a
 * key that is one printable character with no Ctrl, Cmd or Alt (a letter, a digit, `/`, `?`,
 * Space, Shift held or not). The `overlay` and `tool` scopes still do: what an open overlay or a
 * live gesture takes is input, not a shortcut. Every action stays a button.
 *
 * Each region also says what its keys do (`describeKeys`), beside the handler that binds them, so
 * the help overlay lists the keys that exist and nothing else.
 */

export type KeyScope = "overlay" | "tool" | "app";

/** Takes a key, or not: true when it did (the key's default action is then prevented). */
export type KeyHandler = (e: KeyboardEvent) => boolean;

const SCOPES: readonly KeyScope[] = ["overlay", "tool", "app"];

interface Entry {
  scope: KeyScope;
  handler: KeyHandler;
  priority: number;
  seq: number;
}

let entries: Entry[] = [];
let seq = 0;

/** Registers a handler; returns the undo. */
export function onKey(scope: KeyScope, handler: KeyHandler, priority = 0): () => void {
  const entry: Entry = { scope, handler, priority, seq: seq++ };
  entries = [...entries, entry].sort(
    (a, b) =>
      SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope) || b.priority - a.priority || a.seq - b.seq,
  );
  return () => {
    entries = entries.filter((x) => x !== entry);
  };
}

/** Input types that take no typing: keys pressed while one has focus are the app's. */
const NOT_TYPED = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
]);

/** Whether the element takes the keys typed: a text field, a list, an editable. */
export function typingIn(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return true;
  return el.tagName === "INPUT" && !NOT_TYPED.has((el as HTMLInputElement).type);
}

/** Whether Ctrl, Cmd or Alt is held: a chord, which plain-key handlers leave alone. */
export function chord(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

const LETTER_KEYS = "alukit.letter-keys";

/** Whether single-character shortcuts are on (remembered per browser). */
export const letterKeys = signal(readPref(LETTER_KEYS, true, isBoolean));

/** Turns single-character shortcuts on or off, and remembers it. */
export function setLetterKeys(on: boolean): void {
  letterKeys.value = on;
  writePref(LETTER_KEYS, on);
}

/** Whether a key is a single-character shortcut: one printable character, no Ctrl, Cmd or Alt. */
export function isCharacterKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">) {
  return e.key.length === 1 && !chord(e);
}

/**
 * Offers a key to the handlers in order; true when one took it, whose default is prevented.
 * While a text field has focus its keys are its own, except Esc, which still closes the overlay
 * the field is in (a dialog, the catalog: WAI-ARIA's dialog pattern); no tool or app handler
 * sees it, so Esc in a form never cancels a gesture.
 */
export function routeKey(e: KeyboardEvent): boolean {
  const typing = typingIn(e.target);
  if (typing && e.key !== "Escape") return false;
  const shortcutsOff = !letterKeys.value && isCharacterKey(e);
  for (const x of entries) {
    if (typing && x.scope !== "overlay") continue;
    if (shortcutsOff && x.scope === "app") continue;
    if (x.handler(e)) {
      e.preventDefault();
      return true;
    }
  }
  return false;
}

/** Listens for keys on a window (the app's, by default); returns the undo. */
export function listenKeys(target: Window = window): () => void {
  const listener = (e: KeyboardEvent) => {
    routeKey(e);
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}

// ---------------------------------------------------------------------------------------------
// What the keys do, for the help overlay

/** One line of the help: the keys, as written on their caps, and what they do. */
export interface KeyHelpRow {
  keys: readonly string[];
  does: string;
}

/** A group of lines, from the region that binds them. */
export interface KeyHelpSection {
  /** Stable: describing a section again under its id replaces it. */
  id: string;
  title: string;
  /** Its place in the help: lower first. */
  order: number;
  rows: readonly KeyHelpRow[];
}

/** The sections described so far, by order. */
export const keyHelp = signal<readonly KeyHelpSection[]>([]);

/** Describes a region's keys for the help; returns the undo. */
export function describeKeys(section: KeyHelpSection): () => void {
  keyHelp.value = [...keyHelp.value.filter((x) => x.id !== section.id), section].sort(
    (a, b) => a.order - b.order,
  );
  return () => {
    keyHelp.value = keyHelp.value.filter((x) => x !== section);
  };
}
