import type { V3 } from "../../mesh/model.ts";
import {
  barCommands,
  type DrawEnd,
  endUnder,
  nextAnchor,
  nextRoll,
  parseLength,
  previewPlacement,
  typedEnd,
  writtenPoint,
} from "../../viewer/draw.ts";
import type { MarkerKind } from "../../viewer/overlay.ts";
import type { ToolHandler, ToolPointer, Viewer } from "../../viewer/scene.ts";
import { findSnap, type Snap, type SnapTargets, snapTargets } from "../../viewer/snap.ts";
import { facePlane, GROUND, gridSnap, rayFace } from "../../viewer/workplane.ts";
import { select, selection } from "../focus.ts";
import { chord, onKey } from "../keys.ts";
import type { Model } from "../model.ts";
import { palette } from "../palette.ts";
import { applyCommands, model, summary } from "../store.ts";
import { viewer } from "../viewport/viewer.ts";
import { runOf } from "./commands.ts";
import {
  activeTool,
  type ConnectPick,
  connectPicks,
  connectType,
  drawOptions,
  drawState,
  hint,
  measureState,
  patternState,
  pickingPlane,
  pivotOptions,
  placeState,
  TOOL_KEYS,
  type ToolName,
  typed,
  workPlane,
} from "./state.ts";

/**
 * The tools' wiring (design §8, Tools): the active tool gets the viewport's pointer, and the keys
 * (keys.ts) its gesture's keys first, then the tool shortcuts. Each tool turns pointer and key
 * events into one batch of commands (§7.1), sent with source `ui`; the next revision comes back on
 * the event stream. What a tool shows lives in state.ts's signals, which the command bar, the
 * tool forms and the status bar read. Owner: S5.
 */

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const fmt = (x: number) => String(Math.round(x * 100) / 100);

function markerOf(s: Snap): MarkerKind {
  return s.kind;
}

/** A connection's text for what a pick would be: the bar, or its end nearer the pointer. */
function barPick(m: Model, id: string, p: V3): ConnectPick | undefined {
  const bar = m.derived.bars[id];
  if (!bar || id.includes("@")) return undefined;
  const t = bar.frame.z;
  const s = (p[0] - bar.a[0]) * t[0] + (p[1] - bar.a[1]) * t[1] + (p[2] - bar.a[2]) * t[2];
  const L = bar.len_mm;
  // The outer quarters pick an end, the middle half the bar itself.
  if (s < L / 4) return { ref: `${id}.a`, kind: "end", p: bar.a };
  if (s > (3 * L) / 4) return { ref: `${id}.b`, kind: "end", p: bar.b };
  return { ref: id, kind: "bar", p };
}
// ---------------------------------------------------------------------------------------------

export interface Tools {
  dispose(): void;
}

/**
 * Wires the tools to a viewer: the active tool gets the viewport's pointer, and the keys (keys.ts)
 * its gesture's keys first, then the tool shortcuts: a tool's letter, and Esc to leave the tool
 * or, in select, to clear the selection.
 */
export function createTools(viewer: Viewer): Tools {
  let targets: SnapTargets = { points: [], lines: [] };
  let pointer: ToolPointer | undefined;

  const offModel = model.subscribe((m) => {
    if (!m) return;
    targets = snapTargets({
      nodes: m.derived.nodes,
      bars: m.derived.bars,
      parts: m.derived.parts,
      display: m.display,
    });
    // A new revision moves what was under the pointer.
    if (pointer) handler()?.move?.(pointer);
  });

  const rayAt = (e: ToolPointer) => viewer.ray(e.clientX, e.clientY);
  const snapAt = (e: ToolPointer, filter?: (s: SnapTargets) => SnapTargets) =>
    findSnap(filter ? filter(targets) : targets, {
      at: [e.clientX, e.clientY],
      ray: rayAt(e),
      project: viewer.project,
      // The section plane's far side is not drawn, so nothing there snaps.
      hidden: viewer.clipped,
    });
  /** The text by the pointer, and the machine label of what it is on (see `hint`). */
  const show = (e: ToolPointer | undefined, text: string | undefined, snap?: string) => {
    hint.value =
      e && text
        ? { x: e.clientX, y: e.clientY, text, ...(snap !== undefined ? { snap } : {}) }
        : undefined;
  };

  /** W: the next click on a bar sets the work plane to the face it hits (§8, review m11). */
  function pickPlane(e: ToolPointer): void {
    const m = model.value;
    const hit = viewer.pickAt(e.clientX, e.clientY);
    const bar = hit && m ? m.derived.bars[hit.id] : undefined;
    const face = bar ? rayFace(rayAt(e), bar) : undefined;
    workPlane.value = bar && face && hit ? facePlane(bar, hit.id, face.face) : GROUND;
    pickingPlane.value = false;
  }

  // -- Draw bar ---------------------------------------------------------------------------------

  let current: Snap | undefined;

  function drawPreview(e: ToolPointer | undefined): void {
    const { start, end: under } = drawState.value;
    const bar = palette.value.bar;
    const o = drawOptions.value;
    // A typed length is what Enter commits: preview that, along the axis under the pointer.
    const len = typed.value ? parseLength(typed.value) : undefined;
    const end =
      start && under && len !== undefined ? (typedEnd(start, under.p, len) ?? under) : under;
    if (!bar) {
      viewer.setOverlay({});
      show(e, "no bar in the palette: set one from the catalog");
      return;
    }
    const ghost =
      start && end && bar?.section
        ? previewPlacement(start.p, end.p, o.roll, bar.section, o.anchor)
        : undefined;
    const length = start && end ? len3(sub(end.p, start.p)) : undefined;
    viewer.setOverlay({
      marker: end
        ? { p: end.p, kind: end.how === "snap" ? "point" : end.how === "meet" ? "line" : "free" }
        : current
          ? { p: current.p, kind: markerOf(current) }
          : undefined,
      line: start && end ? { a: start.p, b: end.p } : undefined,
      guide:
        start && end?.axis && (end.how === "axis" || end.how === "meet" || end.how === "typed")
          ? { through: start.p, axis: end.axis }
          : undefined,
      ghost:
        ghost && start && bar?.section ? { section: bar.section, a: start.p, ...ghost } : undefined,
      plane: workPlane.value === GROUND ? undefined : workPlane.value,
    });
    const what = end ? end.label : current?.label;
    const text = [
      what,
      length !== undefined ? `${fmt(length)} mm` : undefined,
      typed.value ? `length: ${typed.value}` : undefined,
    ]
      .filter((x) => x !== undefined)
      .join(" · ");
    show(e, text, what);
  }

  async function commitBar(end: DrawEnd): Promise<void> {
    const start = drawState.value.start;
    const bar = palette.value.bar;
    if (!start || !bar) return;
    const o = drawOptions.value;
    const cmds = barCommands({
      item: bar.id,
      ...(bar.opt ? { opt: bar.opt } : {}),
      a: start,
      b: end,
      anchor: o.anchor,
      roll: o.roll,
      autoConnect: o.autoConnect,
    });
    drawState.value = {};
    typed.value = "";
    current = undefined;
    viewer.setOverlay({});
    await applyCommands(cmds, "draw bar");
  }

  const draw: ToolHandler = {
    move(e) {
      pointer = e;
      if (pickingPlane.value) {
        show(e, "click a face for the work plane");
        return;
      }
      const m = model.value;
      if (!m) return;
      const start = drawState.value.start;
      // While a length is typed, the line keeps to its axis (or the plane): no target pulls it.
      const snap = start && typed.value ? undefined : snapAt(e);
      if (!start) {
        current = snap ?? gridSnap(rayAt(e), workPlane.value);
        drawState.value = {};
      } else {
        const end = endUnder(start, {
          ray: rayAt(e),
          at: [e.clientX, e.clientY],
          project: viewer.project,
          snap,
          free: e.shiftKey,
          plane: workPlane.value,
          doc: m.doc,
        });
        drawState.value = { start, ...(end ? { end } : {}) };
      }
      drawPreview(e);
    },
    click(e) {
      if (pickingPlane.value) {
        pickPlane(e);
        return;
      }
      draw.move?.(e);
      const m = model.value;
      if (!m) return;
      if (!palette.value.bar) return;
      const { start, end } = drawState.value;
      if (!start) {
        if (!current) return;
        drawState.value = {
          start: { p: current.p, written: writtenPoint(current, m.doc), label: current.label },
        };
        drawPreview(e);
      } else if (end) void commitBar(end);
    },
    leave() {
      hint.value = undefined;
    },
  };

  function drawKey(e: KeyboardEvent): boolean {
    const k = e.key;
    const { start, end } = drawState.value;
    if (/^[0-9.]$/.test(k) && start) {
      typed.value += k;
      // The direction is the axis under the pointer, whatever target it was near.
      if (pointer) draw.move?.(pointer);
      return true;
    }
    if (k === "Backspace" && typed.value) {
      typed.value = typed.value.slice(0, -1);
      if (pointer) draw.move?.(pointer);
      return true;
    }
    if (k === "Enter" && start && typed.value) {
      const len = parseLength(typed.value);
      const toward = end?.p;
      const t = len !== undefined && toward ? typedEnd(start, toward, len) : undefined;
      if (t) void commitBar(t);
      return true;
    }
    if (k === "r" || k === "R") {
      drawOptions.value = { ...drawOptions.value, roll: nextRoll(drawOptions.value.roll) };
      drawPreview(pointer);
      return true;
    }
    if (k === "a" || k === "A") {
      const anchors = palette.value.bar?.anchors ?? ["c"];
      drawOptions.value = {
        ...drawOptions.value,
        anchor: nextAnchor(anchors, drawOptions.value.anchor),
      };
      drawPreview(pointer);
      return true;
    }
    if (k === "w" || k === "W") {
      if (pickingPlane.value || workPlane.value !== GROUND) {
        workPlane.value = GROUND;
        pickingPlane.value = false;
      } else pickingPlane.value = true;
      drawPreview(pointer);
      return true;
    }
    if (k === "Escape" && (start || typed.value || pickingPlane.value)) {
      drawState.value = {};
      typed.value = "";
      pickingPlane.value = false;
      drawPreview(pointer);
      return true;
    }
    return false;
  }

  // -- Connect ----------------------------------------------------------------------------------

  /** A pivot's base is a station on a face, not in a groove (§4.5): only those snap. */
  const onFaceOnly = (t: SnapTargets): SnapTargets => ({
    points: t.points.filter((p) => p.ref.kind === "station" && p.ref.face !== undefined),
    lines: t.lines.filter((l) => l.face !== undefined && l.groove === undefined),
  });

  /** Whether the next click picks the pivot's base: a pivot with no base yet. */
  const pickingBase = () => connectType.value === "pivot" && !pivotOptions.value.base;

  /** What a click on the body under the pointer picks: a bar or its end; a plate as a layer. */
  function connectPickAt(e: ToolPointer): ConnectPick | undefined {
    const m = model.value;
    const hit = viewer.pickAt(e.clientX, e.clientY);
    if (!m || !hit) return undefined;
    if (m.derived.bars[hit.id]) return barPick(m, hit.id, hit.p);
    // A part holding a plate is a face connection's layer (§4.5); a copy is not an entity.
    if (connectType.value === "face" && m.derived.parts[hit.id] && !hit.id.includes("@"))
      return { ref: hit.id, kind: "part", p: hit.p };
    return undefined;
  }

  const pins = () => [
    ...connectPicks.value.filter((p) => p.kind === "end").map((p) => p.p),
    ...(connectType.value === "pivot" && pivotOptions.value.base
      ? [pivotOptions.value.base.p]
      : []),
  ];

  const connect: ToolHandler = {
    move(e) {
      pointer = e;
      if (pickingBase()) {
        const snap = snapAt(e, onFaceOnly);
        viewer.setOverlay({
          pins: pins(),
          marker: snap ? { p: snap.p, kind: markerOf(snap) } : undefined,
        });
        show(e, snap ? `base: ${snap.label}` : "click a face for the pivot's base", snap?.label);
        return;
      }
      const pick = connectPickAt(e);
      viewer.setOverlay({
        pins: pins(),
        marker: pick ? { p: pick.p, kind: "pick" } : undefined,
      });
      const picked = pick ? `${pick.kind} ${pick.ref}` : undefined;
      show(e, picked, picked);
    },
    click(e) {
      if (pickingBase()) {
        const snap = snapAt(e, onFaceOnly);
        if (snap?.ref.kind !== "station" || snap.ref.face === undefined) return;
        const r = snap.ref;
        pivotOptions.value = {
          ...pivotOptions.value,
          from: "a",
          base: { bar: r.bar, at_mm: r.at_mm, face: r.face, p: snap.p },
        };
        connect.move?.(e);
        return;
      }
      const pick = connectPickAt(e);
      if (!pick) return;
      const cur = connectPicks.value;
      connectPicks.value = cur.some((p) => p.ref === pick.ref)
        ? cur.filter((p) => p.ref !== pick.ref)
        : [...cur, pick];
      connect.move?.(e);
    },
    leave() {
      hint.value = undefined;
    },
  };

  // A bar without the anchor in use (a rail's `mount` on a T-slot) starts from the centre.
  const offPalette = palette.subscribe((p) => {
    const anchors = p.bar?.anchors ?? ["c"];
    if (!anchors.includes(drawOptions.value.anchor))
      drawOptions.value = { ...drawOptions.value, anchor: "c" };
  });

  const offPicks = connectPicks.subscribe((picks) => {
    const m = model.value;
    // A run's layer lights its pieces; a part its body.
    const lit = picks.flatMap((p) =>
      p.kind === "end"
        ? []
        : p.kind === "run" && m
          ? Object.keys(m.derived.bars).filter((b) => runOf(m.doc, b) === p.ref)
          : [p.ref],
    );
    viewer.setHighlight(new Set(lit));
    if (activeTool.value === "connect") viewer.setOverlay({ pins: pins() });
  });
  const offPivot = pivotOptions.subscribe(() => {
    if (activeTool.value === "connect") viewer.setOverlay({ pins: pins() });
  });

  // -- Place part -------------------------------------------------------------------------------

  /** A part lands on a face or a groove (§4.7): only those stations snap. */
  const onFaces = (t: SnapTargets): SnapTargets => ({
    points: t.points.filter((p) => p.ref.kind === "station" && p.ref.face !== undefined),
    lines: t.lines.filter((l) => l.face !== undefined || l.groove !== undefined),
  });

  const place: ToolHandler = {
    move(e) {
      pointer = e;
      const snap = snapAt(e, onFaces);
      viewer.setOverlay({
        marker: snap ? { p: snap.p, kind: markerOf(snap) } : undefined,
        pins: placeState.value.station ? [placeState.value.station.p] : [],
      });
      show(e, snap?.label, snap?.label);
    },
    click(e) {
      const snap = snapAt(e, onFaces);
      if (snap?.ref.kind !== "station") return;
      const r = snap.ref;
      placeState.value = {
        ...placeState.value,
        from: "a",
        station: {
          bar: r.bar,
          at_mm: r.at_mm,
          ...(r.groove ? { groove: r.groove } : r.face ? { face: r.face } : {}),
          p: snap.p,
        },
      };
      place.move?.(e);
    },
    leave() {
      hint.value = undefined;
    },
  };

  // -- Pattern ----------------------------------------------------------------------------------

  const pattern: ToolHandler = {
    move(e) {
      pointer = e;
      const hit = viewer.pickAt(e.clientX, e.clientY);
      const along = hit && !hit.id.includes("@") && hit.id.startsWith("b") ? hit.id : undefined;
      show(e, along ? `along ${along}` : undefined, along ? `bar ${along}` : undefined);
    },
    click(e) {
      const hit = viewer.pickAt(e.clientX, e.clientY);
      if (!hit || hit.id.includes("@") || !hit.id.startsWith("b")) return;
      patternState.value = { ...patternState.value, along: hit.id };
    },
    leave() {
      hint.value = undefined;
    },
  };

  // -- Measure ----------------------------------------------------------------------------------

  const measure: ToolHandler = {
    move(e) {
      pointer = e;
      const snap = snapAt(e) ?? gridSnap(rayAt(e), workPlane.value);
      const { a, b } = measureState.value;
      const to = b ?? snap;
      viewer.setOverlay({
        marker: snap ? { p: snap.p, kind: markerOf(snap) } : undefined,
        pins: [a?.p, b?.p].filter((p): p is V3 => p !== undefined),
        line: a && to && !b ? { a: a.p, b: to.p } : a && b ? { a: a.p, b: b.p } : undefined,
      });
      show(e, snap?.label, snap?.label);
    },
    click(e) {
      const snap = snapAt(e) ?? gridSnap(rayAt(e), workPlane.value);
      if (!snap) return;
      const { a, b } = measureState.value;
      measureState.value = !a || b ? { a: snap } : { a, b: snap };
      measure.move?.(e);
    },
    leave() {
      hint.value = undefined;
    },
  };

  const handlers: Readonly<Record<ToolName, ToolHandler | undefined>> = {
    select: undefined,
    draw,
    connect,
    place,
    pattern,
    measure,
  };
  function handler(): ToolHandler | undefined {
    return handlers[activeTool.value];
  }

  const offTool = activeTool.subscribe((t) => {
    drawState.value = {};
    typed.value = "";
    current = undefined;
    pickingPlane.value = false;
    hint.value = undefined;
    viewer.setOverlay({});
    viewer.setHighlight(new Set());
    if (t !== "connect") {
      connectPicks.value = [];
      if (pivotOptions.value.base) pivotOptions.value = { ...pivotOptions.value, base: undefined };
    }
    if (t === "pattern")
      patternState.value = { ...patternState.value, template: [...selection.value].sort() };
    if (t !== "measure") measureState.value = {};
    viewer.setTool(handlers[t]);
  });

  /** A key the active tool's gesture takes. */
  function gestureKey(e: KeyboardEvent): boolean {
    if (activeTool.value === "draw") return drawKey(e);
    if (e.key === "Escape") {
      if (
        activeTool.value === "connect" &&
        (connectPicks.value.length > 0 || pivotOptions.value.base)
      ) {
        connectPicks.value = [];
        pivotOptions.value = { ...pivotOptions.value, base: undefined };
        return true;
      }
      if (activeTool.value === "measure" && measureState.value.a) {
        measureState.value = {};
        return true;
      }
    }
    return false;
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
    onKey("tool", (e) => !chord(e) && gestureKey(e)),
    onKey("app", (e) => !chord(e) && shortcutKey(e)),
  ];

  return {
    dispose() {
      for (const off of offKeys) off();
      offModel();
      offPicks();
      offPivot();
      offPalette();
      offTool();
      viewer.setTool(undefined);
    },
  };
}

/** Wires the tools to the viewport's viewer while there is one; returns the undo. */
export function connectTools(): () => void {
  let tools: Tools | undefined;
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
