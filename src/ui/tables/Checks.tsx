import { EntityChips } from "../common/EntityChip.tsx";
import type { Model } from "../model.ts";
import { registerSheet } from "../sheets/registry.ts";
import { model } from "../store.ts";

/**
 * The checks (design §8; `alukit check`): the counts by severity, the document's checks with
 * their results and margins, and every diagnostic, whose entity selects in the scene. It comes
 * with the revision's model; its tab counts the errors. Owner: S4, whose Problems sheet takes it
 * in (S4.8).
 */
export function ChecksSheet({ m }: { m: Model }) {
  const ds = m.check.diagnostics;
  const count = (s: string) => ds.filter((d) => d.severity === s).length;
  return (
    <div data-testid="checks">
      <p class="sub">
        {count("error")} error{count("error") === 1 ? "" : "s"}, {count("warn")} warning
        {count("warn") === 1 ? "" : "s"}, {count("info")} note{count("info") === 1 ? "" : "s"}
      </p>
      {m.check.checks.length > 0 && (
        <table class="grid">
          <thead>
            <tr>
              <th>check</th>
              <th>text</th>
              <th>result</th>
              <th>margin</th>
            </tr>
          </thead>
          <tbody>
            {m.check.checks.map((c) => (
              <tr key={c.id} class={c.pass === false ? c.severity : ""}>
                <td>{c.id}</td>
                <td>{c.text ?? ""}</td>
                <td>
                  {c.pending
                    ? "pending"
                    : c.pass === undefined
                      ? (c.problem ?? "?")
                      : c.pass
                        ? "pass"
                        : "fail"}
                </td>
                <td class="n">{c.margin ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul class="diagnostics">
        {ds.map((d) => (
          <li key={`${d.severity}${d.code}${d.entity}${d.field}${d.message}`} class={d.severity}>
            <span class="sev">{d.severity}</span> <span class="code">{d.code}</span>{" "}
            {d.entity && <EntityChips ids={[d.entity.split(".")[0] as string]} />} {d.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The tab's count of errors, when there are any. */
function ErrorBadge() {
  const errors = model.value?.check.diagnostics.filter((d) => d.severity === "error").length ?? 0;
  return errors > 0 ? <span class="badge">{errors}</span> : null;
}

registerSheet({
  id: "checks",
  title: "Checks",
  order: 60,
  badge: () => <ErrorBadge />,
  Body: ChecksSheet,
});
