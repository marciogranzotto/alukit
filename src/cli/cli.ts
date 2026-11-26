import { readFileSync } from "node:fs";
import { CATALOG_USAGE } from "./catalog-usage.ts";
import { PROJECT_COMMANDS, PROJECT_USAGE } from "./project-usage.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** The planned commands (design §7.3), not implemented yet. */
const PLANNED: readonly (readonly [string, string])[] = [
  ["new <dir>", "create a project"],
  ["check <dir>", "validate, derive and run the checks"],
  ["bom | order | costs <dir>", "the outputs"],
  ["query <dir> <selector>", "select entities"],
  ["do <dir> -f batch.json", "apply edits"],
  ["log | undo", "the server's log; undo the latest step"],
  ["lock update <dir>", "refresh the catalog lock"],
  ["fmt <dir>", "rewrite a project into canonical form"],
  ["diff <a> <b>", "compare projects, revisions or variants"],
  ["revision save|verify <name>", "revisions"],
  ["snapshot <dir>", "render a view to PNG"],
  ["export glb <dir>", "export a GLB"],
  ["catalog search | import", "find items; run a vendor importer"],
  ["skill install", "link the agent skill"],
];

/** The first word of each usage alternative: "cutlist | bom" gives cutlist and bom. */
const PLANNED_NAMES = new Set(
  PLANNED.flatMap(([usage]) => usage.split(" | ").map((alt) => alt.split(" ")[0] as string)),
);
PLANNED_NAMES.delete("catalog");

export function packageVersion(): string {
  const url = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
  return pkg.version;
}

export function helpText(): string {
  const width = Math.max(...PLANNED.map(([cmd]) => cmd.length));
  const rows = PLANNED.map(
    ([cmd, what]) => `  ${cmd.padEnd(width)}  ${what} (not implemented yet)`,
  );
  return [
    "alukit: plan aluminium-extrusion builds",
    "",
    "Usage: alukit <command> [options]",
    "",
    "Commands:",
    `  ${"serve [--port N]".padEnd(width)}  serve the app on 127.0.0.1`,
    ...PROJECT_USAGE.split("\n").map((line) => `  ${line.replace(/^alukit /, "")}`),
    ...CATALOG_USAGE.split("\n").map((line) => `  ${line.replace(/^alukit /, "")}`),
    ...rows,
    "",
    "Options:",
    "  --version  print the version",
    "  --help     print this help",
  ].join("\n");
}

function parsePort(args: readonly string[]): number | undefined {
  const i = args.indexOf("--port");
  if (i === -1) return undefined;
  const port = Number(args[i + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port: ${args[i + 1] ?? "(missing)"}`);
  }
  return port;
}

/** Runs the CLI. Returns the exit code, or a promise that never settles while a server runs. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") {
    io.out(helpText());
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    io.out(packageVersion());
    return 0;
  }
  if (cmd === "serve") {
    try {
      // Loaded lazily so --version and --help never touch the server.
      const { startServer } = await import("../server/server.ts");
      const { url } = await startServer({ port: parsePort(rest) ?? 0 });
      io.out(url);
      return await new Promise<number>(() => {});
    } catch (e) {
      io.err(`alukit serve: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }
  if (cmd === "catalog") {
    const { catalogCommand } = await import("./catalog.ts");
    return catalogCommand(rest, io);
  }
  if ((PROJECT_COMMANDS as readonly string[]).includes(cmd)) {
    const { projectCommand } = await import("./project.ts");
    return projectCommand(cmd, rest, io);
  }
  if (PLANNED_NAMES.has(cmd)) {
    io.err(`alukit ${cmd}: not implemented yet`);
    return 2;
  }
  io.err(`alukit: unknown command "${cmd}". Try --help.`);
  return 2;
}
