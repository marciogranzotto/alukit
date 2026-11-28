import { describe, expect, it } from "vitest";
import { minus, negate, offsetBy, plus, reflect } from "./commands/numbers.ts";
import {
  type Ast,
  type ExprScope,
  evalNumber,
  evaluate,
  foldConstants,
  formatExpr,
  parseExpr,
  type Value,
} from "./expr.ts";
import { quantize } from "./quantum.ts";

/**
 * Folding the constants of a sum (design §4.9, *2.3*; the editing review's n3; decisions in
 * docs/ux/review-last-items-decisions.md): `H - 300 - 100` reads `H - 400`. A fold never changes
 * the real value an expression has (its constants are summed in exact decimal arithmetic), and so
 * never what any output says; the double it evaluates to may differ in its last bits, since IEEE
 * addition is not associative (GCC's -fassociative-math), which the property test bounds.
 */

const scope = (params: Readonly<Record<string, number>>): ExprScope => ({
  name: (n) => params[n],
  accessor(name, args): Value | undefined {
    if (name === "sec") {
      const [a] = args as [Ast];
      if (a.t !== "name") return undefined;
      return { kind: "rec", what: `section of ${a.name}`, fields: { t_mm: 4.5, width_mm: 40 } };
    }
    if (name === "count") return 4;
    return undefined;
  },
});
const P = scope({ H: 750, W: 1000, D: 600, L: 400 });

describe("foldConstants (n3)", () => {
  it("folds a sum of one symbol term and constants into one constant", () => {
    const cases: [string, string][] = [
      ["H - 300 - 100", "H - 400"],
      ["H + 300 - 100", "H + 200"],
      ["H - 300 + 300", "H"],
      ["1200 - (H - 300)", "1500 - H"],
      ["600 - (L - 40)", "640 - L"],
      ["-(H - 300) - 100", "200 - H"],
      ["-(H + 300) - 100", "-H - 400"],
      ["W / 2 - 20 + 5", "W / 2 - 15"],
      ["100 - D / 2 - 50", "50 - D / 2"],
      ["-(D / 2) - 100 - 50", "-(D / 2) - 150"],
      ["0.1 + H + 0.2", "H + 0.3"],
      ["H - 300.25 - 0.75", "H - 301"],
      ["sec(b3).t_mm + 1 + 2", "sec(b3).t_mm + 3"],
      ["1e3 + H + 1", "H + 1001"],
      ["2 ^ H + 1 + 1", "2 ^ H + 2"],
      ["H*2-100+50", "H * 2 - 50"],
      ["H - 300 + (-100)", "H - 400"],
      ["(H - 0.005) - 0.005", "H - 0.01"],
    ];
    for (const [src, folded] of cases) expect(foldConstants(src), src).toBe(folded);
  });

  it("leaves what is not such a sum, or has nothing to fold, as written", () => {
    for (const src of [
      "H - 400",
      "400 + H",
      "-(H - 300)",
      "W + D - 100 - 50", // two symbol terms
      "round(H - 300) - 100", // one constant outside the function
      "round(H - 300 - 100)", // never inside a function
      "(H - 300) * 2 - 100",
      "300 + 50 + 100", // no symbol term: a written constant expression stays written
      "H < 3 + 1 + 2",
      "not H",
      "H + 1e300 - 1e300 + 1", // beyond the bound that keeps every partial sum finite
      "H +",
    ]) {
      expect(foldConstants(src), src).toBe(src);
    }
  });

  it("evaluates each folded case to the same value", () => {
    for (const src of ["H - 300 - 100", "1200 - (H - 300)", "W / 2 - 20 + 5", "0.1 + H + 0.2"]) {
      expect(quantize(evalNumber(foldConstants(src), P), 100)).toBe(
        quantize(evalNumber(src, P), 100),
      );
    }
  });
});

describe("the commands' composers write folded sums (numbers.ts)", () => {
  it("folds what a step composes: a move, a mirror, a length from the other end", () => {
    // Move: the copy at H - 300 moved 100 down (the review's n3).
    expect(plus("H - 300", -100)).toBe("H - 400");
    expect(offsetBy("H - 300", 1, -100)).toBe("H - 400");
    expect(offsetBy("H - 300", -1, "-100")).toBe("H - 200");
    // Mirror: W - 100 reflected in x = 600, and back.
    expect(reflect("W - 100", 600)).toBe("1300 - W");
    expect(reflect("1300 - W", 600)).toBe("W - 100");
    // A cut typed over a param, written from the bar's other end.
    expect(minus(600, "L - 40")).toBe("640 - L");
    expect(negate("H - 300 - 100")).toBe("400 - H");
    // One constant is nothing to fold: these read as before.
    expect(plus("W", 100)).toBe("W + 100");
    expect(negate("H - 300")).toBe("-(H - 300)");
    expect(offsetBy("W", 1, "D / 2")).toBe("W + (D / 2)");
    expect(offsetBy("W - 100", 1, "D")).toBe("W - 100 + D");
  });
});

// ---------------------------------------------------------------------------------------------
// The property test: random sums, folded, evaluate identically.

/** mulberry32: a small seeded generator, so a failure replays. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An exact rational, n / d with d > 0. */
type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};
const q = (n: bigint, d: bigint): Q => {
  if (d === 0n) throw new Error("division by zero");
  const s = d < 0n ? -1n : 1n;
  const g = gcd(n, d) || 1n;
  return { n: (s * n) / g, d: (s * d) / g };
};
const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const eq = (a: Q, b: Q) => a.n === b.n && a.d === b.d;

/** A decimal's exact value: "123.45", "1e+21", "-0.5". */
function ofDecimal(text: string): Q {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (!m) throw new Error(`not a decimal: ${text}`);
  const frac = m[3] ?? "";
  const exp = Number(m[4] ?? 0) - frac.length;
  const digits = BigInt(`${m[1]}${m[2]}${frac}`);
  return exp >= 0 ? q(digits * 10n ** BigInt(exp), 1n) : q(digits, 10n ** BigInt(-exp));
}

/** A double's exact value, a binary fraction. */
function ofDouble(x: number): Q {
  let d = 1n;
  let v = x;
  while (!Number.isInteger(v)) {
    v *= 2;
    d *= 2n;
  }
  return q(BigInt(v), d);
}

/**
 * An expression's exact value: sums, products and quotients exactly, numbers by the decimal that
 * names them (Number::toString) and params by the decimal they were written as; anything else (a
 * call, a member, a power) by the double it evaluates to, which a fold does not touch.
 */
function exact(a: Ast, params: Readonly<Record<string, string>>, s: ExprScope): Q {
  switch (a.t) {
    case "num":
      return ofDecimal(String(a.v));
    case "name":
      return a.name in params ? ofDecimal(params[a.name] as string) : ofDouble(evalNum(a, s));
    case "unary":
      if (a.op === "-") return mul(q(-1n, 1n), exact(a.e, params, s));
      if (a.op === "+") return exact(a.e, params, s);
      break;
    case "bin": {
      if (a.op === "+" || a.op === "-" || a.op === "*" || a.op === "/") {
        const l = exact(a.l, params, s);
        const r = exact(a.r, params, s);
        if (a.op === "+") return add(l, r);
        if (a.op === "-") return add(l, mul(q(-1n, 1n), r));
        if (a.op === "*") return mul(l, r);
        return mul(l, q(r.d, r.n));
      }
      break;
    }
    default:
      break;
  }
  return ofDouble(evalNum(a, s));
}

const evalNum = (a: Ast, s: ExprScope): number => {
  const v = evaluate(a, s);
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

/** The operands of a sum, signed, through `+`, `-`, unary signs and parentheses. */
function operands(a: Ast, sign = 1, out: { sign: number; a: Ast }[] = []) {
  if (a.t === "bin" && (a.op === "+" || a.op === "-")) {
    operands(a.l, sign, out);
    operands(a.r, a.op === "+" ? sign : -sign, out);
  } else if (a.t === "unary" && (a.op === "-" || a.op === "+")) {
    operands(a.e, a.op === "-" ? -sign : sign, out);
  } else out.push({ sign, a });
  return out;
}

/** An AST without positions, to compare structure. */
const shape = (a: Ast): unknown =>
  JSON.parse(JSON.stringify(a, (k, v) => (k === "pos" ? undefined : v)));

/** A decimal of up to `frac` fraction digits below `max`, written canonically (or as 1e3, .5). */
function decimal(r: () => number, max: number, frac: number): string {
  const s = Math.floor(r() * (frac + 1));
  const m = Math.floor(r() * max * 10 ** s);
  const x = m / 10 ** s;
  if (r() < 0.03 && x === 1000) return "1e3";
  const t = String(x);
  return r() < 0.05 && t.startsWith("0.") ? t.slice(1) : t;
}

const TERMS = [
  "H",
  "W",
  "W / 2",
  "2 * D",
  "D / 3",
  "sec(b3).t_mm",
  "round(L / 7)",
  "max(H, 400)",
  "W ^ 2 / 1000",
  "abs(H - 300 - 100)",
  "if(H > 500, W, D)",
  "hypot(W, D)",
  "pi * D",
  "count(tag:leg)",
  "(W + D)",
  "-L",
];

/** A random sum: one term (sometimes two, or none) and up to four constants, grouped at random. */
function sum(r: () => number): string {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
  const terms = r() < 0.08 ? 0 : r() < 0.1 ? 2 : 1;
  const leaves: string[] = [];
  for (let i = 0; i < terms; i++) leaves.push(pick(TERMS));
  const k = Math.floor(r() * 5);
  for (let i = 0; i < k; i++) leaves.push(decimal(r, r() < 0.5 ? 1000 : 100000, 3));
  if (leaves.length === 0) leaves.push("H");
  for (let i = leaves.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [leaves[i], leaves[j]] = [leaves[j] as string, leaves[i] as string];
  }
  const build = (xs: string[]): string => {
    if (xs.length === 1) return xs[0] as string;
    const cut = 1 + Math.floor(r() * (xs.length - 1));
    const left = build(xs.slice(0, cut));
    const right = build(xs.slice(cut));
    const op = r() < 0.5 ? "+" : "-";
    const grouped = xs.length - cut > 1 ? `(${right})` : right;
    const text = `${left} ${op} ${grouped}`;
    return r() < 0.12 ? `-(${text})` : text;
  };
  return build(leaves);
}

describe("the fold changes no value (property test over random sums)", () => {
  it("keeps every sum's exact value, and its double within rounding of the original", () => {
    const r = rng(20261128);
    let folded = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const src = sum(r);
      const texts: Record<string, string> = {};
      for (const n of ["H", "W", "D", "L"]) {
        texts[n] = String(Number(`${r() < 0.1 ? "-" : ""}${decimal(r, 100000, 3)}`));
      }
      const nums = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, Number(v)]));
      const s = scope(nums);
      const out = foldConstants(src);
      const before = parseExpr(src);
      const after = parseExpr(out);
      // Idempotent, and a fold only where a sum has one symbol term and constants to fold.
      expect(foldConstants(out), src).toBe(out);
      const ops = operands(before);
      const syms = ops.filter((o) => o.a.t !== "num");
      const consts = ops.length - syms.length;
      const foldable = syms.length === 1 && consts >= 2;
      expect(out !== src, src).toBe(foldable);
      if (!foldable) continue;
      folded++;
      // The term is the same, never folded into: the fold reaches no function or product.
      const left = operands(after);
      expect(
        left.filter((o) => o.a.t !== "num").map((o) => shape(o.a)),
        src,
      ).toEqual([shape((syms[0] as { a: Ast }).a)]);
      expect(left.length - 1, src).toBeLessThanOrEqual(1);

      let a: number;
      try {
        a = evalNumber(src, s);
      } catch {
        expect(() => evalNumber(out, s), src).toThrow();
        continue;
      }
      const b = evalNumber(out, s);
      // The same real value, exactly.
      expect(eq(exact(before, texts, s), exact(after, texts, s)), `${src} → ${out}`).toBe(true);
      // The same value at the output quantum, which every output passes through (§5.2)…
      expect(quantize(b, 100), `${src} → ${out}`).toBe(quantize(a, 100));
      // …and the doubles within the rounding of a sum of these operands: n·ε·Σ|xᵢ|.
      const scale = ops.reduce((t, o) => t + Math.abs(evalNum(o.a, s)), 0);
      expect(Math.abs(a - b), `${src} → ${out}`).toBeLessThanOrEqual(
        ops.length * Number.EPSILON * scale,
      );
    }
    // The test exercises the fold (1884 of the 4000 sums fold; 1307 of those give the very same
    // double, the rest differ in their last bits, as reassociated IEEE sums may).
    expect(folded).toBeGreaterThan(N / 3);
  });

  it("prints every expression so it parses back to the same tree (formatExpr)", () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const src = sum(r);
      const ast = parseExpr(src);
      const text = formatExpr(ast);
      expect(shape(parseExpr(text)), `${src} → ${text}`).toEqual(shape(ast));
      expect(formatExpr(parseExpr(text))).toBe(text);
    }
    for (const src of [
      "-2 ^ 2",
      "(-2) ^ 2",
      "2 ^ 3 ^ 2",
      "(2 ^ 3) ^ 2",
      "2 ^ -1",
      "a - -b",
      "--x",
      "a - (b - c)",
      "a / (b * c)",
      "(a + b) * c",
      "not (a < b) and c or d",
      "not (a and b)",
      "(a < b) == c",
      "if(a or b, 1, 2)",
      "count(tag:leg) + sec(b3).t_mm + pos(n3).z",
      "(2).x",
      "1e21 + .5",
    ]) {
      const ast = parseExpr(src);
      expect(shape(parseExpr(formatExpr(ast))), src).toEqual(shape(ast));
    }
    expect(formatExpr(parseExpr("W*2-(D/2)"))).toBe("W * 2 - D / 2");
  });
});
