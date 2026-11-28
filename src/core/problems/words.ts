import { idList } from "../commands/words.ts";
import type { DiagnosticCode, MachiningReason } from "../diagnostics.ts";

/**
 * The plain words of a problem (D-UX-12, BE-3; B §5.1's principle 5): a title that says what is
 * wrong and where, and a detail that says what follows and what to do, keyed by the diagnostic's
 * code or the order rule. The CLI's message stays beside them as `raw`, for parity.
 */

/**
 * How a problem of a check's code reads in a title, before where it is: what is wrong, in a
 * person's words, never the code itself ("A miter problem"). Every code has its words (E1.3): the
 * type takes them all, so a code cannot be added without them.
 */
const CHECK_TITLE: Readonly<Record<DiagnosticCode, string>> = {
  anchor: "An anchor that does not fit",
  "angled-end": "An end cut at an angle it does not declare",
  bend: "A bend that cannot be made",
  "butt-miss": "A butt that misses its face",
  "butt-no-connector": "A butt with no connector",
  catalog: "A problem in a catalog",
  chain: "An end that reads another end's plane",
  check: "A project check",
  "check-pending": "A project check that cannot run yet",
  coincident: "Two bars in one place",
  connection: "A joint problem",
  "cover-none": "A through end with nothing to cover",
  covers: "A cost line's cover",
  currency: "Prices in a currency the project does not name",
  cycle: "A loop of references",
  "end-far": "An end far from its face",
  expr: "An expression that does not evaluate",
  face: "A face joint that is not complete",
  fit: "A fit to check",
  format: "A file not in canonical form",
  hole: "A hole that cannot be made",
  item: "An item that does not resolve",
  joint: "A station on a run's joint",
  json: "A file that is not JSON",
  length: "A length that cannot be cut",
  lock: "A lock file that cannot be read",
  "lock-behind": "A lock file behind its catalogs",
  machining: "Machining to check",
  mass: "A mass that is unknown",
  miter: "A mitre that cannot be cut",
  "near-vertical": "A bar that is nearly vertical",
  "no-offer": "An item nothing sells by length",
  option: "An option the item does not have",
  order: "An order choice",
  outline: "An outline that encloses nothing",
  part: "A part line that cannot be counted",
  pattern: "A pattern that cannot repeat",
  pivot: "A hinge that cannot be placed",
  "pivot-plane": "A hinge's plane",
  "pivot-range": "A hinge outside its range",
  plane: "An end plane problem",
  "price-band": "A price band that selects nothing",
  rail: "A rail's hole layout that does not fit",
  ref: "A reference to nothing",
  run: "A run whose bars do not join",
  schema: "A field the format does not allow",
  splice: "A splice that cannot join",
  station: "A station measured from where it cannot be",
  "two-providers": "An end joined twice",
  unconnected: "An open corner",
  "up-parallel": "A bar whose up runs along it",
  variant: "A variant that does not apply",
  write: "The files cannot be written",
  "zero-length": "A bar of no length",
};

/**
 * Which machining problem a `machining` diagnostic is, by the `reason` its check gives it (the
 * re-check's N10: a tap in a groove's opening and a hole off its piece on one bar were both
 * "Machining to check at b5"). The title follows the reason, never the message's words, so a
 * check's wording can change and its title stays (docs/ux/recheck-fixes-core-decisions.md 15).
 * The type takes every reason, so a check cannot give one without its words.
 */
const MACHINING_TITLE: Readonly<Record<MachiningReason, string>> = {
  "off-piece": "A hole off its piece",
  "tap-in-groove": "A tap with too little wall",
  repeated: "The same machining made twice at one place",
  "no-cores": "Taps not checked against the section's cores",
  "off-core": "A tap on no core",
  "core-fit": "A tap that does not fit its core",
  "fit-unchecked": "A tap whose fit is not checked",
};

/**
 * "A joint problem at c21". A code AluKit does not know (a newer project's, read by an older
 * build) reads as its kind of problem. A `machining` diagnostic's `reason`, when it gives one,
 * names which machining problem it is; without one, it is the code's "Machining to check".
 */
export function checkTitle(
  code: string,
  where: readonly string[],
  reason?: MachiningReason,
): string {
  const what =
    (code === "machining" && reason !== undefined ? MACHINING_TITLE[reason] : undefined) ??
    (CHECK_TITLE as Readonly<Record<string, string>>)[code] ??
    `A ${code.replaceAll("-", " ")} problem`;
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
