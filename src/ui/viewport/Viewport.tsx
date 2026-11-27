import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { V3 } from "../../mesh/model.ts";
import { createViewer, type SectionPlane, type ViewerStats } from "../../viewer/scene.ts";
import { docViews } from "../../viewer/views.ts";
import { select, selection } from "../focus.ts";
import { extendHook } from "../hook.ts";
import { meshInput } from "../model.ts";
import { model } from "../store.ts";
import { theme } from "../theme/theme.ts";
import { viewTheme } from "../theme/tokens.ts";
import { ViewControls } from "./ViewControls.tsx";
import { viewer } from "./viewer.ts";

/**
 * The viewport (design §8): the 3D view of the drawn model, the bar over it, and the slots other
 * regions fill (docs/ux/plan.md §5.3). It makes the viewer, draws each revision's model in it and
 * keeps the selection painted; the tools wire themselves to the `viewer` signal. Owner: S3.
 *
 * Slots, which the app fills:
 * - `left`: the tool buttons (S5's tool rail). Today they open the bar over the viewport, before
 *   the view controls, so the bar wraps as it did; S3.11 gives the rail its own place.
 * - `centre`: S2's start card, over an empty project.
 * - `bottom`: S5's command bar above S2's status bar; today the tool's tip and help line.
 * - `topRight`: S2's toasts.
 *
 * With `snapshot` (`?snapshot=<view>`, §7.3) it is the canvas alone, at a named view.
 */

export interface ViewportSlots {
  left?: ComponentChildren;
  centre?: ComponentChildren;
  bottom?: ComponentChildren;
  topRight?: ComponentChildren;
}

/** Snapshot mode's state: "ready" once the named view is drawn, or why it cannot be. */
const snapshotState = signal<string | undefined>(undefined);
/** The revision the scene draws. */
let drawnRev: number | undefined;

declare module "../hook.ts" {
  interface AlukitHook {
    /** The scene's counts. */
    stats(): ViewerStats | undefined;
    /** The revision the scene draws. */
    drawnRev(): number | undefined;
    /** A world point (Z up, mm) on the page, in CSS pixels: where a script points the mouse. */
    screen(p: V3): [number, number] | undefined;
    /** Snapshot mode: "ready" once the named view is drawn, or why it cannot be. */
    snapshot(): string | undefined;
    /** The section plane the scene draws with, if it is on. */
    section(): SectionPlane | undefined;
    /** Whether the section plane hides a world point. */
    clipped(p: V3): boolean;
  }
}

extendHook({
  stats: () => viewer.value?.stats(),
  drawnRev: () => drawnRev,
  screen: (p) => viewer.value?.project(p) as [number, number] | undefined,
  snapshot: () => snapshotState.value,
  section: () => viewer.value?.section(),
  clipped: (p) => viewer.value?.clipped(p) === true,
});

export function Viewport({
  snapshot,
  tool,
  slots = {},
}: {
  snapshot?: string | undefined;
  /** The active tool's name, written as `data-tool` for styles and scripts. */
  tool?: string;
  slots?: ViewportSlots;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const v = createViewer(host.current, viewTheme(theme.peek()));
    viewer.value = v;
    if (!snapshot) v.onSelect((ids, mode) => select(ids, mode));
    // The scene follows the signals without re-rendering the component.
    const offModel = model.subscribe((m) => {
      if (!m) return;
      v.setModel(meshInput(m));
      drawnRev = m.rev;
      host.current?.setAttribute("data-drawn-rev", String(m.rev));
      if (snapshot && snapshotState.value === undefined) {
        // §7.3: a named view, no animation, then the frame is final.
        if (!v.setView(snapshot, docViews(m.doc), false)) {
          snapshotState.value = `no view named "${snapshot}"`;
          return;
        }
        v.renderNow();
        requestAnimationFrame(() => {
          v.renderNow();
          snapshotState.value = "ready";
          document.body.dataset.snapshot = "ready";
        });
      }
    });
    const offSel = selection.subscribe((s) => v.setSelection(s));
    const offTheme = theme.subscribe((t) => v.setTheme(viewTheme(t)));
    return () => {
      offModel();
      offSel();
      offTheme();
      // First, so what is wired to the viewer (the tools) lets go of it before it goes.
      viewer.value = undefined;
      v.dispose();
    };
  }, []);

  if (snapshot) return <div class="viewport snapshot" ref={host} data-testid="viewport" />;
  return (
    <div class="viewport" ref={host} data-testid="viewport" data-tool={tool}>
      <div class="toolbar" data-testid="toolbar">
        {slots.left}
        <span class="sep" />
        <ViewControls />
      </div>
      {slots.centre}
      {slots.bottom}
      {slots.topRight}
    </div>
  );
}
