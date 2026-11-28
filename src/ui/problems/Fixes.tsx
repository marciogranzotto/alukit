import { useState } from "preact/hooks";
import type { Fix, Problem } from "#core/problems/types.ts";
import { ConnectorSelect } from "../common/ConnectorSelect.tsx";
import { Errors } from "../Feedback.tsx";
import { pointParam } from "../records/Params.tsx";
import { ResolveForm } from "../records/ResolveForm.tsx";
import { busy, type CommandOutcome, model, sendCommands, summary } from "../store.ts";

/**
 * A problem's fixes (docs/ux/heuristics-and-first-run.md §5.4, principle 4): each a button, and
 * each one step of the log, which the top bar's undo takes back. A fix is a batch of commands the
 * app sends as it stands, or a named form it opens in the row: resolving an open item, setting a
 * price. What a command refuses is shown under the row. Owner: S4.
 */

const readOnly = () => summary.value?.status.readOnly === true;

const today = () => new Date().toISOString().slice(0, 10);

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
 * Choosing a connector for butts that name none (docs/ux/review-phase4.md B1): the same picker
 * as the box frame's, fit to the joined bars, and one step: the project's default butt connector,
 * which every one of them takes, and the butts made later too.
 */
function ConnectorForm({
  fix,
  done,
}: {
  fix: Extract<Fix, { kind: "connector" }>;
  done: () => void;
}) {
  const [connector, setConnector] = useState("");
  const [qty, setQty] = useState("");
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const n = Number(qty.trim() === "" ? "1" : qty);
  const valid = connector !== "" && Number.isInteger(n) && n >= 1;
  const apply = async (e: Event) => {
    e.preventDefault();
    const butt = { connector, ...(n > 1 ? { qty: n } : {}) };
    const r = await sendCommands(
      [{ cmd: "setProject", args: { defaults: { butt } } }],
      `join ${fix.butts.length === 1 ? fix.butts[0] : `${fix.butts.length} butts`} with ${connector}`,
    );
    setOutcome(r);
    if (r.ok) done();
  };
  return (
    <form class="record-form fix-form" data-testid="connector-form" onSubmit={(e) => void apply(e)}>
      <label for="connector-fix">
        Connector, for {fix.butts.length === 1 ? fix.butts[0] : `all ${fix.butts.length}`}
      </label>
      <span>
        <ConnectorSelect
          id="connector-fix"
          testid="connector-fix"
          label="The connector every butt that names none takes"
          value={connector}
          systems={fix.systems}
          lead={[{ value: "", label: "Choose a connector…" }]}
          others
          onChange={setConnector}
        />
      </span>
      <label>
        Per end
        <input
          data-testid="connector-fix-qty"
          inputMode="numeric"
          size={3}
          placeholder="1"
          value={qty}
          onInput={(e) => setQty((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <button
        type="submit"
        class="btn primary"
        data-testid="connector-apply"
        disabled={busy.value || readOnly() || !valid}
      >
        Make it the default butt connector
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
      // The params are in the project panel (D-UX-4): the fix opens the param's row there.
      pointParam(fix.param);
    } else {
      setOpen(open === fix ? undefined : fix);
    }
  };
  const form = open;
  return (
    <>
      <div class="problem-actions">
        {children}
        {/* The problems offer a price form only for a project item (review M1). */}
        {p.fixes.map((fix) => (
          <button
            type="button"
            class="btn"
            key={fix.label}
            data-fix={fix.kind}
            disabled={busy.value || readOnly()}
            aria-expanded={form === fix}
            onClick={() => void run(fix)}
          >
            {fix.label}
          </button>
        ))}
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
      {form?.kind === "connector" && (
        <div class="fix-panel">
          <ConnectorForm fix={form} done={() => setOpen(undefined)} />
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
