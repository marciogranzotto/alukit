import { useState } from "preact/hooks";
import { Errors } from "../Feedback.tsx";
import { busy, type CommandOutcome, model, sendCommands, summary } from "../store.ts";

/**
 * Resolving an open item (design §4.12): what was decided, and why, through `resolveOpen`, which
 * drops the item and records a dated decision: one batch, one step the top bar's undo takes back.
 * The Problems sheet's open-items table and a problem's Fix open it. A refusal shows under the
 * form, field by field. Owner: S4.
 */
export function ResolveForm({ id, done }: { id: string; done: () => void }) {
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const list = model.value?.doc.open;
  const open = Array.isArray(list)
    ? (list as { id?: string; text?: string }[]).find((o) => o.id === id)
    : undefined;
  const resolve = async (e: Event) => {
    e.preventDefault();
    const args = {
      id,
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(why.trim() ? { why: why.trim() } : {}),
    };
    const r = await sendCommands([{ cmd: "resolveOpen", args }], `resolve ${id}`);
    setOutcome(r);
    if (r.ok) done();
  };
  return (
    <form class="record-form fix-form" data-testid="resolve-form" onSubmit={(e) => void resolve(e)}>
      <input
        data-testid="resolve-text"
        aria-label="What was decided"
        placeholder={`what was decided${open?.text ? ` (default: resolved: ${open.text})` : ""}`}
        value={text}
        onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
      />
      <input
        data-testid="resolve-why"
        aria-label="Why"
        placeholder="why (optional)"
        value={why}
        onInput={(e) => setWhy((e.currentTarget as HTMLInputElement).value)}
      />
      <button
        type="submit"
        class="btn primary"
        data-testid="resolve-apply"
        disabled={busy.value || summary.value?.status.readOnly === true}
      >
        Resolve
      </button>
      <button type="button" class="btn" onClick={done}>
        Cancel
      </button>
      <Errors outcome={outcome} />
    </form>
  );
}
