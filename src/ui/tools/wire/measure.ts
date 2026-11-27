import type { V3 } from "../../../mesh/model.ts";
import type { ToolHandler } from "../../../viewer/scene.ts";
import { gridSnap } from "../../../viewer/workplane.ts";
import { hint, measureState, workPlane } from "../state.ts";
import { markerOf, type Wire, type WireContext } from "./common.ts";

/**
 * Measure, `M`: two clicks on snaps (or the grid) give the distance, which the command bar shows;
 * a third click starts again. Nothing is sent. Owner: E3.
 */
export function createMeasureTool(ctx: WireContext): Wire {
  const { viewer, show, snapAt, rayAt } = ctx;
  const handler: ToolHandler = {
    move(e) {
      ctx.track(e);
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
      handler.move?.(e);
    },
    leave() {
      hint.value = undefined;
    },
  };
  return {
    handler,
    /** Esc in Measure, one level: the second point, then the first. */
    back() {
      const { a, b } = measureState.value;
      if (b) measureState.value = { a };
      else if (a) measureState.value = {};
      else return false;
      return true;
    },
    switched(next) {
      if (next !== "measure") measureState.value = {};
    },
  };
}
