import type { Diagnostic } from "./model.ts";
import type { CommandError, CommandOutcome } from "./store.ts";

/**
 * What an edit came to, shown where it was asked (design §6: commands validate what they create):
 * a refusal's complaints, field by field, or the diagnostics the applied step added about what
 * it created (derive's own validity rules, such as a pivot's or a face joint's).
 */

export function Errors({ outcome }: { outcome: CommandOutcome | undefined }) {
  if (!outcome || outcome.ok) return null;
  const list: CommandError[] =
    outcome.errors.length > 0 ? outcome.errors : [{ message: outcome.why }];
  return (
    <ul class="diagnostics form-errors" data-testid="form-errors">
      {list.map((e) => (
        <li key={`${e.field ?? ""}${e.message}`} class="error">
          <span class="sev">refused</span> {e.field ? <code>{e.field}</code> : null} {e.message}
        </li>
      ))}
    </ul>
  );
}

/** The diagnostics an applied step added that name one of `ids` (or a part of one, `c36.f1`). */
export function newDiagnostics(
  outcome: CommandOutcome | undefined,
  ids: readonly string[],
): Diagnostic[] {
  if (!outcome?.ok) return [];
  return outcome.diagnostics.filter(
    (d) => d.entity !== undefined && ids.includes(d.entity.split(".")[0] as string),
  );
}

export function Diagnostics({ list }: { list: readonly Diagnostic[] }) {
  if (list.length === 0) return null;
  return (
    <ul class="diagnostics form-errors" data-testid="new-diagnostics">
      {list.map((d) => (
        <li key={`${d.severity}${d.code}${d.entity}${d.message}`} class={d.severity}>
          <span class="sev">{d.severity}</span> <span class="code">{d.code}</span>{" "}
          {d.entity ? `${d.entity}: ` : ""}
          {d.message}
        </li>
      ))}
    </ul>
  );
}
