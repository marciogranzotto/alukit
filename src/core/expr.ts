import { roundHalfAway, snapCeil, snapFloor } from "./quantum.ts";
import { TOL } from "./tolerances.ts";
import { cosDeg, reduceDeg, sinDeg } from "./trig.ts";

/**
 * The expression language of project documents (design §4.9): a small, safe language with no
 * `eval`. Numbers, params, `+ - * / ^`, unary minus, parentheses, comparisons, `and`, `or`,
 * `not`, `if(c, a, b)` and `pi`; math functions with trig in degrees; accessors (`sec(b3).t_mm`,
 * `len(b3)`, `count(tag:leg)`) supplied by the caller's scope.
 *
 * Determinism (§5.2): degrees are reduced exactly; `sin`, `cos`, `tan` and the inverse functions
 * are exact at the angles where the true value is exact; `floor`, `ceil` and `round` snap first;
 * comparisons hold within `tol.snap`. `hypot` is the square root of a plain sum, which IEEE
 * rounds correctly everywhere.
 */

export class ExprError extends Error {
  /** Character offset in the source, when known. */
  readonly pos: number | undefined;
  constructor(message: string, pos?: number) {
    super(message);
    this.name = "ExprError";
    this.pos = pos;
  }
}

export type Ast =
  | { t: "num"; v: number }
  | { t: "name"; name: string; pos: number }
  | { t: "unary"; op: "-" | "+" | "not"; e: Ast }
  | { t: "bin"; op: BinOp; l: Ast; r: Ast; pos: number }
  | { t: "call"; name: string; args: Ast[]; pos: number }
  | { t: "member"; e: Ast; name: string; pos: number }
  | { t: "sel"; key: string; value: string; pos: number };

type BinOp = "+" | "-" | "*" | "/" | "^" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "and" | "or";

/** A vector (`pos(n3)`), with `.x`, `.y`, `.z`. */
export interface VecValue {
  kind: "vec";
  v: readonly [number, number, number];
}

/** A named record of numbers (`sec(b3)`): `.t_mm`, `.width_mm`. */
export interface RecValue {
  kind: "rec";
  what: string;
  fields: Readonly<Record<string, number>>;
}

export type Value = number | boolean | VecValue | RecValue;

/** What names and accessors mean where an expression is evaluated. */
export interface ExprScope {
  /** The value of a bare name (a param), or undefined when the name is unknown. */
  name(name: string): number | undefined;
  /**
   * An accessor call (`sec`, `len`, `pos`, …), or undefined when this scope offers none by that
   * name. Arguments arrive unevaluated: an accessor's arguments are entity ids and selectors.
   */
  accessor?(name: string, args: readonly Ast[]): Value | undefined;
}

export const RESERVED = new Set(["and", "or", "not", "if", "pi"]);

// ---------------------------------------------------------------------------------------------
// Tokens

type Tok =
  | { k: "num"; v: number; pos: number }
  | { k: "id"; v: string; pos: number }
  | { k: "op"; v: string; pos: number }
  | { k: "eof"; pos: number };

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
const OPS = ["<=", ">=", "==", "!=", "+", "-", "*", "/", "^", "(", ")", ",", ".", "<", ">", ":"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    const rest = src.slice(i);
    const num = NUMBER.exec(rest);
    // A "." followed by a letter is member access, not a number.
    if (num && !(c === "." && /^\.[A-Za-z_]/.test(rest))) {
      out.push({ k: "num", v: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      out.push({ k: "id", v: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      out.push({ k: "op", v: op, pos: i });
      i += op.length;
      continue;
    }
    throw new ExprError(`unexpected "${c}"`, i);
  }
  out.push({ k: "eof", pos: src.length });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Parser: precedence climbing, lowest first: or, and, not, comparison, + -, * /, unary, ^.

class Parser {
  private i = 0;
  private readonly toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  private peek(): Tok {
    return this.toks[this.i] as Tok;
  }

  private next(): Tok {
    return this.toks[this.i++] as Tok;
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === "op" && t.v === v;
  }

  private isWord(v: string): boolean {
    const t = this.peek();
    return t.k === "id" && t.v === v;
  }

  private expectOp(v: string): void {
    const t = this.next();
    if (t.k !== "op" || t.v !== v) throw new ExprError(`expected "${v}"`, t.pos);
  }

  parse(): Ast {
    const e = this.or();
    const t = this.peek();
    if (t.k !== "eof") throw new ExprError("unexpected text after the expression", t.pos);
    return e;
  }

  private or(): Ast {
    let l = this.and();
    while (this.isWord("or")) {
      const pos = this.next().pos;
      l = { t: "bin", op: "or", l, r: this.and(), pos };
    }
    return l;
  }

  private and(): Ast {
    let l = this.not();
    while (this.isWord("and")) {
      const pos = this.next().pos;
      l = { t: "bin", op: "and", l, r: this.not(), pos };
    }
    return l;
  }

  private not(): Ast {
    if (this.isWord("not")) {
      this.next();
      return { t: "unary", op: "not", e: this.not() };
    }
    return this.cmp();
  }

  private cmp(): Ast {
    const l = this.add();
    const t = this.peek();
    if (t.k === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(t.v)) {
      this.next();
      const r = this.add();
      const after = this.peek();
      if (after.k === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(after.v)) {
        throw new ExprError("comparisons do not chain; use and", after.pos);
      }
      return { t: "bin", op: t.v as BinOp, l, r, pos: t.pos };
    }
    return l;
  }

  private add(): Ast {
    let l = this.mul();
    for (;;) {
      const t = this.peek();
      if (t.k !== "op" || (t.v !== "+" && t.v !== "-")) return l;
      this.next();
      l = { t: "bin", op: t.v, l, r: this.mul(), pos: t.pos };
    }
  }

  private mul(): Ast {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.k !== "op" || (t.v !== "*" && t.v !== "/")) return l;
      this.next();
      l = { t: "bin", op: t.v, l, r: this.unary(), pos: t.pos };
    }
  }

  /** Unary minus binds looser than `^`: `-2^2` is −4. */
  private unary(): Ast {
    if (this.isOp("-") || this.isOp("+")) {
      const op = this.next() as { v: "-" | "+" };
      return { t: "unary", op: op.v, e: this.unary() };
    }
    return this.pow();
  }

  /** `^` is right-associative, and its exponent may carry a sign: `2^-1`. */
  private pow(): Ast {
    const base = this.postfix();
    if (this.isOp("^")) {
      const pos = this.next().pos;
      return { t: "bin", op: "^", l: base, r: this.unary(), pos };
    }
    return base;
  }

  private postfix(): Ast {
    let e = this.primary();
    while (this.isOp(".")) {
      this.next();
      const t = this.next();
      if (t.k !== "id") throw new ExprError("expected a name after '.'", t.pos);
      e = { t: "member", e, name: t.v, pos: t.pos };
    }
    return e;
  }

  private primary(): Ast {
    const t = this.next();
    if (t.k === "num") return { t: "num", v: t.v };
    if (t.k === "op" && t.v === "(") {
      const e = this.or();
      this.expectOp(")");
      return e;
    }
    if (t.k === "id") {
      if (RESERVED.has(t.v) && t.v !== "if" && t.v !== "pi") {
        throw new ExprError(`"${t.v}" cannot start an operand`, t.pos);
      }
      if (this.isOp("(")) {
        this.next();
        const args: Ast[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.arg());
            if (this.isOp(",")) {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expectOp(")");
        return { t: "call", name: t.v, args, pos: t.pos };
      }
      return { t: "name", name: t.v, pos: t.pos };
    }
    throw new ExprError(t.k === "eof" ? "unexpected end" : `unexpected "${t.v}"`, t.pos);
  }

  /** A call argument: an expression, or a selector `key:value` (`count(tag:leg)`). */
  private arg(): Ast {
    const t = this.peek();
    const after = this.toks[this.i + 1];
    if (t.k === "id" && after?.k === "op" && after.v === ":") {
      this.next();
      this.next();
      const v = this.next();
      if (v.k !== "id" && v.k !== "num") throw new ExprError("expected a selector value", v.pos);
      return { t: "sel", key: t.v, value: String(v.v), pos: t.pos };
    }
    return this.or();
  }
}

const parsed = new Map<string, Ast>();

/** Parses an expression; throws an ExprError naming the position. Results are cached. */
export function parseExpr(src: string): Ast {
  const hit = parsed.get(src);
  if (hit) return hit;
  const ast = new Parser(tokenize(src)).parse();
  if (parsed.size > 10_000) parsed.clear();
  parsed.set(src, ast);
  return ast;
}

// ---------------------------------------------------------------------------------------------
// Math functions

function window(...xs: number[]): number {
  return TOL.snap * Math.max(1, ...xs.map(Math.abs));
}

const DEG = 180 / Math.PI;

/** tan in degrees: exact 0 and ±1 at multiples of 45°; undefined at odd multiples of 90°. */
function tanDeg(deg: number): number {
  const r = reduceDeg(deg);
  const k = Math.round(r / 45);
  if (Math.abs(r - 45 * k) <= TOL.snap * Math.max(1, r)) {
    const table = [0, 1, Number.NaN, -1, 0, 1, Number.NaN, -1];
    const v = table[k % 8] as number;
    if (Number.isNaN(v)) throw new ExprError(`tan(${deg}) is infinite`);
    return v;
  }
  return Math.tan(r / DEG);
}

/** asin, acos and atan in degrees, exact where the true value is a whole table angle. */
const ASIN: [number, number][] = [
  [-1, -90],
  [-0.5, -30],
  [0, 0],
  [0.5, 30],
  [1, 90],
];
const ACOS: [number, number][] = [
  [-1, 180],
  [-0.5, 120],
  [0, 90],
  [0.5, 60],
  [1, 0],
];
const ATAN: [number, number][] = [
  [-1, -45],
  [0, 0],
  [1, 45],
];

function fromTable(x: number, table: [number, number][], f: (x: number) => number): number {
  for (const [k, v] of table) if (x === k) return v;
  const d = f(x) * DEG;
  return d === 0 ? 0 : d;
}

function atan2Exact(y: number, x: number): number {
  if (y === 0 && x === 0) throw new ExprError("atan2(0, 0) is undefined");
  if (y === 0) return x > 0 ? 0 : 180;
  if (x === 0) return y > 0 ? 90 : -90;
  if (Math.abs(y) === Math.abs(x)) return y > 0 ? (x > 0 ? 45 : 135) : x > 0 ? -45 : -135;
  return Math.atan2(y, x) * DEG;
}

type NumFn = { min: number; max: number; f: (xs: number[]) => number };

const MATH: Readonly<Record<string, NumFn>> = {
  min: { min: 1, max: Infinity, f: (xs) => Math.min(...xs) },
  max: { min: 1, max: Infinity, f: (xs) => Math.max(...xs) },
  abs: { min: 1, max: 1, f: ([x]) => Math.abs(x as number) },
  round: { min: 1, max: 1, f: ([x]) => roundHalfAway(x as number) },
  floor: { min: 1, max: 1, f: ([x]) => snapFloor(x as number) },
  ceil: { min: 1, max: 1, f: ([x]) => snapCeil(x as number) },
  sqrt: {
    min: 1,
    max: 1,
    f: ([x]) => {
      if ((x as number) < 0) throw new ExprError(`sqrt of a negative number (${x})`);
      return Math.sqrt(x as number);
    },
  },
  hypot: { min: 1, max: Infinity, f: (xs) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0)) },
  sin: { min: 1, max: 1, f: ([x]) => sinDeg(x as number) },
  cos: { min: 1, max: 1, f: ([x]) => cosDeg(x as number) },
  tan: { min: 1, max: 1, f: ([x]) => tanDeg(x as number) },
  asin: {
    min: 1,
    max: 1,
    f: ([x]) => {
      if (Math.abs(x as number) > 1) throw new ExprError(`asin(${x}) is outside [-1, 1]`);
      return fromTable(x as number, ASIN, Math.asin);
    },
  },
  acos: {
    min: 1,
    max: 1,
    f: ([x]) => {
      if (Math.abs(x as number) > 1) throw new ExprError(`acos(${x}) is outside [-1, 1]`);
      return fromTable(x as number, ACOS, Math.acos);
    },
  },
  atan: { min: 1, max: 1, f: ([x]) => fromTable(x as number, ATAN, Math.atan) },
  atan2: { min: 2, max: 2, f: ([y, x]) => atan2Exact(y as number, x as number) },
};

/** Names that are functions of the language itself, not accessors. */
export const FUNCTIONS = new Set([...Object.keys(MATH), "if"]);

// ---------------------------------------------------------------------------------------------
// Evaluation

function kindOf(v: Value): string {
  if (typeof v === "number") return "a number";
  if (typeof v === "boolean") return "a boolean";
  return v.kind === "vec" ? "a vector" : `the record ${v.what}`;
}

function asNumber(v: Value, what: string): number {
  if (typeof v !== "number") throw new ExprError(`${what} needs a number, not ${kindOf(v)}`);
  return v;
}

function asBool(v: Value, what: string): boolean {
  if (typeof v !== "boolean") throw new ExprError(`${what} needs a condition, not ${kindOf(v)}`);
  return v;
}

function finite(x: number, what: string): number {
  if (!Number.isFinite(x)) throw new ExprError(`${what} is not finite`);
  return x === 0 ? 0 : x; // never -0
}

export function evaluate(ast: Ast, scope: ExprScope): Value {
  switch (ast.t) {
    case "num":
      return ast.v;
    case "name": {
      if (ast.name === "pi") return Math.PI;
      const v = scope.name(ast.name);
      if (v === undefined) throw new ExprError(`unknown name "${ast.name}"`, ast.pos);
      return v;
    }
    case "unary": {
      const v = evaluate(ast.e, scope);
      if (ast.op === "not") return !asBool(v, "not");
      const n = asNumber(v, `unary ${ast.op}`);
      return ast.op === "-" ? finite(-n, "the result") : n;
    }
    case "bin":
      return binary(ast, scope);
    case "member": {
      const v = evaluate(ast.e, scope);
      if (typeof v === "object" && v.kind === "vec") {
        const i = ["x", "y", "z"].indexOf(ast.name);
        if (i < 0) throw new ExprError(`a vector has .x, .y and .z, not .${ast.name}`, ast.pos);
        return v.v[i] as number;
      }
      if (typeof v === "object" && v.kind === "rec") {
        const f = v.fields[ast.name];
        if (f === undefined) {
          const names = Object.keys(v.fields).join(", ");
          throw new ExprError(`${v.what} has no "${ast.name}" (it has ${names})`, ast.pos);
        }
        return f;
      }
      throw new ExprError(`.${ast.name} needs a vector or a record, not ${kindOf(v)}`, ast.pos);
    }
    case "call":
      return call(ast, scope);
    case "sel":
      throw new ExprError(`a selector (${ast.key}:${ast.value}) is only an argument`, ast.pos);
  }
}

function binary(ast: Extract<Ast, { t: "bin" }>, scope: ExprScope): Value {
  if (ast.op === "and" || ast.op === "or") {
    const l = asBool(evaluate(ast.l, scope), ast.op);
    if (ast.op === "and" ? !l : l) return l;
    return asBool(evaluate(ast.r, scope), ast.op);
  }
  const l = asNumber(evaluate(ast.l, scope), `"${ast.op}"`);
  const r = asNumber(evaluate(ast.r, scope), `"${ast.op}"`);
  const w = window(l, r);
  switch (ast.op) {
    case "+":
      return finite(l + r, "the sum");
    case "-":
      return finite(l - r, "the difference");
    case "*":
      return finite(l * r, "the product");
    case "/":
      if (r === 0) throw new ExprError("division by zero", ast.pos);
      return finite(l / r, "the quotient");
    case "^":
      return finite(l ** r, `${l} ^ ${r}`);
    case "==":
      return Math.abs(l - r) <= w;
    case "!=":
      return Math.abs(l - r) > w;
    case "<":
      return l < r - w;
    case "<=":
      return l <= r + w;
    case ">":
      return l > r + w;
    case ">=":
      return l >= r - w;
  }
}

function call(ast: Extract<Ast, { t: "call" }>, scope: ExprScope): Value {
  if (ast.name === "if") {
    if (ast.args.length !== 3) throw new ExprError("if takes three arguments", ast.pos);
    const [c, a, b] = ast.args as [Ast, Ast, Ast];
    return evaluate(asBool(evaluate(c, scope), "if") ? a : b, scope);
  }
  const fn = MATH[ast.name];
  if (fn) {
    if (ast.args.length < fn.min || ast.args.length > fn.max) {
      const n = fn.min === fn.max ? `${fn.min}` : `at least ${fn.min}`;
      throw new ExprError(`${ast.name} takes ${n} argument${fn.min === 1 ? "" : "s"}`, ast.pos);
    }
    const xs = ast.args.map((a) => asNumber(evaluate(a, scope), ast.name));
    return finite(fn.f(xs), `${ast.name}(…)`);
  }
  const v = scope.accessor?.(ast.name, ast.args);
  if (v === undefined) throw new ExprError(`unknown function "${ast.name}"`, ast.pos);
  return v;
}

/**
 * The bare names an expression reads: its params. Arguments of accessor calls are entity ids,
 * not params, and are skipped.
 */
export function freeNames(ast: Ast, out: Set<string> = new Set()): Set<string> {
  switch (ast.t) {
    case "name":
      if (ast.name !== "pi") out.add(ast.name);
      break;
    case "unary":
      freeNames(ast.e, out);
      break;
    case "bin":
      freeNames(ast.l, out);
      freeNames(ast.r, out);
      break;
    case "member":
      freeNames(ast.e, out);
      break;
    case "call":
      if (FUNCTIONS.has(ast.name)) for (const a of ast.args) freeNames(a, out);
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Printing

/**
 * How tightly a node binds, the parser's levels lowest first: `or` 1, `and` 2, `not` 3, a
 * comparison 4, `+ -` 5, `* /` 6, a sign 7, `^` 8, and an operand that needs no parentheses 9.
 */
function binding(a: Ast): number {
  if (a.t === "unary") return a.op === "not" ? 3 : 7;
  if (a.t !== "bin") return 9;
  switch (a.op) {
    case "or":
      return 1;
    case "and":
      return 2;
    case "+":
    case "-":
      return 5;
    case "*":
    case "/":
      return 6;
    case "^":
      return 8;
    default:
      return 4;
  }
}

/** `a` printed where its parent's grammar reads a node of level `min` or tighter. */
function operand(a: Ast, min: number): string {
  const s = formatExpr(a);
  return binding(a) < min ? `(${s})` : s;
}

/**
 * An expression as text, with the parentheses its grammar needs and no others, spaced as commands
 * write it (`W / 2 - 20`): `parseExpr(formatExpr(ast))` is the same tree. A number prints as
 * ECMAScript's `Number::toString`, the shortest decimal that names its double.
 */
export function formatExpr(a: Ast): string {
  switch (a.t) {
    case "num":
      return String(a.v);
    case "name":
      return a.name;
    case "sel":
      return `${a.key}:${a.value}`;
    case "unary":
      return a.op === "not" ? `not ${operand(a.e, 3)}` : `${a.op}${operand(a.e, 7)}`;
    case "member":
      // A number's "." would read as its decimal point.
      return `${a.e.t === "num" ? `(${formatExpr(a.e)})` : operand(a.e, 9)}.${a.name}`;
    case "call":
      return `${a.name}(${a.args.map((x) => operand(x, 1)).join(", ")})`;
    case "bin": {
      const own = binding(a);
      // Left-associative, but for `^`, whose base is an operand and its exponent a signed term;
      // a comparison takes sums on both sides, since comparisons do not chain.
      const [l, r] = a.op === "^" ? [9, 7] : own === 4 ? [5, 5] : [own, own + 1];
      return `${operand(a.l, l)} ${a.op} ${operand(a.r, r)}`;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Folding constants

/** A decimal, `n × 10^-s`: the constants of a sum are added exactly in these. */
interface Decimal {
  n: bigint;
  s: number;
}

/**
 * A number's decimal: the shortest one that names its double (ECMAScript's `Number::toString`),
 * which is the literal as written for any literal of up to 15 significant digits.
 */
function decimalOf(v: number): Decimal {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(v));
  if (!m) throw new ExprError(`${v} is not a finite number`);
  const frac = m[3] ?? "";
  const s = frac.length - Number(m[4] ?? 0);
  const digits = BigInt(`${m[1]}${m[2]}${frac}`);
  return s >= 0 ? { n: digits, s } : { n: digits * 10n ** BigInt(-s), s: 0 };
}

function addDecimals(a: Decimal, b: Decimal): Decimal {
  const s = Math.max(a.s, b.s);
  return { n: a.n * 10n ** BigInt(s - a.s) + b.n * 10n ** BigInt(s - b.s), s };
}

/** A decimal's magnitude in plain digits, with no exponent and no trailing zeros: "400", "0.3". */
function decimalText(d: Decimal): string {
  let n = d.n < 0n ? -d.n : d.n;
  let s = d.s;
  while (s > 0 && n % 10n === 0n) {
    n /= 10n;
    s--;
  }
  const digits = n.toString().padStart(s + 1, "0");
  return s === 0 ? digits : `${digits.slice(0, -s)}.${digits.slice(-s)}`;
}

/** The terms of a sum, each with its sign, through `+`, `-`, signs and parentheses. */
function addends(a: Ast, sign: 1 | -1, out: { sign: 1 | -1; a: Ast }[]): void {
  if (a.t === "bin" && (a.op === "+" || a.op === "-")) {
    addends(a.l, sign, out);
    addends(a.r, a.op === "+" ? sign : (-sign as 1 | -1), out);
  } else if (a.t === "unary" && (a.op === "-" || a.op === "+")) {
    addends(a.e, a.op === "-" ? (-sign as 1 | -1) : sign, out);
  } else out.push({ sign, a });
}

/**
 * The most the constants of a sum may add up to in magnitude for a fold: 2^53. Below it, no
 * partial sum of a finite term and these constants overflows, before the fold or after, so a fold
 * never turns an error ("the sum is not finite") into a value, nor the reverse.
 */
const FOLD_BOUND = 2n ** 53n;

/**
 * Folds the constants of a sum of one symbol term and constants into one (design §4.9, *2.3*;
 * the editing review's n3): `H - 300 - 100` is `H - 400`, `1200 - (H - 300)` is `1500 - H`.
 * Compilers call it constant folding with reassociation. It never changes the real value the
 * expression has: the constants are added in exact decimal arithmetic, so `H + 0.1 + 0.2` is
 * `H + 0.3`. The double it evaluates to may differ in its last bits, since IEEE addition is not
 * associative (why compilers fold so only under -fassociative-math); §5.2's snapping and output
 * quantum absorb that, so no output changes (docs/ux/review-last-items-decisions.md).
 *
 * Only a sum whose terms are one symbol term (a param, a product, a call, an accessor; never a
 * comparison or a condition) and two or more numbers is folded, and nothing inside its symbol
 * term: a function's argument, a product's factor and a power stay as written, so a fold never
 * crosses a function. There are no units in the language: every term of a sum is in its field's
 * unit. Any other text, or text that does not parse, is returned as it is.
 */
export function foldConstants(src: string): string {
  let ast: Ast;
  try {
    ast = parseExpr(src);
  } catch {
    return src;
  }
  const terms: { sign: 1 | -1; a: Ast }[] = [];
  addends(ast, 1, terms);
  const symbols = terms.filter((x) => x.a.t !== "num");
  if (symbols.length !== 1 || terms.length - 1 < 2) return src;
  const { sign, a: term } = symbols[0] as { sign: 1 | -1; a: Ast };
  if (binding(term) < 6) return src; // a comparison, a condition: not a number to add to
  let c: Decimal = { n: 0n, s: 0 };
  let size: Decimal = { n: 0n, s: 0 };
  for (const x of terms) {
    if (x.a.t !== "num") continue;
    const d = decimalOf(x.a.v);
    c = addDecimals(c, x.sign > 0 ? d : { n: -d.n, s: d.s });
    size = addDecimals(size, { n: d.n < 0n ? -d.n : d.n, s: d.s });
  }
  if (size.n > FOLD_BOUND * 10n ** BigInt(size.s)) return src;
  const k = decimalText(c);
  if (sign > 0) {
    if (c.n === 0n) return formatExpr(term);
    return `${operand(term, 5)} ${c.n < 0n ? "-" : "+"} ${k}`;
  }
  if (c.n === 0n) return `-${operand(term, 7)}`;
  return c.n < 0n ? `-${operand(term, 7)} - ${k}` : `${k} - ${operand(term, 6)}`;
}

/** Evaluates a document value that must be a number: a number as is, or an expression. */
export function evalNumber(x: number | string, scope: ExprScope): number {
  if (typeof x === "number") return finite(x, "the value");
  const v = evaluate(parseExpr(x), scope);
  if (typeof v !== "number") throw new ExprError(`expected a number, not ${kindOf(v)}`);
  return v;
}

/** Evaluates an expression that must be a condition. */
export function evalBool(x: string, scope: ExprScope): boolean {
  return asBool(evaluate(parseExpr(x), scope), "the expression");
}
