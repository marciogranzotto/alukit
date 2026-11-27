import { idList } from "#core/commands/words.ts";
import type { V3 } from "../../mesh/model.ts";
import type { GhostBar, MarkerKind } from "../../viewer/overlay.ts";
import type { Grab, ToolHandler, ToolPointer, Viewer } from "../../viewer/scene.ts";
import { rayLineParams, type Snap, type SnapTargets } from "../../viewer/snap.ts";
import { rayPlane } from "../../viewer/workplane.ts";
import { select, selection } from "../focus.ts";
import type { Model } from "../model.ts";
import { model } from "../store.ts";
import type { GestureSpec, Gestures } from "./drag.ts";
import {
  MOVE_LOCKS,
  type MoveSet,
  moveCommands,
  moveSet,
  moveWords,
  type Offset,
  offsetOf,
  slideAxis,
  typedOffset,
  UNIT,
} from "./moves.ts";
import { createPreviewer } from "./preview.ts";
import { drawOptions, gesture, hint, lastResult, typed, workPlane } from "./state.ts";

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
 */

/** At most this many moved bars are drawn as ghosts; the rest show by the marker and the line. */
const MAX_GHOSTS = 48;

export interface MoveTool {
  handler: ToolHandler;
  grab: Grab;
  /** A value key with the tool on and a selection: a move from the keyboard, base at its centre. */
  startFromKeyboard(): boolean;
  dispose(): void;
}

export interface MoveDeps {
  /** The snap under the pointer, in targets the filter keeps. */
  snap(e: ToolPointer, filter?: (t: SnapTargets) => SnapTargets): Snap | undefined;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const num = (x: number) => (Math.round(x * 100) / 100).toString();

/** The centre of what a set moves: its bars' ends, its parts' and points' positions. */
function centreOf(m: Model, set: MoveSet): V3 {
  const pts: V3[] = [];
  for (const b of set.bars) {
    const bar = m.derived.bars[b];
    if (bar) pts.push(bar.ends.a.point, bar.ends.b.point);
  }
  for (const n of set.nodes) {
    const p = m.derived.nodes[n];
    if (p) pts.push(p);
  }
  for (const p of set.parts) {
    const at = m.derived.parts[p]?.point ?? m.derived.parts[p]?.origin;
    if (at) pts.push(at);
  }
  if (pts.length === 0) return [0, 0, 0];
  const s = pts.reduce((acc, p) => add(acc, p), [0, 0, 0] as V3);
  return scale(s, 1 / pts.length);
}

/** Each moved bar as a ghost, offset by `d`. */
function ghostsOf(m: Model, set: MoveSet, d: V3): GhostBar[] {
  const out: GhostBar[] = [];
  for (const id of set.bars.slice(0, MAX_GHOSTS)) {
    const b = m.derived.bars[id];
    const view = m.display.bars[id];
    const section = view ? m.display.sections[view.section] : undefined;
    if (!b || !view || !section) continue;
    const a = b.ends.a.point;
    const bp = b.ends.b.point;
    out.push({
      section,
      x: b.frame.x,
      y: b.frame.y,
      t: b.frame.z,
      a: add(a, d),
      len: norm(sub(bp, a)),
      shift: view.shift,
    });
  }
  return out;
}

export function createMoveTool(viewer: Viewer, gestures: Gestures, deps: MoveDeps): MoveTool {
  const preview = createPreviewer(
    viewer,
    () => gesture.peek()?.kind === "move",
    () => drawOptions.peek().prefer,
  );

  function spec(m: Model, set: MoveSet, base: V3): GestureSpec {
    const slide = slideAxis(m, set);
    let lock: "x" | "y" | "z" | undefined;
    let way: V3 | undefined;
    let now: Offset = offsetOf([0, 0, 0]);
    let why: string | undefined;
    let detach = false;
    let label = "";
    const moving = new Set([...set.bars, ...set.parts]);
    /** What the moved set is not: its own ends and faces are no place to move to. */
    const others = (t: SnapTargets): SnapTargets => ({
      points: t.points.filter((p) => {
        const r = p.ref as { bar?: string; part?: string };
        return !moving.has((r.bar ?? r.part ?? "").split("@")[0] ?? "");
      }),
      lines: t.lines.filter((l) => !moving.has(l.bar.split("@")[0] ?? "")),
    });
    const title = `Move ${idList(set.ids)}`;
    const axisU = (): V3 | undefined => (lock ? UNIT[lock] : slide?.u);

    function draw(): void {
      const d = now.d;
      const dest = add(base, d);
      const snapped = label !== "" && label !== "free" && label !== "typed";
      const kind: MarkerKind = snapped ? "point" : "free";
      viewer.setOverlay({
        ghosts: ghostsOf(m, set, d),
        line: norm(d) > 0 ? { a: base, b: dest } : undefined,
        marker: { p: dest, kind },
        ...(lock ? { guide: { through: base, axis: lock } } : {}),
      });
      const dist = norm(d);
      const reading =
        why ??
        `by [${now.written.map((x) => (typeof x === "number" ? num(x) : x)).join(", ")}] · ${num(dist)} mm`;
      gesture.value = {
        kind: "move",
        title,
        prompt: lock
          ? `along ${lock.toUpperCase()}: drag, or type the distance`
          : slide
            ? `along ${slide.bar}: drag, or type the distance`
            : "drag, or type a distance, x, y, z or [x, y, z]",
        reading: `${reading}${detach ? " · detached (Alt)" : ""}`,
        snap: label,
      };
      if (why || dist < 0.005) {
        preview.ask(undefined);
        return;
      }
      preview.ask({
        commands: (prefer) => moveCommands(set, now.written, detach, prefer ?? rule()),
        at: dest,
        soon: snapped || label === "typed",
        words: (r) => moveWords(r, detach),
      });
    }
    const rule = () => preview.flipped ?? drawOptions.peek().prefer;

    return {
      kind: "move",
      update(e) {
        if (e) detach = e.altKey;
        why = undefined;
        const text = typed.peek();
        if (text.trim() !== "") {
          const o = typedOffset(text, m.derived.params, base, axisU() ?? way);
          if (o && "why" in o) why = o.why;
          else if (o) now = o;
          label = "typed";
        } else if (e) {
          const ray = viewer.ray(e.clientX, e.clientY);
          const u = axisU();
          const sn = e.shiftKey ? undefined : deps.snap(e, others);
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
        if (norm(now.d) < 0.005) return "nothing";
        return {
          commands: moveCommands(set, now.written, detach, rule()),
          what: `move ${idList(set.ids)}`,
        };
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
      stop() {
        preview.reset();
        viewer.setOverlay({});
        hint.value = undefined;
      },
    };
  }

  /** Starts a move of `ids` from `base`. */
  function begin(ids: Iterable<string>, base: V3 | undefined, e: ToolPointer | undefined): boolean {
    const m = model.peek();
    if (!m) return false;
    const set = moveSet(m, ids);
    if ("why" in set) {
      lastResult.value = { rev: m.rev, created: [], error: set.why };
      return false;
    }
    // The hover hint gives way to the gesture's own words.
    hint.value = undefined;
    gestures.start(spec(m, set, base ?? centreOf(m, set)), e, e !== undefined);
    return true;
  }

  const grab: Grab = {
    press(e) {
      if (gestures.live()) return gestures.press(e);
      const hit = viewer.pickAt(e.clientX, e.clientY);
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
      return begin(ids, at, e);
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

  return {
    handler,
    grab,
    startFromKeyboard() {
      if (gestures.live() || selection.peek().size === 0) return false;
      return begin(selection.peek(), undefined, undefined);
    },
    dispose() {
      preview.reset();
    },
  };
}
