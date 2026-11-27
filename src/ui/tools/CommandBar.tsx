import { activeTool, hint } from "./state.ts";

/** The text by the pointer: what it snaps to, the length, what is typed. */
function Hint() {
  const h = hint.value;
  if (!h) return null;
  return (
    <div
      class="tool-hint"
      data-testid="tool-hint"
      style={{ left: `${h.x + 14}px`, top: `${h.y + 14}px` }}
    >
      {h.text}
    </div>
  );
}

/** The command bar at the canvas foot (D-UX-5), and the tip by the pointer. Owner: S5. */
export function CommandBar() {
  return (
    <>
      <Hint />
      <div class="viewport-help">
        {activeTool.value === "select"
          ? "drag: orbit · right-drag: pan · wheel: zoom · Shift-drag: box select"
          : "click: pick · drag: orbit · Esc: back to select"}
      </div>
    </>
  );
}
