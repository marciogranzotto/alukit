import { useState } from "preact/hooks";
import type { Fix, Problem } from "#core/problems/types.ts";
import { Errors } from "../Feedback.tsx";
import { ResolveForm } from "../records/ResolveForm.tsx";
import { openSheet } from "../sheets/registry.ts";
import { busy, type CommandOutcome, model, sendCommands, summary } from "../store.ts";

/**
 * A problem's fixes (docs/ux/heuristics-and-first-run.md §5.4, principle 4): each a button, and
 * each one step of the log, which the top bar's undo takes back. A fix is a batch of commands the
 * app sends as it stands, or a named form it opens in the row: resolving an open item, setting a
 * price. What a command refuses is shown under the row. Owner: S4.
 */

const readOnly = () => summary.value?.status.readOnly === true;

const today = () => new Date().toISOString().slice(0, 10);

/** The project item the price form sets, or `undefined` when the item is not the project's. */
function projectItem(item: string): boolean {
  return item.startsWith("project:");
}

function SetPriceForm({ item, done }: { item: string; done: () => void }) {
  const [price, setPrice] = useState("");
  const [ref, setRef] = useState("");
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const currency = typeof model.value?.doc.currency === "string" ? model.value.doc.currency : "";
  const minor = Math.round(Number.parseFloat(price) * 100);
  const valid = Number.isFinite(minor) && minor >= 0;
  const apply = async (e: Event) => {
    e.preventDefault();
    const field = {
      v: minor,
      src: "src",
      read: today(),
      ...(ref.trim() ? { ref: ref.trim() } : {}),
    };
    const r = await sendCommands(
      [{ cmd: "setItem", args: { id: item, set: { price_minor: field } } }],
      `set the price of ${item}`,
    );
    setOutcome(r);
    if (r.ok) done();
  };
  return (
    <form class="record-form fix-form" data-testid="price-form" onSubmit={(e) => void apply(e)}>
      <label>
        Price{currency ? `, ${currency}` : ""}
        <input
          data-testid="price-value"
          inputMode="decimal"
          placeholder="85.00"
          value={price}
          onInput={(e) => setPrice((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label>
        Quote or source
        <input
          data-testid="price-ref"
          placeholder="optional"
          value={ref}
          onInput={(e) => setRef((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <button
        type="submit"
        class="btn primary"
        data-testid="price-apply"
        disabled={busy.value || readOnly() || !valid}
      >
        Set the price
      </button>
      <button type="button" class="btn" onClick={done}>
        Cancel
      </button>
      <Errors outcome={outcome} />
    </form>
  );
}

/**
 * A problem's actions: what the row passes (its Show), the buttons of its fixes, and under the
 * row the form of the fix that opened one, or what a command refused.
 */
export function FixControls({ p, children }: { p: Problem; children?: preact.ComponentChildren }) {
  const [open, setOpen] = useState<Fix | undefined>();
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const run = async (fix: Fix) => {
    setOutcome(undefined);
    if (fix.kind === "commands") {
      setOutcome(await sendCommands(fix.commands, fix.label));
    } else if (fix.kind === "lock-update") {
      setOutcome(
        await sendCommands([{ cmd: "lockUpdate", args: { items: [fix.item] } }], fix.label),
      );
    } else if (fix.kind === "param") {
      openSheet("params");
    } else {
      setOpen(open === fix ? undefined : fix);
    }
  };
  const form = open;
  return (
    <>
      <div class="problem-actions">
        {children}
        {p.fixes.map((fix) => {
          // A catalog item's price is the catalog's: only a project item's is set here.
          const blocked =
            fix.kind === "set-price" && !projectItem(fix.item)
              ? "A catalog item's price comes from its catalog"
              : undefined;
          return (
            <button
              type="button"
              class="btn"
              key={fix.label}
              data-fix={fix.kind}
              disabled={busy.value || readOnly() || blocked !== undefined}
              title={blocked}
              aria-expanded={form === fix}
              onClick={() => void run(fix)}
            >
              {fix.label}
            </button>
          );
        })}
      </div>
      {form?.kind === "resolve-open" && (
        <div class="fix-panel">
          <ResolveForm id={form.open} done={() => setOpen(undefined)} />
        </div>
      )}
      {form?.kind === "set-price" && (
        <div class="fix-panel">
          <SetPriceForm item={form.item} done={() => setOpen(undefined)} />
        </div>
      )}
      {outcome && !outcome.ok && (
        <div class="fix-panel">
          <Errors outcome={outcome} />
        </div>
      )}
    </>
  );
}
