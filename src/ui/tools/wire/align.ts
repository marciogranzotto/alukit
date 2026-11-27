import { idList } from "#core/commands/words.ts";
import type { V3 } from "../../../mesh/model.ts";
import type { Viewer } from "../../../viewer/scene.ts";
import { type Action, registerAction } from "../../actions/registry.ts";
import { alignBatch } from "../../edit/batches.ts";
import { type BarFace, facePlane, ghostsOf, sideWords, translation } from "../../edit/geometry.ts";
import { hidden } from "../../focus.ts";
import type { Model } from "../../model.ts";
import { model, summary } from "../../store.ts";
import type { GestureSpec, Gestures } from "../drag.ts";
import { type MoveSet, moveSet, moveWords } from "../moves.ts";
import { createPreviewer } from "../preview.ts";
import { activeTool, drawOptions, gesture, hint } from "../state.ts";

/**
 * Align (docs/ux/editing-audit.md E3.6, E-UX-23; docs/ux/e3-decisions.md), from the menu: a click
 * on a bar's face, and the selection moves square to it until its own face that looks the same
 * way is flush with it (a rail's top with a post's top), one `transform` step, Move's batch. The
 * face under the pointer is named and the selection drawn where it would go before the click; a
 * dry run says what follows or frees, as Move's preview does. Owner: E3.
 */

const num = (x: number) => String(Math.round(x * 100) / 100);

/** Whether a tool that takes the pointer for a gesture is on: Select or Move. */
const pointerTool = () => activeTool.peek() === "select" || activeTool.peek() === "move";

export function createAlign(viewer: Viewer, gestures: Gestures): () => void {
  const preview = createPreviewer(
    viewer,
    () => gesture.peek()?.kind === "align",
    () => drawOptions.peek().prefer,
  );

  function spec(m: Model, set: MoveSet): GestureSpec {
    const title = `Align ${idList(set.ids)}`;
    let target: { bar: string; face: BarFace } | undefined;
    let label = "";
    /** Where the pointer met the face: the preview's words go there. */
    let where: V3 = [0, 0, 0];
    const skip = () => new Set([...hidden.peek(), ...set.ids]);
    const batch = () =>
      target ? alignBatch(m, set.ids, target, drawOptions.peek().prefer) : undefined;

    function draw(): void {
      const b = batch();
      const by = b && !("why" in b) ? ((b[0]?.args.by as V3 | undefined) ?? undefined) : undefined;
      const t = target ? m.derived.bars[target.bar] : undefined;
      const face = t && target ? facePlane(t, target.face) : undefined;
      const words =
        target && face
          ? `flush with ${target.bar}'s ${sideWords(face.n)}`
          : "point at a bar's face";
      viewer.setOverlay(by ? { ghosts: ghostsOf(m, set.bars, translation(by)) } : {});
      gesture.value = {
        kind: "align",
        title,
        prompt:
          "click the face to align to: the selection moves square to it until its own face is flush",
        reading: b && "why" in b ? b.why : by ? `${words} · by [${by.map(num).join(", ")}]` : words,
        snap: label,
      };
      preview.ask(
        by && b && !("why" in b)
          ? {
              commands: () => b,
              at: where,
              soon: true,
              words: (r) => moveWords(r, false),
            }
          : undefined,
      );
    }

    return {
      kind: "align",
      update(e) {
        if (e) {
          const hit = viewer.pickAt(e.clientX, e.clientY, skip());
          target =
            hit?.face && m.derived.bars[hit.id] ? { bar: hit.id, face: hit.face } : undefined;
          label = target ? `${target.bar} ${target.face}` : "";
          if (hit) where = hit.p;
        }
        draw();
      },
      commit() {
        const b = batch();
        if (!b) return { why: "click a face of a bar to align to" };
        if ("why" in b) return b;
        return { commands: b, what: `align ${idList(set.ids)}` };
      },
      stop() {
        preview.reset();
        viewer.setOverlay({});
        hint.value = undefined;
      },
    };
  }

  const ALIGN: Action = {
    id: "align",
    title: "Align to a face…",
    group: "transform",
    help: "Move the selection square to a face until its own face is flush with it",
    applies: (c) => [...c.selection].some((id) => c.m.derived.bars[id] || c.m.derived.parts?.[id]),
    when(c) {
      if (summary.peek()?.status.readOnly === true) return "the project is read-only";
      if (!pointerTool()) return "in Select or Move";
      const set = moveSet(c.m, c.selection);
      return "why" in set ? set.why.replace("to move", "to align") : true;
    },
    run(c) {
      const m = model.peek();
      if (!m) return;
      const set = moveSet(m, c.selection);
      if ("why" in set) return;
      hint.value = undefined;
      gestures.start(spec(m, set), undefined, false);
    },
  };

  const off = registerAction(ALIGN);
  return () => {
    off();
    preview.reset();
  };
}
