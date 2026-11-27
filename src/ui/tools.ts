import { signal } from "@preact/signals";
import { nextIdNumber } from "#core/ids.ts";
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

export type ConnectType = "butt" | "miter" | "splice" | "pivot" | "face";
export interface ConnectPick {
  /**
   * A bar (`b5`), a bar end (`b1.b`), or, as a face connection's layer, a part holding a plate
   * (`p6`) or the run a picked bar belongs to (`r1`).
   */
  ref: string;
  kind: "bar" | "end" | "part" | "run";
  p: V3;
}
export const connectPicks = signal<ConnectPick[]>([]);
export const connectType = signal<ConnectType>("butt");

/** A face station, as the place tool and a pivot's base take one (§4.3). */
export interface FaceStation {
  bar: string;
  at_mm: number;
  face?: string;
  groove?: string;
  p: V3;
}

/** A pivot's own fields (§4.5): its base station, the hinge axis and its connector. */
export interface PivotOptions {
  base?: FaceStation;
  /** The end of the base bar `at_mm` is counted from. */
  from: "a" | "b";
  axis: "along" | "across";
  connector: string;
}
export const pivotOptions = signal<PivotOptions>({ from: "a", axis: "across", connector: "" });

/**
 * A face connection's own fields (§4.5), as typed: the fastening; the fastener, an item or a
 * rod cut from bar stock to a length; the stack; the stations, at distances along the first
 * layer (and across it) or at its rail's holes; the gaps between layers; a screw's tap depth.
 * Lists are comma-separated numbers or expressions.
 */
export interface FaceOptions {
  fastening: "none" | "bolt" | "tnut" | "screw" | "blind";
  fastener: string;
  /** The fastener is a rod cut from `fastener`'s bar stock, `rodLen` long. */
  rod: boolean;
  rodLen: string;
  stack: string;
  at: string;
  across: string;
  railHoles: boolean;
  gaps: string;
  tapDepth: string;
}
export const faceOptions = signal<FaceOptions>({
  fastening: "none",
  fastener: "",
  rod: false,
  rodLen: "",
  stack: "",
  at: "",
  across: "",
  railHoles: false,
  gaps: "",
  tapDepth: "",
});

export type PlaceStation = FaceStation;
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

/** A typed value as a command takes it: a number when it reads as one, else an expression. */
export function typedValue(text: string): number | string {
  const t = text.trim();
  return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : t;
}

/** A comma-separated list of numbers or expressions; undefined when a member is empty. */
export function valueList(text: string): (number | string)[] | undefined {
  if (text.trim() === "") return [];
  const parts = text.split(",").map((s) => s.trim());
  return parts.some((s) => s === "") ? undefined : parts.map(typedValue);
}

/** A face connection's fields from its options, or why they make none. */
function faceFields(f: FaceOptions): { fields: Record<string, unknown> } | { why: string } {
  const gaps = valueList(f.gaps);
  if (!gaps) return { why: "the gaps are a comma-separated list, one per pair of layers" };
  const common = gaps.length > 0 ? { gaps_mm: gaps } : {};
  if (f.fastening === "none") return { fields: { fastening: "none", ...common } };
  const item = f.fastener.trim();
  if (item === "") {
    return {
      why: f.rod ? "name the bar stock the rod is cut from" : "name the fastener: an item id",
    };
  }
  let fastener: unknown = item;
  if (f.rod) {
    if (f.rodLen.trim() === "") return { why: "give the rod's length" };
    fastener = { bar: item, len_mm: typedValue(f.rodLen) };
  }
  const at = valueList(f.at);
  const across = valueList(f.across);
  if (!at || !across) return { why: "the stations are comma-separated distances in mm" };
  if (at.length === 0 && !f.railHoles) {
    return { why: "give the stations: distances along the first layer, or its rail's holes" };
  }
  const stack = f.stack
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return {
    fields: {
      fastening: f.fastening,
      fastener,
      ...(stack.length > 0 ? { stack } : {}),
      stations: {
        ...(at.length > 0 ? { at_mm: at } : {}),
        ...(across.length > 0 ? { across_mm: across } : {}),
        ...(f.railHoles ? { rail_holes: true } : {}),
      },
      ...(f.fastening === "screw" && f.tapDepth.trim() !== ""
        ? { tap_depth_mm: typedValue(f.tapDepth) }
        : {}),
      ...common,
    },
  };
}

/** The batch a connection's picks make, or why they make none. */
export function connectionCommand(
  picks: readonly ConnectPick[],
  type: ConnectType,
  opts: { pivot?: PivotOptions; face?: FaceOptions } = {},
): { cmd: string; args: Record<string, unknown> } | { why: string } {
  const bars = picks.filter((p) => p.kind === "bar").map((p) => p.ref);
  const ends = picks.filter((p) => p.kind === "end").map((p) => p.ref);
  const layers = picks.filter((p) => p.kind !== "end").map((p) => p.ref);
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
    case "pivot": {
      const p = opts.pivot;
      if (!p?.base) return { why: "click a station on a face for the pivot's base" };
      if (layers.length > 0 || ends.length === 0)
        return { why: "a pivot carries ends: click near each end it carries" };
      if (p.connector.trim() === "")
        return { why: "name the connector: one with pivot geometry, a hinge" };
      const b = p.base;
      return {
        cmd: "addConnection",
        args: {
          type: "pivot",
          base: {
            bar: b.bar,
            at_mm: b.at_mm,
            ...(p.from === "b" ? { from: "b" } : {}),
            ...(b.face ? { face: b.face } : {}),
          },
          axis: p.axis,
          ends,
          connector: p.connector.trim(),
        },
      };
    }
    case "face": {
      if (ends.length > 0 || layers.length < 2)
        return {
          why: "a face connection takes two or more layers, head to nut: bars, runs or plates",
        };
      const f = faceFields(opts.face ?? faceOptions.value);
      if ("why" in f) return f;
      return { cmd: "addConnection", args: { type: "face", bars: layers, ...f.fields } };
    }
  }
}

/**
 * A pivot's batch (§4.5): the connection, then each carried end's design point set to it, as a
 * pivot requires. The connection's id is the one the document gives next (`nextIdNumber`); the
 * batch is sent strict, so a step made by anyone else first refuses it instead of pointing the
 * ends at another connection.
 */
export function pivotBatch(
  command: { cmd: string; args: Record<string, unknown> },
  doc: Readonly<Record<string, unknown>>,
): { id: string; commands: { cmd: string; args: Record<string, unknown> }[] } {
  const ids = (doc.ids ?? {}) as Record<string, unknown>;
  const conns = doc.connections;
  const existing =
    typeof conns === "object" && conns !== null ? Object.keys(conns as object) : ([] as string[]);
  const id = `c${nextIdNumber(ids.c, existing, "c")}`;
  const ends = (command.args.ends as string[]) ?? [];
  return {
    id,
    commands: [
      command,
      ...ends.map((ref) => {
        const [bar, end] = ref.split(".") as [string, string];
        return { cmd: "setBar", args: { id: bar, set: { [end]: { pivot: id } } } };
      }),
    ],
  };
}

/** The run a bar is a piece of, if any: a face connection's layer may be the whole run (§4.5). */
export function runOf(doc: Readonly<Record<string, unknown>>, bar: string): string | undefined {
  const runs = doc.runs;
  if (typeof runs !== "object" || runs === null) return undefined;
  for (const [id, r] of Object.entries(runs as Record<string, unknown>)) {
    const members = Array.isArray(r)
      ? r
      : typeof r === "object" && r !== null && Array.isArray((r as { bars?: unknown }).bars)
        ? (r as { bars: unknown[] }).bars
        : [];
    if (members.includes(bar)) return id;
  }
  return undefined;
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
      // The section plane's far side is not drawn, so nothing there snaps.
      hidden: viewer.clipped,
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
        show(e, snap ? `base: ${snap.label}` : "click a face for the pivot's base");
        return;
      }
      const pick = connectPickAt(e);
      viewer.setOverlay({
        pins: pins(),
        marker: pick ? { p: pick.p, kind: "pick" } : undefined,
      });
      show(e, pick ? `${pick.kind === "end" ? "end" : pick.kind} ${pick.ref}` : undefined);
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
    if (t !== "connect") {
      connectPicks.value = [];
      if (pivotOptions.value.base) pivotOptions.value = { ...pivotOptions.value, base: undefined };
    }
    if (t === "pattern")
      patternState.value = { ...patternState.value, template: [...selection.value].sort() };
    if (t !== "measure") measureState.value = {};
    viewer.setTool(handlers[t]);
  });

  return {
    key(e) {
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
    },
    dispose() {
      offModel();
      offPicks();
      offPivot();
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
