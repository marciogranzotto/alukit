import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { splitId } from "#core/ids.ts";
import type { Diagnostic } from "../model.ts";
import { busy, connection, restore, summary, tell } from "../store.ts";
import { Dialog } from "./Dialog.tsx";
import { didYouMean, unknownFields } from "./didYouMean.ts";

/**
 * Read-only and restore (§7.1, D-UX-15, S2.14; U23, U33, U34). While the files hold an error,
 * every tab shows the banner: what is wrong, each error with the entity and the field it is in,
 * and for a field the schema does not know, the known name it is likely a slip for. The viewport
 * says it shows the last good state. "Restore last good" asks first, saying what it writes over,
 * and after it names the copy the server kept of the rejected text (BE-9). Owner: S2.
 */

type Shape = { shape?: Record<string, unknown>; options?: readonly unknown[] };

/** The field names of a schema: an object's keys, or every option's of a union. */
function keysOf(s: unknown): string[] {
  const x = s as Shape;
  if (x.shape) return Object.keys(x.shape);
  if (x.options) return [...new Set(x.options.flatMap(keysOf))];
  return [];
}

/** The entity kinds a field slip is looked up in, by id prefix. */
const KIND_OF_PREFIX: Readonly<Record<string, string>> = {
  b: "Bar",
  c: "Connection",
  p: "Part",
  pt: "Pattern",
  r: "Run",
};

/** The known field names where a diagnostic's unknown field sits: an entity's, or the top level's. */
async function knownFields(d: Diagnostic): Promise<string[]> {
  // The schema is loaded only when a file names a field it does not know: it is large.
  const schema = (await import("#core/project/schema.ts")) as unknown as Record<string, unknown>;
  if (d.entity) {
    const kind = KIND_OF_PREFIX[splitId(d.entity)?.prefix ?? ""];
    return d.field || !kind ? [] : keysOf(schema[kind]);
  }
  if (!d.field) return Object.keys(schema.PROJECT_SHAPE as object);
  if (d.field === "defaults") return keysOf(schema.Defaults);
  return [];
}

const guesses = signal<ReadonlyMap<string, string>>(new Map());
const keyOf = (d: Diagnostic) => `${d.code}|${d.entity ?? ""}|${d.field ?? ""}|${d.message}`;

/** Looks up the near names of the unknown fields the diagnostics name. */
function useGuesses(list: readonly Diagnostic[]): void {
  useEffect(() => {
    let live = true;
    void (async () => {
      const next = new Map<string, string>();
      for (const d of list) {
        const names = unknownFields(d.message);
        if (names.length === 0) continue;
        const known = await knownFields(d);
        const hits = names.flatMap((n) => {
          const g = didYouMean(n, known);
          return g ? [`"${g}" for "${n}"`] : [];
        });
        if (hits.length > 0) next.set(keyOf(d), hits.join(", "));
      }
      if (live) guesses.value = next;
    })();
    return () => {
      live = false;
    };
  }, [list.map(keyOf).join("\n")]);
}

/** Where a diagnostic is, in words: `b3 · ends/0`, or the file's top level. */
function where(d: Diagnostic): string | undefined {
  if (d.entity && d.field) return `${d.entity} · ${d.field}`;
  return d.entity ?? (d.field ? `the file's ${d.field}` : undefined);
}

const restoreAsking = signal(false);

/** Why the project is read-only, in every tab, until the file is valid again or restored. */
export function ReadOnlyBanner() {
  const st = summary.value?.status;
  const list = st?.readOnly ? st.diagnostics : [];
  useGuesses(list);
  if (!st?.readOnly) return null;
  const shown = list.slice(0, 8);
  // One error that says no more than the message above it is not listed again.
  const lone =
    list.length === 1 && !where(list[0] as Diagnostic) && list[0]?.message === st.message;
  return (
    <div class="banner" data-testid="read-only" role="alert">
      <strong>Read-only.</strong> {st.message}
      {!lone && list.length > 0 && (
        <ul data-testid="read-only-list">
          {shown.map((d) => {
            const at = where(d);
            const guess = guesses.value.get(keyOf(d));
            return (
              <li key={keyOf(d)}>
                {at && <strong>{at}: </strong>}
                {d.message}
                {guess && <span class="guess"> Did you mean {guess}?</span>}
              </li>
            );
          })}
          {list.length > shown.length && <li>and {list.length - shown.length} more</li>}
        </ul>
      )}
      <span class="hint">
        {st.reason === "file"
          ? "Fix the file and save it, or restore the last good state the server holds."
          : "Free the disk or fix the folder's permissions, then restore."}
      </span>
      <button
        type="button"
        class="btn"
        disabled={busy.value}
        onClick={() => {
          restoreAsking.value = true;
        }}
      >
        Restore last good
      </button>
      {restoreAsking.value && <RestoreConfirm />}
    </div>
  );
}

function RestoreConfirm() {
  const s = summary.value;
  const close = () => {
    restoreAsking.value = false;
  };
  const go = async () => {
    close();
    const r = await restore();
    if (!r.ok) {
      tell(`restore: ${r.message ?? "the server refused"}`, true);
      return;
    }
    tell(
      r.kept.length > 0
        ? `Restored step ${r.rev ?? s?.rev}. The rejected text is kept in ${r.kept.join(" and ")}.`
        : `Restored step ${r.rev ?? s?.rev}.`,
      false,
    );
  };
  return (
    <Dialog title="Restore the last good state?" onClose={close} testid="restore-dialog">
      <p>
        This writes step {s?.rev}, the state every tab shows, over the project's files. What the
        files hold now is not lost: the server keeps a copy in <code>.alukit/rejected/</code> and
        names it when it is done.
      </p>
      <div class="dialog-actions">
        <button
          type="button"
          class="btn primary"
          data-autofocus
          data-testid="restore-confirm"
          onClick={() => void go()}
        >
          Restore
        </button>
        <button type="button" class="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/** Over the viewport while read-only: what it shows is the last good state, not the files. */
export function LastGood() {
  const s = summary.value;
  if (!s?.status.readOnly) return null;
  return (
    <div class="last-good" data-testid="last-good" role="status">
      {s.status.reason === "file"
        ? `The files have an error: this is the last good state, step ${s.rev}`
        : `Not written to disk: this is step ${s.rev}, as the server holds it`}
    </div>
  );
}

/** What a tab shows when it has no token: the address `alukit serve` printed carries it. */
export function NoAccess() {
  const conn = connection.value;
  if (conn !== "no-token" && conn !== "refused") return null;
  return (
    <div class="banner" role="alert" data-testid="no-access">
      {conn === "no-token"
        ? "This tab has no access token. Open the address that alukit serve printed: it carries one."
        : "The server refused this tab's token: it has restarted. Open the address it printed."}
    </div>
  );
}
