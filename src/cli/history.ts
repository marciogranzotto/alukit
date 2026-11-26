import { jsonText } from "#core/derive/output.ts";
import { call, findServer } from "../server/client.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { SERVER_USAGE } from "./server-usage.ts";

/**
 * `alukit undo | redo | log <dir>` (design §7.1, §7.3): the undo log is the server's, one line
 * for all sources, and lives as long as the server process; git keeps the rest. So these need a
 * running server, and say so when there is none.
 */

const USAGE = SERVER_USAGE.split("\n").slice(2).join("\n");

interface LogEntry {
  rev: number;
  source: string;
  what: string;
  of?: number;
}

export async function historyCommand(
  cmd: "undo" | "redo" | "log",
  argv: readonly string[],
  io: Io,
): Promise<number> {
  const args = parseOptions(
    cmd,
    argv,
    { json: { type: "boolean" }, ...(cmd === "log" ? {} : { as: { type: "string" } }) },
    USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, ...extra] = args.positionals;
  if (dir === undefined) return usageError(cmd, "a project folder is needed", USAGE, io);
  if (extra.length > 0) return usageError(cmd, `unexpected argument ${extra[0]}`, USAGE, io);
  const as = (args.values as { as?: string }).as;

  const link = await findServer(dir);
  if (!link) {
    io.err(
      `alukit ${cmd}: no server runs for ${dir}; the log lives as long as the server (alukit serve ${dir}), and git keeps the rest`,
    );
    return 1;
  }
  try {
    if (cmd === "log") {
      const r = await call(link, "GET", "/api/log");
      const body = r.body as { rev: number; entries: LogEntry[] };
      if (r.status !== 200) {
        io.err(`alukit log: the server answered ${r.status}`);
        return 1;
      }
      if (args.values.json) io.out(jsonText({ schema: "alukit.log/1", ...body }).trimEnd());
      else {
        for (const e of body.entries)
          io.out(`${String(e.rev).padStart(4)}  ${e.source.padEnd(12)} ${e.what}`);
        io.out(`rev ${body.rev}`);
      }
      return 0;
    }
    const r = await call(link, "POST", `/api/${cmd}`, { source: as ? `cli:${as}` : "cli" });
    const body = r.body as {
      ok: boolean;
      rev: number;
      message?: string;
      step?: { rev: number; source: string; what: string };
    };
    if (args.values.json) io.out(jsonText({ schema: `alukit.${cmd}/1`, ...body }).trimEnd());
    if (!body.ok) {
      if (!args.values.json)
        io.err(`alukit ${cmd}: ${body.message ?? `the server answered ${r.status}`}`);
      return 1;
    }
    if (!args.values.json && body.step) {
      io.out(
        `${cmd === "undo" ? "undid" : "redid"} rev ${body.step.rev} (${body.step.source}: ${body.step.what}); rev ${body.rev}`,
      );
    }
    return 0;
  } catch (e) {
    io.err(
      `alukit ${cmd}: the server did not answer: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
}
