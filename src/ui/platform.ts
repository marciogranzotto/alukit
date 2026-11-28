/**
 * The keyboard's platform, for how keys are written (docs/ux/review-editing.md m5): on a Mac the
 * modifiers are ⌘ ⌥ ⇧ and a chord runs together (`⇧⌘Z`), as Apple's keyboards and menus write
 * them (HIG, "Keyboards"); elsewhere Ctrl, Alt and Shift joined by `+`. Read from the user agent:
 * `navigator.platform` is deprecated, and a test's emulated agent does not move it. Pure, with no
 * imports, so pure modules (the tools' words) may use it. Owner: the review fixes (app).
 */

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** A modifier's name in a sentence: "hold Alt", or on a Mac "hold Option". */
export function modifierWord(m: "mod" | "alt" | "shift"): string {
  if (isMac()) return m === "mod" ? "⌘" : m === "alt" ? "Option" : "Shift";
  return m === "mod" ? "Ctrl" : m === "alt" ? "Alt" : "Shift";
}

/** A chord's caps as text: `Ctrl+D`, or on a Mac `⌘D`. */
export function capsText(caps: readonly string[]): string {
  return caps.join(isMac() ? "" : "+");
}
