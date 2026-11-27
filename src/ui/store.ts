import { effect, signal } from "@preact/signals";
import type { ProblemsAnswer } from "#core/problems/types.ts";
import { ApiError, adoptToken, download, get, post, readEvents } from "./api.ts";
import { fetchProblems } from "./client/problems.ts";
import { extendHook } from "./hook.ts";
import type { Diagnostic, LogEntry, Model, RevEvent, Summary } from "./model.ts";

/**
 * The tab's state (design §7.1: a tab holds no unsaved state). The server's revision, status and
 * undo and redo steps arrive on the event stream; the model of a revision is fetched once per
 * revision, and its problems with it. Every edit is a request to the server, whose answer comes
 * back as the next event. The selection lives in focus.ts, with the hover and Show; it is
 * re-exported here. Owner: S2.
 */

export { select, selection } from "./focus.ts";

export type Connection = "connecting" | "live" | "lost" | "no-token" | "refused";

export const connection = signal<Connection>("connecting");
export const summary = signal<Summary | undefined>(undefined);
export const model = signal<Model | undefined>(undefined);
/**
 * The problems of the drawn revision (`alukit.problems/1`), fetched for each revision drawn, in
 * the tab's variant and at the order's date, through src/ui/client/problems.ts (S2.6). Undefined
 * while the server has no `/api/problems` (before BE-3) or has not answered for this revision.
 */
export const problems = signal<ProblemsAnswer | undefined>(undefined);
export const log = signal<LogEntry[]>([]);
/** The order's date (`as_of`), when the person picked one; the server's today otherwise. */
export const asOf = signal<string | undefined>(undefined);
/**
 * The variant the tab derives (§4.10, §8's top bar), when the person picked one; the document's
 * default otherwise. Every view follows it: the model and each output are asked with
 * `?variant=`, as the CLI takes `--variant`. Edits still go to the document as written.
 */
export const variant = signal<string | undefined>(undefined);

/**
 * The last answer worth telling that no form shows where it happened: a refusal, a failure, an
 * export done. The toasts show it (shell/Toasts.tsx). `refs` are what a refusal names (the
 * entity and refs of its errors), which the toast offers to select; `n` counts notices, so the
 * same text told again is a new notice.
 */
export interface Notice {
  text: string;
  error: boolean;
  refs?: string[];
  n: number;
}
export const notice = signal<Notice | undefined>(undefined);
let notices = 0;

/** Tells something in a toast: a refusal or a failure when `error`. */
export function tell(text: string, error: boolean, refs: readonly string[] = []): void {
  notice.value = { text, error, ...(refs.length > 0 ? { refs: [...refs] } : {}), n: ++notices };
}

export const busy = signal(false);

/**
 * The steps as this tab heard them (§7.1's `rev` events), newest last: who made each, its words,
 * what it created, removed and changed, and when the tab heard it. Steps made before the tab
 * opened are only in the log, with no time.
 */
export interface HeardStep extends RevEvent {
  /** When the tab heard it, ms since the epoch. */
  at: number;
}
export const heard = signal<readonly HeardStep[]>([]);

/** When the tab heard the step that made `rev`, if it did. */
export function heardAt(rev: number): number | undefined {
  return heard.peek().find((s) => s.rev === rev)?.at;
}

/** An output's path with the variant and, when given, the order's date. */
export function outputPath(path: string, opts: { asOf?: string | undefined } = {}): string {
  const q = new URLSearchParams();
  if (variant.value !== undefined) q.set("variant", variant.value);
  if (opts.asOf !== undefined) q.set("as_of", opts.asOf);
  const s = q.toString();
  return s === "" ? path : `${path}?${s}`;
}

let wanted = -1;
let fetching = false;
/** The variant the drawn model was asked for; undefined: the default. */
let drawnFor: string | undefined;

/**
 * Fetches the model until the one drawn is the newest revision the server announced, in the
 * variant the tab asks for. A variant an edit has removed falls back to the default.
 */
async function ensureModel(rev: number): Promise<void> {
  wanted = Math.max(wanted, rev);
  if (fetching) return;
  fetching = true;
  try {
    while (model.value?.rev !== wanted || drawnFor !== variant.value) {
      const asked = variant.value;
      let m: Model;
      try {
        m = await get<Model>(outputPath("/api/model"));
      } catch (e) {
        if (asked !== undefined && e instanceof ApiError && e.status === 400) {
          tell(`variant ${asked}: ${e.message}`, true);
          variant.value = undefined;
          continue;
        }
        throw e;
      }
      // A revision newer than any event yet: it is the one to draw.
      wanted = Math.max(wanted, m.rev);
      // The person picked another variant while this one loaded: ask again.
      if (variant.value !== asked) continue;
      drawnFor = asked;
      model.value = m;
      void refreshProblems(m);
      if (m.rev >= wanted) break;
    }
  } catch (e) {
    tell(`cannot load the model: ${(e as Error).message}`, true);
  } finally {
    fetching = false;
  }
}

/**
 * Asks for the problems of the drawn model, in its variant and at the order's date (S2.6). An
 * answer that comes back after the tab has moved on is dropped, so `problems` only ever holds
 * the drawn revision's. A server with no `/api/problems` leaves it undefined.
 */
async function refreshProblems(m: Model): Promise<void> {
  const date = asOf.peek();
  const got = await fetchProblems({
    ...(m.variant !== null ? { variant: m.variant } : {}),
    ...(date !== undefined ? { asOf: date } : {}),
  });
  if (model.peek() !== m || asOf.peek() !== date) return;
  problems.value = got.ok ? got.value : undefined;
}

/** Derives in another variant: every view follows (§4.10). */
export function chooseVariant(v: string | undefined): void {
  variant.value = v;
  void ensureModel(model.value?.rev ?? 0);
}

async function refreshLog(): Promise<void> {
  try {
    log.value = (await get<{ entries: LogEntry[] }>("/api/log")).entries;
  } catch {
    // The next revision refreshes it.
  }
}

function onEvent(event: string, data: string): void {
  const e = JSON.parse(data);
  switch (event) {
    case "hello":
      summary.value = e as Summary;
      connection.value = "live";
      void ensureModel(e.rev);
      void refreshLog();
      void refreshRevisions();
      break;
    case "rev": {
      const s = summary.value;
      summary.value = {
        ...(s ?? { status: { readOnly: false } }),
        rev: e.rev,
        undo: e.undo,
        redo: e.redo,
      };
      heard.value = [...heard.value.slice(-49), { ...(e as RevEvent), at: Date.now() }];
      void ensureModel(e.rev);
      void refreshLog();
      void refreshRevisions();
      break;
    }
    case "status":
      if (summary.value) summary.value = { ...summary.value, status: e.status };
      break;
  }
}

/** Connects, and reconnects after a pause while the server is away. */
export async function start(): Promise<void> {
  // A new date for the order: the drawn revision's problems, judged at it.
  effect(() => {
    void asOf.value;
    const m = model.peek();
    if (m) void refreshProblems(m);
  });
  if (!adoptToken()) {
    connection.value = "no-token";
    return;
  }
  let pause = 500;
  for (;;) {
    const ctrl = new AbortController();
    try {
      await readEvents((m) => onEvent(m.event, m.data), ctrl.signal);
      pause = 500;
    } catch (e) {
      if ((e as { status?: number }).status === 403) {
        connection.value = "refused";
        return;
      }
    }
    connection.value = "lost";
    await new Promise((r) => setTimeout(r, pause));
    pause = Math.min(pause * 2, 5000);
  }
}

async function send(path: string, body: unknown, what: string): Promise<void> {
  busy.value = true;
  try {
    const r = await post<{ ok?: boolean; message?: string; status?: { message?: string } }>(
      path,
      body,
    );
    if (r.body.ok === false || r.status >= 400) {
      tell(
        `${what}: ${r.body.status?.message ?? r.body.message ?? `the server answered ${r.status}`}`,
        true,
      );
    }
  } catch (e) {
    tell(`${what}: ${(e as Error).message}`, true);
  } finally {
    busy.value = false;
  }
}

/**
 * A command's complaint, as the server words it: its code, the entity and field it is about, and
 * the other entities it names (`refs`), when it names them.
 */
export interface CommandError {
  code?: string;
  entity?: string;
  field?: string;
  refs?: string[];
  message: string;
}

/** The entities a refusal names: each error's entity and refs, once each, in order. */
export function refusalRefs(errors: readonly CommandError[]): string[] {
  return [...new Set(errors.flatMap((e) => [...(e.entity ? [e.entity] : []), ...(e.refs ?? [])]))];
}

/** What a batch came to: the entities it created and the diagnostics it added, or why not. */
export type CommandOutcome =
  | { ok: true; rev: number; created: string[]; diagnostics: Diagnostic[] }
  | { ok: false; why: string; errors: CommandError[] };

/**
 * Sends a batch of commands as one step (§7.1: a gesture is committed as one command batch, with
 * source `ui`), and resolves with what it came to. `strict` refuses the batch when another step
 * came first: for a batch that names an id it expects to create (a pivot its carried ends point
 * to). A refusal is shown where the action happened (U30): a caller that shows it itself, under
 * its form, passes `inline`; any other refusal is told in a toast, naming the command and why.
 */
export async function sendCommands(
  commands: readonly { cmd: string; args?: unknown }[],
  what: string,
  opts: { strict?: boolean; inline?: boolean } = {},
): Promise<CommandOutcome> {
  busy.value = true;
  try {
    const r = await post<{
      ok?: boolean;
      rev?: number;
      kind?: string;
      message?: string;
      status?: { message?: string };
      failed?: { index: number; cmd?: string; errors?: CommandError[] };
      results?: { created: string[] }[];
      diagnostics?: { new: Diagnostic[] };
    }>("/api/commands", {
      commands,
      source: "ui",
      ...(model.value ? { baseRev: model.value.rev } : {}),
      ...(opts.strict ? { strict: true } : {}),
    });
    if (r.status === 200 && r.body.ok !== false) {
      return {
        ok: true,
        rev: r.body.rev ?? -1,
        created: (r.body.results ?? []).flatMap((x) => x.created),
        diagnostics: r.body.diagnostics?.new ?? [],
      };
    }
    const f = r.body.failed;
    const errors = f?.errors ?? [];
    const why = f
      ? `${f.cmd ?? `command ${f.index + 1}`}: ${errors.map((e) => e.message).join("; ")}`
      : r.body.kind === "stale"
        ? "the project changed meanwhile; try again on the new revision"
        : (r.body.status?.message ?? r.body.message ?? `the server answered ${r.status}`);
    if (!opts.inline) tell(`${what}: ${why}`, true, refusalRefs(errors));
    return { ok: false, why, errors };
  } catch (e) {
    const why = (e as Error).message;
    if (!opts.inline) tell(`${what}: ${why}`, true);
    return { ok: false, why, errors: [] };
  } finally {
    busy.value = false;
  }
}

/** Sends a batch as one step; true when it was applied (see `sendCommands`). */
export async function applyCommands(
  commands: readonly { cmd: string; args?: unknown }[],
  what: string,
): Promise<boolean> {
  return (await sendCommands(commands, what)).ok;
}

/** Downloads the model as binary glTF, in the tab's variant (§9): `alukit export glb`'s bytes. */
export async function exportGlb(): Promise<void> {
  busy.value = true;
  try {
    const name = await download(outputPath("/api/export/glb"));
    tell(`exported ${name}`, false);
  } catch (e) {
    tell(`export: ${(e as Error).message}`, true);
  } finally {
    busy.value = false;
  }
}

/** A saved revision as the server lists it (§4.13). */
export interface RevisionInfo {
  file: string;
  name: string;
  as_of: string;
  stamp: { alukit: string; hash: string; git: { commit: string; dirty: boolean } | null };
  variants: string[];
}

/** The saved revisions, and the content hash of what the server holds now. */
export const revisions = signal<
  { rev: number; current: string; revisions: RevisionInfo[]; problems: string[] } | undefined
>(undefined);

export async function refreshRevisions(): Promise<void> {
  try {
    revisions.value = await get("/api/revisions");
  } catch {
    // The next revision asks again.
  }
}

/** Saves what the server holds as a revision (§4.13); the answer's message when it cannot. */
export async function saveRevision(name: string): Promise<string | undefined> {
  busy.value = true;
  try {
    const r = await post<{ ok?: boolean; message?: string; file?: string }>("/api/revisions", {
      name,
    });
    if (r.status !== 200) return r.body.message ?? `the server answered ${r.status}`;
    tell(`saved ${r.body.file}`, false);
    await refreshRevisions();
    return undefined;
  } catch (e) {
    return (e as Error).message;
  } finally {
    busy.value = false;
  }
}

/** `alukit revision verify --json`'s answer: drift by variant and output, or none. */
export interface Verification {
  name: string;
  ok: boolean;
  intact: boolean;
  version?: { saved: string; now: string };
  variants: { missing: string[]; extra: string[] };
  drift: { variant?: string; output: string; changes: { path: string }[] }[];
}

export async function verifyRevision(name: string): Promise<Verification | { error: string }> {
  try {
    return await get<Verification>(`/api/revisions/verify?name=${encodeURIComponent(name)}`);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export const undo = () => send("/api/undo", { source: "ui" }, "undo");
export const redo = () => send("/api/redo", { source: "ui" }, "redo");

/** What restoring the last good state came to (§7.1, BE-9). */
export interface Restored {
  ok: boolean;
  rev?: number;
  /** Where the server kept the rejected text (BE-9), when it keeps it. */
  kept?: string;
  message?: string;
}

/**
 * Writes the state the server holds over the files (§7.1's "restore last good"), and resolves
 * with the answer: the revision, the file the server kept the rejected text in when it keeps one
 * (BE-9's `kept`, in the project's folder), or why it could not.
 */
export async function restore(): Promise<Restored> {
  busy.value = true;
  try {
    const r = await post<{ ok?: boolean; rev?: number; kept?: string; message?: string }>(
      "/api/restore",
      {},
    );
    const ok = r.status === 200 && r.body.ok !== false;
    return {
      ok,
      ...(typeof r.body.rev === "number" ? { rev: r.body.rev } : {}),
      ...(typeof r.body.kept === "string" ? { kept: r.body.kept } : {}),
      ...(ok ? {} : { message: r.body.message ?? `the server answered ${r.status}` }),
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    busy.value = false;
  }
}

extendHook({
  rev: () => summary.value?.rev,
  readOnly: () => summary.value?.status.readOnly === true,
});
