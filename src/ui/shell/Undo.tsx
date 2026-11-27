import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import type { StepInfo } from "../model.ts";
import { ago, isOwn, stepWords, who } from "../steps.ts";
import { heardAt, redo, summary, tell, undo } from "../store.ts";
import { Dialog } from "./Dialog.tsx";
import { isBoolean, readPref, writePref } from "./prefs.ts";

/**
 * Undo and redo as the person asks for them (D-UX-14, S2.6, U17): the button and Ctrl+Z always
 * say whose step they take back; when it is another source's (an agent, the CLI, a hand edit),
 * they ask first, once, "This step was claude's, 40 s ago. Undo it?", with "don't ask again" for
 * the tab's session. The history is shared by design (§7.1): what surprised was undoing someone
 * else's step without knowing, not undoing it. A toast's "Undo it" names its step and does not
 * ask. Owner: S2.
 */

const NO_ASK = "alukit.undo.no-ask";

/** The person said not to ask again, for this tab's session. */
export const undoNoAsk = signal(readPref(NO_ASK, false, isBoolean, "session"));

/** The step the confirmation asks about, while it is open. */
export const undoAsking = signal<StepInfo | undefined>(undefined);

/** The words a step goes by: who, then what, `claude: add bar b35`. */
export function stepLabel(step: StepInfo): string {
  return `${who(step.source)}: ${stepWords(step)}`;
}

/** Undo, asking first when the step is another source's. */
export function requestUndo(): void {
  const s = summary.peek();
  const step = s?.undo;
  if (!step || s.status.readOnly) return;
  if (isOwn(step.source) || undoNoAsk.peek()) void undo();
  else undoAsking.value = step;
}

export function requestRedo(): void {
  const s = summary.peek();
  if (s?.redo && !s.status.readOnly) void redo();
}

export function UndoConfirm() {
  const step = undoAsking.value;
  const [noAsk, setNoAsk] = useState(false);
  if (!step) return null;
  const close = () => {
    undoAsking.value = undefined;
    setNoAsk(false);
  };
  const at = heardAt(step.rev);
  const confirm = () => {
    close();
    if (noAsk) {
      undoNoAsk.value = true;
      writePref(NO_ASK, true, "session");
    }
    // Another step may have come in while the question was open: undo only the one asked about.
    if (summary.peek()?.undo?.rev !== step.rev) {
      tell(
        "Not undone: another step came in meanwhile, and Undo would now take back that one.",
        true,
      );
      return;
    }
    void undo();
  };
  return (
    <Dialog title={`Undo ${who(step.source)}'s step?`} onClose={close} testid="undo-confirm-dialog">
      <p>
        This step was {who(step.source)}'s{at !== undefined ? `, ${ago(Date.now() - at)}` : ""}:{" "}
        <strong>{stepWords(step)}</strong>. Undo it?
      </p>
      <label class="dialog-check">
        <input
          type="checkbox"
          data-testid="undo-no-ask"
          checked={noAsk}
          onChange={(e) => setNoAsk((e.currentTarget as HTMLInputElement).checked)}
        />{" "}
        Don't ask again in this tab
      </label>
      <div class="dialog-actions">
        <button
          type="button"
          class="btn primary"
          data-autofocus
          data-testid="undo-confirm"
          onClick={confirm}
        >
          Undo it
        </button>
        <button type="button" class="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
