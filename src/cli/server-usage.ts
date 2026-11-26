/**
 * The usage of the commands that run or talk to a project's server (design §7.1, §7.3), apart
 * from the commands themselves so that `--help` loads no server code.
 */
export const SERVER_USAGE_OF = {
  serve: [
    "alukit serve <dir> [--port N] [--no-open]",
    "    run the project's server: tabs and the CLI edit through it; opens the app",
  ].join("\n"),
  history: [
    "alukit undo | redo <dir> [--as <name>] [--json]",
    "    take back the latest step, whoever made it, or apply again the last one taken back",
    "alukit log <dir> [--json]",
    "    the server's log: every step, undo and redo, with its source",
  ].join("\n"),
  snapshot: [
    "alukit snapshot <dir> -o <file.png> [--view <name>] [--size <w>x<h>]",
    "    render a view to PNG in headless Chromium, on the running server or an ephemeral one:",
    "    a view the document names, or iso, top, front, side, left, back, bottom (1600x1000, iso)",
  ].join("\n"),
} as const;

export const SERVER_USAGE = [
  SERVER_USAGE_OF.serve,
  SERVER_USAGE_OF.history,
  SERVER_USAGE_OF.snapshot,
].join("\n");

export const SERVER_COMMANDS = ["serve", "snapshot", "undo", "redo", "log"] as const;
