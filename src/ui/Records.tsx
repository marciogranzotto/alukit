import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import { Errors } from "./Feedback.tsx";
import type { Model } from "./model.ts";
import { busy, type CommandOutcome, select, selection, sendCommands, summary } from "./store.ts";
import { typedValue } from "./tools.ts";

/**
 * The drawer's record tabs (design §8, §4.12): open items, params and decisions, as the document
 * writes them, each edited through its commands (`addOpen`, `resolveOpen`, `setParam`,
 * `addDecision`). Every edit is one batch, so one step the top bar's undo takes back (§7.1).
 * What a command refuses is shown where it was asked, field by field.
 */

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const readOnly = () => summary.value?.status.readOnly === true;

/** Ids typed or picked: separated by commas or spaces. */
export function idList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function Ids({ ids }: { ids: readonly string[] }) {
  const sel = selection.value;
  return (
    <span class="sources">
      {ids.map((id) => (
        <button
          type="button"
          key={id}
          class={`link${sel.has(id) ? " selected" : ""}`}
          onClick={(e) => select([id], e.ctrlKey || e.metaKey ? "toggle" : "replace")}
        >
          {id}
        </button>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Open items (§4.12)

interface OpenItem {
  id: string;
  text: string;
  blocks?: "order" | null;
  scope?: string[];
}

function openItems(m: Model): OpenItem[] {
  const list = m.doc.open;
  return Array.isArray(list) ? (list.filter(isObject) as unknown as OpenItem[]) : [];
}

function ResolveForm({ item, done }: { item: OpenItem; done: () => void }) {
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const resolve = async (e: Event) => {
    e.preventDefault();
    const args = {
      id: item.id,
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(why.trim() ? { why: why.trim() } : {}),
    };
    const r = await sendCommands([{ cmd: "resolveOpen", args }], `resolve ${item.id}`);
    setOutcome(r);
    if (r.ok) done();
  };
  return (
    <form class="record-form" data-testid="resolve-form" onSubmit={(e) => void resolve(e)}>
      <input
        data-testid="resolve-text"
        placeholder={`what was decided (default: resolved: ${item.text})`}
        value={text}
        onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
      />
      <input
        data-testid="resolve-why"
        placeholder="why (optional)"
        value={why}
        onInput={(e) => setWhy((e.currentTarget as HTMLInputElement).value)}
      />
      <button
        type="submit"
        class="tp-btn"
        data-testid="resolve-apply"
        disabled={busy.value || readOnly()}
      >
        Resolve
      </button>
      <button type="button" class="tp-btn" onClick={done}>
        Cancel
      </button>
      <Errors outcome={outcome} />
    </form>
  );
}

export function OpenItemsTab({ m }: { m: Model }) {
  const items = openItems(m);
  const [resolving, setResolving] = useState<string | undefined>(undefined);
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState(true);
  const [scope, setScope] = useState("");
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const add = async (e: Event) => {
    e.preventDefault();
    const ids = idList(scope);
    const open = {
      text: text.trim(),
      blocks: blocks ? "order" : null,
      ...(ids.length > 0 ? { scope: ids } : {}),
    };
    const r = await sendCommands([{ cmd: "addOpen", args: { open } }], "add open item");
    setOutcome(r);
    if (r.ok) {
      setText("");
      setScope("");
    }
  };
  return (
    <div data-testid="open-items">
      {items.length === 0 ? (
        <p class="sub">No open items.</p>
      ) : (
        <table class="grid">
          <thead>
            <tr>
              <th>id</th>
              <th>text</th>
              <th>blocks</th>
              <th>scope</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <Fragment key={o.id}>
                <tr data-open={o.id}>
                  <td>{o.id}</td>
                  <td>{o.text}</td>
                  <td>{o.blocks === "order" ? "the order" : ""}</td>
                  <td>
                    {o.scope && o.scope.length > 0 ? (
                      <Ids ids={o.scope} />
                    ) : o.blocks === "order" ? (
                      "every supplier"
                    ) : (
                      ""
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      class="tp-btn"
                      data-testid="resolve"
                      disabled={readOnly()}
                      onClick={() => setResolving(resolving === o.id ? undefined : o.id)}
                    >
                      Resolve…
                    </button>
                  </td>
                </tr>
                {resolving === o.id && (
                  <tr>
                    <td />
                    <td colSpan={4}>
                      <ResolveForm item={o} done={() => setResolving(undefined)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <form class="record-form" data-testid="open-add" onSubmit={(e) => void add(e)}>
        <input
          class="wide"
          data-testid="open-text"
          placeholder="an open item, e.g. confirm the screw length"
          value={text}
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        />
        <label>
          <input
            type="checkbox"
            data-testid="open-blocks"
            checked={blocks}
            onChange={() => setBlocks(!blocks)}
          />{" "}
          blocks the order
        </label>
        <input
          data-testid="open-scope"
          placeholder="scope: ids (all if empty)"
          value={scope}
          onInput={(e) => setScope((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="tp-btn"
          title="The selected entities"
          onClick={() => setScope([...selection.value].sort(compareIds).join(", "))}
        >
          use selection
        </button>
        <button
          type="submit"
          class="tp-btn"
          data-testid="open-apply"
          disabled={busy.value || readOnly() || text.trim() === ""}
        >
          Add
        </button>
        <Errors outcome={outcome} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Params (§4.2: a number, an expression, or a valued field)

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

export function ParamsTab({ m }: { m: Model }) {
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

// ---------------------------------------------------------------------------------------------
// Decisions (§4.12)

interface Decision {
  id?: string;
  date?: string;
  text?: string;
  why?: string;
  resolves?: string;
}

export function DecisionsTab({ m }: { m: Model }) {
  const list = Array.isArray(m.doc.decisions)
    ? (m.doc.decisions.filter(isObject) as Decision[])
    : [];
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [date, setDate] = useState("");
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const add = async (e: Event) => {
    e.preventDefault();
    const args = {
      text: text.trim(),
      ...(why.trim() ? { why: why.trim() } : {}),
      ...(date ? { date } : {}),
    };
    const r = await sendCommands([{ cmd: "addDecision", args }], "add decision");
    setOutcome(r);
    if (r.ok) {
      setText("");
      setWhy("");
      setDate("");
    }
  };
  return (
    <div data-testid="decisions">
      {list.length === 0 ? (
        <p class="sub">No decisions recorded.</p>
      ) : (
        <table class="grid">
          <thead>
            <tr>
              <th>id</th>
              <th>date</th>
              <th>decision</th>
              <th>why</th>
              <th>resolves</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d, i) => (
              <tr key={d.id ?? i} data-decision={d.id ?? ""}>
                <td>{d.id ?? ""}</td>
                <td>{d.date ?? ""}</td>
                <td>{d.text ?? ""}</td>
                <td>{d.why ?? ""}</td>
                <td>{d.resolves ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form class="record-form" data-testid="decision-add" onSubmit={(e) => void add(e)}>
        <input
          class="wide"
          data-testid="decision-text"
          placeholder="a decision, e.g. use M6 throughout"
          value={text}
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        />
        <input
          data-testid="decision-why"
          placeholder="why (optional)"
          value={why}
          onInput={(e) => setWhy((e.currentTarget as HTMLInputElement).value)}
        />
        <input
          type="date"
          data-testid="decision-date"
          title="Today when left empty"
          value={date}
          onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="tp-btn"
          data-testid="decision-apply"
          disabled={busy.value || readOnly() || text.trim() === ""}
        >
          Record
        </button>
        <Errors outcome={outcome} />
      </form>
    </div>
  );
}
