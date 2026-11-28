import { type Ast, foldConstants, parseExpr } from "../expr.ts";
import type { Expr } from "../project/schema.ts";
import { QUANTUM, quantize } from "../quantum.ts";

/**
 * Numbers and expressions that commands compute (design §2, §6). A computed length or angle is
 * quantised to its output quantum (0.01 mm, 0.01°), so a command never writes float noise and
 * its output is canonical. Where the input is an expression, the result stays an expression,
 * so a mirrored or split bar still follows its params: `W` mirrored about x = 600 is
 * `1200 - W`, not a number. An expression a composer writes has its constants folded (*2.3*, the
 * editing review's n3; `foldConstants`): `H - 300` moved 100 down is `H - 400`, not
 * `H - 300 - 100`, and `W - 100` mirrored about x = 600 is `1300 - W`.
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
  return foldConstants(d > 0 ? `${left} + ${q(d)}` : `${left} - ${q(-d)}`);
}

/**
 * `e ± d` where `d` may be an expression: a number when both are numbers, else an expression, so
 * a coordinate moved by a typed param keeps following it (`W` moved by `D / 2` is `W + D / 2`).
 */
export function offsetBy(e: Expr, sign: 1 | -1, d: Expr, q: (x: number) => number = len): Expr {
  if (typeof d === "number") return plus(e, sign * d, q);
  if (e === 0) return sign > 0 ? d : foldConstants(`-${term(d)}`);
  const left = typeof e === "number" ? String(q(e)) : rank(e) === "other" ? `(${e})` : e;
  return foldConstants(`${left} ${sign > 0 ? "+" : "-"} ${term(d)}`);
}

/** `-e`. */
export function negate(e: Expr, q: (x: number) => number = len): Expr {
  if (typeof e === "number") return q(-e);
  return foldConstants(`-${term(e)}`);
}

/** `2·at − e`: a coordinate reflected in the plane at `at`. */
export function reflect(e: Expr, at: number): Expr {
  if (typeof e === "number") return len(2 * at - e);
  return at === 0 ? negate(e) : foldConstants(`${len(2 * at)} - ${term(e)}`);
}

/** `k − e`: a length measured from the other end, or an angle turned the other way. */
export function minus(k: number, e: Expr, q: (x: number) => number = len): Expr {
  if (typeof e === "number") return q(k - e);
  return k === 0 ? negate(e, q) : foldConstants(`${q(k)} - ${term(e)}`);
}
