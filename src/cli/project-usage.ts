/**
 * The usage of the project commands, apart from the commands themselves so that `--help` and
 * `--version` load no schemas.
 */
export const PROJECT_USAGE = [
  "alukit derive <dir> [--json] [--select <paths>] [--variant v] [--frozen]",
  "    the derived model: frames, end planes, cut lengths and angles, parts, rail holes,",
  "    fastenings, generated machining and hardware (alukit.derived/1); --select answers",
  "    JSON with only the members named, e.g. bars.*.cut_mm,params (* is every member)",
  "alukit cutlist <dir> [--format md|csv|json] [--variant v] [--frozen]",
  "    the cut list: pieces grouped per item and option, ordered or nested into stock",
  "alukit bom <dir> [--format md|csv|json] [--variant v] [--frozen]",
  "    the bill of materials: every item and quantity, grouped by kind, with mass",
  "alukit order <dir> [--format md|csv|json] [--as-of YYYY-MM-DD] [--variant v] [--frozen]",
  "    the order list per supplier, READY or BLOCKED with every reason, and the totals;",
  "    exits 1 when any supplier is blocked (prices older than 30 days before --as-of,",
  "    today by default, are stale)",
  "alukit costs <dir> [--format md|csv|json] [--as-of YYYY-MM-DD] [--variant v] [--frozen]",
  "    the cost lines and the low, likely and high totals, with their provenance",
  "alukit machining <dir> [--format md|json] [--variant v] [--frozen]",
  "    the machining sheet: each custom plate's and bent angle's holes from its datum,",
  "    with its blank; the cut-list lines that carry the bars' machining",
  "    (--variant v: derive that variant; without it, the project's default variant)",
].join("\n");

export const PROJECT_COMMANDS = [
  "derive",
  "cutlist",
  "bom",
  "order",
  "costs",
  "machining",
] as const;

/** The editing and housekeeping commands (design §6, §7.3, §4.13), each in its own module. */
export const USAGE = {
  new: [
    "alukit new <dir> [--name <name>] [--catalog <id|path>]... [--currency <code>]",
    "    create a project: alukit.json, alukit.lock.json and a .gitignore line for .alukit/",
  ],
  check: [
    "alukit check <dir> [--json] [--variant v] [--frozen]",
    "    validate, derive and run the checks; exit 1 on an error",
  ],
  problems: [
    "alukit problems <dir> [--json] [--variant v] [--as-of YYYY-MM-DD]",
    "    the check and the order's reasons as one list in words, grouped by what they hold up,",
    "    each with its fixes (alukit.problems/1); exit 1 when one blocks the order or is an error",
  ],
  arrangements: [
    "alukit arrangements <dir> --at x,y,z [--at x,y,z]... [--rule vertical|x|y|first]... [--json]",
    "    where bar ends meet at those points, each corner rule's arrangement: which bar runs",
    "    through and the cut lengths it gives, and the batch that applies it; writes nothing",
  ],
  do: [
    "alukit do <dir> '<json>' | -f <file> | -  [--json] [--as <name>|agent:<name>] [--dry-run]",
    "    apply a batch of commands atomically, from an argument, a file or stdin; --dry-run",
    "    writes nothing and says what the step would do: diagnostics, ids, cut lengths that move",
  ],
  add: [
    "alukit add bar|point|connection|part|frame <dir> [options] [--json]",
    "    add one entity, or a box frame in one step, as sugar over `do`; `alukit add <what> --help`",
    "    lists the options",
  ],
  move: [
    "alukit move <dir> --ids <id,id,...> --by <dx,dy,dz> [--detach] [--dry-run] [--json] [--as <name>]",
    "    move nodes, bars, runs, parts or a pattern's template by an offset, as sugar over `do`",
    "    (`transform`); joined ends follow, or --detach frees them; expressions keep their params",
  ],
  rotate: [
    "alukit rotate <dir> --ids <id,id,...> --axis x|y|z --deg <deg> --about <x,y,z> [--detach] [--dry-run] [--json] [--as <name>]",
    "    turn them about a world axis through a point (`transform`); exact at multiples of 90°",
  ],
  query: [
    "alukit query <dir> <selector> [--fields a,b] [--limit n] [--summary] [--json]",
    "    entities by id, kind, tag:<t>, item:<ref>, or `<kind> of <id>`; bounded output",
  ],
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
