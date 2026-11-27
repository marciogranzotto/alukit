/**
 * Steps in words (BE-4, U16–U18): what a step did, as a person says it, for the undo button,
 * the log, toasts and the history ("add bar b12, joined at 1 end"), beside the command names
 * the log keeps as `what`. Each command describes itself (`CommandDef.describe`); this module
 * holds the shared phrasing, and `stepWords` puts a step's phrases together.
 */

/**
 * What one command did: a sentence, or a verb and a noun over ids, which a step merges with the
 * next phrase of the same verb and noun ("add bars b1, b2 and b3").
 */
export type Phrase = string | { verb: string; one: string; many: string; ids: readonly string[] };

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
  return `${p.verb} ${p.ids.length > 1 ? p.many : p.one} ${idList(p.ids)}`;
}

/**
 * A step's phrases as one line: consecutive phrases of one verb and noun merged, the joints a
 * drawing step's `autoConnect`s made folded into "joined at n ends" after what it drew, at most
 * three parts and then how many more.
 */
export function joinPhrases(parts: readonly { cmd: string; phrase: Phrase | undefined }[]): string {
  const out: Phrase[] = [];
  let joints = 0;
  const lead = parts.find((p) => p.phrase !== undefined)?.cmd;
  for (const { cmd, phrase } of parts) {
    if (phrase === undefined) continue;
    // A drawing step: what it drew, then the joints at its ends (U4's "joined at 1 end").
    if (cmd === "autoConnect" && lead !== "autoConnect") {
      joints++;
      continue;
    }
    const last = out.at(-1);
    if (
      typeof phrase !== "string" &&
      typeof last === "object" &&
      last.verb === phrase.verb &&
      last.one === phrase.one
    ) {
      out[out.length - 1] = { ...last, ids: [...last.ids, ...phrase.ids] };
    } else out.push(phrase);
  }
  const texts = out.map(render);
  if (joints > 0) texts.push(`joined at ${joints} end${joints === 1 ? "" : "s"}`);
  if (texts.length === 0) return "no change";
  if (texts.length > 3) return `${texts.slice(0, 2).join(", ")} and ${texts.length - 2} more`;
  return texts.join(", ");
}
