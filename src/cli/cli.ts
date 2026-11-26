import { readFileSync } from "node:fs";
import { CATALOG_USAGE } from "./catalog-usage.ts";
import { EDIT_COMMANDS, EDIT_USAGE, PROJECT_COMMANDS, PROJECT_USAGE } from "./project-usage.ts";
import { SERVER_COMMANDS, SERVER_USAGE } from "./server-usage.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Reads all of standard input (`alukit do <dir> -`). */
  stdin?: () => Promise<string>;
}

/** The planned commands (design §7.3), not implemented yet. */
const PLANNED: readonly (readonly [string, string])[] = [
  ["order | costs <dir>", "the outputs"],
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
    ...SERVER_USAGE.split("\n").map((line) => `  ${line.replace(/^alukit /, "")}`),
    ...PROJECT_USAGE.split("\n").map((line) => `  ${line.replace(/^alukit /, "")}`),
    ...EDIT_USAGE.split("\n").map((line) => `  ${line.replace(/^alukit /, "")}`),
    ...CATALOG_USAGE.split("\n").map((line) => `  ${line.replace(/^alukit /, "")}`),
    ...rows,
    "",
    "Options:",
    "  --version  print the version",
    "  --help     print this help",
  ].join("\n");
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
  if ((SERVER_COMMANDS as readonly string[]).includes(cmd)) {
    if (cmd === "serve") return (await import("./serve.ts")).serveCommand(rest, io);
    const { historyCommand } = await import("./history.ts");
    return historyCommand(cmd as "undo" | "redo" | "log", rest, io);
  }
  if (cmd === "catalog") {
    const { catalogCommand } = await import("./catalog.ts");
    return catalogCommand(rest, io);
  }
  if ((PROJECT_COMMANDS as readonly string[]).includes(cmd)) {
    const { projectCommand } = await import("./project.ts");
    return projectCommand(cmd, rest, io);
  }
  if ((EDIT_COMMANDS as readonly string[]).includes(cmd)) {
    const { editCommand } = await import("./edit.ts");
    return editCommand(cmd as (typeof EDIT_COMMANDS)[number], rest, io);
  }
  if (PLANNED_NAMES.has(cmd)) {
    io.err(`alukit ${cmd}: not implemented yet`);
    return 2;
  }
  io.err(`alukit: unknown command "${cmd}". Try --help.`);
  return 2;
}
