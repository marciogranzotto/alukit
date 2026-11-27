import { useState } from "preact/hooks";
import { Errors } from "../Feedback.tsx";
import type { Model } from "../model.ts";
import { registerSheet } from "../sheets/registry.ts";
import { busy, type CommandOutcome, sendCommands, summary } from "../store.ts";

/**
 * The decisions (design §8, §4.12): the document's record, dated, with why and what each
 * resolves, and a form to add one through `addDecision`, one step the top bar's undo takes back
 * (§7.1). Owner: S4, whose Records sheet takes it in (S4.9).
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

export function DecisionsSheet({ m }: { m: Model }) {
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

registerSheet({ id: "decisions", title: "Decisions", order: 90, Body: DecisionsSheet });
