/**
 * Steps in words (BE-4, U16–U18): what a step did, as a person says it, for the undo button,
 * the log, toasts and the history ("add bar b12, joined at 1 end"), beside the command names
 * the log keeps as `what`. Each command describes itself (`CommandDef.describe`); this module
 * holds the shared phrasing, and `stepWords` puts a step's phrases together.
 */

/**
 * What one command did: a sentence, a verb and a noun over ids, which a step merges with the
 * next phrase of the same verb and noun ("add bars b1, b2 and b3"), or a sentence with the bar
 * ends it leaves open or joins (`Said`).
 */
export type Phrase =
  | string
  | { verb: string; one: string; many: string; ids: readonly string[] }
  | Said;

/**
 * A sentence and the bar ends whose outcome it reports (*2.3*, the re-check's follow-up to N2;
 * docs/ux/recheck-fixes-core-decisions.md 16): `open`, the ends the command left open (`mirror`'s
 * images whose joint found no member to land on), and `joins`, the ends it joined
 * (`autoConnect`'s). A step says each end's one outcome, the step's: an end any command of the
 * step joins is not said to be left open, as the app's preview says it (N2).
 */
export interface Said {
  say: string;
  open?: readonly string[];
  joins?: readonly string[];
}

/** "b1", "b1 and b2", "b1, b2 and b3", "b1, b2, b3 and 4 more". */
export function idList(ids: readonly string[], most = 4): string {
  if (ids.length <= 1) return ids[0] ?? "";
  if (ids.length > most)
    return `${ids.slice(0, most - 1).join(", ")} and ${ids.length - most + 1} more`;
  return `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
}

/** A phrase over the ids a command created, removed or named. */
export function over(verb: string, one: string, ids: readonly string[], many = `${one}s`): Phrase {
  return { verb, one, many, ids };
}

/** How a person names a field a `set…` command changes. */
const FIELD: Readonly<Record<string, string>> = {
  a: "end a",
  b: "end b",
  opt: "options",
  off_mm: "offset",
  roll_deg: "roll",
  ops: "machining",
  at_mm: "position",
  qty: "quantity",
  price_basis: "price basis",
  order_rules: "order rules",
  fx: "exchange rates",
};

export function fieldWords(keys: readonly string[]): string {
  return idList(
    keys.map((k) => FIELD[k] ?? k.replace(/_(mm|deg|minor)$/, "").replaceAll("_", " ")),
    keys.length,
  );
}

/** "change b1's item and options". */
export function changed(id: string, set: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(set);
  return keys.length > 0 ? `change ${id}'s ${fieldWords(keys)}` : `change ${id}`;
}

export function render(p: Phrase): string {
  if (typeof p === "string") return p;
  if ("say" in p) return p.say;
  return `${p.verb} ${p.ids.length > 1 ? p.many : p.one} ${idList(p.ids)}`;
}

/**
 * A step's phrases as one line: consecutive phrases of one verb and noun merged, the joints a
 * drawing step's `autoConnect`s made folded into "joined at n ends" after what it drew, at most
 * three parts and then how many more; then the ends the step leaves open, those a command left
 * open and no command of the step joined (`Said`), so no end is said to be both.
 */
export function joinPhrases(parts: readonly { cmd: string; phrase: Phrase | undefined }[]): string {
  const out: Phrase[] = [];
  let joints = 0;
  const lead = parts.find((p) => p.phrase !== undefined)?.cmd;
  const said = parts.flatMap(({ phrase: p }) => (typeof p === "object" && "say" in p ? [p] : []));
  const joined = new Set(said.flatMap((p) => p.joins ?? []));
  const open = [...new Set(said.flatMap((p) => p.open ?? []))].filter((e) => !joined.has(e));
  for (const { cmd, phrase } of parts) {
    if (phrase === undefined) continue;
    // A drawing step: what it drew, then the joints at its ends (U4's "joined at 1 end").
    if (cmd === "autoConnect" && lead !== "autoConnect") {
      joints++;
      continue;
    }
    const last = out.at(-1);
    if (
      typeof phrase === "object" &&
      "verb" in phrase &&
      typeof last === "object" &&
      "verb" in last &&
      last.verb === phrase.verb &&
      last.one === phrase.one
    ) {
      out[out.length - 1] = { ...last, ids: [...last.ids, ...phrase.ids] };
    } else out.push(phrase);
  }
  const texts = out.map(render);
  if (joints > 0) texts.push(`joined at ${joints} end${joints === 1 ? "" : "s"}`);
  if (texts.length === 0) return "no change";
  const line =
    texts.length > 3
      ? `${texts.slice(0, 2).join(", ")} and ${texts.length - 2} more`
      : texts.join(", ");
  return open.length > 0 ? `${line}; ${idList(open)} left open` : line;
}
