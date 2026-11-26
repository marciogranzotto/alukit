/**
 * The usage of the project commands, apart from the commands themselves so that `--help` and
 * `--version` load no schemas.
 */
export const PROJECT_USAGE = [
  "alukit derive <dir> [--json] [--frozen]",
  "    the derived model: frames, end planes, cut lengths and angles (alukit.derived/1)",
  "alukit cutlist <dir> [--format md|csv|json] [--frozen]",
  "    the cut list: pieces grouped per item and option, ordered or nested into stock",
].join("\n");

export const PROJECT_COMMANDS = ["derive", "cutlist"] as const;

/** The editing and housekeeping commands (design §6, §7.3, §4.13), each in its own module. */
export const USAGE = {
  fmt: [
    "alukit fmt <dir>... [--check]",
    "    rewrite alukit.json and alukit.lock.json into canonical form; --check: exit 1 if one would change",
  ],
  lock: [
    "alukit lock update <dir> [--item <id>]... [--dry-run] [--json]",
    "    refresh alukit.lock.json from the live catalogs; print the changes and their effect on cut lengths",
  ],
} as const;

export type EditCommand = keyof typeof USAGE;
export const EDIT_COMMANDS = Object.keys(USAGE) as EditCommand[];

export function usageOf(cmd: EditCommand): string {
  return USAGE[cmd].join("\n");
}

export const EDIT_USAGE = EDIT_COMMANDS.map(usageOf).join("\n");
