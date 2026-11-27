import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import { dryRun } from "../client/dryrun.ts";
import { Errors } from "../Feedback.tsx";
import { select, selection } from "../focus.ts";
import { plural } from "../format.ts";
import type { Model } from "../model.ts";
import { Dialog } from "../shell/Dialog.tsx";
import { busy, type CommandOutcome, model, sendCommands, summary, tell } from "../store.ts";
import {
  type CopyRef,
  copyMembers,
  type DeletePlan,
  deletePlan,
  deleteTargets,
  removeBatch,
  skipBatch,
  withoutVanished,
} from "./remove.ts";
import { entityName, isObject, listWords, written } from "./words.ts";

/**
 * Delete, with its cascade (D-UX-13): Delete or Backspace in Select, or the inspector's button.
 * The selection's entities are dry-run as one batch of `removeEntity {cascade: true}`; when the
 * step would remove nothing else and change nothing else it is sent at once, as one step, which
 * the step's toast offers to undo. Otherwise a dialog lists what goes, in words, from the dry run,
 * with "Delete all n" or Cancel, and the step is sent `strict`, so it removes what was listed or
 * nothing: when another step came first, the dry run is asked again and the list shown again. A
 * pattern copy is left out of its pattern (`setPattern` skip), since `removeEntity` refuses
 * copies. Owner: S5.
 */

/** What the dialog shows: the plan, the copies, and why the last try did not go through. */
export interface Asking {
  /** The selection's entities, as dry-run and as sent. */
  ids: string[];
  plan?: DeletePlan;
  copies: CopyRef[];
  /** The revision the plan was made against. */
  rev: number;
  /** The last send's refusal, or a note that the list changed. */
  outcome?: CommandOutcome;
  note?: string;
}

/** The dialog, while it is open. */
export const asking = signal<Asking | undefined>(undefined);
/** A delete is being planned (its dry run is out). */
export const planning = signal(false);

type Answer =
  | { ok: true; ids: string[]; plan?: DeletePlan; rev: number }
  | { ok: false; why: string };

/**
 * Dry-runs the removal of these entities, dropping one that is no longer there (an earlier
 * command's cascade took it) and asking again, until the dry run passes or refuses for another
 * reason.
 */
async function planRemoval(ids0: readonly string[]): Promise<Answer> {
  let ids = [...ids0];
  for (let tries = 0; tries <= ids0.length; tries++) {
    if (ids.length === 0) return { ok: true, ids, rev: model.peek()?.rev ?? -1 };
    const r = await dryRun(removeBatch(ids));
    if (!r.ok) return { ok: false, why: r.why };
    const dry = r.value;
    if (dry.ok) return { ok: true, ids, plan: deletePlan(ids, dry), rev: dry.rev };
    const next = withoutVanished(ids, dry);
    if (!next) return { ok: false, why: dry.why };
    ids = next;
  }
  return { ok: false, why: "the selection kept changing; try again" };
}

/** What the person selected is still what the plan is for, at the drawn revision. */
function stillAsked(sel: ReadonlySet<string>, rev: number | undefined): boolean {
  return selection.peek() === sel && model.peek()?.rev === rev;
}

/** Takes the deleted out of the selection, keeping what Delete did nothing to. */
function deselect(gone: Iterable<string>): void {
  const out = new Set(gone);
  select(
    [...selection.peek()].filter((id) => !out.has(id)),
    "replace",
  );
}

/** The step: the removal and the copies left out, as one batch, `strict`. */
async function sendDelete(a: Asking): Promise<CommandOutcome> {
  const m = model.peek();
  const commands = [...removeBatch(a.ids), ...(m ? skipBatch(m, a.copies) : [])];
  const what =
    a.copies.length > 0 && a.ids.length === 0
      ? `leave ${listWords(a.copies.map((c) => c.id))} out`
      : `delete ${listWords(a.ids)}`;
  return sendCommands(commands, what, { strict: true, inline: true });
}

/**
 * Deletes the selection (D-UX-13). Read-only, a tool other than Select, or nothing to delete:
 * nothing happens but a word on why.
 */
export async function startDelete(): Promise<void> {
  const m = model.peek();
  const sel = selection.peek();
  if (!m || sel.size === 0 || planning.peek() || asking.peek()) return;
  if (summary.peek()?.status.readOnly) {
    tell("Delete: the project is read-only until its files are fixed", true);
    return;
  }
  const t = deleteTargets(m, sel);
  if (t.entities.length === 0 && t.copies.length === 0) {
    tell(
      `Delete: nothing to delete; ${[...new Set(t.others.map((o) => o.why))].join("; ")}`,
      false,
    );
    return;
  }
  planning.value = true;
  try {
    let refused: CommandOutcome | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const rev = model.peek()?.rev;
      const p = await planRemoval(t.entities);
      // The person moved on while the dry run was out: its answer is about something else.
      if (selection.peek() !== sel) return;
      // Another step was drawn meanwhile: the plan may be stale, so plan again.
      if (!stillAsked(sel, rev)) continue;
      if (!p.ok) {
        asking.value = {
          ids: t.entities,
          copies: t.copies,
          rev: rev ?? -1,
          outcome: { ok: false, why: p.why, errors: [] },
        };
        return;
      }
      const a: Asking = {
        ids: p.ids,
        ...(p.plan ? { plan: p.plan } : {}),
        copies: t.copies,
        rev: p.rev,
      };
      if (t.copies.length > 0 || !p.plan?.plain || refused) {
        asking.value = refused ? { ...a, outcome: refused } : a;
        return;
      }
      // Nothing beyond the selection: at once, as one step.
      const o = await sendDelete(a);
      if (o.ok) {
        deselect([...p.ids]);
        return;
      }
      // Refused (another step came first, most likely): plan again, and this time ask.
      refused = o;
    }
    tell("Delete: the project kept changing; try again", true);
  } finally {
    planning.value = false;
  }
}

/** Confirms the dialog: sends what it lists; on a refusal, plans again and shows the new list. */
async function confirm(a: Asking): Promise<void> {
  const o = await sendDelete(a);
  if (o.ok) {
    asking.value = undefined;
    deselect([...a.ids, ...a.copies.map((c) => c.id)]);
    return;
  }
  const p = await planRemoval(a.ids);
  if (!p.ok) {
    asking.value = { ...a, outcome: { ok: false, why: p.why, errors: [] } };
    return;
  }
  const same = JSON.stringify(p.plan) === JSON.stringify(a.plan) && p.ids.length === a.ids.length;
  asking.value = {
    ...a,
    ids: p.ids,
    ...(p.plan ? { plan: p.plan } : {}),
    rev: p.rev,
    ...(same ? { outcome: o } : { note: "The project changed meanwhile. This is what goes now." }),
  };
}

/** What a changed entity loses: the members of its lists that named what goes. */
function loses(m: Model, id: string, removed: ReadonlySet<string>): string[] {
  const w = written(m, id);
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      const target = /^b\d+\.[ab]$/.test(v) ? (v.split(".")[0] as string) : v;
      if (removed.has(target)) out.push(v);
    } else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (isObject(v)) {
      if (typeof v.inside === "string" && removed.has(v.inside)) out.push(v.inside);
      for (const x of Object.values(v)) if (typeof x !== "string") walk(x);
    }
  };
  // A list member names what goes; a whole reference (`through`) would have removed the entity.
  if (Array.isArray(w)) {
    walk(w);
  } else if (isObject(w)) {
    for (const v of Object.values(w)) {
      if (Array.isArray(v) || isObject(v)) walk(v);
    }
  }
  return [...new Set(out)].sort(compareIds);
}

function DeleteDialog({ a }: { a: Asking }) {
  const m = model.value;
  if (!m) return null;
  const removed = a.plan?.removed ?? [];
  const gone = new Set(removed);
  const extra = new Set(a.plan?.extra ?? []);
  const n = removed.length + a.copies.length;
  const onlyCopies = a.ids.length === 0;
  const title = onlyCopies
    ? a.copies.length === 1
      ? `Leave ${a.copies[0]?.id} out?`
      : `Leave ${a.copies.length} copies out?`
    : `Delete ${plural(n, "thing")}?`;
  return (
    <Dialog title={title} onClose={() => (asking.value = undefined)} testid="delete-dialog">
      {a.note && <p class="note">{a.note}</p>}
      {removed.length > 0 && (
        <>
          <p>
            {a.plan && a.plan.extra.length > 0
              ? `Deleting ${listWords(a.ids)} also removes what refers to it:`
              : "This removes:"}
          </p>
          <ul class="delete-list" data-testid="delete-removed">
            {removed.map((id) => (
              <li key={id} data-id={id}>
                {entityName(m, id)}
                {extra.has(id) && <span class="sub"> (refers to it)</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {(a.plan?.changed.length ?? 0) > 0 && (
        <>
          <p>And changes:</p>
          <ul class="delete-list" data-testid="delete-changed">
            {a.plan?.changed.map((id) => {
              const lost = loses(m, id, gone);
              return (
                <li key={id} data-id={id}>
                  {entityName(m, id)}
                  {lost.length > 0 ? ` loses ${listWords(lost)}` : " changes"}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {a.copies.length > 0 && (
        <>
          <p>
            {a.copies.length === 1 ? "A pattern copy" : "Pattern copies"} cannot be deleted on their
            own: {a.copies.length === 1 ? "it is" : "they are"} left out of the pattern, with
            everything of that copy:
          </p>
          <ul class="delete-list" data-testid="delete-copies">
            {a.copies.map((c) => (
              <li key={c.id} data-id={c.id}>
                copy {c.k} of {c.pattern}: {listWords(copyMembers(m, c))}
              </li>
            ))}
          </ul>
        </>
      )}
      <Errors outcome={a.outcome} />
      <div class="dialog-actions">
        <button
          type="button"
          class="btn primary"
          data-testid="delete-confirm"
          data-autofocus
          disabled={busy.value || (removed.length === 0 && a.copies.length === 0)}
          onClick={() => void confirm(a)}
        >
          {onlyCopies
            ? a.copies.length === 1
              ? "Leave this copy out"
              : "Leave these copies out"
            : `Delete all ${n}`}
        </button>
        <button type="button" class="btn" onClick={() => (asking.value = undefined)}>
          Cancel
        </button>
        <span class="spacer" />
        <span class="sub">One step: Undo brings it all back.</span>
      </div>
    </Dialog>
  );
}

/** The inspector's Delete button, for the selection. */
export function DeleteButton({ label = "Delete" }: { label?: string }) {
  const off = summary.value?.status.readOnly === true || busy.value || planning.value;
  return (
    <button
      type="button"
      class="btn"
      data-testid="delete"
      disabled={off}
      title="Delete the selection, and say first what else goes (Delete or Backspace)"
      onClick={() => void startDelete()}
    >
      {label} <kbd>⌫</kbd>
    </button>
  );
}

/**
 * Delete's dialog: mounted once, by the inspector, for as long as the app is shown. Its keys and
 * its line in the help are the `delete` action's (inspector/actions.ts).
 */
export function DeleteFlow() {
  // A dialog left open over a selection that changed under it closes.
  useEffect(() => {
    if (asking.peek()) asking.value = undefined;
  }, [selection.value]);
  const a = asking.value;
  return a ? <DeleteDialog a={a} /> : null;
}
