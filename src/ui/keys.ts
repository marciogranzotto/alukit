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

/** Offers a key to the handlers in order; true when one took it, whose default is prevented. */
export function routeKey(e: KeyboardEvent): boolean {
  if (typingIn(e.target)) return false;
  for (const x of entries) {
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
