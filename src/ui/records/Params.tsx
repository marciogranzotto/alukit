import { useState } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import { Errors } from "../Feedback.tsx";
import type { Model } from "../model.ts";
import { registerSheet } from "../sheets/registry.ts";
import { busy, type CommandOutcome, sendCommands, summary } from "../store.ts";
import { typedValue } from "../tools.ts";

/**
 * The params (design §8, §4.2: a number, an expression, or a valued field): each as written, its
 * value in the variant derived and its provenance, edited through `setParam`, each edit one step
 * the top bar's undo takes back (§7.1). What a command refuses is shown in its row. Owner: S2,
 * which moves it to the project panel (D-UX-4, S2.12).
 */

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const readOnly = () => summary.value?.status.readOnly === true;

/** A param as written, as text: a number or an expression; a valued field's `v`. */
export function paramText(p: unknown): string {
  if (typeof p === "number" || typeof p === "string") return String(p);
  if (isObject(p) && (typeof p.v === "number" || typeof p.v === "string")) return String(p.v);
  return JSON.stringify(p);
}

/** The value `setParam` takes for a typed edit: a valued field keeps its provenance. */
export function editedParam(was: unknown, text: string): unknown {
  const v = typedValue(text);
  return isObject(was) ? { ...was, v } : v;
}

function provenance(p: unknown): string {
  if (!isObject(p)) return "";
  return [
    typeof p.src === "string" ? p.src : undefined,
    typeof p.read === "string" ? `read ${p.read}` : undefined,
    typeof p.ref === "string" ? p.ref : undefined,
    typeof p.note === "string" ? p.note : undefined,
  ]
    .filter((x) => x !== undefined)
    .join("; ");
}

function ParamRow({
  name,
  written,
  value,
  override,
}: {
  name: string;
  written: unknown;
  value: number | undefined;
  override: unknown;
}) {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const set = async (e: Event) => {
    e.preventDefault();
    if (editing === undefined || editing.trim() === "") return;
    const r = await sendCommands(
      [{ cmd: "setParam", args: { name, value: editedParam(written, editing) } }],
      `set ${name}`,
    );
    setOutcome(r);
    if (r.ok) setEditing(undefined);
  };
  const remove = async () => {
    setOutcome(
      await sendCommands([{ cmd: "setParam", args: { name, value: null } }], `remove ${name}`),
    );
  };
  return (
    <>
      <tr data-param={name}>
        <td>
          <code>{name}</code>
        </td>
        <td>
          {editing === undefined ? (
            <code>{paramText(written)}</code>
          ) : (
            <form class="inline-form" onSubmit={(e) => void set(e)}>
              <input
                data-testid="param-edit"
                value={editing}
                onInput={(e) => setEditing((e.currentTarget as HTMLInputElement).value)}
              />
              <button type="submit" class="tp-btn" data-testid="param-set" disabled={busy.value}>
                Set
              </button>
              <button type="button" class="tp-btn" onClick={() => setEditing(undefined)}>
                Cancel
              </button>
            </form>
          )}
          {override !== undefined && (
            <span class="sub"> (this variant: {paramText(override)})</span>
          )}
        </td>
        <td class="n" data-testid="param-value">
          {value === undefined ? "" : value}
        </td>
        <td class="sub">{provenance(written)}</td>
        <td>
          <button
            type="button"
            class="tp-btn"
            data-testid="param-change"
            disabled={readOnly()}
            onClick={() => setEditing(paramText(written))}
          >
            Edit
          </button>{" "}
          <button
            type="button"
            class="tp-btn"
            data-testid="param-remove"
            disabled={readOnly() || busy.value}
            title="Remove the param; refused while something reads it"
            onClick={() => void remove()}
          >
            Remove
          </button>
        </td>
      </tr>
      {outcome && !outcome.ok && (
        <tr>
          <td />
          <td colSpan={4}>
            <Errors outcome={outcome} />
          </td>
        </tr>
      )}
    </>
  );
}

export function ParamsSheet({ m }: { m: Model }) {
  const params = isObject(m.doc.params) ? m.doc.params : {};
  const names = Object.keys(params).sort(compareIds);
  const variants = isObject(m.doc.variants) ? m.doc.variants : {};
  const list = isObject(variants.list) ? variants.list : {};
  const inVariant = m.variant !== null ? list[m.variant] : undefined;
  const overrides = isObject(inVariant) && isObject(inVariant.params) ? inVariant.params : {};
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const add = async (e: Event) => {
    e.preventDefault();
    const r = await sendCommands(
      [{ cmd: "setParam", args: { name: name.trim(), value: typedValue(value) } }],
      `set ${name.trim()}`,
    );
    setOutcome(r);
    if (r.ok) {
      setName("");
      setValue("");
    }
  };
  return (
    <div data-testid="params">
      {names.length === 0 ? (
        <p class="sub">No params.</p>
      ) : (
        <table class="grid">
          <thead>
            <tr>
              <th>name</th>
              <th>as written</th>
              <th class="n">value{m.variant ? ` (${m.variant})` : ""}</th>
              <th>provenance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {names.map((n) => (
              <ParamRow
                key={n}
                name={n}
                written={params[n]}
                value={m.derived.params[n]}
                override={Object.hasOwn(overrides, n) ? overrides[n] : undefined}
              />
            ))}
          </tbody>
        </table>
      )}
      <form class="record-form" data-testid="param-add" onSubmit={(e) => void add(e)}>
        <input
          data-testid="param-name"
          placeholder="name"
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        <input
          data-testid="param-value-new"
          placeholder="a number or an expression, e.g. W / 2"
          value={value}
          onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="tp-btn"
          data-testid="param-apply"
          disabled={busy.value || readOnly() || name.trim() === "" || value.trim() === ""}
        >
          Set
        </button>
        <Errors outcome={outcome} />
      </form>
    </div>
  );
}

registerSheet({ id: "params", title: "Params", order: 80, Body: ParamsSheet });
