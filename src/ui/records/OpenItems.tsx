import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import { EntityChips } from "../common/EntityChip.tsx";
import { Errors } from "../Feedback.tsx";
import { selection } from "../focus.ts";
import type { Model } from "../model.ts";
import { busy, type CommandOutcome, sendCommands, summary } from "../store.ts";
import { Clip, type Col, Row, SheetTable } from "../tables/common.tsx";
import { ResolveForm } from "./ResolveForm.tsx";

/**
 * The open items (design §8, §4.12): the document's list, each resolvable, and a form to add one;
 * edited through `addOpen` and `resolveOpen`, each edit one batch, so one step the top bar's undo
 * takes back (§7.1). What a command refuses is shown where it was asked, field by field. It is a
 * section of the Problems sheet, since an open item that blocks the order is a problem. Owner: S4.
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

export function openItems(m: Model): OpenItem[] {
  const list = m.doc.open;
  return Array.isArray(list) ? (list.filter(isObject) as unknown as OpenItem[]) : [];
}

const COLS: readonly Col[] = [
  { id: "id", head: "Item", w: "64px" },
  { id: "text", head: "Open question" },
  { id: "blocks", head: "Holds", w: "132px" },
  { id: "scope", head: "Scope", w: "230px" },
  { id: "action", head: "", w: "112px", align: "right" },
];

export function OpenItemsSection({ m }: { m: Model }) {
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
    <section class="block" data-testid="open-items">
      <h4 class="block-head">
        <span class="figure">Open items</span>
        <span class="sub">Questions the project still has to answer</span>
      </h4>
      {items.length === 0 ? (
        <p class="sub pad">No open items.</p>
      ) : (
        <SheetTable cols={COLS}>
          <tbody>
            {items.map((o) => (
              <Fragment key={o.id}>
                <Row data-open={o.id} {...(o.scope && o.scope.length > 0 ? { ids: o.scope } : {})}>
                  <td>
                    <b>{o.id}</b>
                  </td>
                  <td>
                    <Clip text={o.text} />
                  </td>
                  <td>{o.blocks === "order" ? "The order" : "Nothing"}</td>
                  <td>
                    {o.scope && o.scope.length > 0 ? (
                      <EntityChips ids={o.scope} />
                    ) : o.blocks === "order" ? (
                      <span class="sub">Every supplier</span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td class="n">
                    <button
                      type="button"
                      class="btn"
                      data-testid="resolve"
                      disabled={readOnly()}
                      aria-expanded={resolving === o.id}
                      onClick={() => setResolving(resolving === o.id ? undefined : o.id)}
                    >
                      Resolve…
                    </button>
                  </td>
                </Row>
                {resolving === o.id && (
                  <tr class="detail">
                    <td />
                    <td colSpan={COLS.length - 1}>
                      <ResolveForm id={o.id} done={() => setResolving(undefined)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </SheetTable>
      )}
      <form class="record-form" data-testid="open-add" onSubmit={(e) => void add(e)}>
        <input
          class="wide"
          data-testid="open-text"
          aria-label="An open item"
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
          Holds the order
        </label>
        <input
          data-testid="open-scope"
          aria-label="Scope"
          placeholder="scope: ids (all if empty)"
          value={scope}
          onInput={(e) => setScope((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="btn"
          title="The selected entities"
          onClick={() => setScope([...selection.value].sort(compareIds).join(", "))}
        >
          Use selection
        </button>
        <button
          type="submit"
          class="btn primary"
          data-testid="open-apply"
          disabled={busy.value || readOnly() || text.trim() === ""}
        >
          Add
        </button>
        <Errors outcome={outcome} />
      </form>
    </section>
  );
}
