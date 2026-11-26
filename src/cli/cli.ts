import { packageVersion } from "#core/version.ts";
import { CATALOG_USAGE } from "./catalog-usage.ts";
import { EDIT_COMMANDS, EDIT_USAGE, PROJECT_COMMANDS, PROJECT_USAGE } from "./project-usage.ts";
import { PUBLISH_COMMANDS, PUBLISH_USAGE, type PublishCommand } from "./publish-usage.ts";
import { SERVER_COMMANDS, SERVER_USAGE } from "./server-usage.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Reads all of standard input (`alukit do <dir> -`). */
  stdin?: () => Promise<string>;
}

export { packageVersion };

/** Every command of design §7.3, by group. */
export function helpText(): string {
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
    ...PUBLISH_USAGE.split("\n").map((line) => `  ${line.replace(/^alukit /, "")}`),
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
  if ((PUBLISH_COMMANDS as readonly string[]).includes(cmd)) {
    const { publishCommand } = await import("./publish.ts");
    return publishCommand(cmd as PublishCommand, rest, io);
  }
  io.err(`alukit: unknown command "${cmd}". Try --help.`);
  return 2;
}
