import type { CornerRule } from "#core/project/schema.ts";
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
} from "../../../viewer/draw.ts";
import type { ToolHandler, ToolPointer } from "../../../viewer/scene.ts";
import { q, type Snap } from "../../../viewer/snap.ts";
import { facePlane, GROUND, gridSnap, rayFace } from "../../../viewer/workplane.ts";
import type { DryRun } from "../../client/dryrun.ts";
import { cornerKey, cornersOf } from "../../corners.ts";
import { selection } from "../../focus.ts";
import { describeKeys } from "../../keys.ts";
import { palette } from "../../palette.ts";
import { model, sendCommands } from "../../store.ts";
import { type JointWords, jointWords, touchesBars } from "../joint.ts";
import { type Cmd, createPreviewer } from "../preview.ts";
import {
  activeTool,
  drawOptions,
  drawState,
  hint,
  jointPreview,
  lastResult,
  pickingPlane,
  typed,
  workPlane,
} from "../state.ts";
import {
  add,
  fmt,
  len3,
  markerOf,
  noteResult,
  refuse,
  sub,
  typedPoint,
  type Wire,
  type WireContext,
} from "./common.ts";

/**
 * Draw bar, `B` (design §8, Tools; D-UX-17, D-UX-18): a click starts a bar at the snap under the
 * pointer, and the next click, or a typed length along the way the pointer went (or the locked
 * axis), or a typed point, ends it; the step is the bar and an `autoConnect` at each end, which
 * the joint preview dry-runs first and Tab flips. The arrow keys lock the axis; Space chains the
 * next bar from the last end; R rolls the profile, A takes the next anchor, W picks a face as the
 * work plane. Owner: E3.
 */

/** Enter on a typed length with neither a pointer direction nor a locked axis (review M2). */
export const NO_DIRECTION = "Which way? Point, or press → ← ↑";

export function createDrawTool(ctx: WireContext): Wire {
  const { viewer, show, refresh, used, typedNow, snapAt, rayAt } = ctx;

  /** The snap under the pointer before the gesture starts. */
  let current: Snap | undefined;
  /** The last bar's end b, which Space chains the next bar from (U29). */
  let lastEnd: DrawPoint | undefined;
  /**
   * The joint preview (S5.6), shared with the end handles and Move (preview.ts): the gesture
   * dry-run when it rests or snaps, its words by the end; Tab flips the rule for this gesture.
   */
  const joint = createPreviewer(
    viewer,
    () => activeTool.peek() === "draw",
    () => drawOptions.peek().prefer,
  );

  /** The rule the gesture's joints follow: Tab's, else the command bar's, else the project's. */
  const preferNow = (): CornerRule | undefined => joint.flipped ?? drawOptions.peek().prefer;

  /** W: the next click on a bar sets the work plane to the face it hits (§8, review m11). */
  function pickPlane(e: ToolPointer): void {
    const m = model.value;
    const hit = viewer.pickAt(e.clientX, e.clientY);
    const bar = hit && m ? m.derived.bars[hit.id] : undefined;
    const face = bar ? rayFace(rayAt(e), bar) : undefined;
    workPlane.value = bar && face && hit ? facePlane(bar, hit.id, face.face) : GROUND;
    pickingPlane.value = false;
  }

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

  /** The gesture's batch, as it would commit now (with a corner rule: as Tab would flip it). */
  function gestureCommands(
    end: DrawEnd,
    prefer: CornerRule | undefined = preferNow(),
  ): Cmd[] | undefined {
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
      prefer,
    });
  }

  /** What the drawn bar's dry run says: who runs through and which cuts move (joint.ts). */
  function drawnWords(r: DryRun): JointWords | undefined {
    if (!r.ok) return undefined;
    const bar = r.created.find((id) => /^b\d+$/.test(id));
    if (!bar) return undefined;
    const w = jointWords(r, bar);
    // Nothing joins and nothing moves: open space, nothing to say.
    if (!w.joins && Object.keys(r.effects.cuts).length === 0) return undefined;
    return w;
  }

  function scheduleJoint(end: DrawEnd | undefined): void {
    const start = drawState.peek().start;
    const m = model.peek();
    // Open space: neither point of the stroke is where autoConnect could join, so its dry run
    // would say nothing (joint.ts, touchesBars). Judged by where the points are, not how the end
    // was found: a typed or grid end can land on a bar's end without snapping to it.
    const open = !m || !start || !end || !(touchesBars(m, start.p) || touchesBars(m, end.p));
    if (!end || open || !drawOptions.peek().autoConnect) {
      joint.ask(undefined);
      return;
    }
    joint.ask({
      commands: (prefer) => gestureCommands(end, prefer ?? preferNow()),
      at: end.p,
      soon: end.how === "snap" || end.how === "meet",
      words: drawnWords,
    });
  }

  function drawPreview(e: ToolPointer | undefined): void {
    const { start, end: under } = drawState.value;
    const bar = palette.value.bar;
    const o = drawOptions.value;
    const t = typedNow();
    const end = drawEnd();
    if (!bar) {
      viewer.setOverlay({});
      joint.ask(undefined);
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
    current = undefined;
    joint.reset();
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

  const handler: ToolHandler = {
    move(e) {
      ctx.track(e);
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
      handler.move?.(e);
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
  function enter(): boolean {
    const { start } = drawState.peek();
    const t = typedNow();
    if (t.kind === "error") {
      refuse(t.why);
      return true;
    }
    if (!start) {
      if (t.kind === "point") {
        used();
        startAt(typedPoint(t));
        return true;
      }
      if (t.kind !== "empty") {
        refuse("click a start point first, or type one as [x, y, z]");
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
        wayNeeded: true,
      };
    }
    return true;
  }

  function key(e: KeyboardEvent): boolean {
    const k = e.key;
    const { start } = drawState.value;
    if (k === "Enter") return enter();
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
      void joint.flip();
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
  function back(): boolean {
    if (pickingPlane.value) {
      pickingPlane.value = false;
      refresh();
      return true;
    }
    if (drawState.value.start || drawOptions.value.lock) {
      drawState.value = {};
      drawOptions.value = { ...drawOptions.value, lock: undefined };
      joint.reset();
      refresh();
      return true;
    }
    return false;
  }

  // A bar without the anchor in use (a rail's `mount` on a T-slot) starts from the centre.
  const offPalette = palette.subscribe((p) => {
    const anchors = p.bar?.anchors ?? ["c"];
    if (!anchors.includes(drawOptions.value.anchor))
      drawOptions.value = { ...drawOptions.value, anchor: "c" };
  });

  const offHelp = describeKeys({
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
  });

  return {
    handler,
    preview: () => drawPreview(undefined),
    back,
    enter,
    key,
    takesValue: (ch) => drawState.peek().start !== undefined || ch === "[" || ch === "=",
    flip: () => void joint.flip(),
    reset() {
      current = undefined;
      joint.reset();
    },
    dispose() {
      offPalette();
      offHelp();
      joint.reset();
    },
  };
}
