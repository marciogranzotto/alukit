import { nextIdNumber } from "#core/ids.ts";
import { exampleCommands, workedExample } from "../../cli/skill-example.ts";

/**
 * The start card's example (D-UX-25): the skill's worked example, a work table on a shipped
 * catalog, read from `skills/alukit/SKILL.md` by the parser its own test uses, so the card and
 * the skill cannot drift apart. Its `alukit new` names the catalogs and the currency; its
 * `alukit do` batches are the commands, which the card sends as one step. Owner: S2.
 */

export interface Command {
  cmd: string;
  args?: unknown;
}

export interface Example {
  /** The catalogs `alukit new` names (`--catalog`). */
  catalogs: string[];
  currency?: string;
  /** Every `alukit do` batch, in order, as one list. */
  commands: Command[];
}

const isCommand = (x: unknown): x is Command =>
  typeof x === "object" && x !== null && typeof (x as Command).cmd === "string";

let loaded: Promise<Example> | undefined;

/**
 * The skill's example, read and parsed the first time it is asked for. The skill's text (44 kB)
 * is a chunk of its own, which only loading the example needs, so the page does not parse it on
 * every start (docs/ux/integration-decisions.md).
 */
export function loadExample(): Promise<Example> {
  loaded ??= import("../../../skills/alukit/SKILL.md?raw").then(
    (m) => exampleOf(m.default),
    (e: unknown) => {
      loaded = undefined;
      throw e;
    },
  );
  return loaded;
}

/** The example's catalogs, currency and commands. */
export function exampleOf(skill: string): Example {
  const out: Example = { catalogs: [], commands: [] };
  for (const words of exampleCommands(workedExample(skill))) {
    if (words[0] !== "alukit") continue;
    if (words[1] === "new") {
      for (let i = 2; i < words.length; i++) {
        if (words[i] === "--catalog" && words[i + 1]) out.catalogs.push(words[++i] as string);
        else if (words[i] === "--currency" && words[i + 1]) out.currency = words[++i] as string;
      }
    } else if (words[1] === "do" && words[3] !== undefined) {
      const batch: unknown = JSON.parse(words[3]);
      for (const c of Array.isArray(batch) ? batch : [batch]) {
        if (!isCommand(c))
          throw new Error(`the example's batch holds a non-command: ${JSON.stringify(c)}`);
        out.commands.push(c);
      }
    }
  }
  return out;
}

const keysOf = (x: unknown) => (typeof x === "object" && x !== null ? Object.keys(x) : []);

/**
 * Whether the example can be loaded into this document as written: it names the ids it creates
 * (b1, c1…), so the document must have none of its own yet, and no counter moved past them; and
 * it adds variants, so the document must have none. Why not, in words, else undefined.
 */
export function whyNotExample(doc: Record<string, unknown>): string | undefined {
  const ids = (typeof doc.ids === "object" && doc.ids !== null ? doc.ids : {}) as Record<
    string,
    unknown
  >;
  const fresh = (prefix: string, kind: string) =>
    nextIdNumber(ids[prefix], keysOf(doc[kind]), prefix) === 1;
  if (!fresh("b", "bars") || !fresh("c", "connections") || keysOf(doc.parts).length > 0) {
    return "The example needs an empty project: this one has had bars, connections or parts.";
  }
  if (keysOf(doc.variants).length > 0)
    return "The example adds variants, and this project has its own.";
  return undefined;
}

/**
 * The example as one batch for this document: first a `setProject` that adds the catalogs it
 * names and the document lacks, and its currency when the document has none (a step that adds a
 * catalog may use its items, s1-decisions 6); then the example's commands.
 */
export function exampleBatch(ex: Example, doc: Record<string, unknown>): Command[] {
  const have = Array.isArray(doc.catalogs) ? doc.catalogs.filter((c) => typeof c === "string") : [];
  const missing = ex.catalogs.filter((c) => !have.includes(c));
  const patch: Record<string, unknown> = {};
  if (missing.length > 0) patch.catalogs = [...have, ...missing];
  if (ex.currency && typeof doc.currency !== "string") patch.currency = ex.currency;
  return [
    ...(Object.keys(patch).length > 0 ? [{ cmd: "setProject", args: patch }] : []),
    ...ex.commands,
  ];
}
