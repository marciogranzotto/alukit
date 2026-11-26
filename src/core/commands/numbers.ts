import { type Ast, parseExpr } from "../expr.ts";
import type { Expr } from "../project/schema.ts";
import { QUANTUM, quantize } from "../quantum.ts";

/**
 * Numbers and expressions that commands compute (design §2, §6). A computed length or angle is
 * quantised to its output quantum (0.01 mm, 0.01°), so a command never writes float noise and
 * its output is canonical. Where the input is an expression, the result stays an expression,
 * so a mirrored or split bar still follows its params: `W` mirrored about x = 600 is
 * `1200 - W`, not a number.
 */

export const len = (x: number) => quantize(x, QUANTUM.len_mm);
export const ang = (x: number) => quantize(x, QUANTUM.ang_deg);

/** The binding of an expression's top: a leaf needs no parentheses anywhere. */
function rank(src: string): "leaf" | "sum" | "other" {
  let ast: Ast;
  try {
    ast = parseExpr(src);
  } catch {
    return "other";
  }
  if (ast.t === "num" || ast.t === "name" || ast.t === "call" || ast.t === "member") return "leaf";
  if (
    ast.t === "bin" &&
    (ast.op === "+" || ast.op === "-" || ast.op === "*" || ast.op === "/" || ast.op === "^")
  ) {
    return "sum";
  }
  if (ast.t === "unary" && ast.op === "-") return "sum";
  return "other";
}

/** `e` as a term: parenthesised unless it is a leaf. */
function term(e: string): string {
  return rank(e) === "leaf" ? e : `(${e})`;
}

/** `e + d`, a number when `e` is one. */
export function plus(e: Expr, d: number, q: (x: number) => number = len): Expr {
  if (typeof e === "number") return q(e + d);
  if (d === 0) return e;
  const left = rank(e) === "other" ? `(${e})` : e;
  return d > 0 ? `${left} + ${q(d)}` : `${left} - ${q(-d)}`;
}

/** `-e`. */
export function negate(e: Expr, q: (x: number) => number = len): Expr {
  if (typeof e === "number") return q(-e);
  return `-${term(e)}`;
}

/** `2·at − e`: a coordinate reflected in the plane at `at`. */
export function reflect(e: Expr, at: number): Expr {
  if (typeof e === "number") return len(2 * at - e);
  return at === 0 ? negate(e) : `${len(2 * at)} - ${term(e)}`;
}

/** `k − e`: a length measured from the other end, or an angle turned the other way. */
export function minus(k: number, e: Expr, q: (x: number) => number = len): Expr {
  if (typeof e === "number") return q(k - e);
  return k === 0 ? negate(e, q) : `${q(k)} - ${term(e)}`;
}
