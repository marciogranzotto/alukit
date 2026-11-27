import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Errors } from "../Feedback.tsx";
import { busy, type CommandOutcome, sendCommands } from "../store.ts";
import { CommitInput, Row, readOnly } from "./Fields.tsx";
import type { Command } from "./remove.ts";

/**
 * Editable rows that each keep their own outcome (docs/ux/editing-audit.md E5.2: "each refusal
 * shows under its row"): a text field or a select that commits one step, and, under it, the
 * refusal of its last edit, or why the value typed makes none (then nothing is sent). The
 * connection, pattern and part fields are built of them. Owner: E5.
 */

/** What an edit comes to: the step it sends, or why the value makes none. */
export type Edit = { commands: Command[] } | { why: string };

/** One row's edits: its last outcome, and `edit`, which sends one step or keeps the why. */
export function useEdit(): {
  outcome: CommandOutcome | undefined;
  edit: (e: Edit, what: string) => Promise<CommandOutcome>;
} {
  const [outcome, setOutcome] = useState<CommandOutcome>();
  return {
    outcome,
    async edit(e, what) {
      setOutcome(undefined);
      // A value that makes no step is said where it was typed, as a refusal is (U30).
      const o: CommandOutcome =
        "why" in e
          ? { ok: false, why: e.why, errors: [] }
          : await sendCommands(e.commands, what, { inline: true });
      setOutcome(o);
      return o;
    },
  };
}

/** A row's refusal under it, across its columns. */
export function EditErrors({
  outcome,
  name,
}: {
  outcome: CommandOutcome | undefined;
  name: string;
}) {
  if (!outcome || outcome.ok) return null;
  return (
    <tr class="row-errors" data-testid={`row-${name}-errors`}>
      <td colSpan={2}>
        <Errors outcome={outcome} />
      </td>
    </tr>
  );
}

/** Whether a field can be edited now: not while read-only or while a step is on its way. */
export const editOff = () => readOnly() || busy.value;

/**
 * A text field that commits on Enter: `toEdit(text)` gives the step, or why the text makes none.
 * Test ids: `row-<name>`, `field-<name>`, `row-<name>-errors`.
 */
export function TextRow({
  label,
  name,
  fields,
  value,
  toEdit,
  what,
  title,
  size = 9,
  placeholder,
  after,
}: {
  label: string;
  name: string;
  fields: readonly string[];
  value: string;
  toEdit: (text: string) => Edit;
  what: string;
  /** What the field takes, for a screen reader. */
  title: string;
  size?: number;
  placeholder?: string;
  /** Words after the field: its unit, what it comes to. */
  after?: ComponentChildren;
}) {
  const { outcome, edit } = useEdit();
  return (
    <>
      <Row label={label} fields={fields} testid={`row-${name}`}>
        <CommitInput
          label={title}
          testid={`field-${name}`}
          size={size}
          value={value}
          {...(placeholder !== undefined ? { placeholder } : {})}
          onCommit={(text) => void edit(toEdit(text), what)}
        />
        {after}
      </Row>
      <EditErrors outcome={outcome} name={name} />
    </>
  );
}

/** A select that commits on a change. Test ids as `TextRow`'s. */
export function SelectRow({
  label,
  name,
  fields,
  value,
  options,
  toEdit,
  what,
  title,
  after,
}: {
  label: string;
  name: string;
  fields: readonly string[];
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  toEdit: (value: string) => Edit;
  what: string;
  title: string;
  after?: ComponentChildren;
}) {
  const { outcome, edit } = useEdit();
  return (
    <>
      <Row label={label} fields={fields} testid={`row-${name}`}>
        <select
          class="insp-select"
          data-testid={`field-${name}`}
          aria-label={title}
          value={value}
          disabled={editOff()}
          onChange={(e) => void edit(toEdit((e.currentTarget as HTMLSelectElement).value), what)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        {after}
      </Row>
      <EditErrors outcome={outcome} name={name} />
    </>
  );
}
