import { effect, signal } from "@preact/signals";
import type { Theme } from "./tokens.ts";

/**
 * The app's theme (D-UX-21). The stylesheets key the light values on `<html data-theme>`, and the
 * viewport hands the viewer `viewTheme(theme)`. Today the app has one theme, dark; S4.11 makes the
 * signal follow `prefers-color-scheme` (dark when the system says nothing) with a manual switch
 * remembered per browser. Owner: S4.
 */

export type { Theme };

export const theme = signal<Theme>("dark");

/** Keeps `data-theme` on the root element equal to the theme; returns the undo. */
export function applyTheme(root: HTMLElement = document.documentElement): () => void {
  return effect(() => {
    root.dataset.theme = theme.value;
  });
}
