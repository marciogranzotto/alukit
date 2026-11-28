import { compareIds } from "../ids.ts";

/**
 * A set of bars' own joints (design §4.7, §6; docs/ux/review-fixes-joins-decisions.md 1): the
 * connections that claim bar ends, every one of them an end of a bar in the set. They are what
 * cuts those bars' ends, as an end condition is part of the feature it ends in CAD, so a copy of
 * the bars (a pattern's, `explodePattern`'s, `array`'s, `mirror`'s) carries a copy of them.
 *
 * The ends a connection claims, read from the document as written:
 * - a butt: its butting `ends`, and a through end it names (`through_end: { end }`), which is the
 *   through bar's; a through member named as an end (`"b7.b"`) is borne on, not claimed;
 * - a miter or a splice: its two `ends`; a pivot: the ends it carries;
 * - a face connection claims no end (its layers keep their own), so it is never one.
 *
 * A joint that also claims an end outside the set (a corner's butt, shared by two rails) is not
 * the set's: a copy of it would claim that end a second time. Reading the document, not derive's
 * claims, keeps the rule the same for derive's patterns and for the commands that copy.
 */
export function ownJoints(
  connections: Readonly<Record<string, unknown>> | undefined,
  bars: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const [id, c] of Object.entries(connections ?? {})) {
    const claimed = claimedEnds(c);
    if (claimed.length > 0 && claimed.every((e) => bars.has(barOf(e)))) out.push(id);
  }
  return out.sort(compareIds);
}

function barOf(end: string): string {
  return end.slice(0, end.lastIndexOf("."));
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** The bar ends a written connection claims (above), or none. */
export function claimedEnds(c: unknown): string[] {
  if (!isObject(c)) return [];
  const ends = Array.isArray(c.ends)
    ? c.ends.filter((e): e is string => typeof e === "string")
    : [];
  switch (c.type) {
    case "butt": {
      const te = c.through_end;
      const named =
        isObject(te) && typeof te.end === "string" && typeof c.through === "string"
          ? [`${c.through}.${te.end}`]
          : [];
      return [...ends, ...named];
    }
    case "miter":
    case "splice":
    case "pivot":
      return ends;
    default:
      return [];
  }
}
