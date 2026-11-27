import type { Order } from "#core/order/types.ts";
import { kg, money, plural } from "../format.ts";
import type { Model } from "../model.ts";
import { palette } from "../palette.ts";
import { ParamsTable } from "../records/Params.tsx";
import { openSheet } from "../sheets/registry.ts";
import { model } from "../store.ts";
import { useOutput, withAsOf } from "../tables/common.tsx";
import { settingsOpen } from "./open.ts";
import { readiness } from "./readiness.ts";
import { firstStepsHidden, hideFirstSteps, orderSeen, startedEmpty } from "./start.ts";

/**
 * What the inspector shows with nothing selected (D-UX-4, S2.12): the project panel. The
 * inspector (S5) renders it in its place. Three parts: First steps, on a project that started
 * empty in this tab, until all four tick or the person hides them; the project's summary (bars,
 * parts, mass, the likely cost and the order's state); and the params, editable, which were a
 * sheet of their own. Owner: S2.
 */

const count = (x: unknown) => (typeof x === "object" && x !== null ? Object.keys(x).length : 0);

/** The four first steps, each ticked by what the project and the tab hold (B §4.3). */
function steps(m: Model): { label: string; done: boolean }[] {
  return [
    { label: "Choose a profile to draw with", done: palette.value.bar !== undefined },
    { label: "Draw a bar", done: count(m.doc.bars) > 0 },
    { label: "Join two bars", done: count(m.doc.connections) > 0 },
    { label: "Read the order", done: orderSeen.value },
  ];
}

function FirstSteps({ m }: { m: Model }) {
  const list = steps(m);
  if (!startedEmpty.value || firstStepsHidden.value || list.every((s) => s.done)) return null;
  return (
    <section class="first-steps" aria-labelledby="first-steps-title" data-testid="first-steps">
      <div class="section-head">
        <h3 id="first-steps-title">First steps</h3>
        <button type="button" class="link" data-testid="first-steps-hide" onClick={hideFirstSteps}>
          Hide
        </button>
      </div>
      <ol>
        {list.map((s) => (
          <li key={s.label} class={s.done ? "done" : undefined}>
            <span class="tick" aria-hidden="true">
              {s.done ? "✓" : "○"}
            </span>
            {s.label}
            <span class="sr-only">{s.done ? ", done" : ", to do"}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The likely total of the order, in its currency, when it is priced. */
function likelyCost(o: Order | undefined): string | undefined {
  if (!o || o.suppliers.length === 0) return undefined;
  const t = o.totals.total;
  const cur = o.totals.currency ?? o.currency ?? "";
  return `${money(t.likely_minor)}${cur ? ` ${cur}` : ""}${o.totals.unpriced > 0 ? ` + ${plural(o.totals.unpriced, "line")} unpriced` : ""}`;
}

function Summary({ m }: { m: Model }) {
  const order = useOutput<Order>(withAsOf("/api/order"), m.rev);
  const o = order && !("error" in order) ? order.value : undefined;
  const r = readiness();
  const cost = likelyCost(o);
  return (
    <section aria-labelledby="summary-title">
      <h3 id="summary-title">This project</h3>
      <dl class="summary" data-testid="project-summary">
        <dt>Bars</dt>
        <dd>{count(m.derived.bars)}</dd>
        <dt>Parts</dt>
        <dd>{count(m.derived.parts)}</dd>
        <dt>Joints</dt>
        <dd>{count(m.doc.connections)}</dd>
        <dt>Mass</dt>
        <dd>
          {kg(m.bom.mass_kg)} kg
          {m.bom.mass_unknown.length > 0 && (
            <span class="sub" title={m.bom.mass_unknown.join(", ")}>
              {" "}
              + {plural(m.bom.mass_unknown.length, "item")} with no mass
            </span>
          )}
        </dd>
        {cost && (
          <>
            <dt>Likely cost</dt>
            <dd>{cost}</dd>
          </>
        )}
        {r && (
          <>
            <dt>Order</dt>
            <dd>
              <button type="button" class="link" onClick={() => openSheet("order")}>
                {r.text}
              </button>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

export function ProjectPanel() {
  const m = model.value;
  if (!m) return null;
  return (
    <div class="project-panel" data-testid="project-panel">
      <div class="section-head">
        <h2>{m.name ?? "Project"}</h2>
        <button
          type="button"
          class="btn"
          data-testid="open-settings"
          onClick={() => {
            settingsOpen.value = true;
          }}
        >
          Settings…
        </button>
      </div>
      <FirstSteps m={m} />
      <Summary m={m} />
      <section aria-labelledby="params-title">
        <h3 id="params-title">Params</h3>
        <ParamsTable m={m} />
      </section>
      <p class="panel-hint">
        Select a bar, part or connection: click it, Shift-drag a box, or pick it in the outline.
      </p>
    </div>
  );
}
