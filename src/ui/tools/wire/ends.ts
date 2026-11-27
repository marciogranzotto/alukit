import { effect, signal } from "@preact/signals";
import type { CornerRule } from "#core/project/schema.ts";
import type { V3 } from "../../../mesh/model.ts";
import { type GizmoHandle, handleAt as handleUnder } from "../../../viewer/gizmo.ts";
import type { MarkerKind, OverlayState } from "../../../viewer/overlay.ts";
import type { Grab, ToolPointer, Viewer } from "../../../viewer/scene.ts";
import { rayLineParams } from "../../../viewer/snap.ts";
import type { DryRun } from "../../client/dryrun.ts";
import { endBatch } from "../../edit/batches.ts";
import { selection } from "../../focus.ts";
import { extendHook } from "../../hook.ts";
import type { Model } from "../../model.ts";
import { model, summary } from "../../store.ts";
import type { GestureSpec, Gestures } from "../drag.ts";
import {
  draggable,
  type EndAxis,
  type EndState,
  endAxis,
  endState,
  endStops,
  type Landing,
  landing,
  type Stop,
  typedCut,
  typedLanding,
} from "../ends.ts";
import { type JointWords, jointWords } from "../joint.ts";
import { type Cmd, createPreviewer } from "../preview.ts";
import { activeTool, drawOptions, gesture, hint, labelEdit, typed } from "../state.ts";

/**
 * The end handles (docs/ux/drag-ends-decisions.md): one bar selected in Select shows a grip at
 * each end, drawn over every body as the selection is. A free or detachable end drags along the
 * bar's own axis, the pointer's ray projected onto it; it falls onto another bar's line or end
 * when it meets the bar's body, touches a face it cannot join, and otherwise moves the cut in
 * whole millimetres. A typed value is the cut length (`+50`, `-20` from the cut now). The release
 * is one step: `moveEnd`, then `autoConnect` at the end, so an end that lands on a bar joins it
 * by the project's corner rule, which the joint preview says first and Tab flips. An end a pivot,
 * miter, splice or its own plane sets, or one a param drives, is drawn locked, and pressing it
 * says why. Owner: E4.
 */

/** How far a stop pulls a dragged end, px on the screen. */
const PULL_PX = 10;

/** A locked handle pressed, or a driven length: what holds it, shown by the handle. */
export interface EndNote {
  at: V3;
  text: string;
  /** The params to edit, for "driven by H: edit H". */
  params: string[];
}
export const endNote = signal<EndNote | undefined>(undefined);

/** A length as the words say it: two decimals only when needed. */
const num = (x: number) => {
  const r = Math.round(x * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
};
const at = (q: V3, u: V3, s: number): V3 => [q[0] + u[0] * s, q[1] + u[1] * s, q[2] + u[2] * s];

/** The selected bar whose ends get handles, when there is one. */
function handled(m: Model | undefined): string | undefined {
  if (!m || activeTool.value !== "select" || summary.value?.status.readOnly === true) return;
  const ids = [...selection.value];
  const id = ids.length === 1 ? ids[0] : undefined;
  return id && !id.includes("@") && m.derived.bars[id] ? id : undefined;
}

interface Handle {
  end: "a" | "b";
  p: V3;
  state: EndState;
}

/** A held end's words for the hint and the note. */
function stateWords(bar: string, h: Handle): string {
  const ref = `${bar}.${h.end}`;
  switch (h.state.kind) {
    case "free":
      return h.state.corner
        ? `${ref} · drag to lengthen or shorten; it leaves ${h.state.corner}'s corner`
        : `${ref} · drag to lengthen or shorten, or click and type the cut`;
    case "detach":
      return `${ref} ${h.state.words.join(" and ")}: dragging frees it`;
    default:
      return h.state.words;
  }
}

/**
 * The bar as an end's move would leave it, for the overlay: a ghost from its other end's face to
 * the end's new face `p`, and the marker where it lands (a diamond on a line, a square at a stop,
 * a ring in open space). The overlay's own preview mesh and materials: nothing is made per move.
 */
export function endGhost(
  m: Model,
  id: string,
  end: "a" | "b",
  p: V3,
  stop: Stop | undefined,
): OverlayState {
  const b = m.derived.bars[id];
  const view = m.display.bars[id];
  const section = view ? m.display.sections[view.section] : undefined;
  const other = b?.ends[end === "a" ? "b" : "a"].point;
  const marker = {
    p,
    kind: (stop?.kind === "line" ? "line" : stop ? "point" : "free") as MarkerKind,
  };
  if (!b || !section || !view || !other) return { marker };
  return {
    ghost: {
      section,
      x: b.frame.x,
      y: b.frame.y,
      t: b.frame.z,
      a: end === "b" ? other : p,
      len: Math.hypot(p[0] - other[0], p[1] - other[1], p[2] - other[2]),
      shift: view.shift,
    },
    marker,
  };
}

/** The end drag's words for a dry run's answer (preview.ts): the joint, the cut, what it frees. */
export function endWords(r: DryRun, bar: string, stop: Stop | undefined): JointWords {
  if (!r.ok) return { text: r.why, shape: "refused", joins: false };
  const w = jointWords(r, bar);
  const info = r.results[0]?.info as { detached?: string; left?: string } | undefined;
  const freed = [info?.detached, info?.left].filter((x) => x !== undefined);
  const lead = freed.length > 0 ? [`frees it from ${freed.join(" and ")}`] : [];
  const open = "no joint: the ends stay open";
  if (!w.joins && stop?.kind === "face") {
    const text = w.text.replace(open, `${stop.label}: no joint, its line misses ${stop.bar}'s`);
    return { ...w, text: [...lead, text].join(" · ") };
  }
  // A length typed into open space: nothing to join, only what the cuts come to.
  const text = !w.joins && !stop ? w.text.replace(`${open} · `, "") : w.text;
  return { ...w, text: [...lead, text].join(" · ") };
}

export interface EndHandles {
  /** The grab Select gives the viewer while a bar is selected. */
  grab: Grab;
  dispose(): void;
}

export function createEndHandles(viewer: Viewer, gestures: Gestures): EndHandles {
  let handles: Handle[] = [];
  let bar: string | undefined;
  let hot: number | undefined;
  /** The dragged end's handle, where the gesture has it now. */
  let dragged: { end: "a" | "b"; p: V3 } | undefined;

  current = () => handles;

  /** Whether the view's gizmo shows these handles: only then do they take it away. */
  let showing = false;
  const draw = () => {
    const edit = labelEdit.peek();
    const grips: GizmoHandle[] = handles.map((h) => ({
      key: h.end,
      at: dragged && dragged.end === h.end ? dragged.p : h.p,
      locked: !draggable(h.state),
    }));
    const focus = dragged
      ? dragged.end
      : edit && edit.bar === bar
        ? edit.end
        : hot !== undefined
          ? handles[hot]?.end
          : undefined;
    if (grips.length > 0) {
      viewer.setGizmo({ handles: grips, ...(focus ? { hot: focus } : {}) });
      showing = true;
    } else if (showing) {
      viewer.setGizmo(undefined);
      showing = false;
    }
  };

  // The handles follow the selection, the revision drawn, the tool and the label being typed in.
  const offHandles = effect(() => {
    const m = model.value;
    const id = handled(m);
    labelEdit.value;
    if (gestures.live() && gesture.peek()?.kind === "end") return;
    bar = id;
    handles =
      m && id
        ? (["a", "b"] as const).map((e) => ({
            end: e,
            p: m.derived.bars[id]?.ends[e].point as V3,
            state: endState(m, id, e),
          }))
        : [];
    if (hot !== undefined && !handles[hot]) hot = undefined;
    endNote.value = undefined;
    draw();
  });

  /** The handle under the pointer, by its screen distance (gizmo.ts). */
  function handleAt(e: ToolPointer): number | undefined {
    const key = handleUnder(
      handles.map((h) => ({ key: h.end, at: h.p })),
      [e.clientX, e.clientY],
      viewer.project,
    );
    const i = handles.findIndex((h) => h.end === key);
    return i >= 0 ? i : undefined;
  }

  const preview = createPreviewer(
    viewer,
    () => gestures.live() && gesture.peek()?.kind === "end",
    () => drawOptions.peek().prefer,
  );

  /** The end drag, from a press on a free or detachable handle. */
  function endGesture(m: Model, id: string, h: Handle): GestureSpec | undefined {
    const axis: EndAxis | undefined = endAxis(m, id, h.end);
    if (!axis) return undefined;
    const stops = endStops(m, axis);
    const ref = `${id}.${h.end}`;
    const state = h.state;
    /** Where the gesture is: a landing from the pointer, or a typed cut. */
    let now: Landing = { len: axis.len, face: axis.face, cut: axis.cut };
    let why: string | undefined;

    const unchanged = () =>
      Math.abs(now.len - axis.len) < 0.005 &&
      // Where it was, or back on the bar it already butts on: nothing to do.
      (state.kind !== "detach" ||
        (state.conn !== undefined &&
          now.stop?.bar ===
            (m.doc.connections as Record<string, { through?: string }>)[state.conn]?.through));

    const commands = (prefer: CornerRule | undefined): Cmd[] =>
      endBatch(ref, now, state.kind === "detach", prefer);

    return {
      kind: "end",
      update(e) {
        const text = typed.peek();
        why = undefined;
        if (text.trim() !== "") {
          const c = typedCut(text, axis.cut, m.derived.params);
          if ("why" in c) why = c.why;
          else now = typedLanding(axis, stops, c.cut, c.written);
        } else if (e) {
          const s = rayLineParams(viewer.ray(e.clientX, e.clientY), axis.Q, axis.u).s;
          const a = viewer.project(at(axis.Q, axis.u, now.face));
          const c = viewer.project(at(axis.Q, axis.u, now.face + 1));
          const pxPerMm = a && c ? Math.hypot(c[0] - a[0], c[1] - a[1]) : 0;
          const pull = pxPerMm > 0 ? Math.min(Math.max(PULL_PX / pxPerMm, 1), 400) : 20;
          now = landing(axis, stops, s, pull);
        }
        const p = at(axis.Q, axis.u, now.face);
        dragged = { end: h.end, p };
        draw();
        viewer.setOverlay(endGhost(m, id, h.end, p, now.stop));
        const snap = now.typed ? "typed" : (now.stop?.label ?? "free");
        const reading = why ?? `cut ${num(now.cut)} mm · length ${num(now.len)}`;
        gesture.value = {
          kind: "end",
          title: `Drag end ${ref}`,
          prompt:
            "Drag along the bar, or type its cut length (600, +50, -20) and press Enter; Esc cancels.",
          reading: now.stop ? `${now.stop.label} · ${reading}` : reading,
          snap,
          bar: id,
          end: h.end,
        };
        if (e) {
          hint.value = {
            x: e.clientX,
            y: e.clientY,
            text: now.stop ? `${now.stop.label} · ${reading}` : reading,
            snap,
          };
        }
        // The joint preview where the end may join, frees something, or is typed.
        if (why || unchanged() || (!now.stop && state.kind !== "detach" && !now.typed)) {
          preview.ask(undefined);
          return;
        }
        const stop = now.stop;
        preview.ask({
          commands: (prefer) => commands(prefer ?? preview.flipped ?? drawOptions.peek().prefer),
          at: p,
          soon: stop !== undefined,
          words: (r) => endWords(r, id, stop),
        });
      },
      commit() {
        if (why) return { why };
        if (unchanged()) return "nothing";
        return {
          commands: commands(preview.flipped ?? drawOptions.peek().prefer),
          what: `drag end ${ref}`,
        };
      },
      flip: () => void preview.flip(),
      stop() {
        dragged = undefined;
        preview.reset();
        viewer.setOverlay({});
        hint.value = undefined;
        draw();
      },
    };
  }

  const grab: Grab = {
    press(e) {
      if (gestures.live()) return gestures.press(e);
      const i = handleAt(e);
      const m = model.peek();
      const h = i !== undefined ? handles[i] : undefined;
      if (!h || !m || !bar) return false;
      endNote.value = undefined;
      if (!draggable(h.state)) {
        endNote.value = {
          at: h.p,
          text: stateWords(bar, h),
          params: h.state.kind === "driven" ? h.state.params : [],
        };
        return true;
      }
      const spec = endGesture(m, bar, h);
      if (!spec) return false;
      hot = i;
      gestures.start(spec, e, true);
      return true;
    },
    move(e, held) {
      if (gestures.live()) {
        gestures.pointer(e, held);
        return;
      }
      const i = handleAt(e);
      if (i !== hot) {
        hot = i;
        draw();
      }
      viewer.canvas.style.cursor = i !== undefined ? "grab" : "";
      const h = i !== undefined ? handles[i] : undefined;
      if (h && bar) hint.value = { x: e.clientX, y: e.clientY, text: stateWords(bar, h) };
      else if (hint.peek() && !gestures.live() && activeTool.peek() === "select") {
        hint.value = undefined;
      }
    },
    release(e) {
      gestures.release(e);
    },
    busy: () => gestures.live(),
  };

  return {
    grab,
    dispose() {
      offHandles();
      preview.reset();
      if (showing) viewer.setGizmo(undefined);
      showing = false;
      endNote.value = undefined;
      current = () => [];
    },
  };
}

declare module "../../hook.ts" {
  interface AlukitHook {
    /**
     * The selected bar's end handles: each end, its world point and whether it can be dragged;
     * the gesture on (an end drag's bar, end, reading and snap), if any.
     */
    handles(): { end: string; p: V3; locked: boolean; state: string }[];
    gesture():
      | { kind: string; reading: string; snap: string; bar?: string; end?: string }
      | undefined;
  }
}

let current: () => Handle[] = () => [];
extendHook({
  handles: () =>
    current().map((h) => ({
      end: h.end,
      p: h.p,
      locked: !draggable(h.state),
      state: h.state.kind,
    })),
  gesture: () => {
    const g = gesture.value;
    return g
      ? {
          kind: g.kind,
          reading: g.reading,
          snap: g.snap,
          ...(g.bar ? { bar: g.bar, end: g.end } : {}),
        }
      : undefined;
  },
});
