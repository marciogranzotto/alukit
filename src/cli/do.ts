import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseJson } from "#catalog/json.ts";
import { checkModel } from "#core/check/check.ts";
import { modelOutputs, outputAccessors } from "#core/check/outputs.ts";
import { applyBatchLive, batchOf, type CommandResult } from "#core/commands/apply.ts";
import { taggedWords } from "#core/commands/copies.ts";
import { type DryEffects, effectsOf, type PartEffect } from "#core/commands/dry.ts";
import type { CommandError, State } from "#core/commands/types.ts";
import { localDate } from "#core/dates.ts";
import { type Derived, derive } from "#core/derive/derive.ts";
import { jsonText } from "#core/derive/output.ts";
import type { Diagnostic } from "#core/diagnostics.ts";
import { contentHash, pinLock } from "#core/lock/pin.ts";
import { documentRefs, lockCovers } from "#core/lock/refs.ts";
import { LOCK_FILE, lockText } from "#core/lock/schema.ts";
import { lockItems } from "#core/lock/source.ts";
import { projectText } from "#core/project/canonical.ts";
import { catalogPlaces, openLiveCatalogs } from "#core/project/open.ts";
import {
  EditLockHeld,
  readDocument,
  readLock,
  withEditLock,
  writeProject,
} from "#core/project/store.ts";
import { call, findServer, type ServerLink } from "../server/client.ts";
import { cliSource } from "../server/source.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine } from "./project.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit do <dir> '<json>' | -f <file> | -` (design §6, §7.1, §7.3): one batch per process,
 * applied atomically. When a server owns the project (found through `.alukit/owner.json`), the
 * batch goes to it, so it appears live in every tab and enters the server's log; otherwise the
 * same core runs in-process under `.alukit/edit.lock`. The answer names what each command
 * created, removed and changed, the new revision, and the diagnostics the batch added or
 * resolved. With no server, the revision is the content hash of the document and its lock: the
 * server's counter needs a process that outlives one batch.
 */

export const DO_SCHEMA = "alukit.do/1";
const DO_USAGE = usageOf("do");

export interface EditOptions {
  json: boolean;
  /** A dry run (BE-2): apply and derive, write nothing, and say what the step would do. */
  dry?: boolean;
  /** The step's source in the log (§7.1), from `--as` through `cliSource`. */
  source: string;
  /** The command named in error messages: `do`, or `add` when it applies its own command. */
  cmd: string;
}

/**
 * A state derived, with what `alukit check` reports on its model (§5.5), without the file-level
 * checks.
 */
function modelOf(s: State): { derived: Derived; diagnostics: Diagnostic[] } {
  const items = lockItems(s.lock);
  const derived = derive(s.doc, items);
  const accessors = outputAccessors(modelOutputs(derived, items));
  return {
    derived,
    diagnostics: checkModel({ raw: s.doc, derived, items, accessors }).diagnostics,
  };
}

function key(d: Diagnostic): string {
  return diagnosticLine(d);
}

function counts(ds: readonly Diagnostic[]) {
  return {
    error: ds.filter((d) => d.severity === "error").length,
    warn: ds.filter((d) => d.severity === "warn").length,
    info: ds.filter((d) => d.severity === "info").length,
  };
}

function resultLine(r: CommandResult, dry: boolean): string {
  const verb = (done: string, would: string) => (dry ? `would ${would}` : done);
  const parts = [
    r.created.length > 0 ? `${verb("created", "create")} ${r.created.join(", ")}` : "",
    r.removed.length > 0 ? `${verb("removed", "remove")} ${r.removed.join(", ")}` : "",
    r.changed.length > 0 ? `${verb("changed", "change")} ${r.changed.join(", ")}` : "",
    // The tags a copy carries, as the app's preview says them (review m2).
    taggedWords((r.info as { tagged?: Record<string, string[]> } | undefined)?.tagged),
  ].filter((s) => s !== "");
  return `${r.cmd}: ${parts.length > 0 ? parts.join("; ") : "no change"}`;
}

/** What a dry run says the step would do to what is derived, a line each. */
/** Where a part a step adds lands: on a bar at a distance, at a point, or counted. */
function partWhere(p: PartEffect): string {
  if ("qty" in p) return `${p.item}, ${p.qty} counted, not placed`;
  if (p.bar !== undefined && p.s_mm !== undefined) return `${p.item} on ${p.bar} at ${p.s_mm}`;
  return `${p.item} at (${p.origin.join(", ")})`;
}

function effectLines(e: DryEffects): string[] {
  return [
    ...Object.entries(e.cuts).map(([id, [a, b]]) => `cut ${id}: ${a} → ${b}`),
    ...Object.entries(e.added).map(([id, cut]) => `new ${id}: cut ${cut}`),
    ...Object.entries(e.parts).map(([id, p]) => `new ${id}: ${partWhere(p)}`),
    ...(e.claimed.length > 0 ? [`claims ${e.claimed.join(", ")}`] : []),
  ];
}

/** An answer to a batch, from the server or in-process: what `do` prints. */
type DoAnswer =
  | {
      ok: true;
      rev: number | string;
      results: CommandResult[];
      diagnostics: { new: Diagnostic[]; resolved: Diagnostic[]; counts: ReturnType<typeof counts> };
      /** From a server: the steps others made since the batch's base revision. */
      between?: unknown[];
      /** A dry run's: every id the step would create, and what it would do to what is derived. */
      created?: string[];
      effects?: DryEffects;
    }
  | { ok: false; failed: { index: number; cmd?: string; errors: CommandError[] } };

function report(answer: DoAnswer, source: string, io: Io, opts: EditOptions): number {
  const dry = opts.dry === true;
  if (opts.json) {
    io.out(jsonText({ schema: DO_SCHEMA, ...(dry ? { dry } : {}), ...answer, source }).trimEnd());
    return answer.ok ? 0 : 1;
  }
  if (!answer.ok) {
    const { index, cmd, errors } = answer.failed;
    io.err(`refused: command ${index + 1}${cmd ? ` (${cmd})` : ""}; nothing was changed`);
    for (const e of errors) {
      io.err(
        `  ${e.code}${e.entity ? ` ${e.entity}` : ""}${e.field ? ` ${e.field}` : ""}: ${e.message}`,
      );
    }
    return 1;
  }
  const { new: added, resolved, counts: total } = answer.diagnostics;
  for (const res of answer.results) io.out(resultLine(res, dry));
  for (const d of added) io.out(`${dry ? "would add" : "new"} ${diagnosticLine(d)}`);
  for (const d of resolved) io.out(`${dry ? "would resolve" : "resolved"} ${diagnosticLine(d)}`);
  if (answer.effects) for (const line of effectLines(answer.effects)) io.out(line);
  const tally = `${total.error} error${total.error === 1 ? "" : "s"}, ${total.warn} warning${total.warn === 1 ? "" : "s"} (${added.length} new, ${resolved.length} resolved)`;
  io.out(
    dry
      ? `dry run on rev ${answer.rev}: ${tally} after it; nothing was written`
      : `rev ${answer.rev}: ${tally}`,
  );
  return 0;
}

/** Sends a batch to the server that owns the project; the exit code. */
async function applyThroughServer(
  link: ServerLink,
  commands: readonly unknown[],
  source: string,
  io: Io,
  opts: EditOptions,
): Promise<number> {
  let r: Awaited<ReturnType<typeof call>>;
  try {
    // The id makes a retry harmless (§7.1); this process sends once. A dry run has none: it
    // changes nothing, and the server remembers no answer of one.
    r = await call(
      link,
      "POST",
      "/api/commands",
      opts.dry ? { commands, source, dryRun: true } : { commands, source, id: randomUUID() },
    );
  } catch (e) {
    io.err(
      `alukit ${opts.cmd}: the server at ${link.url} did not answer (${e instanceof Error ? e.message : String(e)}); nothing is known to have changed`,
    );
    return 1;
  }
  const body = r.body as {
    ok?: boolean;
    kind?: string;
    message?: string;
    status?: { message?: string };
  } & Partial<DoAnswer>;
  if (body.ok === true || body.kind === "refused")
    return report(body as DoAnswer, source, io, opts);
  const why =
    body.kind === "read-only"
      ? `the project is read-only: ${body.status?.message ?? "its files are not valid"}`
      : (body.message ?? `the server answered ${r.status}`);
  if (opts.json) io.out(jsonText({ schema: DO_SCHEMA, ...body, source }).trimEnd());
  else io.err(`refused: ${why}; nothing was changed`);
  return 1;
}

/** Applies a batch to a project folder and answers; the exit code. */
export async function applyToProject(
  dir: string,
  commands: readonly unknown[],
  io: Io,
  opts: EditOptions,
): Promise<number> {
  const root = resolve(dir);
  const source = opts.source;
  const link = await findServer(root);
  if (link) return applyThroughServer(link, commands, source, io, opts);
  try {
    return await withEditLock(root, async () => {
      const doc = await readDocument(root);
      const lockRead = await readLock(root);
      const problems = [...doc.diagnostics, ...lockRead.diagnostics];
      if (doc.value === undefined || problems.length > 0) {
        for (const d of problems) io.err(diagnosticLine(d));
        if (lockRead.diagnostics.length > 0) {
          io.err(`${LOCK_FILE} cannot be read: rebuild it with alukit lock update`);
        }
        return 1;
      }
      const raw = doc.value as State["doc"];
      const live = await openLiveCatalogs(root, raw);

      // The lock as derive will read it: created, or completed, first (§4.13).
      let lock = lockRead.value;
      const refs = documentRefs(raw);
      if (!lock || !lockCovers(lock, refs)) {
        const pinned = pinLock(live.set, refs, lock, { kind: "add" });
        io.err(
          `notice: ${LOCK_FILE} ${lock ? `pinned ${pinned.added.length} new entr${pinned.added.length === 1 ? "y" : "ies"}` : "created"}`,
        );
        lock = pinned.lock;
      }
      const state: State = { doc: raw, lock };
      const before = modelOf(state);

      const env = { today: localDate(), live: live.set, catalogs: await catalogPlaces(root) };
      const r = await applyBatchLive(state, commands, env, async (catalogs) => {
        return (await openLiveCatalogs(root, { catalogs })).set;
      });
      if (!r.ok) return report({ ok: false, failed: r.failed }, source, io, opts);

      // The revision: the content hash of the files as written, or, for a dry run, of the
      // state it ran against.
      const shown = opts.dry ? state : r.state;
      const docText = projectText(shown.doc);
      const newLockText = lockText(shown.lock);
      if (!opts.dry) {
        await writeProject(
          root,
          docText !== doc.text ? docText : undefined,
          newLockText !== lockRead.text ? r.state.lock : undefined,
        );
      }
      const rev = contentHash([docText, newLockText]).slice(
        "sha256:".length,
        "sha256:".length + 12,
      );

      const after = modelOf(r.state);
      const was = new Set(before.diagnostics.map(key));
      const now = new Set(after.diagnostics.map(key));
      return report(
        {
          ok: true,
          rev,
          results: r.results,
          diagnostics: {
            new: after.diagnostics.filter((d) => !was.has(key(d))),
            resolved: before.diagnostics.filter((d) => !now.has(key(d))),
            counts: counts(after.diagnostics),
          },
          ...(opts.dry
            ? {
                created: r.results.flatMap((x) => x.created),
                effects: effectsOf(before.derived, after.derived, r.results),
              }
            : {}),
        },
        source,
        io,
        opts,
      );
    });
  } catch (e) {
    if (e instanceof EditLockHeld) {
      io.err(`alukit ${opts.cmd}: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

/** Reads the batch: inline JSON, `-f <file>`, or `-` / `-f -` for standard input. */
async function readBatch(
  inline: string | undefined,
  file: string | undefined,
  io: Io,
): Promise<{ text: string; where: string } | string> {
  if (inline !== undefined && file !== undefined)
    return "give the batch inline or with -f, not both";
  const src = file ?? inline;
  if (src === undefined) return "give a batch: inline JSON, -f <file>, or - for standard input";
  if (src === "-") {
    if (!io.stdin) return "standard input is not available here";
    return { text: await io.stdin(), where: "stdin" };
  }
  if (file !== undefined) {
    try {
      return { text: await readFile(file, "utf8"), where: file };
    } catch (e) {
      return `cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { text: src, where: "the argument" };
}

export async function doCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "do",
    argv,
    {
      file: { type: "string", short: "f" },
      json: { type: "boolean" },
      as: { type: "string" },
      "dry-run": { type: "boolean" },
    },
    DO_USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, inline, ...extra] = args.positionals;
  if (dir === undefined) return usageError("do", "a project folder is needed", DO_USAGE, io);
  if (extra.length > 0) return usageError("do", `unexpected argument ${extra[0]}`, DO_USAGE, io);
  const input = await readBatch(inline, args.values.file, io);
  if (typeof input === "string") return usageError("do", input, DO_USAGE, io);
  const parsed = parseJson(input.text);
  if (!parsed.ok) {
    for (const p of parsed.problems) {
      io.err(`alukit do: ${input.where}${p.line ? `:${p.line}:${p.col}` : ""}: ${p.message}`);
    }
    return 2;
  }
  const commands = batchOf(parsed.value);
  if (!commands) {
    return usageError(
      "do",
      'a batch is a command {"cmd", "args"}, a list of them, or {"commands": [...]}',
      DO_USAGE,
      io,
    );
  }
  const who = cliSource(args.values.as);
  if ("error" in who) return usageError("do", who.error, DO_USAGE, io);
  return applyToProject(dir, commands, io, {
    json: args.values.json === true,
    dry: args.values["dry-run"] === true,
    source: who.source,
    cmd: "do",
  });
}
