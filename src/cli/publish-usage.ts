/**
 * The usage of the commands that compare, publish, render and export (design §7.3, §4.13, §9,
 * §7.5), apart from the commands themselves so that `--help` and `--version` load no schemas.
 */
export const PUBLISH = {
  diff: [
    "alukit diff <a> [<b>] [--variant v]... [--as-of YYYY-MM-DD] [--format md|json]",
    "    what moved between two sides: entities, cut lengths, BOM and order lines, prices and",
    "    totals, and the lock. A side is a project folder or its alukit.json, a revision file,",
    "    rev:<name> (a revision of the project here), or git:<ref>:<path>; each derives with",
    "    its own lock. One side and two --variant compare two variants of it",
  ],
  revision: [
    "alukit revision save [<dir>] <name> [--as-of YYYY-MM-DD] [--frozen] [--json]",
    "alukit revision list [<dir>] [--json]",
    "alukit revision show [<dir>] <name> [--variant v]",
    "                     [--output derive|cutlist|bom|order|costs|machining|check]",
    "                     [--format md|csv|json]",
    "alukit revision verify [<dir>] <name> [--json]",
    "    revisions/<name>.json: the document, its lock, the outputs of every variant and a",
    "    stamp; show prints what was stored; verify re-derives it and exits 1 on any drift",
    "    (<dir> defaults to the current folder)",
  ],
  snapshot: [
    "alukit snapshot <dir> -o <file.png> [--view <name>] [--size <w>x<h>]",
    "    render a view to PNG in headless Chromium, on the running server or an ephemeral one:",
    "    a view the document names, or iso, top, front, side, left, back, bottom (1600x1000, iso)",
  ],
  export: [
    "alukit export glb <dir> -o <file.glb> [--variant v] [--frozen]",
    "    the model as binary glTF: Y up, metres, one node per bar, part and fastener, each",
    "    named <id> <label|item> with its id, item, SKU, options and cut length in extras;",
    "    a project plate's or bent angle's holes are its node's children (<part>.<hole> <rod>)",
  ],
  skill: [
    "alukit skill install [--dir <skills folder>]",
    "    link the agent skill into ~/.claude/skills/alukit (refuses to replace another target)",
  ],
} as const;

export type PublishCommand = keyof typeof PUBLISH;
export const PUBLISH_COMMANDS = Object.keys(PUBLISH) as PublishCommand[];

export function publishUsageOf(cmd: PublishCommand): string {
  return PUBLISH[cmd].join("\n");
}

export const PUBLISH_USAGE = PUBLISH_COMMANDS.map(publishUsageOf).join("\n");
