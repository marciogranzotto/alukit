import type { ToolPointer, Viewer } from "../../viewer/scene.ts";
import { findSnap, type SnapTargets, snapTargets } from "../../viewer/snap.ts";
import { hidden, select } from "../focus.ts";
import { chord, describeKeys, onKey } from "../keys.ts";
import { model, summary } from "../store.ts";
import { viewer } from "../viewport/viewer.ts";
import { createGestures } from "./drag.ts";
import {
  activeTool,
  drawOptions,
  drawState,
  fieldDone,
  fieldWanted,
  hint,
  jointPreview,
  lastResult,
  pickingPlane,
  TOOL_KEYS,
  TOOL_NAMES,
  type ToolName,
  typed,
} from "./state.ts";
import { parseTyped, type Typed } from "./typed.ts";
import { VALUE_START, type Wire, type WireContext } from "./wire/common.ts";
import { createConnectTool } from "./wire/connect.ts";
import { createDrawTool } from "./wire/draw.ts";
import { createEndHandles } from "./wire/ends.ts";
import { createFrameTool } from "./wire/frame.ts";
import { createMeasureTool } from "./wire/measure.ts";
import { createMoveTool } from "./wire/move.ts";
import { createPatternTool } from "./wire/pattern.ts";
import { createPlaceTool } from "./wire/place.ts";

/**
 * The tools' router (design §8, Tools; docs/ux/editing-audit.md E0.1): the active tool gets the
 * viewport's pointer, and the keys (keys.ts) its gesture's keys first, then the tool shortcuts.
 * Each tool is its own module under `wire/`, which turns pointer and key events into one batch of
 * commands (§7.1), sent with source `ui`; the next revision comes back on the event stream. What
 * a tool shows lives in state.ts's signals, which the command bar, the tool forms and the status
 * bar read. This file routes and nothing else. Owner: E3.
 *
 * Keys (D-UX-18): a tool's letter picks it; Esc steps back one level (what is typed, the last
 * pick, the gesture, the tool, then the selection); a digit, a sign, `(`, `[` or `=` starts a
 * value in the command bar, where letters then belong to the value (U20); a drag on (an end
 * handle, Move) takes its keys first.
 */

export interface Tools {
  dispose(): void;
  /** A key typed in the command bar's field: Enter, Esc, Tab. True when the tool took it. */
  fieldKey(e: KeyboardEvent): boolean;
}

/** Wires the tools to a viewer. */
export function createTools(viewer: Viewer): Tools {
  let targets: SnapTargets = { points: [], lines: [] };
  let pointer: ToolPointer | undefined;
  const params = () => model.peek()?.derived.params ?? {};
  const rayAt = (e: ToolPointer) => viewer.ray(e.clientX, e.clientY);

  const ctx: WireContext = {
    viewer,
    targets: () => targets,
    rayAt,
    snapAt: (e, filter) =>
      findSnap(filter ? filter(targets) : targets, {
        at: [e.clientX, e.clientY],
        ray: rayAt(e),
        project: viewer.project,
        // The section plane's far side is not drawn, so nothing there snaps; nor what is hidden.
        hidden: viewer.clipped,
        skip: hidden.peek(),
      }),
    pickAt: (e) => viewer.pickAt(e.clientX, e.clientY, hidden.peek()),
    show(e, text, snap) {
      hint.value =
        e && text
          ? { x: e.clientX, y: e.clientY, text, ...(snap !== undefined ? { snap } : {}) }
          : undefined;
    },
    pointer: () => pointer,
    track(e) {
      pointer = e;
    },
    refresh,
    used() {
      typed.value = "";
      fieldDone.value++;
    },
    typedNow: (): Typed => parseTyped(typed.peek(), params()),
    params,
  };

  /** Drag gestures (drag.ts): the end handles in Select, and Move. */
  const gestures = createGestures(viewer);
  const ends = createEndHandles(viewer, gestures);
  /** The Move tool (wire/move.ts), on the same drag machinery as the end handles. */
  const mover = createMoveTool(viewer, gestures, { snap: ctx.snapAt, pick: ctx.pickAt });
  const draw = createDrawTool(ctx);
  const frame = createFrameTool(ctx);
  const connect = createConnectTool(ctx);
  const place = createPlaceTool(ctx);
  const pattern = createPatternTool(ctx);
  const measure = createMeasureTool(ctx);

  const wires: Readonly<Record<ToolName, Wire | undefined>> = {
    select: undefined,
    move: { handler: mover.handler },
    draw,
    frame,
    connect,
    place,
    pattern,
    measure,
  };
  /** The order each tool hears that the tool changed. */
  const SWITCH_ORDER: readonly Wire[] = [connect, pattern, measure, frame, place];
  const wire = (): Wire | undefined => wires[activeTool.peek()];

  /** Shows the active tool again where the pointer is (or without it, for the keyboard). */
  function refresh(): void {
    const w = wire();
    if (pointer && w?.handler.move) w.handler.move(pointer);
    else w?.preview?.();
  }

  // After the tools: `subscribe` calls at once when the model is already there (the viewer
  // made after the model came, as in a second tab on a warm server), and `refresh` reads them.
  // Subscribed before them, that first call threw on the tools not yet made, and the app
  // wiring after the tools' never ran (measured: that tab told no step in a toast).
  const offModel = model.subscribe((m) => {
    if (!m) return;
    targets = snapTargets({
      nodes: m.derived.nodes,
      bars: m.derived.bars,
      parts: m.derived.parts,
      display: m.display,
    });
    // A new revision moves what was under the pointer.
    refresh();
  });

  const offTool = activeTool.subscribe((t) => {
    gestures.cancel();
    // A press is a drag's before the camera's: the end handles' in Select.
    viewer.setGrab(t === "select" ? ends.grab : t === "move" ? mover.grab : undefined);
    drawState.value = {};
    typed.value = "";
    for (const w of [draw, frame]) w.reset?.();
    viewer.setLabel("frame", undefined);
    pickingPlane.value = false;
    hint.value = undefined;
    lastResult.value = undefined;
    if (drawOptions.peek().lock) drawOptions.value = { ...drawOptions.peek(), lock: undefined };
    viewer.setOverlay({});
    viewer.setHighlight(new Set());
    for (const w of SWITCH_ORDER) w.switched?.(t);
    viewer.setTool(wires[t]?.handler);
  });

  // What is typed moves the preview, pointer or not.
  const offTyped = typed.subscribe(() => refresh());

  /** Esc, one level back in the active tool's gesture (D-UX-18). */
  function back(): boolean {
    if (typed.peek()) {
      ctx.used();
      return true;
    }
    return wire()?.back?.() ?? false;
  }

  /** Enter in the active tool: what is typed, or the gesture's next step. */
  const enter = (): boolean => wire()?.enter?.() ?? false;

  /** A key the active tool's gesture takes, outside the command bar's field. */
  function gestureKey(e: KeyboardEvent): boolean {
    if (e.key === "Escape") return back();
    if (e.key === "Enter") return enter();
    if (e.key.length === 1 && VALUE_START.test(e.key) && wire()?.takesValue?.(e.key)) {
      typed.value = e.key === "=" ? "" : e.key;
      fieldWanted.value++;
      return true;
    }
    return wire()?.key?.(e) ?? false;
  }

  /** Esc leaves the tool, or in select clears the selection; a tool's letter picks it. */
  function shortcutKey(e: KeyboardEvent): boolean {
    if (e.key === "Escape") {
      if (activeTool.value !== "select") activeTool.value = "select";
      else select([], "replace");
      return true;
    }
    const t = TOOL_KEYS[e.key.toLowerCase()];
    if (!t || summary.value?.status.readOnly === true) return false;
    activeTool.value = t;
    return true;
  }

  const offKeys = [
    // A drag on (an end handle, Move) takes its keys first: Esc, Enter, Tab, a typed value.
    onKey("tool", (e) => !chord(e) && gestures.key(e), 50),
    onKey("tool", (e) => !chord(e) && gestureKey(e)),
    onKey("app", (e) => !chord(e) && shortcutKey(e)),
    describeKeys({
      id: "tools",
      title: "Tools",
      order: 10,
      rows: [
        ...Object.entries(TOOL_KEYS).map(([k, t]) => ({
          keys: [k.toUpperCase()],
          does: TOOL_NAMES[t],
        })),
        {
          keys: ["Esc"],
          does: "Step back one level: what is typed, the last pick, the gesture, the tool, then the selection",
        },
      ],
    }),
  ];

  return {
    dispose() {
      for (const off of offKeys) off();
      offModel();
      offTool();
      offTyped();
      for (const w of [draw, frame, connect, place, pattern, measure]) w.dispose?.();
      ends.dispose();
      mover.dispose();
      gestures.dispose();
      viewer.setGrab(undefined);
      viewer.setLabel("frame", undefined);
      viewer.setTool(undefined);
    },
    fieldKey(e) {
      if (gestures.live()) {
        if (e.key === "Enter") return gestures.enter();
        if (e.key === "Escape") return gestures.back();
        return e.key === "Tab" ? gestures.key(e) : false;
      }
      if (e.key === "Enter") return enter();
      if (e.key === "Escape") return back();
      // The draw tool's joint preview is the one a field Tab flips: the drags flip their own.
      if (e.key === "Tab" && !e.shiftKey && jointPreview.peek()) {
        draw.flip?.();
        return true;
      }
      return false;
    },
  };
}

let tools: Tools | undefined;

/** A key typed in the command bar's field, offered to the active tool. */
export function toolFieldKey(e: KeyboardEvent): boolean {
  return tools?.fieldKey(e) ?? false;
}

/** Wires the tools to the viewport's viewer while there is one; returns the undo. */
export function connectTools(): () => void {
  const off = viewer.subscribe((v) => {
    tools?.dispose();
    tools = v ? createTools(v) : undefined;
  });
  return () => {
    off();
    tools?.dispose();
    tools = undefined;
  };
}
