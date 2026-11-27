import { summary } from "../store.ts";
import { activeTool, TOOLS, type ToolName } from "./state.ts";

/** The tool rail (the viewport's `left` slot): a button per tool; the active one is on. Owner: S5. */

const TOOL_TEXT: Readonly<Record<ToolName, [string, string]>> = {
  select: ["Select", "V"],
  draw: ["Draw bar", "B"],
  connect: ["Connect", "C"],
  place: ["Place part", "P"],
  pattern: ["Pattern", ""],
  measure: ["Measure", "M"],
};

export function ToolRail() {
  const readOnly = summary.value?.status.readOnly === true;
  return (
    <>
      {TOOLS.map((t) => {
        const [text, key] = TOOL_TEXT[t];
        return (
          <button
            type="button"
            key={t}
            data-testid={`tool-${t}`}
            class={activeTool.value === t ? "tb on" : "tb"}
            disabled={readOnly && t !== "select" && t !== "measure"}
            title={key ? `${text} (${key})` : text}
            onClick={() => {
              activeTool.value = t;
            }}
          >
            {text}
          </button>
        );
      })}
    </>
  );
}
