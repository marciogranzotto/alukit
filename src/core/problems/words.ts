import { idList } from "../commands/words.ts";

/**
 * The plain words of a problem (D-UX-12, BE-3; B §5.1's principle 5): a title that says what is
 * wrong and where, and a detail that says what follows and what to do, keyed by the diagnostic's
 * code or the order rule. The CLI's message stays beside them as `raw`, for parity. A code with
 * no words of its own reads as its kind of problem and where it is, the message as its detail.
 */

/** How a problem of a check's code reads in a title, before where it is. */
const CHECK_TITLE: Readonly<Record<string, string>> = {
  anchor: "An anchor that does not fit",
  "butt-miss": "A butt that misses its face",
  catalog: "A problem in a catalog",
  check: "A project check",
  "check-pending": "A project check that cannot run yet",
  connection: "A joint problem",
  covers: "A cost line's cover",
  cycle: "A loop of references",
  derive: "Something that does not derive",
  expr: "An expression that does not evaluate",
  fit: "A fit to check",
  geometry: "A geometry problem",
  item: "An item that does not resolve",
  json: "A file that is not JSON",
  length: "A length problem",
  machining: "A machining problem",
  mass: "A mass that is unknown",
  miter: "A miter problem",
  "near-vertical": "A bar that is nearly vertical",
  option: "An option the item does not have",
  order: "An order choice",
  part: "A part problem",
  pattern: "A pattern problem",
  pivot: "A pivot problem",
  "pivot-plane": "A pivot's plane",
  plane: "An end plane problem",
  "price-band": "A price band problem",
  rail: "A rail problem",
  ref: "A reference to nothing",
  run: "A run problem",
  schema: "A field the format does not allow",
  splice: "A splice problem",
  "up-parallel": "A bar whose up runs along it",
  variant: "A variant problem",
  write: "The files cannot be written",
  "zero-length": "A bar of no length",
};

/** "A joint problem at c21", or "A problem with the project" with nothing to name. */
export function checkTitle(code: string, where: readonly string[]): string {
  const what = CHECK_TITLE[code] ?? `A ${code.replaceAll("-", " ")} problem`;
  return where.length > 0 ? `${what} at ${idList(where)}` : what;
}

/**
 * `s` with its first letter upper case, when it starts with a plain word: an id (`b18.a`,
 * `project:motor`, `test:PSU-24V`) keeps its case.
 */
export function capital(s: string): string {
  return /^[a-z]+(?=[\s,]|$)/.test(s) ? `${(s[0] as string).toUpperCase()}${s.slice(1)}` : s;
}

/** A message as a sentence: its first letter upper case, a full stop at its end. */
export function sentence(s: string): string {
  const t = s.trim();
  return t === "" ? t : `${capital(t)}${/[.!?]$/.test(t) ? "" : "."}`;
}

/** Who an order problem holds: "local", "local and shop-a", or "the unsourced lines". */
export function supplierWords(suppliers: readonly (string | null)[]): string {
  return idList(
    suppliers.map((s) => s ?? "the unsourced lines"),
    suppliers.length,
  );
}
