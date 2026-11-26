import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseJson } from "#catalog/json.ts";
import { checkModel } from "#core/check/check.ts";
import { applyBatch, batchOf, type CommandResult } from "#core/commands/apply.ts";
import type { State } from "#core/commands/types.ts";
import { derive } from "#core/derive/derive.ts";
import { jsonText } from "#core/derive/output.ts";
import type { Diagnostic } from "#core/diagnostics.ts";
import { contentHash, pinLock } from "#core/lock/pin.ts";
import { documentRefs, lockCovers } from "#core/lock/refs.ts";
import { LOCK_FILE, lockText } from "#core/lock/schema.ts";
import { lockItems } from "#core/lock/source.ts";
import { projectText } from "#core/project/canonical.ts";
import { openLiveCatalogs } from "#core/project/open.ts";
import {
  EditLockHeld,
  readDocument,
  readLock,
  withEditLock,
  writeProject,
} from "#core/project/store.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine } from "./project.ts";
import { usageOf } from "./project-usage.ts";

/**
 * `alukit do <dir> '<json>' | -f <file> | -` (design §6, §7.1, §7.3): one batch per process,
 * applied atomically by the same core the server will run, under `.alukit/edit.lock`. The answer
 * names what each command created, removed and changed, the new revision, and the diagnostics
 * the batch added or resolved. With no server, the revision is the content hash of the document
 * and its lock: the server's counter (M4a) needs a process that outlives one batch.
 */

export const DO_SCHEMA = "alukit.do/1";
const DO_USAGE = usageOf("do");

export interface EditOptions {
  json: boolean;
  /** Tags the source (§7.1): `cli:<name>`. */
  as?: string;
  /** The command named in error messages: `do`, or `add` when it applies its own command. */
  cmd: string;
}

/** Today as YYYY-MM-DD in local time: the date a decision record carries. */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** What `alukit check` reports on the model of a state (§5.5), without the file-level checks. */
function modelDiagnostics(s: State): Diagnostic[] {
  const items = lockItems(s.lock);
  return checkModel({ raw: s.doc, derived: derive(s.doc, items), items }).diagnostics;
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

function resultLine(r: CommandResult): string {
  const parts = [
    r.created.length > 0 ? `created ${r.created.join(", ")}` : "",
    r.removed.length > 0 ? `removed ${r.removed.join(", ")}` : "",
    r.changed.length > 0 ? `changed ${r.changed.join(", ")}` : "",
  ].filter((s) => s !== "");
  return `${r.cmd}: ${parts.length > 0 ? parts.join("; ") : "no change"}`;
}

/** Applies a batch to a project folder and answers; the exit code. */
export async function applyToProject(
  dir: string,
  commands: readonly unknown[],
  io: Io,
  opts: EditOptions,
): Promise<number> {
  const root = resolve(dir);
  const source = opts.as ? `cli:${opts.as}` : "cli";
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
      const before = modelDiagnostics(state);

      const r = applyBatch(state, commands, { today: localDate(), live: live.set });
      if (!r.ok) {
        if (opts.json) {
          io.out(jsonText({ schema: DO_SCHEMA, ok: false, source, failed: r.failed }).trimEnd());
        } else {
          const { index, cmd, errors } = r.failed;
          io.err(`refused: command ${index + 1}${cmd ? ` (${cmd})` : ""}; nothing was changed`);
          for (const e of errors) {
            io.err(
              `  ${e.code}${e.entity ? ` ${e.entity}` : ""}${e.field ? ` ${e.field}` : ""}: ${e.message}`,
            );
          }
        }
        return 1;
      }

      const docText = projectText(r.state.doc);
      const newLockText = lockText(r.state.lock);
      await writeProject(
        root,
        docText !== doc.text ? docText : undefined,
        newLockText !== lockRead.text ? r.state.lock : undefined,
      );
      const rev = contentHash([docText, newLockText]).slice(
        "sha256:".length,
        "sha256:".length + 12,
      );

      const after = modelDiagnostics(r.state);
      const was = new Set(before.map(key));
      const now = new Set(after.map(key));
      const added = after.filter((d) => !was.has(key(d)));
      const resolved = before.filter((d) => !now.has(key(d)));
      const total = counts(after);
      if (opts.json) {
        io.out(
          jsonText({
            schema: DO_SCHEMA,
            ok: true,
            rev,
            source,
            results: r.results,
            diagnostics: { new: added, resolved, counts: total },
          }).trimEnd(),
        );
        return 0;
      }
      for (const res of r.results) io.out(resultLine(res));
      for (const d of added) io.out(`new ${diagnosticLine(d)}`);
      for (const d of resolved) io.out(`resolved ${diagnosticLine(d)}`);
      io.out(
        `rev ${rev}: ${total.error} error${total.error === 1 ? "" : "s"}, ${total.warn} warning${total.warn === 1 ? "" : "s"} (${added.length} new, ${resolved.length} resolved)`,
      );
      return 0;
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
  return applyToProject(dir, commands, io, {
    json: args.values.json === true,
    ...(args.values.as ? { as: args.values.as } : {}),
    cmd: "do",
  });
}
