import type { ToolPointer, Viewer } from "../../viewer/scene.ts";
import { type CommandOutcome, model, sendCommands } from "../store.ts";
import type { Cmd } from "./preview.ts";
import { fieldDone, fieldWanted, type Gesture, gesture, lastResult, typed } from "./state.ts";

/**
 * Drag gestures (docs/ux/drag-ends-decisions.md): an end handle, and the Move tool, built once.
 * A gesture starts on a press the viewer's grab takes (`Viewer.setGrab`), and goes on in one of
 * two ways, as SketchUp's Move and Fusion's manipulators both allow:
 *
 * - **press, drag, release**: the release commits where the pointer let go;
 * - **click, move, click**: a press released where it was pressed leaves the gesture following the
 *   pointer, and the next click commits. Typing then goes in the command bar, as the draw tool
 *   takes a length (D-UX-17), and Enter commits what is typed.
 *
 * Esc steps back one level (D-UX-18): what is typed, then the gesture, which leaves the document
 * as it was. Tab flips the previewed joint. The whole gesture is one batch, one step (§7.1: a
 * tab holds no unsaved state; a drag is a local preview, committed as one command on release).
 * What a gesture moves and how it reads the pointer is its `GestureSpec`'s. Owner: S5.
 */

/** A press that moves less than this, px, is a click: the gesture keeps following the pointer. */
const CLICK_PX = 4;

export interface GestureSpec {
  kind: Gesture["kind"];
  /** Draws the gesture where the pointer is, or, with no pointer, as typed. */
  update(e: ToolPointer | undefined): void;
  /** What committing now sends, why it cannot, or that nothing would change. */
  commit(): { commands: Cmd[]; what: string } | { why: string } | "nothing";
  /** A key the gesture takes itself (an axis lock, say). */
  key?(e: KeyboardEvent): boolean;
  /** Tab: the previewed joint's next arrangement. */
  flip?(): void;
  /** Takes what the gesture draws away. */
  stop(): void;
  /** After a step it sent, with what came of it. */
  done?(o: CommandOutcome): void;
}

/** The value-starting characters that hand the keyboard to the command bar (D-UX-17). */
const VALUE_START = /^[0-9.\-+([=]$/;

export interface Gestures {
  /** Whether a gesture is on. */
  live(): boolean;
  /** Starts a gesture at a press (`held`) or from the keyboard. */
  start(spec: GestureSpec, e: ToolPointer | undefined, held: boolean): void;
  /** The pointer moved, with the button held or not. */
  pointer(e: ToolPointer, held: boolean): void;
  /** The button came up: a drag commits, a click leaves the gesture following the pointer. */
  release(e: ToolPointer): void;
  /** A press while a click-move gesture is on: it commits there. True when one was on. */
  press(e: ToolPointer): boolean;
  /** Esc: the typed value, then the gesture. True when there was something to take back. */
  back(): boolean;
  /** Enter: commits what is typed, or where the gesture is. */
  enter(): boolean;
  /** The gesture's keys, outside the command bar's field. */
  key(e: KeyboardEvent): boolean;
  /** Ends any gesture without a step. */
  cancel(): void;
  dispose(): void;
}

export function createGestures(_viewer: Viewer): Gestures {
  let spec: GestureSpec | undefined;
  let held = false;
  let from: [number, number] | undefined;
  let moved = false;
  let last: ToolPointer | undefined;

  function end(): void {
    const s = spec;
    spec = undefined;
    held = false;
    from = undefined;
    moved = false;
    last = undefined;
    if (typed.peek()) typed.value = "";
    fieldDone.value++;
    gesture.value = undefined;
    s?.stop();
  }

  async function commit(): Promise<void> {
    const s = spec;
    if (!s) return;
    const c = s.commit();
    if (c === "nothing") {
      end();
      return;
    }
    if ("why" in c) {
      lastResult.value = { rev: model.peek()?.rev ?? 0, created: [], error: c.why };
      return;
    }
    end();
    const o = await sendCommands(c.commands, c.what);
    lastResult.value = o.ok
      ? { rev: o.rev, created: o.created }
      : { rev: model.peek()?.rev ?? 0, created: [], error: o.why };
    s.done?.(o);
  }

  // What is typed moves the gesture, pointer or not.
  const offTyped = typed.subscribe(() => spec?.update(last));

  return {
    live: () => spec !== undefined,
    start(s, e, isHeld) {
      if (spec) end();
      spec = s;
      held = isHeld;
      moved = false;
      from = e ? [e.clientX, e.clientY] : undefined;
      last = e;
      lastResult.value = undefined;
      s.update(e);
    },
    pointer(e, isHeld) {
      if (!spec) return;
      last = e;
      if (isHeld && from && Math.hypot(e.clientX - from[0], e.clientY - from[1]) > CLICK_PX) {
        moved = true;
      }
      // While a value is typed, the pointer only gives the way; the gesture reads both.
      spec.update(e);
    },
    release(e) {
      if (!spec || !held) return;
      held = false;
      last = e;
      if (moved) void commit();
    },
    press(e) {
      if (!spec) return false;
      last = e;
      spec.update(e);
      void commit();
      return true;
    },
    back() {
      if (!spec) return false;
      if (typed.peek()) {
        typed.value = "";
        fieldDone.value++;
        spec.update(last);
        return true;
      }
      end();
      return true;
    },
    enter() {
      if (!spec) return false;
      void commit();
      return true;
    },
    key(e) {
      if (!spec) return false;
      if (e.key === "Escape") return this.back();
      if (e.key === "Enter") return this.enter();
      if (e.key === "Tab" && !e.shiftKey && spec.flip) {
        spec.flip();
        return true;
      }
      if (e.key.length === 1 && VALUE_START.test(e.key)) {
        typed.value = e.key === "=" ? "" : e.key;
        fieldWanted.value++;
        return true;
      }
      return spec.key?.(e) ?? false;
    },
    cancel() {
      if (spec) end();
    },
    dispose() {
      offTyped();
      if (spec) end();
    },
  };
}
