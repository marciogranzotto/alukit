import { type Ast, FUNCTIONS, freeNames, parseExpr } from "../expr.ts";

/**
 * What holds a bar's end where it is (design §4.3, §4.5), for the edits that move one end along
 * its bar (`moveEnd`, the app's end handles and its length label). Pure, and free of the
 * schemas, so the app reads the same rule the command applies: the handles say before a drag what
 * the command will do or refuse.
 *
 * - **Free**: written as coordinates or a free length, claimed by no connection (or only as the
 *   through bar's own end at a corner, a claim that ends when the end leaves the corner).
 * - **Detachable**: written at a node, another bar's end or a station, or listed among a butt's
 *   butting ends. Moving it frees it: it is written as coordinates, and dropped from its butt.
 * - **Fixed**: set by a pivot, a miter, a splice, a named `through_end`, or its own end plane.
 *   Moving the design point would not move the cut, or would break the joint: refused.
 * - **Driven**: a coordinate the move would change (or a free length) reads a param or another
 *   entity. A move would overwrite the link the person made: refused, naming what to edit.
 *
 * What holds an end is the providers that claim it (derive's `claims`), not the one whose plane it
 * got: a joint that fails (an angled end that declares no cut, a miter it cannot make, two joints
 * on one end) leaves the end its default plane, but the document still joins it, so it holds the
 * end as a joint that derives would, and the words add that it fails (E4's D2; e4 23).
 */

type O = Record<string, unknown>;

const isObject = (x: unknown): x is O => typeof x === "object" && x !== null && !Array.isArray(x);

export type End = "a" | "b";

export type EndHold =
  | {
      kind: "free";
      /** The through bar's end at a corner (§4.5, `through_end`): the butt whose claim ends. */
      corner?: string;
    }
  | {
      kind: "detach";
      /** What holds it, in words: "is at point n2", "butts on b7 (c16)". */
      words: string[];
      /** Why the joints that claim it give it no plane: "the joint fails", "two joints claim it". */
      fails?: string;
      /** The butts that list it among their butting ends, in id order. */
      conns?: string[];
      /** The node, bar end or station bar it is written at. */
      at?: string;
      refs: string[];
    }
  | { kind: "fixed"; words: string; fails?: string; refs: string[] };

/**
 * An end as derive reports it: every provider that claims it, in id order, whether or not its
 * plane resolved (`Derived.claims`: a connection's id, `b2.ends.a.plane`, or the free end counted
 * from end a's cut), and the one whose plane it got (`by`: "default", "free", "plane" or a
 * connection's id).
 */
export interface EndClaims {
  claims: readonly string[];
  by: string;
}

/** A detachable end's words as one clause: what holds it, then why its joints fail, if they do. */
export function heldWords(h: { words: readonly string[]; fails?: string }): string {
  return `${h.words.join(" and ")}${h.fails ? `, and ${h.fails}` : ""}`;
}

/** Whether an expression reads another entity through an accessor (`len(b3)`, `sec(b3).t_mm`). */
function readsEntity(a: Ast): boolean {
  switch (a.t) {
    case "unary":
      return readsEntity(a.e);
    case "bin":
      return readsEntity(a.l) || readsEntity(a.r);
    case "member":
      return readsEntity(a.e);
    case "call":
      return !FUNCTIONS.has(a.name) || a.args.some(readsEntity);
    default:
      return false;
  }
}

/**
 * What drives a written value: the params it reads (none when it reads another entity), or
 * undefined when it is a constant, which a move may overwrite with the number it comes to. Text
 * that does not parse is taken as driven by something the edit cannot see.
 */
export function drivers(v: unknown): { params: string[] } | undefined {
  if (typeof v !== "string") return undefined;
  let ast: Ast;
  try {
    ast = parseExpr(v);
  } catch {
    return { params: [] };
  }
  const params = [...freeNames(ast)].sort();
  return params.length > 0 || readsEntity(ast) ? { params } : undefined;
}

/** The connections of a document by id, as written. */
function connections(doc: O): O {
  return isObject(doc.connections) ? doc.connections : {};
}

/**
 * What one provider that claims end `e` of `bar` (a name in derive's claims) does to a move of
 * it: a butt that lists it lets go on a detach; the butt whose through bar's end it is at a corner
 * lets go when it leaves the corner; the free end counted from end a's cut moves with it; anything
 * else fixes it, `words` saying what and `how` what to edit.
 */
type ClaimHold =
  | { kind: "butt"; conn: string; words: string }
  | { kind: "corner"; conn: string }
  | { kind: "fixed"; words: string; how?: string; refs: string[] }
  | { kind: "none" };

function claimHold(doc: O, bar: string, e: End, name: string): ClaimHold {
  const ref = `${bar}.${e}`;
  if (name === `${bar}.ends.${e}.plane`) {
    return {
      kind: "fixed",
      words: `${ref} is cut on its own plane (ends.${e}.plane), which does not follow the end`,
      refs: [],
    };
  }
  if (e === "b" && name === `${bar}.b (free end from a.cut)`) return { kind: "none" };
  if (name.includes("@")) {
    return {
      kind: "fixed",
      words: `${ref} is held by ${name}, a pattern copy's joint`,
      refs: [name],
    };
  }
  const c = connections(doc)[name];
  const how = `: edit or delete ${name} to move it`;
  if (!isObject(c)) return { kind: "fixed", words: `${ref} is held by ${name}`, how, refs: [name] };
  const ends = Array.isArray(c.ends) ? c.ends : [];
  const te = c.through_end;
  if (c.type === "butt" && ends.includes(ref)) {
    return { kind: "butt", conn: name, words: `butts on ${String(c.through)} (${name})` };
  }
  if (c.type === "butt" && c.through === bar && !(isObject(te) && te.end === e)) {
    return { kind: "corner", conn: name };
  }
  const what = c.type === "butt" ? "its through_end" : String(c.type);
  return { kind: "fixed", words: `${ref} is held by ${name} (${what})`, how, refs: [name] };
}

/**
 * What holds end `e` of bar `bar`, from the document as written and the providers that claim the
 * end (`end.claims`). A provider that fixes the end wins over a butt that would let it go; every
 * butt that lists the end lets go of it on a detach. `end.by` says only whether the claims fail:
 * one claim and the default plane is a joint that fails; more than one is two joints on one end.
 */
export function endHold(doc: O, bar: string, e: End, end: EndClaims): EndHold {
  const bars = isObject(doc.bars) ? doc.bars : {};
  const w = isObject(bars[bar]) ? (bars[bar] as O)[e] : undefined;
  const ref = `${bar}.${e}`;
  if (isObject(w) && typeof w.pivot === "string") {
    return {
      kind: "fixed",
      words: `${ref} is at pivot ${w.pivot}, which sets it`,
      refs: [w.pivot],
    };
  }
  const n = end.claims.length;
  const fails =
    n > 1
      ? `${n === 2 ? "two" : n} joints claim it`
      : n === 1 && end.by === "default"
        ? "the joint fails"
        : undefined;
  const holds = end.claims.map((name) => claimHold(doc, bar, e, name));
  const fixed = holds.find((h) => h.kind === "fixed");
  if (fixed) {
    return {
      kind: "fixed",
      words: `${fixed.words}${fails ? `, and ${fails}` : ""}${fixed.how ?? ""}`,
      ...(fails ? { fails } : {}),
      refs: fixed.refs,
    };
  }
  const words: string[] = [];
  const refs: string[] = [];
  let at: string | undefined;
  if (typeof w === "string") {
    at = w;
    words.push(/^n\d+$/.test(w) ? `is at point ${w}` : `is at ${w.replace(".", "'s end ")}`);
    refs.push(w.split(".")[0] as string);
  } else if (isObject(w) && isObject(w.on)) {
    at = String(w.on.bar);
    words.push(`is on ${at} (a station)`);
    refs.push(at);
  }
  const conns: string[] = [];
  for (const h of holds) {
    if (h.kind !== "butt") continue;
    conns.push(h.conn);
    words.push(h.words);
    refs.push(h.conn);
  }
  const corner = holds.find((h) => h.kind === "corner");
  if (words.length === 0) return corner ? { kind: "free", corner: corner.conn } : { kind: "free" };
  return {
    kind: "detach",
    words,
    ...(fails && conns.length > 0 ? { fails } : {}),
    ...(conns.length > 0 ? { conns } : {}),
    ...(at ? { at } : {}),
    refs,
  };
}

/** The world axes a move along unit direction `u` changes. */
export function movingAxes(u: readonly number[]): number[] {
  return [0, 1, 2].filter((i) => Math.abs(u[i] as number) > 1e-9);
}

const AXIS_NAME = ["x", "y", "z"] as const;

/**
 * Whether moving end `e` along `u` would overwrite a link the person wrote: a coordinate on a
 * moving axis, or a free length, that reads a param or another entity. Moving end a of a bar
 * whose end b is a free length moves end b too unless its length changes, so that length counts.
 */
export function drivenEnd(
  doc: O,
  bar: string,
  e: End,
  u: readonly number[],
): { words: string; params: string[]; expr: string } | undefined {
  const bars = isObject(doc.bars) ? doc.bars : {};
  const b = isObject(bars[bar]) ? (bars[bar] as O) : {};
  const say = (what: string, expr: string, params: string[]) => ({
    words:
      params.length > 0
        ? `${bar}.${e}'s ${what} is ${expr}: driven by ${params.join(", ")}; edit ${params.length > 1 ? "them" : "it"} instead`
        : `${bar}.${e}'s ${what} is set by its expression, ${expr}`,
    params,
    expr,
  });
  const w = b[e];
  if (Array.isArray(w)) {
    for (const i of movingAxes(u)) {
      const by = drivers(w[i]);
      if (by) return say(AXIS_NAME[i] as string, String(w[i]), by.params);
    }
  }
  const free = isObject(b.b) && b.b.len_mm !== undefined ? b.b : undefined;
  if (free) {
    const by = drivers(free.len_mm);
    if (by) return say("free length", String(free.len_mm), by.params);
  }
  return undefined;
}
