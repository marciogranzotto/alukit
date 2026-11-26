/**
 * The usage of the project commands, apart from the commands themselves so that `--help` and
 * `--version` load no schemas.
 */
export const PROJECT_USAGE = [
  "alukit derive <dir> [--json]",
  "    the derived model: frames, end planes, cut lengths and angles (alukit.derived/1)",
  "alukit cutlist <dir> [--format md|csv|json]",
  "    the cut list: pieces grouped per item and option, ordered or nested into stock",
].join("\n");

export const PROJECT_COMMANDS = ["derive", "cutlist"] as const;
