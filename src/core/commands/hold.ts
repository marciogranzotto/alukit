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
      /** The butt that lists it among its butting ends. */
      conn?: string;
      /** The node, bar end or station bar it is written at. */
      at?: string;
      refs: string[];
    }
  | { kind: "fixed"; words: string; refs: string[] };

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
 * What holds end `e` of bar `bar`, from the document as written and the end's provider as derive
 * reports it (`by`: "default", "free", "plane" or a connection's id).
 */
export function endHold(doc: O, bar: string, e: End, by: string): EndHold {
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
  let conn: string | undefined;
  let corner: string | undefined;
  if (by === "plane") {
    return {
      kind: "fixed",
      words: `${ref} is cut on its own plane (ends.${e}.plane), which does not follow the end`,
      refs: [],
    };
  }
  if (by !== "default" && by !== "free") {
    const c = connections(doc)[by];
    if (!isObject(c) || by.includes("@")) {
      return {
        kind: "fixed",
        words: `${ref} is held by ${by}, a pattern copy's joint`,
        refs: [by],
      };
    }
    const ends = Array.isArray(c.ends) ? c.ends : [];
    const te = c.through_end;
    if (c.type === "butt" && ends.includes(ref)) {
      conn = by;
      words.push(`butts on ${String(c.through)} (${by})`);
      refs.push(by);
    } else if (c.type === "butt" && c.through === bar && !(isObject(te) && te.end === e)) {
      corner = by;
    } else {
      const what = c.type === "butt" ? "its through_end" : String(c.type);
      return {
        kind: "fixed",
        words: `${ref} is held by ${by} (${what}): edit or delete ${by} to move it`,
        refs: [by],
      };
    }
  }
  if (words.length === 0) return corner ? { kind: "free", corner } : { kind: "free" };
  return {
    kind: "detach",
    words,
    ...(conn ? { conn } : {}),
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
