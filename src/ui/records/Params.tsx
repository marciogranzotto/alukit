import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import { Errors } from "../Feedback.tsx";
import { select } from "../focus.ts";
import type { Model } from "../model.ts";
import { busy, type CommandOutcome, sendCommands, summary } from "../store.ts";
import { typedValue } from "../tools/typed.ts";

/**
 * The params (design §8, §4.2: a number, an expression, or a valued field), in the project panel
 * (D-UX-4, S2.12): each as written, its value in the variant derived and its provenance, edited
 * through `setParam`, each edit one step the top bar's undo takes back (§7.1). What a command
 * refuses is shown in its row, where the edit happened. A problem's "param" fix points at a row
 * (`pointParam`), which opens it for editing. Owner: S2.
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

/** The param a fix points at, and how many times one was pointed at (to point again). */
export const pointedParam = signal<{ name: string; n: number } | undefined>(undefined);
let points = 0;

/** Shows the project panel (by clearing the selection) with the param's row open to edit. */
export function pointParam(name: string): void {
  select([], "replace");
  pointedParam.value = { name, n: ++points };
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
  const row = useRef<HTMLTableRowElement>(null);
  const pointed = pointedParam.value;
  useEffect(() => {
    if (pointed?.name !== name) return;
    setEditing(paramText(written));
    row.current?.scrollIntoView({ block: "nearest" });
  }, [pointed?.n]);
  const set = async (e: Event) => {
    e.preventDefault();
    if (editing === undefined || editing.trim() === "") return;
    const r = await sendCommands(
      [{ cmd: "setParam", args: { name, value: editedParam(written, editing) } }],
      `set ${name}`,
      { inline: true },
    );
    setOutcome(r);
    if (r.ok) setEditing(undefined);
  };
  const remove = async () => {
    setOutcome(
      await sendCommands([{ cmd: "setParam", args: { name, value: null } }], `remove ${name}`, {
        inline: true,
      }),
    );
  };
  const prov = provenance(written);
  return (
    <>
      <tr data-param={name} ref={row} class={pointed?.name === name ? "pointed" : undefined}>
        <th scope="row">
          <code>{name}</code>
        </th>
        <td>
          {editing === undefined ? (
            <span title={prov || undefined}>
              <code>{paramText(written)}</code>
              {prov && <span class="sub"> · {prov}</span>}
            </span>
          ) : (
            <form class="inline-form" onSubmit={(e) => void set(e)}>
              <input
                data-testid="param-edit"
                aria-label={`${name}: a number or an expression`}
                value={editing}
                onInput={(e) => setEditing((e.currentTarget as HTMLInputElement).value)}
              />
              <button type="submit" class="btn" data-testid="param-set" disabled={busy.value}>
                Set
              </button>
              <button type="button" class="btn" onClick={() => setEditing(undefined)}>
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
        <td class="actions">
          <button
            type="button"
            class="btn"
            data-testid="param-change"
            aria-label={`Edit ${name}`}
            disabled={readOnly()}
            title={
              readOnly()
                ? "Read-only: fix the file, or restore the last good state"
                : `Edit ${name}`
            }
            onClick={() => setEditing(paramText(written))}
          >
            Edit
          </button>
          <button
            type="button"
            class="btn"
            data-testid="param-remove"
            aria-label={`Remove ${name}`}
            disabled={readOnly() || busy.value}
            title="Remove the param; refused while something reads it"
            onClick={() => void remove()}
          >
            ×
          </button>
        </td>
      </tr>
      {outcome && !outcome.ok && (
        <tr>
          <td colSpan={4}>
            <Errors outcome={outcome} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The params table, with the form that adds one. */
export function ParamsTable({ m }: { m: Model }) {
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
      { inline: true },
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
        <p class="sub">No params yet: a size the bars are written from, such as W = 1200.</p>
      ) : (
        <table class="grid params-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">As written</th>
              <th scope="col" class="n">
                Value{m.variant ? ` (${m.variant})` : ""}
              </th>
              <th scope="col">
                <span class="sr-only">Actions</span>
              </th>
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
          aria-label="A new param's name"
          placeholder="name"
          size={6}
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        <input
          data-testid="param-value-new"
          aria-label="Its value: a number or an expression"
          placeholder="value, e.g. W / 2"
          value={value}
          onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="btn"
          data-testid="param-apply"
          disabled={busy.value || readOnly() || name.trim() === "" || value.trim() === ""}
        >
          Add
        </button>
        <Errors outcome={outcome} />
      </form>
    </div>
  );
}
