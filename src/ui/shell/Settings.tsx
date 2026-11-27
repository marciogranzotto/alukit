import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Order } from "#core/order/types.ts";
import type { ItemCard } from "../../server/catalog.ts";
import { getAtRev } from "../api.ts";
import { cardOf } from "../catalog/state.ts";
import { ConnectorSelect } from "../common/ConnectorSelect.tsx";
import { Errors } from "../Feedback.tsx";
import type { Model } from "../model.ts";
import { optionFields } from "../options.ts";
import { busy, type CommandOutcome, model, sendCommands, summary } from "../store.ts";
import { Dialog } from "./Dialog.tsx";

/**
 * Project settings (S2.11, BE-1): the name, the catalogs, the currency, the price basis and the
 * exchange rates, the default bar and its options, the cutting allowances, the corner rule and
 * the order rules. Saving sends what changed as one `setProject` step, a merge patch over the
 * document (RFC 7396: a field set to null is removed), which the top bar's undo takes back; a
 * refusal shows under the form. Owner: S2.
 */

export const settingsOpen = signal(false);

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const obj = (x: unknown): Record<string, unknown> => (isObject(x) ? x : {});
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const num = (x: unknown): string => (typeof x === "number" ? String(x) : "");

/** The settings as the form edits them: text, as typed. */
interface Form {
  name: string;
  catalogs: string[];
  currency: string;
  price_basis: string;
  /** Exchange rates: units of the project's currency per unit of each other one. */
  fx: Record<string, string>;
  barItem: string;
  barOpt: Record<string, string>;
  kerf: string;
  trim: string;
  corner: string;
  /** The default butt connector (review B1), which every butt that names none takes. */
  buttConnector: string;
  /** Connectors per butting end, typed: empty for one. */
  buttQty: string;
  /** The order rules the document sets; "" leaves a rule at its default. */
  rules: Record<string, string>;
}

const rateOf = (r: unknown) => (typeof r === "number" ? String(r) : num(obj(r).v));

export function formOf(doc: Record<string, unknown>): Form {
  const defaults = obj(doc.defaults);
  const bar = obj(defaults.bar);
  const butt = obj(defaults.butt);
  const cutting = obj(defaults.cutting);
  return {
    name: str(doc.name),
    catalogs: Array.isArray(doc.catalogs) ? doc.catalogs.filter((c) => typeof c === "string") : [],
    currency: str(doc.currency),
    price_basis: str(doc.price_basis),
    fx: Object.fromEntries(Object.entries(obj(doc.fx)).map(([k, v]) => [k, rateOf(v)])),
    barItem: str(bar.item),
    barOpt: Object.fromEntries(Object.entries(obj(bar.opt)).map(([k, v]) => [k, str(v)])),
    kerf: num(cutting.kerf_mm),
    trim: num(cutting.trim_mm),
    corner: str(defaults.corner),
    buttConnector: str(butt.connector),
    buttQty: num(butt.qty),
    rules: Object.fromEntries(Object.entries(obj(doc.order_rules)).map(([k, v]) => [k, str(v)])),
  };
}

/** A number typed, or null to remove the field; undefined when it is not a number. */
function typedNumber(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** Each key of `after` that differs from `before`, and null for each key `after` dropped. */
function mapPatch(
  before: Record<string, string>,
  after: Record<string, string>,
  value: (key: string, text: string) => unknown,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = after[k] ?? "";
    if ((before[k] ?? "") === a) continue;
    out[k] = a === "" ? null : value(k, a);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The merge patch from the form as it was to the form as it is: only what changed, so a step
 * says what it did ("set currency"), and a field the person left alone is never rewritten. An
 * exchange rate written with its provenance keeps it, its `v` replaced.
 */
export function settingsPatch(
  doc: Record<string, unknown>,
  was: Form,
  now: Form,
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  const text = (k: "name" | "currency" | "price_basis") => {
    if (was[k] !== now[k]) patch[k] = now[k].trim() === "" ? null : now[k].trim();
  };
  text("name");
  text("currency");
  text("price_basis");
  if (JSON.stringify(was.catalogs) !== JSON.stringify(now.catalogs)) patch.catalogs = now.catalogs;

  const docFx = obj(doc.fx);
  let bad: string | undefined;
  const fx = mapPatch(was.fx, now.fx, (cur, t) => {
    const v = typedNumber(t);
    if (typeof v !== "number" || v <= 0) bad = `the rate for ${cur} is not a positive number`;
    return isObject(docFx[cur]) ? { ...docFx[cur], v } : v;
  });
  if (fx) patch.fx = fx;

  const defaults: Record<string, unknown> = {};
  const bar: Record<string, unknown> = {};
  if (was.barItem !== now.barItem) bar.item = now.barItem.trim() === "" ? null : now.barItem.trim();
  const opt = mapPatch(was.barOpt, now.barOpt, (_k, t) => t);
  if (opt) bar.opt = opt;
  if (Object.keys(bar).length > 0) defaults.bar = bar;
  const cutting: Record<string, unknown> = {};
  for (const [k, f] of [
    ["kerf_mm", "kerf"],
    ["trim_mm", "trim"],
  ] as const) {
    if (was[f] === now[f]) continue;
    const v = typedNumber(now[f]);
    if (v === undefined || (typeof v === "number" && v < 0)) bad = `${k} is not a length in mm`;
    cutting[k] = v;
  }
  if (Object.keys(cutting).length > 0) defaults.cutting = cutting;
  if (was.corner !== now.corner) defaults.corner = now.corner === "" ? null : now.corner;
  const butt: Record<string, unknown> = {};
  if (was.buttConnector !== now.buttConnector)
    butt.connector = now.buttConnector === "" ? null : now.buttConnector;
  if (was.buttQty !== now.buttQty) {
    const q = typedNumber(now.buttQty);
    if (q !== null && !(Number.isInteger(q) && (q as number) >= 1))
      bad = "connectors per end: a whole number, 1 or more";
    butt.qty = q;
  }
  if (Object.keys(butt).length > 0) defaults.butt = butt;
  if (Object.keys(defaults).length > 0) patch.defaults = defaults;

  const rules = mapPatch(was.rules, now.rules, (_k, t) => t);
  if (rules) patch.order_rules = rules;
  if (bad) return { error: bad };
  return { patch };
}

const CURRENCIES = ["BRL", "USD", "EUR", "GBP", "CNY", "JPY"];

/** The order rules in words, their codes shown small beside them (review m10; design §5.5). */
const RULE_LABELS: Readonly<Record<string, string>> = {
  "check-error": "An error in the model",
  "open-item": "An open item",
  placeholder: "A placeholder",
  "missing-price": "A price is missing",
  "est-price": "A price is an estimate",
  "out-of-stock": "Out of stock",
  "option-not-sold": "An option is not sold",
  "stale-price": "A price is over 30 days old",
  "no-connector": "Butts with no connector",
};
const CORNER_WORDS: Readonly<Record<string, string>> = {
  "": "the default: a vertical bar runs through",
  vertical: "a vertical bar runs through",
  x: "the bar along x runs through",
  y: "the bar along y runs through",
  first: "the lower-numbered bar runs through",
};

/** A row of the form: its label, pointing at the control when it has one, and the control. */
function Field({
  label,
  for: control,
  children,
}: {
  label: string;
  for?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="field">
      {control ? <label htmlFor={control}>{label}</label> : <span>{label}</span>}
      {children}
    </div>
  );
}

function SettingsForm({ m }: { m: Model }) {
  const [was] = useState(() => formOf(m.doc));
  const [f, setF] = useState(was);
  const [newCatalog, setNewCatalog] = useState("");
  const [newFx, setNewFx] = useState("");
  const [card, setCard] = useState<ItemCard | undefined>();
  const [rules, setRules] = useState<Record<string, string> | undefined>();
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const [error, setError] = useState<string | undefined>();
  const set = (p: Partial<Form>) => setF({ ...f, ...p });
  const readOnly = summary.value?.status.readOnly === true;

  // The default bar's options come from its card; the rules' effective actions from the order.
  useEffect(() => {
    if (!f.barItem) return setCard(undefined);
    let live = true;
    cardOf(f.barItem).then(
      (c) => live && setCard(c),
      () => live && setCard(undefined),
    );
    return () => {
      live = false;
    };
  }, [f.barItem]);
  useEffect(() => {
    getAtRev<Order>("/api/order").then(
      (r) => setRules(r.body.rules as Record<string, string>),
      () => setRules({}),
    );
  }, []);

  const save = async (e: Event) => {
    e.preventDefault();
    const p = settingsPatch(m.doc, was, f);
    if ("error" in p) {
      setError(p.error);
      return;
    }
    setError(undefined);
    if (Object.keys(p.patch).length === 0) {
      settingsOpen.value = false;
      return;
    }
    const r = await sendCommands([{ cmd: "setProject", args: p.patch }], "project settings", {
      inline: true,
    });
    setOutcome(r);
    if (r.ok) settingsOpen.value = false;
  };
  const fields = card ? optionFields(card.options, card.offers, undefined) : [];

  return (
    <form class="settings-form" data-testid="settings-form" onSubmit={(e) => void save(e)}>
      <fieldset>
        <legend>Project</legend>
        <Field label="Name" for="settings-name">
          <input
            data-testid="settings-name"
            id="settings-name"
            data-autofocus
            value={f.name}
            onInput={(e) => set({ name: (e.currentTarget as HTMLInputElement).value })}
          />
        </Field>
        <div class="field">
          <span>Catalogs</span>
          <ul class="catalog-list" data-testid="settings-catalogs">
            {f.catalogs.map((c) => (
              <li key={c}>
                <code>{c}</code>
                <button
                  type="button"
                  class="link"
                  aria-label={`Remove the catalog ${c}`}
                  onClick={() => set({ catalogs: f.catalogs.filter((x) => x !== c) })}
                >
                  Remove
                </button>
              </li>
            ))}
            <li>
              <input
                data-testid="settings-catalog-new"
                aria-label="A catalog to add: a built-in id, or a folder inside the project"
                placeholder="a built-in id, or a folder in the project"
                value={newCatalog}
                onInput={(e) => setNewCatalog((e.currentTarget as HTMLInputElement).value)}
              />
              <button
                type="button"
                class="btn"
                disabled={newCatalog.trim() === "" || f.catalogs.includes(newCatalog.trim())}
                onClick={() => {
                  set({ catalogs: [...f.catalogs, newCatalog.trim()] });
                  setNewCatalog("");
                }}
              >
                Add
              </button>
            </li>
          </ul>
        </div>
      </fieldset>
      <fieldset>
        <legend>Prices</legend>
        <Field label="Currency" for="settings-currency">
          <input
            data-testid="settings-currency"
            id="settings-currency"
            list="settings-currencies"
            size={5}
            value={f.currency}
            onInput={(e) =>
              set({ currency: (e.currentTarget as HTMLInputElement).value.toUpperCase() })
            }
          />
          <datalist id="settings-currencies">
            {CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Price basis" for="settings-basis">
          <select
            data-testid="settings-basis"
            id="settings-basis"
            value={f.price_basis}
            onChange={(e) => set({ price_basis: (e.currentTarget as HTMLSelectElement).value })}
          >
            <option value="">the default (regular)</option>
            <option value="regular">regular prices</option>
            <option value="sale">sale prices where there are</option>
            <option value="lowest">the lowest of the two</option>
          </select>
        </Field>
        <div class="field">
          <span>Exchange rates</span>
          <ul class="catalog-list">
            {Object.keys(f.fx).map((cur) => (
              <li key={cur}>
                1 {cur} ={" "}
                <input
                  aria-label={`${f.currency || "the project's currency"} per ${cur}`}
                  size={8}
                  value={f.fx[cur]}
                  onInput={(e) =>
                    set({ fx: { ...f.fx, [cur]: (e.currentTarget as HTMLInputElement).value } })
                  }
                />{" "}
                {f.currency}
                <button
                  type="button"
                  class="link"
                  aria-label={`Remove the rate for ${cur}`}
                  onClick={() => {
                    const { [cur]: _, ...rest } = f.fx;
                    set({ fx: rest });
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
            <li>
              <input
                aria-label="A currency to add a rate for"
                placeholder="USD"
                size={5}
                value={newFx}
                onInput={(e) => setNewFx((e.currentTarget as HTMLInputElement).value.toUpperCase())}
              />
              <button
                type="button"
                class="btn"
                disabled={!/^[A-Z]{3}$/.test(newFx) || newFx in f.fx}
                onClick={() => {
                  set({ fx: { ...f.fx, [newFx]: "" } });
                  setNewFx("");
                }}
              >
                Add a rate
              </button>
            </li>
          </ul>
        </div>
      </fieldset>
      <fieldset>
        <legend>Drawing</legend>
        <Field label="Default bar">
          <code data-testid="settings-bar">{f.barItem || "none"}</code>
          <span class="sub">(choose another in the catalog: Make it the default)</span>
        </Field>
        {fields.map((o) => (
          <Field
            key={o.name}
            label={o.name.charAt(0).toUpperCase() + o.name.slice(1)}
            for={`settings-opt-${o.name}`}
          >
            <select
              data-testid={`settings-opt-${o.name}`}
              id={`settings-opt-${o.name}`}
              value={f.barOpt[o.name] ?? ""}
              onChange={(e) =>
                set({
                  barOpt: { ...f.barOpt, [o.name]: (e.currentTarget as HTMLSelectElement).value },
                })
              }
            >
              <option value="">none: each bar chooses</option>
              {o.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                  {c.sold ? "" : " (not sold)"}
                </option>
              ))}
            </select>
          </Field>
        ))}
        <Field label="Corner rule" for="settings-corner">
          <select
            data-testid="settings-corner"
            id="settings-corner"
            value={f.corner}
            onChange={(e) => set({ corner: (e.currentTarget as HTMLSelectElement).value })}
          >
            {Object.entries(CORNER_WORDS).map(([v, w]) => (
              <option key={v} value={v}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default butt connector" for="settings-butt">
          <ConnectorSelect
            id="settings-butt"
            testid="settings-butt"
            label="The connector every butt that names none takes"
            value={f.buttConnector}
            systems={card?.entry.system ? [card.entry.system] : []}
            lead={[{ value: "", label: "none: each butt names its own" }]}
            others
            onChange={(v) => set({ buttConnector: v })}
          />
          {f.buttConnector !== "" && (
            <label>
              ×{" "}
              <input
                data-testid="settings-butt-qty"
                aria-label="Connectors per butting end"
                inputMode="numeric"
                size={3}
                placeholder="1"
                value={f.buttQty}
                onInput={(e) => set({ buttQty: (e.currentTarget as HTMLInputElement).value })}
              />{" "}
              per end
            </label>
          )}
        </Field>
        <Field label="Saw kerf, mm" for="settings-kerf">
          <input
            data-testid="settings-kerf"
            id="settings-kerf"
            inputMode="decimal"
            size={6}
            value={f.kerf}
            onInput={(e) => set({ kerf: (e.currentTarget as HTMLInputElement).value })}
          />
        </Field>
        <Field label="End trim, mm" for="settings-trim">
          <input
            data-testid="settings-trim"
            id="settings-trim"
            inputMode="decimal"
            size={6}
            value={f.trim}
            onInput={(e) => set({ trim: (e.currentTarget as HTMLInputElement).value })}
          />
        </Field>
      </fieldset>
      <fieldset>
        <legend>Order rules</legend>
        {rules === undefined ? (
          <p class="sub">Reading the order's rules…</p>
        ) : (
          <div class="rules">
            {Object.keys(rules).map((rule) => (
              <label key={rule} class="rule">
                <span>
                  {RULE_LABELS[rule] ?? rule} <code class="sub">{rule}</code>
                </span>
                <select
                  data-testid={`settings-rule-${rule}`}
                  value={f.rules[rule] ?? ""}
                  onChange={(e) =>
                    set({
                      rules: { ...f.rules, [rule]: (e.currentTarget as HTMLSelectElement).value },
                    })
                  }
                >
                  <option value="">the default{was.rules[rule] ? "" : ` (${rules[rule]})`}</option>
                  <option value="block">blocks the order</option>
                  <option value="warn">warns</option>
                  <option value="off">off</option>
                </select>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {error && <p class="msg-error">{error}</p>}
      <Errors outcome={outcome} />
      <div class="dialog-actions">
        <button
          type="submit"
          class="btn primary"
          data-testid="settings-save"
          disabled={busy.value || readOnly}
          title={readOnly ? "Read-only: fix the file, or restore the last good state" : undefined}
        >
          Save, as one step
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            settingsOpen.value = false;
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Settings() {
  const m = model.value;
  if (!settingsOpen.value || !m) return null;
  return (
    <Dialog
      title="Project settings"
      testid="settings"
      wide
      onClose={() => {
        settingsOpen.value = false;
      }}
    >
      <SettingsForm m={m} />
    </Dialog>
  );
}
