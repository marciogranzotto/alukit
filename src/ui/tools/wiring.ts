import { len } from "#core/commands/numbers.ts";
import type { CornerRule } from "#core/project/schema.ts";
import type { V3 } from "../../mesh/model.ts";
import {
  AXES,
  type Axis,
  barCommands,
  type DrawEnd,
  type DrawPoint,
  endUnder,
  nextAnchor,
  nextRoll,
  previewPlacement,
  typedEnd,
  writtenPoint,
} from "../../viewer/draw.ts";
import type { MarkerKind } from "../../viewer/overlay.ts";
import type { ToolHandler, ToolPointer, Viewer } from "../../viewer/scene.ts";
import {
  findSnap,
  q,
  rayLineParams,
  type Snap,
  type SnapTargets,
  snapTargets,
} from "../../viewer/snap.ts";
import {
  facePlane,
  GROUND,
  gridSnap,
  onGrid,
  rayFace,
  rayPlane,
  through,
} from "../../viewer/workplane.ts";
import { dryRun } from "../client/dryrun.ts";
import { cornerKey, cornersOf } from "../corners.ts";
import { select, selection } from "../focus.ts";
import { chord, describeKeys, onKey } from "../keys.ts";
import type { Model } from "../model.ts";
import { palette } from "../palette.ts";
import { type CommandOutcome, model, sendCommands, summary } from "../store.ts";
import { viewer } from "../viewport/viewer.ts";
import { frameBatch, pickRefusal, placeCommand, placeFrom, runOf } from "./commands.ts";
import { jointWords } from "./joint.ts";
import {
  activeTool,
  CORNER_RULES,
  type ConnectPick,
  connectPicks,
  connectType,
  drawOptions,
  drawState,
  fieldDone,
  fieldWanted,
  frameDraft,
  frameOptions,
  frameStage,
  hint,
  jointPreview,
  lastResult,
  measureState,
  patternState,
  pickingPlane,
  pivotOptions,
  placeState,
  TOOL_KEYS,
  TOOL_NAMES,
  type ToolName,
  typed,
  workPlane,
} from "./state.ts";
import { parseTyped, type Typed, typedWords } from "./typed.ts";

/**
 * The tools' wiring (design §8, Tools): the active tool gets the viewport's pointer, and the keys
 * (keys.ts) its gesture's keys first, then the tool shortcuts. Each tool turns pointer and key
 * events into one batch of commands (§7.1), sent with source `ui`; the next revision comes back on
 * the event stream. What a tool shows lives in state.ts's signals, which the command bar, the tool
 * forms and the status bar read. Owner: S5.
 *
 * Keys (D-UX-18): a tool's letter picks it; Esc steps back one level (what is typed, the last
 * pick, the gesture, the tool, then the selection); a digit, a sign, `(`, `[` or `=` starts a
 * value in the command bar, where letters then belong to the value (U20); the arrow keys lock the
 * draw axis; Space chains the next bar from the last end; Tab flips the previewed joint.
 */

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const fmt = (x: number) => String(Math.round(x * 100) / 100);

/** A character that starts a value in the command bar (D-UX-17). */
const VALUE_START = /^[0-9.\-+([=]$/;

/** Enter on a typed length with neither a pointer direction nor a locked axis (review M2). */
export const NO_DIRECTION = "Which way? Move the pointer, or press → ← ↑";

/**
 * How long the pointer rests before the joint preview dry-runs a gesture whose end is in open
 * space, ms; a snap onto another bar asks sooner. S1 measured a dry run at 144–167 ms on 1,008
 * bars: it is asked when the gesture rests or snaps, never on every pointer move (S5.6).
 */
const PAUSE_MS = 250;
const SNAP_MS = 60;

/** The marker a snap's kind and reference draw (C §5.3): a face centre and a part's datum apart. */
function markerOf(s: Snap): MarkerKind {
  if (s.kind !== "point") return s.kind;
  if (s.ref.kind === "part") return / origin$| datum /.test(s.label) ? "datum" : "face";
  if (s.ref.kind === "station" && / face centre$/.test(s.label)) return "face";
  return "point";
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

/** A typed point (`[x, y, z]`) as a gesture's point: written with its expressions. */
function typedPoint(t: Extract<Typed, { kind: "point" }>): DrawPoint {
  return {
    p: t.items.map((x) => x.value) as unknown as V3,
    written: t.items.map((x) => x.written),
    label: `typed [${t.items.map((x) => x.written).join(", ")}]`,
  };
}

/** What a step came to, for the command bar's result chip. */
function noteResult(o: CommandOutcome): void {
  lastResult.value = o.ok
    ? { rev: o.rev, created: o.created }
    : { rev: model.peek()?.rev ?? 0, created: [], error: o.why };
}

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
  const typedNow = (): Typed => parseTyped(typed.peek(), params());

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
  /** Shows the active tool again where the pointer is (or without it, for the keyboard). */
  function refresh(): void {
    const h = handler();
    if (pointer && h?.move) h.move(pointer);
    else if (activeTool.peek() === "draw") drawPreview(undefined);
    else if (activeTool.peek() === "frame") framePreview(undefined);
  }
  /** The command bar gives the keyboard back once a value is used. */
  const used = () => {
    typed.value = "";
    fieldDone.value++;
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

  /** The snap under the pointer before the gesture starts. */
  let current: Snap | undefined;
  /** The last bar's end b, which Space chains the next bar from (U29). */
  let lastEnd: DrawPoint | undefined;
  /** The rule Tab flipped the previewed joint to, for this gesture only (S5.6). */
  let flip: CornerRule | undefined;

  /** The rule the gesture's joints follow: Tab's, else the command bar's, else the project's. */
  const preferNow = (): CornerRule | undefined => flip ?? drawOptions.peek().prefer;

  /**
   * The end Enter or a click would commit: a typed length along the direction under the pointer
   * (or the locked axis), a typed point, or the end under the pointer.
   */
  function drawEnd(): DrawEnd | undefined {
    const { start, end } = drawState.peek();
    if (!start) return undefined;
    const t = typedNow();
    if (t.kind === "point") {
      const p = typedPoint(t);
      return len3(sub(p.p, start.p)) > 1e-6 ? { ...p, how: "typed" } : undefined;
    }
    if (t.kind === "value") {
      const lock = drawOptions.peek().lock;
      const toward = end?.p ?? (lock ? add(start.p, AXES[lock]) : undefined);
      return toward ? typedEnd(start, toward, t.value, t.written) : undefined;
    }
    return t.kind === "empty" ? end : undefined;
  }

  /** The gesture's batch, as it would commit now. */
  function gestureCommands(
    end: DrawEnd,
  ): { cmd: string; args: Record<string, unknown> }[] | undefined {
    const start = drawState.peek().start;
    const bar = palette.peek().bar;
    if (!start || !bar) return undefined;
    const o = drawOptions.peek();
    return barCommands({
      item: bar.id,
      ...(bar.opt ? { opt: bar.opt } : {}),
      a: start,
      b: end,
      anchor: o.anchor,
      roll: o.roll,
      autoConnect: o.autoConnect,
      prefer: preferNow(),
    });
  }

  // The joint preview (S5.6): the gesture dry-run when it rests or snaps, its words by the end.
  let jointTimer: ReturnType<typeof setTimeout> | undefined;
  let jointWanted: string | undefined;
  function clearJoint(): void {
    if (jointTimer) clearTimeout(jointTimer);
    jointTimer = undefined;
    jointWanted = undefined;
    if (jointPreview.peek()) jointPreview.value = undefined;
    viewer.setLabel("joint", undefined);
  }
  function scheduleJoint(end: DrawEnd | undefined): void {
    const cmds = end && drawOptions.peek().autoConnect ? gestureCommands(end) : undefined;
    if (!end || !cmds) {
      clearJoint();
      return;
    }
    const key = JSON.stringify(cmds);
    if (key === jointWanted) return;
    // What was shown is about another gesture now.
    if (jointPreview.peek()) jointPreview.value = undefined;
    viewer.setLabel("joint", undefined);
    jointWanted = key;
    if (jointTimer) clearTimeout(jointTimer);
    const prefer = preferNow();
    jointTimer = setTimeout(
      () => void askJoint(key, cmds, end, prefer),
      end.how === "snap" || end.how === "meet" ? SNAP_MS : PAUSE_MS,
    );
  }
  async function askJoint(
    key: string,
    cmds: { cmd: string; args: Record<string, unknown> }[],
    end: DrawEnd,
    prefer: CornerRule | undefined,
  ): Promise<void> {
    const t0 = performance.now();
    const r = await dryRun(cmds);
    const ms = Math.round(performance.now() - t0);
    // Only the answer for the gesture as it stands now is shown.
    if (key !== jointWanted || activeTool.peek() !== "draw") return;
    if (!r.ok || !r.value.ok) return;
    const bar = r.value.created.find((id) => /^b\d+$/.test(id));
    if (!bar) return;
    const w = jointWords(r.value, bar);
    // Nothing joins and nothing moves: open space, nothing to say.
    if (!w.joins && Object.keys(r.value.effects.cuts).length === 0) return;
    jointPreview.value = { key, at: end.p, text: w.text, prefer, shape: w.shape, ms };
    viewer.setLabel("joint", end.p, w.joins ? `${w.text} · Tab: flip` : w.text);
  }

  /** Tab: the next corner rule that gives the previewed joint another arrangement. */
  async function flipJoint(): Promise<void> {
    const j = jointPreview.peek();
    const end = drawEnd();
    if (!j || !end) return;
    const m = model.peek();
    const base = (j.prefer ??
      (m?.defaults.corner as CornerRule | undefined) ??
      "vertical") as CornerRule;
    const from = CORNER_RULES.indexOf(base);
    for (let i = 1; i < CORNER_RULES.length; i++) {
      const rule = CORNER_RULES[(from + i) % CORNER_RULES.length] as CornerRule;
      const saved = flip;
      flip = rule;
      const cmds = gestureCommands(end);
      flip = saved;
      if (!cmds) return;
      const r = await dryRun(cmds);
      if (jointPreview.peek() !== j) return;
      if (!r.ok || !r.value.ok) continue;
      const bar = r.value.created.find((id) => /^b\d+$/.test(id)) ?? "";
      const w = jointWords(r.value, bar);
      if (w.shape === j.shape) continue;
      flip = rule;
      const key = JSON.stringify(gestureCommands(end));
      jointWanted = key;
      jointPreview.value = { key, at: end.p, text: w.text, prefer: rule, shape: w.shape, ms: j.ms };
      viewer.setLabel("joint", end.p, `${w.text} · Tab: flip`);
      return;
    }
    viewer.setLabel("joint", end.p, `${j.text} · no other arrangement here`);
  }

  function drawPreview(e: ToolPointer | undefined): void {
    const { start, end: under } = drawState.value;
    const bar = palette.value.bar;
    const o = drawOptions.value;
    const t = typedNow();
    const end = drawEnd();
    if (!bar) {
      viewer.setOverlay({});
      clearJoint();
      show(e, "no bar in the palette: arm one in the parts bin or the catalog");
      return;
    }
    const ghost =
      start && end && bar.section
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
        start && end?.axis && end.how !== "snap" && end.how !== "free"
          ? { through: start.p, axis: end.axis }
          : undefined,
      ghost:
        ghost && start && bar.section ? { section: bar.section, a: start.p, ...ghost } : undefined,
      plane: workPlane.value === GROUND ? undefined : workPlane.value,
    });
    const what = under ? under.label : current?.label;
    const text = [
      t.kind === "empty" ? what : end?.label,
      length !== undefined ? `${fmt(length)} mm` : undefined,
      t.kind === "error" ? t.why : undefined,
    ]
      .filter((x) => x !== undefined)
      .join(" · ");
    show(e, text, what);
    scheduleJoint(start ? end : undefined);
  }

  /** Commits the gesture; with `chain`, the next bar starts where this one ends (Space). */
  async function commitBar(end: DrawEnd, chain = false): Promise<void> {
    const cmds = gestureCommands(end);
    if (!cmds) return;
    drawState.value = {};
    flip = undefined;
    current = undefined;
    clearJoint();
    viewer.setOverlay({});
    if (drawOptions.peek().lock) drawOptions.value = { ...drawOptions.peek(), lock: undefined };
    used();
    const o = await sendCommands(cmds, "draw bar", { inline: true });
    noteResult(o);
    if (!o.ok) return;
    const id = o.created.find((x) => /^b\d+$/.test(x));
    lastEnd = { p: end.p, written: end.written, label: id ? `end ${id}.b` : end.label };
    if (chain && activeTool.peek() === "draw") {
      drawState.value = { start: lastEnd };
      refresh();
    }
  }

  /** Starts a bar at a point, from the keyboard (a typed point, the selection, Space). */
  function startAt(p: DrawPoint): void {
    drawState.value = { start: p };
    refresh();
  }

  /**
   * The point the selection stands for, where Enter starts a bar (S5.2): a corner, a node, a
   * bar's end (`b1.b`).
   */
  function selectedPoint(): DrawPoint | undefined {
    const m = model.peek();
    const sel = [...selection.peek()];
    if (!m || sel.length !== 1) return undefined;
    const ref = sel[0] as string;
    const key = cornerKey(ref);
    if (key !== undefined) {
      const c = cornersOf(m).find((x) => x.key === key);
      return c ? { p: c.at, written: c.at.map((x) => q(x)), label: `corner ${key}` } : undefined;
    }
    const node = m.derived.nodes[ref];
    if (node) return { p: node, written: ref, label: `node ${ref}` };
    const end = /^(b\d+)\.([ab])$/.exec(ref);
    const bar = end ? m.derived.bars[end[1] as string] : undefined;
    if (end && bar) {
      const e = end[2] as "a" | "b";
      const snap: Snap = {
        p: bar[e],
        ref: { kind: "end", bar: end[1] as string, end: e },
        label: `end ${ref}`,
        kind: "point",
      };
      return { p: bar[e], written: writtenPoint(snap, m.doc), label: `end ${ref}` };
    }
    return undefined;
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
          lock: drawOptions.value.lock,
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
      if (!m || !palette.value.bar) return;
      const { start } = drawState.value;
      if (!start) {
        if (!current) return;
        startAt({ p: current.p, written: writtenPoint(current, m.doc), label: current.label });
        return;
      }
      // A click commits what is previewed: the typed length when one is typed.
      const end = drawEnd();
      if (end) void commitBar(end);
    },
    leave() {
      hint.value = undefined;
    },
  };

  /** Enter in Draw: start at a typed point or the selection; commit the previewed end. */
  function drawEnter(): boolean {
    const { start } = drawState.peek();
    const t = typedNow();
    if (t.kind === "error") {
      lastResult.value = { rev: model.peek()?.rev ?? 0, created: [], error: t.why };
      return true;
    }
    if (!start) {
      if (t.kind === "point") {
        used();
        startAt(typedPoint(t));
        return true;
      }
      if (t.kind !== "empty") {
        lastResult.value = {
          rev: model.peek()?.rev ?? 0,
          created: [],
          error: "click a start point first, or type one as [x, y, z]",
        };
        return true;
      }
      const p = selectedPoint();
      if (!p) return false;
      startAt(p);
      return true;
    }
    const end = drawEnd();
    if (end) void commitBar(end);
    else if (t.kind === "value") {
      // A length with no way to go (review M2): say so, rather than nothing.
      lastResult.value = {
        rev: model.peek()?.rev ?? 0,
        created: [],
        error: NO_DIRECTION,
      };
    }
    return true;
  }

  function drawKey(e: KeyboardEvent): boolean {
    const k = e.key;
    const { start } = drawState.value;
    if (k === "Enter") return drawEnter();
    if (k === " ") {
      // Space: chain. With a bar previewed, commit it and start the next from its end; with
      // nothing started, start from the last bar's end.
      if (start) {
        const end = drawEnd();
        if (!end) return false;
        void commitBar(end, true);
        return true;
      }
      if (!lastEnd) return false;
      startAt(lastEnd);
      return true;
    }
    if (k === "Tab" && !e.shiftKey && jointPreview.value) {
      void flipJoint();
      return true;
    }
    const LOCKS: Readonly<Record<string, Axis>> = { ArrowRight: "x", ArrowLeft: "y", ArrowUp: "z" };
    if ((LOCKS[k] || k === "ArrowDown") && !e.defaultPrevented) {
      const axis = LOCKS[k];
      const was = drawOptions.value.lock;
      drawOptions.value = { ...drawOptions.value, lock: axis && axis !== was ? axis : undefined };
      refresh();
      return true;
    }
    if (k === "r" || k === "R") {
      drawOptions.value = { ...drawOptions.value, roll: nextRoll(drawOptions.value.roll) };
      refresh();
      return true;
    }
    if (k === "a" || k === "A") {
      const anchors = palette.value.bar?.anchors ?? ["c"];
      drawOptions.value = {
        ...drawOptions.value,
        anchor: nextAnchor(anchors, drawOptions.value.anchor),
      };
      refresh();
      return true;
    }
    if (k === "w" || k === "W") {
      if (pickingPlane.value || workPlane.value !== GROUND) {
        workPlane.value = GROUND;
        pickingPlane.value = false;
      } else pickingPlane.value = true;
      refresh();
      return true;
    }
    return false;
  }

  /** Esc in Draw, one level: picking a plane, then the gesture (and its lock). */
  function drawBack(): boolean {
    if (pickingPlane.value) {
      pickingPlane.value = false;
      refresh();
      return true;
    }
    if (drawState.value.start || drawOptions.value.lock) {
      drawState.value = {};
      flip = undefined;
      drawOptions.value = { ...drawOptions.value, lock: undefined };
      clearJoint();
      refresh();
      return true;
    }
    return false;
  }

  // -- Box frame (S5.7) --------------------------------------------------------------------------

  /** The footprint or height under the pointer, while the frame asks for one. */
  let framePointer: { w?: number; d?: number; h?: number } = {};

  function framePreview(e: ToolPointer | undefined): void {
    const d = frameDraft.value;
    const stage = frameStage(d);
    const at = d.at;
    if (stage === "corner" || !at) {
      viewer.setOverlay({
        marker: current ? { p: current.p, kind: markerOf(current) } : undefined,
      });
      viewer.setLabel("frame", undefined);
      show(e, current ? `corner: ${current.label}` : undefined, current?.label);
      return;
    }
    const t = typedNow();
    if (stage === "size") {
      const list = t.kind === "list" && t.items.length === 2 ? t.items : undefined;
      const w = list ? list[0]?.value : framePointer.w;
      const dd = list ? list[1]?.value : framePointer.d;
      const far: V3 | undefined =
        w !== undefined && dd !== undefined ? [at[0] + w, at[1] + dd, at[2]] : undefined;
      viewer.setOverlay({
        pins: [at],
        line: far ? { a: at, b: far } : undefined,
        marker: far ? { p: far, kind: "free" } : undefined,
      });
      viewer.setLabel(
        "frame",
        far,
        far ? `W ${fmt(Math.abs(w as number))} × D ${fmt(Math.abs(dd as number))}` : undefined,
      );
      show(
        e,
        far ? `${fmt(Math.abs(w as number))} × ${fmt(Math.abs(dd as number))} mm` : undefined,
        far ? `size ${fmt(w as number)}, ${fmt(dd as number)}` : undefined,
      );
      return;
    }
    const W = parseTyped(d.w, params());
    const D = parseTyped(d.d, params());
    const wv = W.kind === "value" ? W.value : 0;
    const dv = D.kind === "value" ? D.value : 0;
    const h = t.kind === "value" ? t.value : framePointer.h;
    const corner: V3 = [at[0] + wv, at[1] + dv, at[2]];
    const top: V3 | undefined = h !== undefined ? [corner[0], corner[1], at[2] + h] : undefined;
    viewer.setOverlay({
      pins: [at, corner],
      line: top ? { a: corner, b: top } : undefined,
      guide: { through: corner, axis: "z" },
      marker: top ? { p: top, kind: "free" } : undefined,
    });
    viewer.setLabel("frame", top, top ? `H ${fmt(h as number)}` : undefined);
    show(
      e,
      top ? `H ${fmt(h as number)} mm` : undefined,
      top ? `height ${fmt(h as number)}` : undefined,
    );
  }

  /**
   * Sends the frame when the draft is whole: one step, its `addFrame` after the default butt
   * connector the form's Joined with chose (review B1); while none is chosen, it says so.
   */
  async function commitFrame(): Promise<void> {
    const m = model.peek();
    const butt = m?.defaults.butt as { connector?: unknown } | undefined;
    const c = frameBatch(
      frameDraft.peek(),
      frameOptions.peek(),
      palette.peek().bar,
      {
        hasDefaultBar:
          typeof (m?.defaults.bar as { item?: unknown } | undefined)?.item === "string",
        defaultButt: typeof butt?.connector === "string" ? butt.connector : undefined,
      },
      params(),
    );
    if ("why" in c) {
      lastResult.value = { rev: m?.rev ?? 0, created: [], error: c.why };
      return;
    }
    const o = await sendCommands(c.commands, "box frame", { inline: true });
    noteResult(o);
    if (o.ok) {
      frameDraft.value = { w: "", d: "", h: "" };
      framePointer = {};
      viewer.setOverlay({});
      viewer.setLabel("frame", undefined);
    }
  }

  const frame: ToolHandler = {
    move(e) {
      pointer = e;
      const d = frameDraft.value;
      const stage = frameStage(d);
      const at = d.at;
      if (stage === "corner" || !at) current = snapAt(e) ?? gridSnap(rayAt(e), workPlane.value);
      else if (stage === "size") {
        const plane = through(GROUND, at);
        const hit = rayPlane(rayAt(e), plane);
        const p = hit ? onGrid(plane, hit) : undefined;
        framePointer = p ? { w: q(p[0] - at[0]), d: q(p[1] - at[1]) } : {};
      } else {
        const W = parseTyped(d.w, params());
        const D = parseTyped(d.d, params());
        const corner: V3 = [
          at[0] + (W.kind === "value" ? W.value : 0),
          at[1] + (D.kind === "value" ? D.value : 0),
          at[2],
        ];
        const s = Math.round(rayLineParams(rayAt(e), corner, AXES.z).s / 10) * 10;
        framePointer = s > 0 ? { h: s } : {};
      }
      framePreview(e);
    },
    click(e) {
      frame.move?.(e);
      const d = frameDraft.value;
      const stage = frameStage(d);
      if (stage === "corner") {
        if (!current) return;
        frameDraft.value = { ...d, at: current.p.map((x) => len(x)) as unknown as V3 };
      } else if (stage === "size" && d.at) {
        const { w, d: dd } = framePointer;
        if (!w || !dd) return;
        // A far corner below or left of the first: the frame's corner is the least of the two.
        frameDraft.value = {
          ...d,
          at: [Math.min(d.at[0], d.at[0] + w), Math.min(d.at[1], d.at[1] + dd), d.at[2]].map((x) =>
            len(x),
          ) as unknown as V3,
          w: String(Math.abs(w)),
          d: String(Math.abs(dd)),
        };
      } else if (stage === "height") {
        if (!framePointer.h) return;
        frameDraft.value = { ...d, h: String(framePointer.h) };
        void commitFrame();
        return;
      }
      framePreview(e);
    },
    leave() {
      hint.value = undefined;
    },
  };

  /** Enter in Box frame: the typed corner, W and D, or H; the frame when it is whole. */
  function frameEnter(): boolean {
    const d = frameDraft.peek();
    const stage = frameStage(d);
    const t = typedNow();
    const fail = (why: string) => {
      lastResult.value = { rev: model.peek()?.rev ?? 0, created: [], error: why };
      return true;
    };
    if (t.kind === "error") return fail(t.why);
    if (stage === "corner") {
      if (t.kind !== "point")
        return t.kind === "empty" ? false : fail("type the corner as [x, y, z]");
      frameDraft.value = { ...d, at: t.items.map((x) => len(x.value)) as unknown as V3 };
    } else if (stage === "size") {
      const [w, dd] = t.kind === "list" && t.items.length === 2 ? t.items : [];
      if (!w || !dd) return t.kind === "empty" ? false : fail("type the width and the depth: W, D");
      frameDraft.value = { ...d, w: String(w.written), d: String(dd.written) };
    } else if (stage === "height") {
      if (t.kind !== "value") return t.kind === "empty" ? false : fail("type the height H");
      frameDraft.value = { ...d, h: String(t.written) };
    }
    used();
    if (frameStage(frameDraft.peek()) === "done") void commitFrame();
    else refresh();
    return true;
  }

  /** Esc in Box frame, one level: the height, then the size, then the corner. */
  function frameBack(): boolean {
    const d = frameDraft.value;
    const stage = frameStage(d);
    if (stage === "height") frameDraft.value = { ...d, w: "", d: "" };
    else if (stage === "size") frameDraft.value = { ...d, at: undefined };
    else return false;
    refresh();
    return true;
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
      const refused = pick ? pickRefusal(connectType.value, connectPicks.value, pick) : undefined;
      viewer.setOverlay({
        pins: pins(),
        marker: pick && !refused ? { p: pick.p, kind: "pick" } : undefined,
      });
      const picked = pick ? `${pick.kind} ${pick.ref}` : undefined;
      show(e, picked && refused ? `${picked}: ${refused}` : picked, picked);
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
      // A pick the connection cannot take is left out; the tip by the pointer says why.
      if (pickRefusal(connectType.value, cur, pick)) return;
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

  // -- Place part (D-UX-16) -----------------------------------------------------------------------

  /** A part lands on a face or a groove (§4.7): only those stations snap. */
  const onFaces = (t: SnapTargets): SnapTargets => ({
    points: t.points.filter((p) => p.ref.kind === "station" && p.ref.face !== undefined),
    lines: t.lines.filter((l) => l.face !== undefined || l.groove !== undefined),
  });

  /** The station under the pointer, or why a click there places nothing. */
  function placeAt(
    e: ToolPointer,
  ):
    | { snap: Snap; st: NonNullable<typeof placeState.value.station> }
    | { why: string; snap?: Snap }
    | undefined {
    const snap = snapAt(e, onFaces);
    if (snap?.ref.kind !== "station") return undefined;
    const r = snap.ref;
    // A pattern copy is derived from its template: it takes no parts of its own (U37).
    if (r.bar.includes("@")) {
      return { why: `copies take no parts: use ${r.bar.split("@")[0]}, the template`, snap };
    }
    return {
      snap,
      st: {
        bar: r.bar,
        at_mm: r.at_mm,
        ...(r.groove ? { groove: r.groove } : r.face ? { face: r.face } : {}),
        p: snap.p,
      },
    };
  }

  /** Where the part would go: the station's distance, or the typed one from the nearer end. */
  function placeWhere(
    st: NonNullable<typeof placeState.value.station>,
  ): { from: "a" | "b"; at: number | string; words?: string } | { why: string } {
    const t = typedNow();
    if (t.kind === "empty") return { from: "a", at: st.at_mm };
    if (t.kind !== "value") return { why: t.kind === "error" ? t.why : "type one distance" };
    const bar = model.peek()?.derived.bars[st.bar];
    const from = bar ? placeFrom(st, bar.len_mm) : "a";
    return { from, at: t.written, words: `${typedWords(t)} from end ${from} of ${st.bar}` };
  }

  async function commitPlace(st: NonNullable<typeof placeState.value.station>): Promise<void> {
    const part = palette.peek().part;
    const m = model.peek();
    if (!part) {
      lastResult.value = {
        rev: m?.rev ?? 0,
        created: [],
        error: "no part armed: arm one in the parts bin or the catalog",
      };
      return;
    }
    const w = placeWhere(st);
    if ("why" in w) {
      lastResult.value = { rev: m?.rev ?? 0, created: [], error: w.why };
      return;
    }
    used();
    const o = await sendCommands(
      [placeCommand(part, st, w.from, placeState.peek().roll, w.at)],
      "place part",
      { inline: true },
    );
    noteResult(o);
  }

  const place: ToolHandler = {
    move(e) {
      pointer = e;
      const at = placeAt(e);
      if (!at || "why" in at) {
        placeState.value = { ...placeState.value, station: undefined };
        viewer.setOverlay({});
        show(e, at?.why, at?.snap?.label);
        return;
      }
      placeState.value = { ...placeState.value, station: at.st };
      viewer.setOverlay({ marker: { p: at.snap.p, kind: markerOf(at.snap) } });
      const w = placeWhere(at.st);
      show(
        e,
        "why" in w
          ? `${at.snap.label} · ${w.why}`
          : w.words
            ? `${at.snap.label} · ${w.words}`
            : at.snap.label,
        at.snap.label,
      );
    },
    click(e) {
      const at = placeAt(e);
      if (!at || "why" in at) return;
      void commitPlace(at.st);
    },
    leave() {
      hint.value = undefined;
      placeState.value = { ...placeState.value, station: undefined };
    },
  };

  // -- Pattern ----------------------------------------------------------------------------------

  const pattern: ToolHandler = {
    move(e) {
      pointer = e;
      const hit = viewer.pickAt(e.clientX, e.clientY);
      const copy = hit?.id.includes("@") ? hit.id : undefined;
      const along = hit && !copy && hit.id.startsWith("b") ? hit.id : undefined;
      show(
        e,
        along
          ? `along ${along}`
          : copy
            ? `${copy} is a copy: repeat along ${copy.split("@")[0]}, its template`
            : undefined,
        along ? `bar ${along}` : undefined,
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
    frame,
    connect,
    place,
    pattern,
    measure,
  };
  function handler(): ToolHandler | undefined {
    return handlers[activeTool.peek()];
  }

  const offTool = activeTool.subscribe((t) => {
    drawState.value = {};
    typed.value = "";
    current = undefined;
    flip = undefined;
    framePointer = {};
    clearJoint();
    viewer.setLabel("frame", undefined);
    pickingPlane.value = false;
    hint.value = undefined;
    lastResult.value = undefined;
    if (drawOptions.peek().lock) drawOptions.value = { ...drawOptions.peek(), lock: undefined };
    viewer.setOverlay({});
    viewer.setHighlight(new Set());
    if (t !== "connect") {
      connectPicks.value = [];
      if (pivotOptions.value.base) pivotOptions.value = { ...pivotOptions.value, base: undefined };
    }
    if (t === "pattern")
      patternState.value = { ...patternState.value, template: [...selection.value].sort() };
    if (t !== "measure") measureState.value = {};
    if (t !== "frame") frameDraft.value = { w: "", d: "", h: "" };
    if (t !== "place") placeState.value = { ...placeState.value, station: undefined };
    viewer.setTool(handlers[t]);
  });

  // What is typed moves the preview, pointer or not.
  const offTyped = typed.subscribe(() => refresh());
  const offFrame = frameDraft.subscribe(() => {
    if (activeTool.peek() === "frame") framePreview(pointer);
  });

  /** Whether the active tool takes a value from the command bar now (D-UX-17). */
  function takesValue(ch: string): boolean {
    switch (activeTool.peek()) {
      case "draw":
        return drawState.peek().start !== undefined || ch === "[" || ch === "=";
      case "place":
        return ch !== "[";
      case "frame":
        return frameStage(frameDraft.peek()) === "corner" ? ch === "[" || ch === "=" : ch !== "[";
      default:
        return false;
    }
  }

  /** Esc, one level back in the active tool's gesture (D-UX-18). */
  function back(): boolean {
    if (typed.peek()) {
      used();
      return true;
    }
    switch (activeTool.peek()) {
      case "draw":
        return drawBack();
      case "frame":
        return frameBack();
      case "connect": {
        const picks = connectPicks.value;
        if (picks.length > 0) {
          connectPicks.value = picks.slice(0, -1);
          return true;
        }
        if (pivotOptions.value.base) {
          pivotOptions.value = { ...pivotOptions.value, base: undefined };
          return true;
        }
        return false;
      }
      case "measure": {
        const { a, b } = measureState.value;
        if (b) measureState.value = { a };
        else if (a) measureState.value = {};
        else return false;
        return true;
      }
      default:
        return false;
    }
  }

  /** Enter in the active tool: what is typed, or the gesture's next step. */
  function enter(): boolean {
    switch (activeTool.peek()) {
      case "draw":
        return drawEnter();
      case "frame":
        return frameEnter();
      case "place": {
        const st = placeState.peek().station;
        if (!st) {
          if (typed.peek())
            lastResult.value = {
              rev: model.peek()?.rev ?? 0,
              created: [],
              error: "point at a face of a bar, then press Enter",
            };
          return typed.peek() !== "";
        }
        void commitPlace(st);
        return true;
      }
      default:
        return false;
    }
  }

  /** A key the active tool's gesture takes, outside the command bar's field. */
  function gestureKey(e: KeyboardEvent): boolean {
    if (e.key === "Escape") return back();
    if (e.key === "Enter") return enter();
    if (e.key.length === 1 && VALUE_START.test(e.key) && takesValue(e.key)) {
      typed.value = e.key === "=" ? "" : e.key;
      fieldWanted.value++;
      return true;
    }
    if (activeTool.peek() === "draw") return drawKey(e);
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
    describeKeys({
      id: "drawing",
      title: "While drawing",
      order: 20,
      rows: [
        { keys: ["0–9", "Enter"], does: "Type a length (W / 2 + 20, 1.2m, -300) and draw the bar" },
        { keys: ["="], does: "Start typing an expression that begins with a param" },
        { keys: ["[", "Enter"], does: "Type a point, [x, y, z]: where the bar starts or ends" },
        { keys: ["Enter"], does: "With nothing started, start at the selected corner or point" },
        { keys: ["→", "←", "↑"], does: "Lock the line to X, Y or Z (again, or ↓, to free it)" },
        { keys: ["Space"], does: "Draw the next bar from the last one's end" },
        { keys: ["Tab"], does: "Flip the previewed joint: which bar runs through" },
        { keys: ["R"], does: "Roll the profile 90°" },
        { keys: ["A"], does: "Next anchor on the section" },
        { keys: ["W"], does: "Pick a face as the work plane" },
        { keys: ["Shift"], does: "Hold to draw off the axes" },
        { keys: ["1000, 600", "Enter"], does: "Box frame: the width and depth, then the height" },
      ],
    }),
  ];

  return {
    dispose() {
      for (const off of offKeys) off();
      offModel();
      offPicks();
      offPivot();
      offPalette();
      offTool();
      offTyped();
      offFrame();
      clearJoint();
      viewer.setLabel("frame", undefined);
      viewer.setTool(undefined);
    },
    fieldKey(e) {
      if (e.key === "Enter") return enter();
      if (e.key === "Escape") return back();
      if (e.key === "Tab" && !e.shiftKey && jointPreview.peek()) {
        void flipJoint();
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
