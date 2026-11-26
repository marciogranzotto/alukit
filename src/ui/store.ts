import { signal } from "@preact/signals";
import { adoptToken, get, post, readEvents } from "./api.ts";
import type { LogEntry, Model, Summary } from "./model.ts";

/**
 * The tab's state (design §7.1: a tab holds no unsaved state). The server's revision, status and
 * undo and redo steps arrive on the event stream; the model of a revision is fetched once per
 * revision. Every edit is a request to the server, whose answer comes back as the next event.
 */

export type Connection = "connecting" | "live" | "lost" | "no-token" | "refused";

export const connection = signal<Connection>("connecting");
export const summary = signal<Summary | undefined>(undefined);
export const model = signal<Model | undefined>(undefined);
export const selection = signal<ReadonlySet<string>>(new Set());
export const log = signal<LogEntry[]>([]);
/** The order's date (`as_of`), when the person picked one; the server's today otherwise. */
export const asOf = signal<string | undefined>(undefined);
/** The last answer worth telling: a refusal, a failure. */
export const notice = signal<{ text: string; error: boolean } | undefined>(undefined);
export const busy = signal(false);

let wanted = -1;
let fetching = false;

/** Fetches the model until the one drawn is the newest revision the server announced. */
async function ensureModel(rev: number): Promise<void> {
  wanted = Math.max(wanted, rev);
  if (fetching) return;
  fetching = true;
  try {
    while (model.value?.rev !== wanted) {
      const m = await get<Model>("/api/model");
      // A revision newer than any event yet: it is the one to draw.
      wanted = Math.max(wanted, m.rev);
      model.value = m;
      if (m.rev >= wanted) break;
    }
  } catch (e) {
    notice.value = { text: `cannot load the model: ${(e as Error).message}`, error: true };
  } finally {
    fetching = false;
  }
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

/**
 * Sends a batch of commands as one step (§7.1: a gesture is committed as one command batch, with
 * source `ui`). Resolves true when applied; a refusal is shown as the notice, naming the
 * command and why.
 */
export async function applyCommands(
  commands: readonly { cmd: string; args?: unknown }[],
  what: string,
): Promise<boolean> {
  busy.value = true;
  try {
    const r = await post<{
      ok?: boolean;
      message?: string;
      status?: { message?: string };
      failed?: { index: number; cmd?: string; errors?: { message: string }[] };
    }>("/api/commands", {
      commands,
      source: "ui",
      ...(model.value ? { baseRev: model.value.rev } : {}),
    });
    if (r.status === 200 && r.body.ok !== false) {
      notice.value = undefined;
      return true;
    }
    const f = r.body.failed;
    const why = f
      ? `${f.cmd ?? `command ${f.index + 1}`}: ${(f.errors ?? []).map((e) => e.message).join("; ")}`
      : (r.body.status?.message ?? r.body.message ?? `the server answered ${r.status}`);
    notice.value = { text: `${what}: ${why}`, error: true };
    return false;
  } catch (e) {
    notice.value = { text: `${what}: ${(e as Error).message}`, error: true };
    return false;
  } finally {
    busy.value = false;
  }
}

export const undo = () => send("/api/undo", { source: "ui" }, "undo");
export const redo = () => send("/api/redo", { source: "ui" }, "redo");
export const restore = () => send("/api/restore", {}, "restore");

export function select(ids: readonly string[], mode: "replace" | "toggle" | "add"): void {
  if (mode === "replace") {
    selection.value = new Set(ids);
    return;
  }
  const next = new Set(selection.value);
  for (const id of ids) {
    if (mode === "toggle" && next.has(id)) next.delete(id);
    else next.add(id);
  }
  selection.value = next;
}
