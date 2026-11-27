import { signal } from "@preact/signals";
import type { ProblemsAnswer } from "#core/problems/types.ts";
import { ApiError, adoptToken, download, get, post, readEvents } from "./api.ts";
import { extendHook } from "./hook.ts";
import type { Diagnostic, LogEntry, Model, Summary } from "./model.ts";

/**
 * The tab's state (design §7.1: a tab holds no unsaved state). The server's revision, status and
 * undo and redo steps arrive on the event stream; the model of a revision is fetched once per
 * revision. Every edit is a request to the server, whose answer comes back as the next event.
 * The selection lives in focus.ts, with the hover and Show; it is re-exported here.
 */

export { select, selection } from "./focus.ts";

export type Connection = "connecting" | "live" | "lost" | "no-token" | "refused";

export const connection = signal<Connection>("connecting");
export const summary = signal<Summary | undefined>(undefined);
export const model = signal<Model | undefined>(undefined);
/**
 * The problems of the drawn revision (`alukit.problems/1`), once something asks for them: S2.6
 * fetches them each revision through src/ui/client/problems.ts. Until BE-3 lands nothing does.
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
/** The last answer worth telling: a refusal, a failure. */
export const notice = signal<{ text: string; error: boolean } | undefined>(undefined);
export const busy = signal(false);

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
          notice.value = { text: `variant ${asked}: ${e.message}`, error: true };
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
      if (m.rev >= wanted) break;
    }
  } catch (e) {
    notice.value = { text: `cannot load the model: ${(e as Error).message}`, error: true };
  } finally {
    fetching = false;
  }
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
      notice.value = {
        text: `${what}: ${r.body.status?.message ?? r.body.message ?? `the server answered ${r.status}`}`,
        error: true,
      };
    } else notice.value = undefined;
  } catch (e) {
    notice.value = { text: `${what}: ${(e as Error).message}`, error: true };
  } finally {
    busy.value = false;
  }
}

/** A command's complaint, as the server words it: the field it is about, when it names one. */
export interface CommandError {
  field?: string;
  message: string;
}

/** What a batch came to: the entities it created and the diagnostics it added, or why not. */
export type CommandOutcome =
  | { ok: true; rev: number; created: string[]; diagnostics: Diagnostic[] }
  | { ok: false; why: string; errors: CommandError[] };

/**
 * Sends a batch of commands as one step (§7.1: a gesture is committed as one command batch, with
 * source `ui`), and resolves with what it came to. A refusal is also shown as the notice, naming
 * the command and why. `strict` refuses the batch when another step came first: for a batch
 * that names an id it expects to create (a pivot its carried ends point to).
 */
export async function sendCommands(
  commands: readonly { cmd: string; args?: unknown }[],
  what: string,
  opts: { strict?: boolean } = {},
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
      notice.value = undefined;
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
    notice.value = { text: `${what}: ${why}`, error: true };
    return { ok: false, why, errors };
  } catch (e) {
    const why = (e as Error).message;
    notice.value = { text: `${what}: ${why}`, error: true };
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
    notice.value = { text: `exported ${name}`, error: false };
  } catch (e) {
    notice.value = { text: `export: ${(e as Error).message}`, error: true };
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
    notice.value = { text: `saved ${r.body.file}`, error: false };
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
export const restore = () => send("/api/restore", {}, "restore");

extendHook({
  rev: () => summary.value?.rev,
  readOnly: () => summary.value?.status.readOnly === true,
});
