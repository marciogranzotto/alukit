import { signal } from "@preact/signals";
import type { V3, ViewSection } from "../mesh/model.ts";
import {
  barCommands,
  type DrawEnd,
  type DrawPoint,
  endUnder,
  nextAnchor,
  nextRoll,
  parseLength,
  previewPlacement,
  typedEnd,
  writtenPoint,
} from "../viewer/draw.ts";
import type { MarkerKind } from "../viewer/overlay.ts";
import type { ToolHandler, ToolPointer, Viewer } from "../viewer/scene.ts";
import { findSnap, type Snap, type SnapTargets, snapTargets } from "../viewer/snap.ts";
import { facePlane, GROUND, gridSnap, rayFace, type WorkPlane } from "../viewer/workplane.ts";
import type { Model } from "./model.ts";
import { applyCommands, model, selection } from "./store.ts";

/**
 * The tools of the viewport (design §8, Tools): draw bar, connect, place part, pattern and
 * measure; select is no tool. Each turns pointer and key events into one batch of commands
 * (§7.1), sent with source `ui`; the next revision comes back on the event stream. What a tool
 * shows (its state, the hint by the pointer) lives in signals the panels read.
 */

export const TOOLS = ["select", "draw", "connect", "place", "pattern", "measure"] as const;
export type ToolName = (typeof TOOLS)[number];

export const TOOL_KEYS: Readonly<Record<string, ToolName>> = {
  v: "select",
  b: "draw",
  c: "connect",
  p: "place",
  m: "measure",
};

export const activeTool = signal<ToolName>("select");

/** An item chosen in the catalog browser (§8: "set as palette"). */
export interface PaletteItem {
  id: string;
  kind: string;
  name: string;
  opt?: Readonly<Record<string, string>>;
  /** A bar's section, for the draw tool's preview and anchors. */
  section?: ViewSection;
  anchors?: readonly string[];
}

/** What the draw tool draws with (a bar item) and the place tool places (any other item). */
export const palette = signal<{ bar?: PaletteItem; part?: PaletteItem }>({});

export const drawOptions = signal<{ roll: number; anchor: string; autoConnect: boolean }>({
  roll: 0,
  anchor: "c",
  autoConnect: true,
});

/** The work plane (§8): the ground, or a face picked with W. */
export const workPlane = signal<WorkPlane>(GROUND);
/** Waiting for a click on a face to set the work plane. */
export const pickingPlane = signal(false);

/** The text by the pointer: what it snaps to, the length, what is typed. */
export const hint = signal<{ x: number; y: number; text: string } | undefined>(undefined);
/** A length being typed (§8: type a length and press Enter). */
export const typed = signal("");

/** The draw tool's gesture, for the panel and the test hook. */
export const drawState = signal<{ start?: DrawPoint; end?: DrawEnd }>({});

export type ConnectType = "butt" | "miter" | "splice" | "face";
export interface ConnectPick {
  /** A bar (`b5`) or a bar end (`b1.b`). */
  ref: string;
  kind: "bar" | "end";
  p: V3;
}
export const connectPicks = signal<ConnectPick[]>([]);
export const connectType = signal<ConnectType>("butt");

export interface PlaceStation {
  bar: string;
  at_mm: number;
  face?: string;
  groove?: string;
  p: V3;
}
export const placeState = signal<{ station?: PlaceStation; from: "a" | "b"; roll: number }>({
  from: "a",
  roll: 0,
});

export const patternState = signal<{
  template: string[];
  along?: string;
  pitch: string;
  count: string;
}>({ template: [], pitch: "150", count: "3" });

export const measureState = signal<{ a?: Snap; b?: Snap }>({});

// ---------------------------------------------------------------------------------------------

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

/** The batch a connection's picks make, or why they make none. */
export function connectionCommand(
  picks: readonly ConnectPick[],
  type: ConnectType,
): { cmd: string; args: Record<string, unknown> } | { why: string } {
  const bars = picks.filter((p) => p.kind === "bar").map((p) => p.ref);
  const ends = picks.filter((p) => p.kind === "end").map((p) => p.ref);
  switch (type) {
    case "butt": {
      if (bars.length === 1 && ends.length >= 1)
        return { cmd: "addConnection", args: { type: "butt", through: bars[0], ends } };
      if (bars.length === 0 && ends.length >= 2) {
        // An end bearing on another bar's end (§4.5, G17): the first end picked is the through.
        const [through, ...rest] = ends;
        return { cmd: "addConnection", args: { type: "butt", through, ends: rest } };
      }
      return { why: "a butt takes a through bar and the ends that butt on it" };
    }
    case "miter":
    case "splice":
      if (bars.length === 0 && ends.length === 2)
        return { cmd: "addConnection", args: { type, ends } };
      return { why: `a ${type} takes two ends` };
    case "face":
      if (ends.length === 0 && bars.length >= 2)
        return { cmd: "addConnection", args: { type: "face", bars, fastening: "none" } };
      return { why: "a face connection takes two or more bars, head to nut" };
  }
}

/** The batch the place tool's station makes. */
export function placeCommand(
  item: PaletteItem,
  st: PlaceStation,
  from: "a" | "b",
  roll: number,
): { cmd: string; args: Record<string, unknown> } {
  return {
    cmd: "addPart",
    args: {
      item: item.id,
      ...(item.opt && Object.keys(item.opt).length > 0 ? { opt: item.opt } : {}),
      on: {
        bar: st.bar,
        at_mm: st.at_mm,
        ...(from === "b" ? { from: "b" } : {}),
        ...(st.groove ? { groove: st.groove } : st.face ? { face: st.face } : {}),
      },
      ...(roll !== 0 ? { roll_deg: roll } : {}),
    },
  };
}

/** The batch the pattern tool makes, or why it makes none. */
export function patternCommand(s: {
  template: readonly string[];
  along?: string | undefined;
  pitch: string;
  count: string;
}): { cmd: string; args: Record<string, unknown> } | { why: string } {
  const template = s.template.filter((id) => !id.includes("@"));
  if (template.length === 0) return { why: "select the entities to repeat" };
  if (!s.along) return { why: "pick the bar or run to repeat along" };
  const pitch = Number(s.pitch);
  const count = Number(s.count);
  if (!(Number.isFinite(pitch) && pitch !== 0)) return { why: "the pitch is a length in mm" };
  if (!(Number.isInteger(count) && count >= 2)) return { why: "the count is 2 or more" };
  return {
    cmd: "addPattern",
    args: { template, along: s.along, pitch_mm: pitch, count },
  };
}

// ---------------------------------------------------------------------------------------------

export interface Tools {
  /** A key the active tool takes; true when it did. */
  key(e: KeyboardEvent): boolean;
  dispose(): void;
}

/** Wires the tools to a viewer: the active tool gets the viewport's pointer. */
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
    });
  const show = (e: ToolPointer | undefined, text: string | undefined) => {
    hint.value = e && text ? { x: e.clientX, y: e.clientY, text } : undefined;
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
    show(e, text);
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

  const connect: ToolHandler = {
    move(e) {
      pointer = e;
      const m = model.value;
      const hit = viewer.pickAt(e.clientX, e.clientY);
      const pick = m && hit ? barPick(m, hit.id, hit.p) : undefined;
      viewer.setOverlay({
        pins: connectPicks.value.filter((p) => p.kind === "end").map((p) => p.p),
        marker: pick ? { p: pick.p, kind: "pick" } : undefined,
      });
      show(e, pick ? `${pick.kind === "end" ? "end" : "bar"} ${pick.ref}` : undefined);
    },
    click(e) {
      const m = model.value;
      const hit = viewer.pickAt(e.clientX, e.clientY);
      const pick = m && hit ? barPick(m, hit.id, hit.p) : undefined;
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
    viewer.setHighlight(new Set(picks.filter((p) => p.kind === "bar").map((p) => p.ref)));
    if (activeTool.value === "connect")
      viewer.setOverlay({ pins: picks.filter((p) => p.kind === "end").map((p) => p.p) });
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
      show(e, snap?.label);
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
      show(
        e,
        hit && !hit.id.includes("@") && hit.id.startsWith("b") ? `along ${hit.id}` : undefined,
      );
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
      show(e, snap?.label);
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
    if (t !== "connect") connectPicks.value = [];
    if (t === "pattern")
      patternState.value = { ...patternState.value, template: [...selection.value].sort() };
    if (t !== "measure") measureState.value = {};
    viewer.setTool(handlers[t]);
  });

  return {
    key(e) {
      if (activeTool.value === "draw") return drawKey(e);
      if (e.key === "Escape") {
        if (activeTool.value === "connect" && connectPicks.value.length > 0) {
          connectPicks.value = [];
          return true;
        }
        if (activeTool.value === "measure" && measureState.value.a) {
          measureState.value = {};
          return true;
        }
      }
      return false;
    },
    dispose() {
      offModel();
      offPicks();
      offPalette();
      offTool();
      viewer.setTool(undefined);
    },
  };
}

/** Distances between two measured points: along each axis and straight. */
export function measured(a: V3, b: V3): { d: number; dx: number; dy: number; dz: number } {
  const v = sub(b, a);
  return { d: len3(v), dx: v[0], dy: v[1], dz: v[2] };
}
