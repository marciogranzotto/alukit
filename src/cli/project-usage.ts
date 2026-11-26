/**
 * The usage of the project commands, apart from the commands themselves so that `--help` and
 * `--version` load no schemas.
 */
export const PROJECT_USAGE = [
  "alukit derive <dir> [--json]",
  "    the derived model: frames, end planes, cut lengths and angles, parts, rail holes,",
  "    fastenings, generated machining and hardware (alukit.derived/1)",
  "alukit cutlist <dir> [--format md|csv|json]",
  "    the cut list: pieces grouped per item and option, ordered or nested into stock",
  "alukit bom <dir> [--format md|csv|json]",
  "    the bill of materials: every item and quantity, grouped by kind, with mass",
  "alukit order <dir> [--format md|csv|json] [--as-of YYYY-MM-DD]",
  "    the order list per supplier, READY or BLOCKED with every reason, and the totals;",
  "    exits 1 when any supplier is blocked (prices older than 30 days before --as-of,",
  "    today by default, are stale)",
  "alukit costs <dir> [--format md|csv|json] [--as-of YYYY-MM-DD]",
  "    the cost lines and the low, likely and high totals, with their provenance",
].join("\n");

export const PROJECT_COMMANDS = ["derive", "cutlist", "bom", "order", "costs"] as const;
