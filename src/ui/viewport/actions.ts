import { type Action, type ActionContext, registerAction } from "../actions/registry.ts";
import { bodiesOf, hidden, hide, isolate, showAll, unhide } from "../focus.ts";
import { viewer } from "./viewer.ts";

/**
 * The view's actions (docs/ux/editing-audit.md E0.2, E2.4), registered while the view controls
 * are shown: Fit, with its key, as the toolbar's Fit button fits; Show, which draws a hidden
 * selection again (review m10); and Hide (H), Isolate
 * (Shift+H) and Show all (Alt+H), view state that is never a step (E-UX-9). Owner: E2.
 */

const FIT: Action = {
  id: "fit",
  title: (c) => (c.selection.size > 0 ? "Fit to the selection" : "Fit to everything"),
  group: "view",
  keys: ["f"],
  help: "Fit the view to the selection, or to everything",
  when: () => (viewer.peek() ? true : "the view is not ready"),
  run(c) {
    viewer.peek()?.fitSelection(c.selection);
  },
};

/** What draws the selection and is hidden now. */
const hiddenOfSelection = (c: ActionContext) =>
  bodiesOf(c.m, [...c.selection]).filter((id) => hidden.peek().has(id));

/**
 * Show, beside Hide, is Hide's undoing (review m10): on a hidden entity (its outline row's menu)
 * it draws it again. On a drawn one it is not offered: it framed and pulsed the selection with a
 * callout that said only its id, which Fit, just above it, already does, and it read as un-hide.
 * A problem's, a toast's or a chip's Show still frames what it is about (`show` in focus.ts).
 */
const SHOW: Action = {
  id: "show",
  title: "Show",
  group: "view",
  help: "Draw the selection again where it is hidden (view only, never a step)",
  applies: (c) => hiddenOfSelection(c).length > 0,
  when: (c) => (hiddenOfSelection(c).length > 0 ? true : "nothing selected is hidden"),
  run(c) {
    unhide(c.m, [...c.selection]);
  },
};

/** What draws the selection and is not hidden yet. */
const shownOfSelection = (c: ActionContext) =>
  bodiesOf(c.m, [...c.selection]).filter((id) => !hidden.peek().has(id));

const HIDE: Action = {
  id: "hide",
  title: "Hide",
  group: "view",
  keys: ["h"],
  help: "Hide the selection (view only, never a step)",
  applies: (c) => c.selection.size > 0,
  when: (c) => {
    if (c.selection.size === 0) return "select something to hide";
    return shownOfSelection(c).length > 0 ? true : "nothing selected is drawn";
  },
  run(c) {
    hide(c.m, [...c.selection]);
  },
};

const ISOLATE: Action = {
  id: "isolate",
  title: "Isolate",
  group: "view",
  keys: ["shift+h"],
  help: "Show only the selection; hide the rest",
  applies: (c) => c.selection.size > 0,
  when: (c) => {
    if (c.selection.size === 0) return "select something to isolate";
    return bodiesOf(c.m, [...c.selection]).length > 0 ? true : "nothing selected is drawn";
  },
  run(c) {
    isolate(c.m, [...c.selection]);
  },
};

const SHOW_ALL: Action = {
  id: "show-all",
  title: "Show all",
  group: "view",
  keys: ["alt+h"],
  help: "Show everything hidden again",
  applies: () => hidden.peek().size > 0,
  when: () => (hidden.peek().size > 0 ? true : "nothing is hidden"),
  run() {
    showAll();
  },
};

/** Registers the view's actions; returns the undo. */
export function viewActions(): () => void {
  const offs = [FIT, SHOW, HIDE, ISOLATE, SHOW_ALL].map(registerAction);
  return () => {
    for (const off of offs) off();
  };
}
