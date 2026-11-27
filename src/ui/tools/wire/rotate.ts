import { idList } from "#core/commands/words.ts";
import type { V3 } from "../../../mesh/model.ts";
import type { GizmoPart, GizmoSpec } from "../../../viewer/gizmo.ts";
import type { Grab, Hit, ToolHandler, ToolPointer, Viewer } from "../../../viewer/scene.ts";
import type { Snap } from "../../../viewer/snap.ts";
import { rayPlane } from "../../../viewer/workplane.ts";
import { rotateBatch } from "../../edit/batches.ts";
import { type Axis, centreOf, ghostsOf, snapAngle, turn, typedAngle } from "../../edit/geometry.ts";
import { select, selection } from "../../focus.ts";
import { chord, describeKeys, onKey } from "../../keys.ts";
import type { Model } from "../../model.ts";
import { model } from "../../store.ts";
import type { GestureSpec, Gestures } from "../drag.ts";
import { type MoveSet, moveSet, moveWords } from "../moves.ts";
import { createPreviewer } from "../preview.ts";
import {
  activeTool,
  drawOptions,
  fieldDone,
  gesture,
  hint,
  lastResult,
  typed,
  workPlane,
} from "../state.ts";
import { VALUE_START } from "./common.ts";

/**
 * The Rotate tool, `Q` (docs/ux/editing-audit.md E3.1, E-UX-5, E-UX-24; docs/ux/e3-decisions.md):
 * the selection turns about a world axis through a centre, as one `transform` step. The rings
 * of the gizmo stand at the selection's centre; a click on a snap (an end, a face, a groove, a
 * part's point) is the centre instead (point to point, E3.5), and Enter takes the selection's
 * centre. X, Y or Z (or → ← ↑, as Move locks) choose the axis, Z at first; the angle is typed
 * (`90`, `-45`, `=A / 2`) and Enter commits it, or a ring is dragged, in 15° steps, and the
 * release commits. The selection is drawn turned where it would go; after a typed angle or a
 * rest a dry run says what follows, frees or joins, as Move's preview does. Joined ends follow
 * (`transform`'s default); Alt frees them. Owner: E3.
 */

const RINGS: readonly GizmoPart[] = ["ring-x", "ring-y", "ring-z"];
const AXIS_KEYS: Readonly<Record<string, Axis>> = {
  x: "x",
  y: "y",
  z: "z",
  ArrowRight: "x",
  ArrowLeft: "y",
  ArrowUp: "z",
};
const num = (x: number) => String(Math.round(x * 100) / 100);
const q2 = (p: V3): V3 => p.map((x) => Math.round(x * 100) / 100 || 0) as unknown as V3;

export interface RotateDeps {
  /** The snap under the pointer, passing over what the view hides. */
  snap(e: ToolPointer): Snap | undefined;
  /** The body under the pointer, passing over what the view hides. */
  pick(e: ToolPointer): Hit | undefined;
}

export interface RotateTool {
  handler: ToolHandler;
  grab: Grab;
  /** Enter with no turn on: the centre is the selection's. */
  enter(): boolean;
  dispose(): void;
}

/** A turn on: the gesture, and what the rings and the module tell it. */
interface TurnSpec extends GestureSpec {
  /** A ring dragged: its axis and the angle so far. */
  ring(axis: Axis, deg: number): void;
}

export function createRotateTool(viewer: Viewer, gestures: Gestures, deps: RotateDeps): RotateTool {
  const preview = createPreviewer(
    viewer,
    () => gesture.peek()?.kind === "rotate",
    () => drawOptions.peek().prefer,
  );
  /** The turn on now, while its gesture is. */
  let live: TurnSpec | undefined;
  /** The rings this tool showed, to take away only those. */
  let shown: GizmoSpec | undefined;

  function showRings(at: V3): void {
    shown = { at, parts: RINGS };
    viewer.setGizmo(shown);
  }
  function hideRings(): void {
    if (shown && viewer.gizmo() === shown) viewer.setGizmo(undefined);
    shown = undefined;
  }

  /** What the selection turns, or why it cannot. */
  function setOf(m: Model, ids: Iterable<string>): MoveSet | { why: string } {
    const set = moveSet(m, ids);
    return "why" in set ? { why: set.why.replace("to move", "to turn") } : set;
  }

  /** At rest (no turn on): the rings at the selection's centre, in Rotate, with a selection. */
  function rest(): void {
    if (live) return;
    const m = model.peek();
    const sel = selection.peek();
    if (activeTool.peek() !== "rotate" || !m || sel.size === 0) {
      hideRings();
      return;
    }
    const set = setOf(m, sel);
    if ("why" in set) hideRings();
    else showRings(centreOf(m, set));
  }

  function spec(m: Model, set: MoveSet, start: V3, startLabel: string): TurnSpec {
    let centre = start;
    let label = startLabel;
    let axis: Axis = "z";
    let ringDeg = 0;
    let now = 0;
    let why: string | undefined;
    let detach = false;
    const title = `Rotate ${idList(set.ids)}`;
    const rule = () => preview.flipped ?? drawOptions.peek().prefer;
    const about = () => q2(centre);

    function draw(): void {
      why = undefined;
      now = ringDeg;
      const text = typed.peek();
      if (text.trim() !== "") {
        const t = typedAngle(text, m.derived.params);
        if (t && "why" in t) why = t.why;
        else if (t) now = t.deg;
      }
      showRings(centre);
      viewer.setOverlay({
        ghosts: ghostsOf(m, set.bars, turn(axis, now, centre)),
        marker: { p: centre, kind: "point" },
        guide: { through: centre, axis },
      });
      const where = `about ${axis.toUpperCase()} through [${about().map(num).join(", ")}]`;
      gesture.value = {
        kind: "rotate",
        title,
        prompt:
          "type the angle, or drag a ring; X, Y or Z for the axis; click a snap to move the centre",
        reading: `${why ?? `${num(now)}° ${where}`}${detach ? " · detached (Alt)" : ""}`,
        snap: label,
      };
      if (why || now === 0) {
        preview.ask(undefined);
        return;
      }
      preview.ask({
        commands: (prefer) =>
          rotateBatch(set, { axis, deg: now, about: about() }, detach, prefer ?? rule()),
        at: centre,
        soon: text.trim() !== "",
        words: (r) => moveWords(r, detach),
      });
    }

    return {
      kind: "rotate",
      update(e) {
        if (e) detach = e.altKey;
        draw();
      },
      commit() {
        if (why) return { why };
        if (now === 0) return { why: "type the angle, or drag a ring" };
        return {
          commands: rotateBatch(set, { axis, deg: now, about: about() }, detach, rule()),
          what: `turn ${idList(set.ids)}`,
        };
      },
      key(e) {
        if (chord(e)) return false;
        const k = AXIS_KEYS[e.key];
        if (!k) return false;
        axis = k;
        draw();
        return true;
      },
      press(e) {
        // A click on a snap or a body moves the centre there; the rings take their own presses.
        const sn = deps.snap(e);
        const hit = sn ? undefined : deps.pick(e);
        const p = sn?.p ?? hit?.p;
        if (p) {
          centre = p;
          label = sn?.label ?? `on ${hit?.id}`;
        }
        return "taken";
      },
      flip() {
        void preview.flip();
      },
      ring(k, deg) {
        axis = k;
        ringDeg = deg;
        if (typed.peek()) {
          typed.value = "";
          fieldDone.value++;
        }
        draw();
      },
      stop() {
        preview.reset();
        viewer.setOverlay({});
        hint.value = undefined;
        live = undefined;
        rest();
      },
    };
  }

  /** Starts a turn of the selection about `centre`. */
  function begin(centre: V3 | undefined, label: string): boolean {
    const m = model.peek();
    if (!m) return false;
    const set = setOf(m, selection.peek());
    if ("why" in set) {
      lastResult.value = { rev: m.rev, created: [], error: set.why };
      return false;
    }
    hint.value = undefined;
    const s = spec(m, set, centre ?? centreOf(m, set), centre ? label : "the selection's centre");
    live = s;
    gestures.start(s, undefined, false);
    return true;
  }

  const offGizmo = viewer.onGizmoDrag((g) => {
    if (activeTool.peek() !== "rotate" || !g.part.startsWith("ring-")) return;
    const k = g.part.slice(5) as Axis;
    const deg = snapAngle(g.angle ?? 0);
    if (g.phase === "start") {
      const at = shown && "at" in shown ? shown.at : undefined;
      if (!live && !begin(at, "the selection's centre")) return;
      live?.ring(k, 0);
      return;
    }
    live?.ring(k, deg);
    // The release commits a turn; a ring clicked without a turn leaves it on, to type the angle.
    if (g.phase === "end" && deg !== 0) gestures.enter();
  });

  const grab: Grab = {
    press(e) {
      if (gestures.live()) return gestures.press(e);
      const sel = selection.peek();
      const sn = deps.snap(e);
      const hit = deps.pick(e);
      if (sel.size === 0) {
        // Nothing to turn yet: a click on a body selects it.
        if (!hit) return false;
        select([hit.id], "replace");
        return true;
      }
      const p = sn?.p ?? hit?.p ?? rayPlane(viewer.ray(e.clientX, e.clientY), workPlane.peek());
      if (!p) return false;
      return begin(p, sn?.label ?? (hit ? `on ${hit.id}` : "free"));
    },
    move(e, held) {
      if (gestures.live()) gestures.pointer(e, held);
    },
    release(e) {
      gestures.release(e);
    },
    busy: () => gestures.live(),
  };

  const handler: ToolHandler = {
    move(e) {
      if (gestures.live()) return;
      const sn = deps.snap(e);
      hint.value = {
        x: e.clientX,
        y: e.clientY,
        text:
          selection.peek().size > 0
            ? `click the centre${sn ? `: ${sn.label}` : ""}, Enter for the selection's centre, or drag a ring`
            : "click a bar or a part to turn it",
        ...(sn ? { snap: sn.label } : {}),
      };
    },
    leave() {
      if (!gestures.live()) hint.value = undefined;
    },
  };

  const offs = [
    selection.subscribe(rest),
    model.subscribe(rest),
    activeTool.subscribe(rest),
    // Rotate with a selection and no turn on: a value typed turns it about the selection's centre.
    onKey(
      "tool",
      (e) =>
        !chord(e) &&
        activeTool.peek() === "rotate" &&
        !gestures.live() &&
        e.key.length === 1 &&
        VALUE_START.test(e.key) &&
        selection.peek().size > 0 &&
        begin(undefined, "") &&
        gestures.key(e),
      51,
    ),
    describeKeys({
      id: "rotating",
      title: "While rotating (Q)",
      order: 16,
      rows: [
        {
          keys: ["Q"],
          does: "Rotate: click the centre, or Enter for the selection's centre; then type the angle or drag a ring",
        },
        {
          keys: ["X", "Y", "Z"],
          or: [["→"], ["←"], ["↑"]],
          does: "Turn about X, Y or Z (Z at first)",
        },
        {
          keys: ["0–9", "Enter"],
          does: "Type the angle in degrees, counter-clockwise looking down the axis",
        },
        { keys: ["Alt"], does: "Hold to free what joins the selection to the rest" },
        { keys: ["Tab"], does: "Flip the previewed joint where a turned end lands on a bar" },
      ],
    }),
  ];

  return {
    handler,
    grab,
    enter: () => !gestures.live() && selection.peek().size > 0 && begin(undefined, ""),
    dispose() {
      offGizmo();
      for (const off of offs) off();
      preview.reset();
      hideRings();
    },
  };
}
