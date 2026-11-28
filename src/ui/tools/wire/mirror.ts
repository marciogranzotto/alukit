import { taggedWords } from "#core/commands/copies.ts";
import { idList } from "#core/commands/words.ts";
import { compareIds } from "#core/ids.ts";
import type { V3 } from "../../../mesh/model.ts";
import type { ToolPointer, Viewer } from "../../../viewer/scene.ts";
import type { Snap } from "../../../viewer/snap.ts";
import { type Action, type ActionContext, registerAction } from "../../actions/registry.ts";
import type { DryRun } from "../../client/dryrun.ts";
import { mirrorBatch } from "../../edit/batches.ts";
import {
  AXIS_INDEX,
  type Axis,
  centreOf,
  ghostsOf,
  membersOf,
  reflection,
  UNIT,
} from "../../edit/geometry.ts";
import { select } from "../../focus.ts";
import { chord, describeKeys } from "../../keys.ts";
import type { Model } from "../../model.ts";
import { model, summary } from "../../store.ts";
import type { GestureSpec, Gestures } from "../drag.ts";
import type { JointWords } from "../joint.ts";
import { copiedJoins } from "../moves.ts";
import { createPreviewer } from "../preview.ts";
import { activeTool, drawOptions, gesture, hint, mirrorOptions, typed } from "../state.ts";
import { parseTyped } from "../typed.ts";

/**
 * Mirror (docs/ux/editing-audit.md E3.2, E-UX-8; docs/ux/e3-decisions.md), from the menu: the
 * selection copied as its mirror image in a plane square to X, Y or Z, one `mirror` step. The
 * plane goes through the selection's centre at first, then through the snap under the pointer,
 * or where a typed value says it crosses its axis (`500`, `=W / 2`); X, Y or Z (or → ← ↑) turn
 * it square to that axis. "Remove the originals", in the command bar, removes what was mirrored
 * in the same step. The images are drawn where they would go, with the plane; a dry run says
 * what the step makes, or why the core refuses it. A click, or Enter, commits. Owner: E3.
 */

const AXIS_KEYS: Readonly<Record<string, Axis>> = {
  x: "x",
  y: "y",
  z: "z",
  ArrowRight: "x",
  ArrowLeft: "y",
  ArrowUp: "z",
};
const num = (x: number) => String(Math.round(x * 100) / 100);

/** The plane's two in-plane axes, for the grid the overlay draws. */
const IN_PLANE: Readonly<Record<Axis, [V3, V3]>> = {
  x: [UNIT.y, UNIT.z],
  y: [UNIT.z, UNIT.x],
  z: [UNIT.x, UNIT.y],
};

export interface MirrorDeps {
  /** The snap under the pointer, passing over what the view hides. */
  snap(e: ToolPointer): Snap | undefined;
}

/**
 * What a mirror's dry run says it makes, or why the core refuses it: the images, what joins
 * them (the joints mirrored with them, then the joins at their ends; review B2), what stays open,
 * their cuts, and what is removed.
 *
 * One outcome per end, the step's (re-check N2): `mirror` reports the images' ends whose joint it
 * could not land (`info.open`), but the step goes on to an `autoConnect` at each image's end, so
 * an end is said to stay open only when nothing in the whole step claims it, as the dry run's
 * `effects.claimed` says. Whatever lands a joint, the mirror or a join after it, the words follow
 * what the core will do, never "joins" and "stays open" for one end.
 */
export function mirrorWords(r: DryRun): JointWords {
  if (!r.ok) {
    return { text: r.errors[0]?.message ?? r.why, shape: "refused", joins: false };
  }
  const info = r.results[0]?.info as
    | { joined?: Record<string, string>; open?: string[]; tagged?: Record<string, string[]> }
    | undefined;
  // The tags the images carry, as the core says them (docs/ux/review-editing.md m2).
  const tags = taggedWords(info?.tagged);
  const made = (r.results[0]?.created ?? []).filter((id) => info?.joined?.[id] === undefined);
  const joins = copiedJoins(r);
  const claimed = new Set(r.effects.claimed);
  const open = (info?.open ?? []).filter((end) => !claimed.has(end));
  const cuts = [...new Set(made.map((id) => r.effects.added[id]).filter((c) => c !== undefined))];
  const removed = r.effects.removed;
  const parts = [
    made.length > 0 ? `makes ${idList(made)}` : "makes nothing",
    ...(tags ? [tags] : []),
    ...(joins.length > 3 ? [`${joins.length} joints`] : joins),
    ...(open.length > 0 ? [`${idList(open)} stay${open.length === 1 ? "s" : ""} open`] : []),
    ...(cuts.length > 0
      ? [`cut ${cuts.slice(0, 3).join(", ")}${cuts.length > 3 ? " …" : ""}`]
      : []),
    ...(removed.length > 0 ? [`removes ${idList(removed)}`] : []),
  ];
  return { text: parts.join(" · "), shape: "mirror", joins: joins.length > 0 };
}

/** Whether a tool that takes the pointer for a gesture is on: Select or Move. */
const pointerTool = () => activeTool.peek() === "select" || activeTool.peek() === "move";

export function createMirror(viewer: Viewer, gestures: Gestures, deps: MirrorDeps): () => void {
  const preview = createPreviewer(
    viewer,
    () => gesture.peek()?.kind === "mirror",
    () => undefined,
  );

  function spec(m: Model, ids: readonly string[]): GestureSpec {
    const set = membersOf(m, ids);
    const centre = centreOf(m, set);
    let axis: Axis = "x";
    let at = centre[0];
    let label = "the selection's centre";
    let why: string | undefined;
    const title = `Mirror ${idList(ids)}`;
    const batch = () =>
      mirrorBatch(
        m,
        ids,
        { axis, at_mm: at },
        { removeOriginals: mirrorOptions.peek().remove, prefer: drawOptions.peek().prefer },
      );

    function draw(typedWhy?: string): void {
      why = typedWhy;
      const k = AXIS_INDEX[axis];
      const [u, v] = IN_PLANE[axis];
      const origin = centre.map((c, i) => (i === k ? at : c)) as unknown as V3;
      viewer.setOverlay({
        ghosts: ghostsOf(m, set.bars, reflection(axis, at)),
        plane: { origin, n: UNIT[axis], u, v, label: `${axis} = ${num(at)}` },
        marker: { p: origin, kind: "point" },
      });
      const b = batch();
      if (!why && "why" in b) why = b.why;
      gesture.value = {
        kind: "mirror",
        title,
        prompt: "click a snap for the plane, or type where it crosses its axis; X, Y or Z turns it",
        reading: why ?? `across ${axis} = ${num(at)}`,
        snap: label,
      };
      preview.ask(
        why || "why" in b
          ? undefined
          : {
              commands: () => b,
              at: origin,
              soon: label !== "free",
              words: mirrorWords,
            },
      );
    }

    return {
      kind: "mirror",
      update(e) {
        const k = AXIS_INDEX[axis];
        const text = typed.peek().trim().replace(/^=\s*/, "");
        if (text !== "") {
          const t = parseTyped(text, m.derived.params);
          label = "typed";
          if (t.kind === "value") at = t.value;
          else if (t.kind !== "empty") {
            draw(t.kind === "error" ? t.why : "type where the plane crosses its axis: one value");
            return;
          }
        } else if (e) {
          const sn = deps.snap(e);
          if (sn) {
            at = sn.p[k] as number;
            label = sn.label;
          }
        }
        draw();
      },
      commit() {
        if (why) return { why };
        const b = batch();
        if ("why" in b) return b;
        return { commands: b, what: `mirror ${idList(ids)}` };
      },
      done(o) {
        // The images are what a person works on next: they are selected.
        const made = o.ok ? o.created.filter((id) => /^(b|p|n)\d+$/.test(id)) : [];
        if (made.length > 0) select(made, "replace");
      },
      key(e) {
        if (chord(e)) return false;
        const k = AXIS_KEYS[e.key];
        if (!k) return false;
        axis = k;
        // Square to the new axis, through the same place: the centre, or the last snap.
        at = centre[AXIS_INDEX[k]] as number;
        label = "the selection's centre";
        draw();
        return true;
      },
      stop() {
        preview.reset();
        viewer.setOverlay({});
        hint.value = undefined;
      },
    };
  }

  const MIRROR: Action = {
    id: "mirror",
    title: "Mirror…",
    group: "transform",
    help: "Mirror the selection in a plane square to X, Y or Z",
    applies: (c) => membersCount(c) > 0,
    when(c) {
      if (summary.peek()?.status.readOnly === true) return "the project is read-only";
      if (!pointerTool()) return "works in Select or Move: press Esc first";
      const copy = [...c.selection].find((id) => id.includes("@"));
      if (copy) return `${copy} is a pattern copy: mirror ${copy.split("@")[0]}, its template`;
      return membersCount(c) > 0 ? true : "select the bars, parts or points to mirror";
    },
    run(c) {
      const m = model.peek();
      if (!m) return;
      hint.value = undefined;
      gestures.start(spec(m, membersIds(m, [...c.selection])), undefined, false);
    },
  };

  const offs = [
    registerAction(MIRROR),
    // The command bar's "Remove the originals" redraws the step it previews.
    mirrorOptions.subscribe(() => {
      if (gesture.peek()?.kind === "mirror") gestures.refresh();
    }),
    describeKeys({
      id: "mirroring",
      title: "While mirroring (the menu's Mirror)",
      order: 17,
      rows: [
        { keys: ["X", "Y", "Z"], or: [["→"], ["←"], ["↑"]], does: "The plane square to X, Y or Z" },
        { keys: ["0–9", "Enter"], does: "Type where the plane crosses its axis, then commit" },
      ],
    }),
  ];
  return () => {
    for (const off of offs) off();
    preview.reset();
  };
}

/** How many of a context's selection a mirror or a copy takes: bars, parts and points. */
export function membersCount(c: ActionContext): number {
  const s = membersOf(c.m, c.selection);
  return s.bars.length + s.parts.length + s.nodes.length;
}

/** The ids a context's selection copies, by kind, in order. */
function membersIds(m: Model, ids: readonly string[]): string[] {
  const s = membersOf(m, ids);
  return [...s.bars, ...s.parts, ...s.nodes].sort(compareIds);
}
