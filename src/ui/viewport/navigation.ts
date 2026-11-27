import { effect, signal } from "@preact/signals";
import type { Navigation } from "../../viewer/scene.ts";
import { readPref, writePref } from "../shell/prefs.ts";
import { viewer } from "./viewer.ts";

/**
 * How the view takes a wheel (docs/ux/editing-audit.md E-UX-17, E2.6): Mouse, the default, where
 * the wheel zooms and a right-drag pans; or Trackpad, where a two-finger scroll pans. A pinch
 * zooms in both. A preference per browser, chosen in the help. Owner: E2.
 */

const KEY = "alukit.navigation";
const isNavigation = (x: unknown): x is Navigation => x === "mouse" || x === "trackpad";

export const navigation = signal<Navigation>(readPref(KEY, "mouse", isNavigation));

/** Chooses how the view takes a wheel, and remembers it. */
export function setNavigation(n: Navigation): void {
  navigation.value = n;
  writePref(KEY, n);
}

/** Keeps the viewer's navigation the preference's; returns the undo. */
export function connectNavigation(): () => void {
  return effect(() => {
    viewer.value?.setNavigation(navigation.value);
  });
}
