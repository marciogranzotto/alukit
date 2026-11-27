import { registerSheet } from "../sheets/registry.ts";
import { log } from "../store.ts";

/**
 * The history (design §8; `alukit log`): every step since the server started, newest first, with
 * its revision, its source and what it did. Owner: S4, whose Records sheet takes it in (S4.9).
 */
export function HistorySheet() {
  const entries = log.value;
  if (entries.length === 0) return <p class="panel-empty">No steps since the server started.</p>;
  return (
    <table class="grid" data-testid="log">
      <thead>
        <tr>
          <th>rev</th>
          <th>source</th>
          <th>what</th>
        </tr>
      </thead>
      <tbody>
        {[...entries].reverse().map((e) => (
          <tr key={e.rev}>
            <td class="n">{e.rev}</td>
            <td>{e.source}</td>
            <td>{e.what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

registerSheet({ id: "history", title: "Log", order: 100, Body: HistorySheet });
