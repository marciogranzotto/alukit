import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Errors } from "../Feedback.tsx";
import { shown } from "../focus.ts";
import { busy, type CommandOutcome, model, sendCommands, summary } from "../store.ts";
import type { Command } from "./remove.ts";
import { valueWords } from "./words.ts";

/**
 * The inspector's field rows (docs/ux/plan.md S5.3): a label, the value as words or as a control
 * that edits it in place, and what an edit came to, under it (U30: a refusal shows where it
 * happened). A row names the document fields it shows, so a problem's Show can point at it
 * (`focus.shown.field`, as `opt.finish`). Owner: S5.
 */

export const readOnly = () => summary.value?.status.readOnly === true;

/** Whether a field the problem points at is one of a row's: the same, or inside one of them. */
export function pointsAt(field: string | undefined, fields: readonly string[]): boolean {
  if (field === undefined) return false;
  return fields.some((f) => field === f || field.startsWith(`${f}.`) || field.startsWith(`${f}/`));
}

/** One row: its label, its body, and the fields it shows. */
export function Row({
  label,
  fields = [],
  children,
  testid,
}: {
  label: string;
  fields?: readonly string[];
  children: ComponentChildren;
  testid?: string;
}) {
  const s = shown.value;
  const pointed = pointsAt(s?.field, fields);
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (pointed) ref.current?.scrollIntoView({ block: "nearest" });
  }, [pointed, s?.n]);
  return (
    <tr
      ref={ref}
      class={pointed ? "pointed" : undefined}
      data-field={fields.join(" ") || undefined}
      {...(testid ? { "data-testid": testid } : {})}
    >
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  );
}

/**
 * Sending from a field: one step, its refusal kept for the row to show under itself (`inline`,
 * so no toast repeats it). Each new send forgets the last outcome.
 */
export function useSend(): {
  outcome: CommandOutcome | undefined;
  send: (commands: Command[], what: string, opts?: { strict?: boolean }) => Promise<CommandOutcome>;
  clear: () => void;
} {
  const [outcome, setOutcome] = useState<CommandOutcome>();
  return {
    outcome,
    async send(commands, what, opts = {}) {
      setOutcome(undefined);
      const o = await sendCommands(commands, what, { inline: true, ...opts });
      setOutcome(o);
      return o;
    },
    clear: () => setOutcome(undefined),
  };
}

/** A refusal under a row, across its columns. */
export function RowErrors({ outcome }: { outcome: CommandOutcome | undefined }) {
  if (!outcome || outcome.ok) return null;
  return (
    <tr class="row-errors">
      <td colSpan={2}>
        <Errors outcome={outcome} />
      </td>
    </tr>
  );
}

/**
 * A text field that commits on Enter (or on leaving it, when changed) and goes back to the value
 * as written on Esc. The value follows the document while the field is not being typed in.
 */
export function CommitInput({
  value,
  onCommit,
  label,
  testid,
  size,
  disabled,
  placeholder,
}: {
  value: string;
  onCommit: (text: string) => void;
  label: string;
  testid?: string;
  size?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(value);
  }, [value]);
  const commit = () => {
    typing.current = false;
    if (text.trim() !== value.trim()) onCommit(text);
  };
  return (
    <input
      class="insp-input"
      aria-label={label}
      value={text}
      size={size}
      placeholder={placeholder}
      disabled={disabled === true || readOnly() || busy.value}
      {...(testid ? { "data-testid": testid } : {})}
      onInput={(e) => {
        typing.current = true;
        setText((e.currentTarget as HTMLInputElement).value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          typing.current = false;
          setText(value);
        }
      }}
      onBlur={() => {
        if (typing.current) commit();
      }}
    />
  );
}

/** A written field the inspector does not edit, as words. */
export function WordsRow({ label, v, fields }: { label: string; v: unknown; fields?: string[] }) {
  return (
    <Row label={label} fields={fields ?? []}>
      {valueWords(v)}
    </Row>
  );
}

/** The drawn revision, for a field that must not act on a model it was not drawn from. */
export const drawnRev = () => model.peek()?.rev;
