import { computed, signal } from "@preact/signals";
import type { ComponentType } from "preact";
import type { Model } from "../model.ts";
import { isBoolean, readPref, writePref } from "./prefs.ts";

/**
 * When the start card shows (D-UX-6, S2.10; B §4.3): over an empty project's viewport, until the
 * person dismisses it (Esc or ×, remembered for the tab) or the project has something in it; and
 * again on demand, from the help (`?`, "Show the start card"). A project emptied again brings it
 * back. Owner: S2.
 */

const DISMISSED = "alukit.start.dismissed";

/** The person dismissed the card on this tab, while the project was empty. */
export const startDismissed = signal(readPref(DISMISSED, false, isBoolean, "session"));
/** The help asked for the card, whatever the project holds. */
export const startForced = signal(false);
/** Whether the drawn project is empty: no bars and no parts (B §4.3). */
export const emptyProject = signal<boolean | undefined>(undefined);

export function dismissStart(): void {
  startForced.value = false;
  startDismissed.value = true;
  writePref(DISMISSED, true, "session");
}

export function showStart(): void {
  startForced.value = true;
}

/** The card is up. */
export const startShown = computed(
  () => startForced.value || (emptyProject.value === true && !startDismissed.value),
);

/** Follows the drawn project: something in it ends a dismissal, so emptying it again shows the card. */
export function noteProject(m: Model): void {
  const empty =
    Object.keys(m.derived.bars).length === 0 && Object.keys(m.derived.parts).length === 0;
  emptyProject.value = empty;
  if (!empty && startDismissed.peek()) {
    startDismissed.value = false;
    writePref(DISMISSED, undefined, "session");
  }
}

/**
 * The box frame's form, which the box frame tool's module provides (S5.7: `FrameForm`, D-UX-8):
 * the card shows it as its first way in once it is there, and leaves the way out until then.
 * `onDone` closes the card when the frame is made.
 */
export const frameWay = signal<ComponentType<{ onDone: () => void }> | undefined>(undefined);
