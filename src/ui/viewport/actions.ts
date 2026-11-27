import { type Action, registerAction } from "../actions/registry.ts";
import { show } from "../focus.ts";
import { viewer } from "./viewer.ts";

/**
 * The view's actions (docs/ux/editing-audit.md E0.2), registered while the view controls are
 * shown: Fit, with its key, as the toolbar's Fit button fits; Show, which frames and pulses the
 * selection and reveals its rows, as a toast's or a chip's Show does. Owner: E2.
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

const SHOW: Action = {
  id: "show",
  title: "Show",
  group: "view",
  applies: (c) => c.selection.size > 0,
  when: (c) => (c.selection.size > 0 ? true : "select something to show"),
  run(c) {
    show({ refs: [...c.selection] });
  },
};

/** Registers the view's actions; returns the undo. */
export function viewActions(): () => void {
  const offs = [FIT, SHOW].map(registerAction);
  return () => {
    for (const off of offs) off();
  };
}
