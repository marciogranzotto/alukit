/**
 * Per-browser and per-tab conveniences (docs/ux/plan.md S2.2, S2.4, S2.13): the sheets' size, the
 * columns' widths, the single-letter keys switch, the palette for the tab's session. None of this
 * is the project's state, which the server holds (§7.1); losing it costs a click. Storage can be
 * missing or refuse (a private window, cleared site data, Node in the unit tests), so every read
 * and write is guarded and a read falls back to its default. Owner: S2.
 */

type Store = "local" | "session";

function storage(which: Store): Storage | undefined {
  // Outside a page (the unit tests in Node) there is no storage to keep anything in.
  if (typeof window === "undefined") return undefined;
  try {
    return which === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** A stored value, when it is there and passes `valid`; the fallback otherwise. */
export function readPref<T>(
  key: string,
  fallback: T,
  valid: (x: unknown) => x is T,
  which: Store = "local",
): T {
  try {
    const text = storage(which)?.getItem(key);
    if (text === null || text === undefined) return fallback;
    const x: unknown = JSON.parse(text);
    return valid(x) ? x : fallback;
  } catch {
    return fallback;
  }
}

/** Stores a value; undefined removes it. A refusal is ignored: it is a convenience. */
export function writePref(key: string, value: unknown, which: Store = "local"): void {
  try {
    const s = storage(which);
    if (!s) return;
    if (value === undefined) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    // Full, refused or absent: the default comes back next time.
  }
}

export const isBoolean = (x: unknown): x is boolean => typeof x === "boolean";
export const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export const isString = (x: unknown): x is string => typeof x === "string";
export const isStringList = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((s) => typeof s === "string");
