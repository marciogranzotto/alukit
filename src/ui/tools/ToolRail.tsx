import { Icon } from "../icons/Icons.tsx";
import { letterKeys } from "../keys.ts";
import { summary } from "../store.ts";
import { activeTool, TOOL_NAMES, TOOLS, type ToolName, toolKey } from "./state.ts";

/**
 * The tool rail (the viewport's `left` slot; S5.10, U44, U22, U33): a button per tool, each S4's
 * icon with its word beside it from 1440 px and its key on a cap; the active one is on. A tool
 * that cannot be used says why, in its title and to a screen reader. Owner: S5.
 */

/** Why a tool cannot be used now, if it cannot. */
function whyNot(t: ToolName, readOnly: boolean): string | undefined {
  if (readOnly && t !== "select" && t !== "measure")
    return "the project is read-only until its files are valid again: fix them, or restore the last good state";
  return undefined;
}

export function ToolRail() {
  const readOnly = summary.value?.status.readOnly === true;
  const keysOn = letterKeys.value;
  return (
    <>
      {TOOLS.map((t) => {
        const name = TOOL_NAMES[t];
        const key = toolKey(t);
        const why = whyNot(t, readOnly);
        const title = `${name}${key && keysOn ? ` (${key})` : ""}${why ? `: ${why}` : ""}`;
        return (
          <button
            type="button"
            key={t}
            data-testid={`tool-${t}`}
            class={activeTool.value === t ? "tb on" : "tb"}
            aria-pressed={activeTool.value === t}
            aria-label={why ? `${name}, unavailable: ${why}` : name}
            {...(key && keysOn ? { "aria-keyshortcuts": key } : {})}
            disabled={why !== undefined}
            title={title}
            onClick={() => {
              activeTool.value = t;
            }}
          >
            <Icon name={t === "select" ? "select" : t} />
            <span class="icon-word">{name}</span>
            {key && keysOn && <kbd class="tool-key">{key}</kbd>}
          </button>
        );
      })}
    </>
  );
}
