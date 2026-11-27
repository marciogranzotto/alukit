import { computed, effect, signal } from "@preact/signals";
import type { Theme } from "./tokens.ts";

/**
 * The app's theme (docs/ux/plan.md D-UX-21). The stylesheets key the light values on
 * `<html data-theme>`, and the viewport hands the viewer `viewTheme(theme)`.
 *
 * - The theme **follows the system's scheme** (`prefers-color-scheme`): light when the system
 *   asks for light, dark otherwise, so dark when it says nothing.
 * - A **manual choice** (the switch, `ThemeSwitch.tsx`) overrides it and is remembered per
 *   browser. Storage can be absent or throw (a private window, blocked site data), so every use
 *   is guarded and the app works without it.
 * - **Snapshots are pinned dark** unless the URL says `theme=light` (`alukit snapshot --theme`):
 *   deterministic images that follow neither the system nor a remembered choice.
 *
 * Owner: S4.
 */

export type { Theme };

/** What the person chose: the system's scheme, or one theme. */
export type ThemePreference = "system" | Theme;

const KEY = "alukit.theme";

/** The system's scheme, when the browser can say; dark otherwise. */
export const system = signal<Theme>("dark");

/** The choice, remembered per browser. */
export const themePreference = signal<ThemePreference>("system");

/** The snapshot's pin, when the page is one (`?snapshot=<view>`): its theme from `?theme=`. */
const pinned = signal<Theme | undefined>(undefined);

/** The theme in force: the snapshot's pin, else the choice, else the system's. */
export const theme = computed<Theme>(() => {
  if (pinned.value !== undefined) return pinned.value;
  return themePreference.value === "system" ? system.value : themePreference.value;
});

function stored(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    return "system";
  }
}

/** Chooses a theme, or the system's; remembered when the browser lets it be. */
export function chooseTheme(p: ThemePreference): void {
  themePreference.value = p;
  try {
    if (p === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    // Not remembered: the choice holds for this page.
  }
}

/** Reads the page's state into the signals: the snapshot's pin, the choice, the system. */
function read(): () => void {
  const params = new URLSearchParams(location.search);
  pinned.value = params.has("snapshot")
    ? params.get("theme") === "light"
      ? "light"
      : "dark"
    : undefined;
  themePreference.value = stored();
  const query = matchMedia("(prefers-color-scheme: light)");
  const sync = () => {
    system.value = query.matches ? "light" : "dark";
  };
  sync();
  query.addEventListener("change", sync);
  return () => query.removeEventListener("change", sync);
}

/**
 * Starts the theme: reads the system, the remembered choice and the snapshot's pin, and keeps
 * `data-theme` on the root element equal to the theme. Returns the undo.
 */
export function applyTheme(root: HTMLElement = document.documentElement): () => void {
  const stop = read();
  const off = effect(() => {
    root.dataset.theme = theme.value;
  });
  return () => {
    off();
    stop();
  };
}
