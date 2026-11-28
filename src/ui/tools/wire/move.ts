import { idList } from "#core/commands/words.ts";
import type { V3 } from "../../../mesh/model.ts";
import type { GizmoPart, GizmoSpec } from "../../../viewer/gizmo.ts";
import type { MarkerKind } from "../../../viewer/overlay.ts";
import type { Grab, Hit, ToolHandler, ToolPointer, Viewer } from "../../../viewer/scene.ts";
import { rayLineParams, type Snap, type SnapTargets } from "../../../viewer/snap.ts";
import { rayPlane } from "../../../viewer/workplane.ts";
import { duplicateBatch, transformBatch } from "../../edit/batches.ts";
import {
  centreOf,
  ghostsOf,
  splitCopies,
  stretchedGhosts,
  translation,
} from "../../edit/geometry.ts";
import { crossedEnds, select, selection } from "../../focus.ts";
import { chord, describeKeys, onKey } from "../../keys.ts";
import type { Model } from "../../model.ts";
import { model } from "../../store.ts";
import type { GestureSpec, Gestures } from "../drag.ts";
import {
  copyWords,
  MOVE_LOCKS,
  type MoveSet,
  moveSet,
  moveWords,
  type Offset,
  offsetOf,
  slideAxis,
  typedOffset,
  UNIT,
} from "../moves.ts";
import { createPreviewer } from "../preview.ts";
import { activeTool, drawOptions, gesture, hint, lastResult, typed, workPlane } from "../state.ts";
import { VALUE_START } from "./common.ts";

/**
 * The Move tool, `D` (docs/ux/drag-ends-decisions.md, "The Move tool"; SketchUp's Move): the
 * selection, or what is pressed, moves by a drag (press, drag, release) or by two clicks (a base
 * point, then where it goes), on the drag machinery the end handles use (`drag.ts`). The base
 * point snaps to what is under the pointer, and so does where it goes: ends, faces, grooves,
 * parts' points; Shift moves freely in a plane parallel to the work plane. `→ ← ↑` lock X, Y or Z.
 * A value typed meanwhile is the distance along the lock or the way the pointer went (`200`), the
 * offset (`0, 200, 0`) or where the base point goes (`[0, 0, H]`). Parts alone on one bar slide
 * along it. The moved bars are drawn where they would be; after a snap or a pause a dry run of the
 * step says what follows, frees or joins. The release is one step: `transform`, then an
 * `autoConnect` at each moved bar's end. Joined ends follow (the default); Alt frees them.
 *
 * The same session moves a copy (docs/ux/e3-decisions.md; the editing audit's E3.3–E3.5, E3.7):
 * - **Duplicate** (Ctrl/Cmd+D) starts from the original's place: the first click on a snap is the
 *   base point (point to point), the next where the copy goes; `4x` typed after the offset makes
 *   four copies at that spacing, `/4` divides it into four. The step is one `array`, with a join
 *   at each new bar's ends, and the copies are selected after it.
 * - **Paste** (Ctrl/Cmd+V) is a Duplicate whose base is set already: the copied selection's
 *   lowest corner, hanging from the pointer, so the first click places it.
 * - **A part selected alone**, in Select, shows the gizmo's arrow along its bar (when the bar runs
 *   along a world axis); dragging the arrow slides it along the bar, a typed distance too.
 * Owner: E3.
 */

export interface MoveTool {
  handler: ToolHandler;
  grab: Grab;
  /** A value key with the tool on and a selection: a move from the keyboard, base at its centre. */
  startFromKeyboard(): boolean;
  /**
   * A Move session on a copy of `ids` (Duplicate, Paste): from `base` (the selection's centre
   * when absent), with the base already chosen (`based`, Paste) or chosen by the first click.
   */
  startCopy(ids: Iterable<string>, how: CopyHow, e?: ToolPointer): boolean;
  dispose(): void;
}

export interface CopyHow {
  title: string;
  base?: V3;
  based: boolean;
}

export interface MoveDeps {
  /** The snap under the pointer, in targets the filter keeps. */
  snap(e: ToolPointer, filter?: (t: SnapTargets) => SnapTargets): Snap | undefined;
  /** The body under the pointer, passing over what the view hides. */
  pick(e: ToolPointer): Hit | undefined;
}

/** A move on: the gesture, and what a gizmo's arrow tells it. */
interface MoveSpec extends GestureSpec {
  /** An arrow dragged: the world offset from its press. */
  dragged(delta: V3 | undefined): void;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const num = (x: number) => (Math.round(x * 100) / 100).toString();

/** The axis a world unit vector runs along, if it does. */
function worldAxis(u: V3): "x" | "y" | "z" | undefined {
  const k = [0, 1, 2].find((i) => Math.abs(Math.abs(u[i] as number) - 1) < 1e-9);
  return k === undefined ? undefined : (["x", "y", "z"] as const)[k];
}

export function createMoveTool(viewer: Viewer, gestures: Gestures, deps: MoveDeps): MoveTool {
  const preview = createPreviewer(
    viewer,
    () => {
      const k = gesture.peek()?.kind;
      return k === "move" || k === "duplicate";
    },
    () => drawOptions.peek().prefer,
  );

  function spec(m: Model, set: MoveSet, start: V3, copy?: CopyHow): MoveSpec {
    const slide = slideAxis(m, set);
    let base = start;
    let based = copy ? copy.based : true;
    let lock: "x" | "y" | "z" | undefined;
    let way: V3 | undefined;
    let now: Offset = offsetOf([0, 0, 0]);
    let why: string | undefined;
    let detach = false;
    let label = "";
    let arrow: V3 | undefined;
    let copies: { count?: number; divide?: number } = {};
    const moving = new Set([
      ...set.bars,
      ...set.parts,
      ...(set.ends ?? []).map((x) => x.split(".")[0] as string),
    ]);
    /** What the moved set is not: its own ends and faces are no place to move to. */
    const others = (t: SnapTargets): SnapTargets => ({
      points: t.points.filter((p) => {
        const r = p.ref as { bar?: string; part?: string };
        return !moving.has((r.bar ?? r.part ?? "").split("@")[0] ?? "");
      }),
      lines: t.lines.filter((l) => !moving.has(l.bar.split("@")[0] ?? "")),
    });
    const kind = copy ? "duplicate" : "move";
    const title = copy ? `${copy.title} ${idList(set.ids)}` : `Move ${idList(set.ids)}`;
    const axisU = (): V3 | undefined => (lock ? UNIT[lock] : slide?.u);
    const rule = () => preview.flipped ?? drawOptions.peek().prefer;
    /** A copy's step with a corner rule (Tab's, else the gesture's), or why it cannot be built. */
    const copyBatch = (prefer = rule()) =>
      duplicateBatch(m, set.ids, [now.d[0], now.d[1], now.d[2]], { ...copies, prefer });

    function prompt(): string {
      if (copy && !based) return "click a base point, or drag; or type an offset, then 4x or /4";
      if (lock) return `along ${lock.toUpperCase()}: drag, or type the distance`;
      if (slide) return `along ${slide.bar}: drag, or type the distance`;
      return copy
        ? "click where the copy goes, or type x, y, z; then 4x for more, /4 to divide"
        : "drag, or type a distance, x, y, z or [x, y, z]";
    }

    function draw(): void {
      const d = now.d;
      const dest = add(base, d);
      const snapped = label !== "" && label !== "free" && label !== "typed" && !arrow;
      const markerKind: MarkerKind = snapped ? "point" : "free";
      const steps = copy ? (copies.divide ?? copies.count ?? 1) : 1;
      const pitch = copy && copies.divide ? scale(d, 1 / copies.divide) : d;
      const ghosts = copy
        ? Array.from({ length: Math.min(steps, 24) }, (_, i) =>
            ghostsOf(m, set.bars, translation(scale(pitch, i + 1)), 48),
          ).flat()
        : [
            ...ghostsOf(m, set.bars, translation(d)),
            ...stretchedGhosts(m, set.ends ?? [], d),
          ].slice(0, 48);
      viewer.setOverlay({
        ghosts: ghosts.slice(0, 96),
        line: norm(d) > 0 ? { a: base, b: dest } : undefined,
        marker: { p: dest, kind: markerKind },
        ...(lock ? { guide: { through: base, axis: lock } } : {}),
      });
      const dist = norm(d);
      const many = copy
        ? copies.divide
          ? ` · ${copies.divide} copies, ${num(dist / copies.divide)} apart`
          : copies.count
            ? ` · ${copies.count} copies`
            : ""
        : "";
      const reading =
        why ??
        `by [${now.written.map((x) => (typeof x === "number" ? num(x) : x)).join(", ")}] · ${num(dist)} mm${many}`;
      gesture.value = {
        kind,
        title,
        prompt: prompt(),
        reading: `${reading}${detach && !copy ? " · detached (Alt)" : ""}`,
        snap: label,
      };
      if (why || dist < 0.005) {
        preview.ask(undefined);
        return;
      }
      const soon = snapped || label === "typed";
      if (copy) {
        preview.ask({
          commands: (prefer) => {
            const b = copyBatch(prefer ?? rule());
            return "why" in b ? undefined : b;
          },
          at: dest,
          soon,
          words: copyWords,
        });
        return;
      }
      preview.ask({
        commands: (prefer) =>
          transformBatch(set, now.written, detach, prefer ?? rule(), { m, by: now.d }),
        at: dest,
        soon,
        words: (r) => moveWords(r, detach),
      });
    }

    return {
      kind,
      update(e) {
        if (e) detach = e.altKey;
        why = undefined;
        let text = typed.peek();
        copies = {};
        if (copy) {
          const c = splitCopies(text, m.derived.params);
          if ("why" in c) {
            why = c.why;
            text = "";
          } else {
            text = c.rest;
            copies = {
              ...(c.count !== undefined ? { count: c.count } : {}),
              ...(c.divide !== undefined ? { divide: c.divide } : {}),
            };
          }
        }
        if (text.trim() !== "") {
          const o = typedOffset(text, m.derived.params, base, axisU() ?? way);
          if (o && "why" in o) why = o.why;
          else if (o) now = o;
          label = "typed";
        } else if (arrow) {
          // An arrow dragged: along it, in whole millimetres, from the press.
          const u = axisU();
          const s = u ? dot(arrow, u) : 0;
          now = offsetOf(u ? scale(u, Math.round(s)) : [0, 0, 0]);
          label = `along ${slide?.bar ?? lock ?? ""}`;
        } else if (e) {
          const ray = viewer.ray(e.clientX, e.clientY);
          const u = axisU();
          const sn = e.shiftKey ? undefined : deps.snap(e, copy ? undefined : others);
          let d: V3;
          if (u) {
            // Along the lock: what is snapped, or the pointer's ray, read on the axis (§4.4).
            const s = sn ? dot(sub(sn.p, base), u) : rayLineParams(ray, base, u).s;
            d = scale(u, sn ? s : Math.round(s));
            label = sn ? sn.label : `along ${lock ? lock.toUpperCase() : slide?.bar}`;
          } else if (sn) {
            d = sub(sn.p, base);
            label = sn.label;
          } else {
            const p = rayPlane(ray, { origin: base, n: workPlane.peek().n });
            d = p ? (sub(p, base).map((x) => Math.round(x)) as unknown as V3) : now.d;
            label = "free";
          }
          now = offsetOf(d);
          if (norm(d) > 0.5) way = scale(d, 1 / norm(d));
        }
        draw();
      },
      commit() {
        if (why) return { why };
        if (copy && !based && norm(now.d) < 0.005) {
          return { why: "click a base point, then where the copy goes, or type an offset" };
        }
        if (norm(now.d) < 0.005) return "nothing";
        if (copy) {
          const b = copyBatch();
          if ("why" in b) return b;
          return { commands: b, what: `copy ${idList(set.ids)}` };
        }
        return {
          commands: transformBatch(set, now.written, detach, rule(), { m, by: now.d }),
          what: `move ${idList(set.ids)}`,
        };
      },
      press(e) {
        // Duplicate: the first click is the base point (point to point, E3.5), the next commits.
        if (!copy || based) return undefined;
        const sn = deps.snap(e);
        const hit = sn ? undefined : deps.pick(e);
        base =
          sn?.p ?? hit?.p ?? rayPlane(viewer.ray(e.clientX, e.clientY), workPlane.peek()) ?? base;
        based = true;
        now = offsetOf([0, 0, 0]);
        way = undefined;
        return "drag";
      },
      done(o) {
        // The copies are what a person works on next: they are selected.
        if (copy && o.ok) {
          const made = o.created.filter((id) => /^(b|p|n)\d+$/.test(id));
          if (made.length > 0) select(made, "replace");
        }
      },
      key(e) {
        const axis = MOVE_LOCKS[e.key];
        if (axis || e.key === "ArrowDown") {
          lock = axis && lock !== axis ? axis : undefined;
          this.update(undefined);
          return true;
        }
        return false;
      },
      flip() {
        void preview.flip();
      },
      dragged(delta) {
        arrow = delta;
        this.update(undefined);
      },
      stop() {
        preview.reset();
        viewer.setOverlay({});
        hint.value = undefined;
        live = undefined;
        restArrow();
      },
    };
  }

  /** The move on now, while its gesture is. */
  let live: MoveSpec | undefined;

  /** Starts a move of `ids` from `base`, or a copy's. */
  function begin(
    ids: Iterable<string>,
    base: V3 | undefined,
    e: ToolPointer | undefined,
    held: boolean,
    copy?: CopyHow,
  ): boolean {
    const m = model.peek();
    if (!m) return false;
    // The selection a crossing box made stretches the bars it held in part; a copy is whole.
    const sel = selection.peek();
    const set = moveSet(m, ids, !copy && ids === sel ? crossedEnds(sel) : undefined);
    if ("why" in set) {
      const why = copy ? set.why.replace("to move", "to copy") : set.why;
      lastResult.value = { rev: m.rev, created: [], error: why };
      return false;
    }
    // The hover hint gives way to the gesture's own words.
    hint.value = undefined;
    const s = spec(m, set, base ?? centreOf(m, set), copy);
    live = s;
    gestures.start(s, e, held);
    return true;
  }

  // A part selected alone, in Select: the gizmo's arrow along its bar (E3.7).
  let arrowShown: GizmoSpec | undefined;
  function restArrow(): void {
    // A move of this tool's on (the arrow's own slide among them) leaves the arrow as it is.
    if (live) return;
    const m = model.peek();
    const sel = selection.peek();
    let want: GizmoSpec | undefined;
    // Another gesture on (a Mirror, a Duplicate) takes the arrow away until it ends.
    if (m && !gesture.peek() && activeTool.peek() === "select" && sel.size > 0) {
      const set = moveSet(m, sel);
      const slide = "why" in set ? undefined : slideAxis(m, set);
      const k = slide ? worldAxis(slide.u) : undefined;
      if (k && !("why" in set)) want = { at: centreOf(m, set), parts: [`move-${k}` as GizmoPart] };
    }
    if (want) {
      arrowShown = want;
      viewer.setGizmo(want);
    } else {
      if (arrowShown && viewer.gizmo() === arrowShown) viewer.setGizmo(undefined);
      arrowShown = undefined;
    }
  }
  const offGizmo = viewer.onGizmoDrag((g) => {
    if (!arrowShown || activeTool.peek() !== "select" || !g.part.startsWith("move-")) return;
    if (g.phase === "start") {
      const at = "at" in arrowShown ? arrowShown.at : undefined;
      if (!live && !begin(selection.peek(), at, undefined, false)) return;
      live?.dragged([0, 0, 0]);
      return;
    }
    if (g.phase === "move") {
      live?.dragged(g.delta);
      return;
    }
    // A drag commits where it let go; a click on the arrow leaves the slide on, to type the
    // distance or click where it goes. Either way the pointer steers from here.
    if (norm(g.delta) >= 0.5) {
      live?.dragged(g.delta);
      gestures.enter();
    }
    live?.dragged(undefined);
  });

  const grab: Grab = {
    press(e) {
      if (gestures.live()) return gestures.press(e);
      const hit = deps.pick(e);
      const sel = selection.peek();
      let ids: Iterable<string> = sel;
      if (hit && !sel.has(hit.id)) {
        // SketchUp's Move takes what is under the pointer when it is not selected.
        select([hit.id], "replace");
        ids = [hit.id];
      }
      if (!hit && sel.size === 0) return false;
      const base = deps.snap(e)?.p ?? hit?.p ?? undefined;
      const at = base ?? rayPlane(viewer.ray(e.clientX, e.clientY), workPlane.peek());
      return begin(ids, at, e, true);
    },
    move(e, held) {
      gestures.pointer(e, held);
    },
    release(e) {
      gestures.release(e);
    },
    busy: () => gestures.live(),
  };

  const handler: ToolHandler = {
    move(e) {
      if (gestures.live()) {
        gestures.pointer(e, false);
        return;
      }
      const n = selection.peek().size;
      hint.value = {
        x: e.clientX,
        y: e.clientY,
        text:
          n > 0
            ? "drag to move the selection, or click a base point; Alt frees what joins it"
            : "drag a bar or a part to move it",
      };
    },
    leave() {
      if (!gestures.live()) hint.value = undefined;
    },
  };

  function startFromKeyboard(): boolean {
    if (gestures.live() || selection.peek().size === 0) return false;
    return begin(selection.peek(), undefined, undefined, false);
  }

  /**
   * Move with a selection and no drag on: a value typed moves it from the keyboard (D-UX-17), and
   * an arrow lock starts the move with that axis locked (docs/ux/polish-editing-decisions.md, as
   * Rotate's X, Y and Z start a turn, e3 2), so D, ↑, 150, Enter moves 150 up. Asked above the
   * drag's own keys (wiring.ts), which take them once the move is on, and in the capture phase
   * with the focus on an element (`starting`), so the outline's row does not take the arrows.
   */
  const startKey = (e: KeyboardEvent): boolean =>
    !chord(e) &&
    activeTool.peek() === "move" &&
    !gestures.live() &&
    ((e.key.length === 1 && VALUE_START.test(e.key)) || MOVE_LOCKS[e.key] !== undefined) &&
    startFromKeyboard() &&
    gestures.key(e);

  const offKeys = [
    selection.subscribe(restArrow),
    model.subscribe(restArrow),
    activeTool.subscribe(restArrow),
    gesture.subscribe(restArrow),
    onKey("tool", startKey, 51),
    gestures.starting(startKey),
    describeKeys({
      id: "moving",
      title: "While moving (D)",
      order: 15,
      rows: [
        {
          keys: ["D"],
          does: "Move: drag the selection or a bar, or click a base point, then where it goes",
        },
        {
          keys: ["0–9", "Enter"],
          does: "Type the distance (along the lock or the way you dragged), x, y, z, or [x, y, z]",
        },
        {
          keys: ["→", "←", "↑"],
          does: "Lock the move to X, Y or Z, starting it with a selection (again, or ↓, to free it)",
        },
        { keys: ["Shift"], does: "Hold to move freely, snapping to nothing" },
        {
          keys: ["Alt"],
          does: "Hold to free what joins the selection to the rest, instead of it following",
        },
        { keys: ["Tab"], does: "Flip the previewed joint where a moved end lands on a bar" },
        {
          keys: ["4x", "/4"],
          does: "While duplicating: after the offset, four copies at that spacing, or four gaps",
        },
      ],
    }),
  ];

  return {
    handler,
    grab,
    startFromKeyboard,
    startCopy(ids, how, e) {
      if (gestures.live()) gestures.cancel();
      return begin(ids, how.base, e, false, how);
    },
    dispose() {
      offGizmo();
      for (const off of offKeys) off();
      preview.reset();
      if (arrowShown && viewer.gizmo() === arrowShown) viewer.setGizmo(undefined);
    },
  };
}
