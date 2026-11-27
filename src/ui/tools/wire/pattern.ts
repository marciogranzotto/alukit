import type { ToolHandler } from "../../../viewer/scene.ts";
import { selection } from "../../focus.ts";
import { hint, patternState } from "../state.ts";
import type { Wire, WireContext } from "./common.ts";

/**
 * Pattern, `X`: the selection is the template, a click picks the bar to repeat along; the tool's
 * form in the right column takes the pitch and count and sends the pattern. Owner: E5.
 */
export function createPatternTool(ctx: WireContext): Wire {
  const { viewer, show } = ctx;
  const handler: ToolHandler = {
    move(e) {
      ctx.track(e);
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
  return {
    handler,
    switched(next) {
      if (next === "pattern")
        patternState.value = { ...patternState.value, template: [...selection.value].sort() };
    },
  };
}
