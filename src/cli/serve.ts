import { spawn } from "node:child_process";
import { EditLockHeld } from "#core/project/store.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine } from "./project.ts";
import { SERVER_USAGE } from "./server-usage.ts";

/**
 * `alukit serve <dir> [--port N] [--no-open]` (design §7.1, §7.3): runs the project's server and
 * opens the app at `http://127.0.0.1:<port>/#t=<token>`. It runs until interrupted; then it
 * removes `.alukit/owner.json` and releases the edit lock.
 */

const SERVE_USAGE = SERVER_USAGE.split("\n").slice(0, 2).join("\n");

/** Opens a URL in the default browser, without waiting for it. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", '""', url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No browser to open: the URL is printed.
  }
}

export async function serveCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "serve",
    argv,
    { port: { type: "string" }, "no-open": { type: "boolean" } },
    SERVE_USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, ...extra] = args.positionals;
  if (dir === undefined) return usageError("serve", "a project folder is needed", SERVE_USAGE, io);
  if (extra.length > 0)
    return usageError("serve", `unexpected argument ${extra[0]}`, SERVE_USAGE, io);
  const port = args.values.port === undefined ? 0 : Number(args.values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return usageError("serve", `invalid --port: ${args.values.port}`, SERVE_USAGE, io);
  }

  // Loaded lazily so --version and --help never touch the server.
  const { startServer } = await import("../server/server.ts");
  const { HostOpenError } = await import("../server/host.ts");
  let running: Awaited<ReturnType<typeof startServer>>;
  try {
    running = await startServer({ dir, port });
  } catch (e) {
    if (e instanceof HostOpenError) {
      io.err(`alukit serve: the project's files are not valid (see alukit check ${dir}):`);
      for (const d of e.diagnostics) io.err(`  ${diagnosticLine(d)}`);
    } else if (e instanceof EditLockHeld) {
      io.err(`alukit serve: ${e.message}`);
    } else {
      io.err(`alukit serve: ${e instanceof Error ? e.message : String(e)}`);
    }
    return 1;
  }
  io.out(running.appUrl);
  if (args.values["no-open"] !== true) openBrowser(running.appUrl);

  return await new Promise<number>((done) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      running.close().then(
        () => done(0),
        () => done(1),
      );
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
