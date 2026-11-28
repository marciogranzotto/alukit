import { signal } from "@preact/signals";
import { idList } from "#core/commands/words.ts";
import { compareIds } from "#core/ids.ts";
import type { ToolPointer } from "../../../viewer/scene.ts";
import {
  type Action,
  type ActionContext,
  keyText,
  registerAction,
} from "../../actions/registry.ts";
import { membersOf, minCorner } from "../../edit/geometry.ts";
import type { Model } from "../../model.ts";
import { summary } from "../../store.ts";
import { activeTool } from "../state.ts";
import type { MoveTool } from "./move.ts";

/**
 * Duplicate, Copy and Paste (docs/ux/editing-audit.md E3.3, E3.4, E-UX-6, E-UX-7;
 * docs/ux/e3-decisions.md): actions in the registry, so the keys, the menu and the help read
 * one definition. Duplicate (Ctrl/Cmd+D) starts a Move session on a copy of the selection (the
 * Move tool's, `startCopy`); Copy (Ctrl/Cmd+C) remembers the selection, in this tab and its
 * project only; Paste (Ctrl/Cmd+V) starts the same session with the copied entities hanging from
 * the pointer by their lowest corner. Each step is one `array`. The chords are the view's and the
 * outline's only: with the focus elsewhere, or text selected on the page, the browser keeps them
 * (the editing audit's §9). Owner: E3.
 */

/** What Copy remembered: ids in this tab's project, until the tab closes. */
export const clipboard = signal<readonly string[]>([]);

/** Whether a tool that takes the pointer for a gesture is on: Select or Move. */
const pointerTool = () => activeTool.peek() === "select" || activeTool.peek() === "move";

/** Whether the keyboard is the view's or the outline's, so a chord is the app's to take. */
function onTheView(): boolean {
  if (typeof document === "undefined") return true;
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return true;
  return a.closest('[data-testid="viewport"], [data-testid="tree"]') !== null;
}

/** Whether text is selected on the page, which Ctrl/Cmd+C copies instead. */
function textSelected(): boolean {
  if (typeof window === "undefined") return false;
  const s = window.getSelection?.();
  return s !== null && s !== undefined && !s.isCollapsed && s.toString() !== "";
}

/** What a selection copies: its bars, parts and points, in id order. */
function copied(m: Model, ids: Iterable<string>): string[] {
  const s = membersOf(m, ids);
  return [...s.bars, ...s.parts, ...s.nodes].sort(compareIds);
}

/** A pattern copy among the selection, said as what to do instead. */
function patternCopy(c: ActionContext, verb: string): string | undefined {
  const copy = [...c.selection].find((id) => id.includes("@"));
  return copy
    ? `${copy} is a pattern copy: ${verb} ${copy.split("@")[0]}, its template`
    : undefined;
}

/**
 * Registers Duplicate, Copy and Paste for the Move tool's sessions; `pointer` is where the
 * pointer was last over the view, where a paste starts. Returns the undo.
 */
export function copyActions(mover: MoveTool, pointer: () => ToolPointer | undefined): () => void {
  const DUPLICATE: Action = {
    id: "duplicate",
    title: "Duplicate",
    group: "transform",
    keys: ["mod+d"],
    help: "Duplicate the selection: click a base point and where the copy goes, or type an offset; 4x or /4 for more",
    applies: (c) => copied(c.m, c.selection).length > 0,
    when(c) {
      if (summary.peek()?.status.readOnly === true) return "the project is read-only";
      if (!pointerTool()) return "works in Select or Move: press Esc first";
      if (c.from === "key" && !onTheView()) return "the focus is not on the view";
      const pc = patternCopy(c, "duplicate");
      if (pc) return pc;
      return copied(c.m, c.selection).length > 0
        ? true
        : "select the bars, parts or points to duplicate";
    },
    run(c) {
      mover.startCopy(copied(c.m, c.selection), { title: "Duplicate", based: false });
    },
  };

  const COPY: Action = {
    id: "copy",
    title: "Copy",
    group: "edit",
    keys: ["mod+c"],
    help: "Copy the selection, to paste in this project",
    applies: (c) => copied(c.m, c.selection).length > 0,
    when(c) {
      if (c.from === "key" && (textSelected() || !onTheView())) return "the page has the keys";
      const pc = patternCopy(c, "copy");
      if (pc) return pc;
      return copied(c.m, c.selection).length > 0
        ? true
        : "select the bars, parts or points to copy";
    },
    run(c) {
      clipboard.value = copied(c.m, c.selection);
    },
  };

  const PASTE: Action = {
    id: "paste",
    title: "Paste",
    group: "edit",
    keys: ["mod+v"],
    help: "Paste what was copied: it hangs from the pointer; click where it goes",
    // A menu offers it once something is copied.
    applies: () => clipboard.peek().length > 0,
    when(c) {
      if (summary.peek()?.status.readOnly === true) return "the project is read-only";
      if (!pointerTool()) return "works in Select or Move: press Esc first";
      if (c.from === "key" && !onTheView()) return "the focus is not on the view";
      const ids = clipboard.peek();
      if (ids.length === 0) return `copy something first (${keyText("mod+c")})`;
      const gone = ids.filter(
        (id) => !(c.m.derived.bars[id] || c.m.derived.parts?.[id] || c.m.derived.nodes[id]),
      );
      return gone.length === 0 ? true : `${idList(gone)} is gone since it was copied`;
    },
    run(c) {
      const ids = clipboard.peek();
      const base = minCorner(c.m, membersOf(c.m, ids));
      mover.startCopy(ids, { title: "Paste", based: true, base }, pointer());
    },
  };

  const offs = [DUPLICATE, COPY, PASTE].map(registerAction);
  return () => {
    for (const off of offs) off();
  };
}
