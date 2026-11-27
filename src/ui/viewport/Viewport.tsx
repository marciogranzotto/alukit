import { effect, signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { V3 } from "../../mesh/model.ts";
import {
  type CameraState,
  createViewer,
  type RenderStats,
  type SectionPlane,
  type ViewerStats,
} from "../../viewer/scene.ts";
import { docViews } from "../../viewer/views.ts";
import { swatches } from "../common/ItemSwatch.tsx";
import { type Corner, cornersOf } from "../corners.ts";
import { clearShow, hover, select, selection, shown } from "../focus.ts";
import { extendHook } from "../hook.ts";
import { onKey } from "../keys.ts";
import { meshInput } from "../model.ts";
import { problemList } from "../problems/source.ts";
import { model } from "../store.ts";
import { resolveTargets } from "../targets.ts";
import { theme } from "../theme/theme.ts";
import { viewTheme } from "../theme/tokens.ts";
import { Callout, Gizmo, HoverLabel, Legend, SelectionLabel, usePointer } from "./Overlays.tsx";
import { ViewControls } from "./ViewControls.tsx";
import { colourBy, drawnCorners, ghostsRest, showJoints, showProblems, viewer } from "./viewer.ts";
import { badgesOf } from "./words.ts";

/**
 * The viewport (design §8): the 3D view of the drawn model, the bar over it, the overlays it
 * draws itself (the hover label, the selected bar's label, Show's callout, the legend, the
 * gizmo), and the slots other regions fill (docs/ux/plan.md §5.3). It makes the viewer and keeps
 * it in step with the signals: each revision's model and its corners, the selection, the hover
 * from any region, Show, the problems, colour by, the theme. The tools wire themselves to the
 * `viewer` signal. Owner: S3.
 *
 * Slots, which the app fills:
 * - `left`: the tool buttons (S5's tool rail), a column down the viewport's left edge; the view
 *   controls take the top right (S3.11).
 * - `centre`: S2's start card, over an empty project.
 * - `bottom`: S5's command bar above S2's status bar; today the tool's tip and help line.
 * - `topRight`: S2's toasts.
 *
 * With `snapshot` (`?snapshot=<view>`, §7.3) it is the canvas alone, at a named view: no hover,
 * no markers, no badges, no overlays, so a snapshot shows the model and nothing else.
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
    /** The corners the joint markers show (src/ui/corners.ts), whether drawn or toggled off. */
    corners(): readonly Corner[];
    /** The camera, in world coordinates. */
    camera(): CameraState | undefined;
    /** What drawing has cost so far: frames, CPU ms in render calls and hover picks. */
    frames(): RenderStats | undefined;
  }
}

extendHook({
  stats: () => viewer.value?.stats(),
  drawnRev: () => drawnRev,
  screen: (p) => viewer.value?.project(p) as [number, number] | undefined,
  snapshot: () => snapshotState.value,
  section: () => viewer.value?.section(),
  clipped: (p) => viewer.value?.clipped(p) === true,
  corners: () => drawnCorners.value,
  camera: () => viewer.value?.camera(),
  frames: () => viewer.value?.renderStats(),
});

/** Esc first leaves Show (and its dimming), before it clears the selection. */
function showKey(e: KeyboardEvent): boolean {
  if (e.key !== "Escape" || !shown.value) return false;
  clearShow();
  return true;
}

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
  usePointer(host);

  useEffect(() => {
    if (!host.current) return;
    const v = createViewer(host.current, viewTheme(theme.peek()));
    viewer.value = v;
    const offs: (() => void)[] = [];
    // The scene follows the signals without re-rendering the component.
    offs.push(
      model.subscribe((m) => {
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
      }),
    );
    offs.push(theme.subscribe((t) => v.setTheme(viewTheme(t))));
    if (!snapshot) {
      v.onSelect((ids, mode) => select(ids, mode));
      v.onHover((id) => {
        if (id !== undefined) hover.value = { ids: [id], from: "view" };
        else if (hover.peek()?.from === "view") hover.value = undefined;
      });
      offs.push(
        selection.subscribe((s) => v.setSelection(s)),
        // The corners, drawn while the joints are on.
        effect(() => {
          const m = model.value;
          const corners = m ? cornersOf(m) : [];
          drawnCorners.value = corners;
          v.setCorners(showJoints.value ? corners : []);
        }),
        // What a row, a chip or the pointer is over: the bodies its refs stand for, tinted.
        effect(() => {
          const h = hover.value;
          const m = model.peek();
          const ids = h?.ids ?? [];
          const bodies = m && ids.length > 0 ? resolveTargets(m, ids).bodies : [];
          v.setHover(new Set([...ids, ...bodies]));
        }),
        effect(() => {
          const m = model.value;
          v.setProblemBadges(showProblems.value && m ? badgesOf(problemList.value?.answer, m) : []);
        }),
        effect(() => {
          const m = model.value;
          const mode = colourBy.value;
          v.setColourBy(mode, mode === "item" && m ? swatches.value : new Map());
        }),
        // Show: frame the targets keeping the direction, pulse them, dim the rest if asked.
        shown.subscribe((s) => {
          if (!s) {
            v.setGhost(undefined);
            return;
          }
          const m = model.peek();
          if (!m) return;
          const t = resolveTargets(m, s.refs);
          if (t.box) v.fitBox(t.box);
          const ids = new Set([...t.ids, ...t.bodies]);
          v.pulse(ids);
          v.setGhost(ghostsRest(s) ? ids : undefined);
        }),
        onKey("app", showKey, 10),
      );
    }
    return () => {
      for (const off of offs) off();
      // First, so what is wired to the viewer (the tools) lets go of it before it goes.
      viewer.value = undefined;
      v.dispose();
    };
  }, []);

  if (snapshot) return <div class="viewport snapshot" ref={host} data-testid="viewport" />;
  return (
    <div class="viewport" ref={host} data-testid="viewport" data-tool={tool}>
      <div class="viewport-top">
        <div class="tool-rail" data-testid="tool-rail">
          {slots.left}
        </div>
        <div class="toolbar" data-testid="toolbar">
          <ViewControls />
        </div>
      </div>
      <SelectionLabel />
      <Callout />
      <Legend />
      <Gizmo />
      <HoverLabel />
      {slots.centre}
      {slots.bottom}
      {slots.topRight}
    </div>
  );
}
