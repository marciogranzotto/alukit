import { useState } from "preact/hooks";
import { EmptyState } from "../common/EmptyState.tsx";
import { Errors } from "../Feedback.tsx";
import { date } from "../format.ts";
import type { Model } from "../model.ts";
import { busy, type CommandOutcome, sendCommands, summary } from "../store.ts";
import { Clip, type Col, Row, SheetTable } from "../tables/common.tsx";

/**
 * The decisions (design §8, §4.12): the document's record, dated, with why and what each
 * resolves, and a form to add one through `addDecision`, one step the top bar's undo takes back
 * (§7.1). A section of the Records sheet. Owner: S4.
 */

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const readOnly = () => summary.value?.status.readOnly === true;

interface Decision {
  id?: string;
  date?: string;
  text?: string;
  why?: string;
  resolves?: string;
}

const COLS: readonly Col[] = [
  { id: "id", head: "Decision", w: "80px" },
  { id: "date", head: "Date", w: "112px" },
  { id: "text", head: "What was decided" },
  { id: "why", head: "Why" },
  { id: "resolves", head: "Resolves", w: "88px" },
];

export function DecisionsSection({ m }: { m: Model }) {
  const list = Array.isArray(m.doc.decisions)
    ? (m.doc.decisions.filter(isObject) as Decision[])
    : [];
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [on, setOn] = useState("");
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const add = async (e: Event) => {
    e.preventDefault();
    const args = {
      text: text.trim(),
      ...(why.trim() ? { why: why.trim() } : {}),
      ...(on ? { date: on } : {}),
    };
    const r = await sendCommands([{ cmd: "addDecision", args }], "add decision");
    setOutcome(r);
    if (r.ok) {
      setText("");
      setWhy("");
      setOn("");
    }
  };
  return (
    <section class="block" data-testid="decisions">
      <h4 class="block-head">
        <span class="figure">Decisions</span>
        <span class="sub">What was decided, when and why</span>
      </h4>
      {list.length === 0 ? (
        <EmptyState title="No decisions recorded">
          A decision is a line in the project's record: what was settled and why. Resolving an open
          item writes one.
        </EmptyState>
      ) : (
        <SheetTable cols={COLS}>
          <tbody>
            {list.map((d, i) => (
              <Row key={d.id ?? i} data-decision={d.id ?? ""}>
                <td>
                  <b>{d.id ?? ""}</b>
                </td>
                <td title={d.date}>{d.date ? date(d.date) : ""}</td>
                <td>
                  <Clip text={d.text ?? ""} />
                </td>
                <td>
                  <Clip text={d.why ?? ""} />
                </td>
                <td>{d.resolves ?? ""}</td>
              </Row>
            ))}
          </tbody>
        </SheetTable>
      )}
      <form class="record-form" data-testid="decision-add" onSubmit={(e) => void add(e)}>
        <input
          class="wide"
          data-testid="decision-text"
          aria-label="A decision"
          placeholder="a decision, e.g. use M6 throughout"
          value={text}
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        />
        <input
          data-testid="decision-why"
          aria-label="Why"
          placeholder="why (optional)"
          value={why}
          onInput={(e) => setWhy((e.currentTarget as HTMLInputElement).value)}
        />
        <input
          type="date"
          data-testid="decision-date"
          aria-label="Date"
          title="Today when left empty"
          value={on}
          onInput={(e) => setOn((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="btn primary"
          data-testid="decision-apply"
          disabled={busy.value || readOnly() || text.trim() === ""}
        >
          Record
        </button>
        <Errors outcome={outcome} />
      </form>
    </section>
  );
}
