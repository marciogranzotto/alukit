import { EmptyState } from "../common/EmptyState.tsx";
import type { LogEntry } from "../model.ts";
import { log } from "../store.ts";
import { type Col, Row, SheetTable } from "../tables/common.tsx";

/**
 * The history (design §8; `alukit log`): every step since the server started, newest first, with
 * its step number, who made it in words, and what it did; a step that was undone is struck, and
 * says which step undid it. A section of the Records sheet. Owner: S4.
 */

/** A step's source as words: `ui` is the person at the app. */
export function sourceText(source: string): string {
  if (source === "ui") return "You, in the app";
  if (source === "file") return "An edit to the file";
  const at = source.indexOf(":");
  const who = at < 0 ? source : source.slice(at + 1);
  if (source.startsWith("agent:")) return `Agent ${who}`;
  if (source.startsWith("cli:")) return `The CLI (${who})`;
  return source;
}

/** For each step the later step that undid it, while it stays undone (a redo brings it back). */
export function undoneBy(entries: readonly LogEntry[]): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  for (const e of [...entries].sort((a, b) => a.rev - b.rev)) {
    if (e.of === undefined) continue;
    if (e.what.startsWith("undo ")) out.set(e.of, e.rev);
    else if (e.what.startsWith("redo ")) out.delete(e.of);
  }
  return out;
}

const COLS: readonly Col[] = [
  { id: "rev", head: "Step", w: "64px", align: "right" },
  { id: "source", head: "Made by", w: "200px" },
  { id: "what", head: "What it did" },
];

export function HistorySection() {
  const entries = log.value;
  const undone = undoneBy(entries);
  return (
    <section class="block" data-testid="log">
      <h4 class="block-head">
        <span class="figure">History</span>
        <span class="sub">Every step since the server started, newest first</span>
      </h4>
      {entries.length === 0 ? (
        <EmptyState title="No steps yet">
          Every edit, from the app, the CLI or an agent, is a step you can undo. It will be listed
          here.
        </EmptyState>
      ) : (
        <SheetTable cols={COLS}>
          <tbody>
            {[...entries].reverse().map((e) => {
              const by = undone.get(e.rev);
              return (
                <Row key={e.rev} class={by === undefined ? undefined : "undone"}>
                  <td class="n">{e.rev}</td>
                  <td>{sourceText(e.source)}</td>
                  <td>
                    <span class="what">{e.what}</span>
                    {by !== undefined && <span class="sub"> · undone in step {by}</span>}
                    {e.of !== undefined && <span class="sub"> · of step {e.of}</span>}
                  </td>
                </Row>
              );
            })}
          </tbody>
        </SheetTable>
      )}
    </section>
  );
}
