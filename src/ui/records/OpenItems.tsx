import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import { EntityChips } from "../common/EntityChip.tsx";
import { Errors } from "../Feedback.tsx";
import { selection } from "../focus.ts";
import type { Model } from "../model.ts";
import { registerSheet } from "../sheets/registry.ts";
import { busy, type CommandOutcome, sendCommands, summary } from "../store.ts";

/**
 * The open items (design §8, §4.12): the document's list, each resolvable, and a form to add one;
 * edited through `addOpen` and `resolveOpen`, each edit one batch, so one step the top bar's undo
 * takes back (§7.1). What a command refuses is shown where it was asked, field by field. Owner:
 * S4, whose Problems sheet takes it in (S4.8).
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

export function OpenItemsSheet({ m }: { m: Model }) {
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
                      <EntityChips ids={o.scope} />
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

registerSheet({ id: "open-items", title: "Open items", order: 70, Body: OpenItemsSheet });
