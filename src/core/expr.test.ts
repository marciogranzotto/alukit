import { describe, expect, it } from "vitest";
import {
  type Ast,
  type ExprScope,
  evalBool,
  evalNumber,
  evaluate,
  freeNames,
  parseExpr,
  type Value,
} from "./expr.ts";

const params: Record<string, number> = { W: 1200, H: 900, D: 600, t: 3 };
const scope: ExprScope = {
  name: (n) => params[n],
  accessor(name, args): Value | undefined {
    if (name === "sec") {
      const [a] = args as [Ast];
      if (a.t !== "name") return undefined;
      return { kind: "rec", what: `section of ${a.name}`, fields: { t_mm: 4, width_mm: 50 } };
    }
    if (name === "pos") return { kind: "vec", v: [1, 2, 3] };
    if (name === "count") {
      const [a] = args as [Ast];
      return a.t === "sel" && a.key === "tag" && a.value === "leg" ? 4 : 0;
    }
    return undefined;
  },
};
const num = (s: string) => evalNumber(s, scope);

describe("expressions (design §4.9)", () => {
  it("does arithmetic with the usual precedence", () => {
    expect(num("1 + 2 * 3")).toBe(7);
    expect(num("(1 + 2) * 3")).toBe(9);
    expect(num("W / 2 - 20")).toBe(580);
    expect(num("2 ^ 3 ^ 2")).toBe(512); // right-associative
    expect(num("-2 ^ 2")).toBe(-4); // unary minus binds looser than ^
    expect(num("2 ^ -1")).toBe(0.5);
    expect(num("1e3 + .5")).toBe(1000.5);
    expect(num("--3")).toBe(3);
  });

  it("evaluates trig in degrees, exactly at special angles", () => {
    expect(num("sin(30)")).toBe(0.5);
    expect(num("cos(90)")).toBe(0);
    expect(num("tan(45)")).toBe(1);
    expect(num("tan(135)")).toBe(-1);
    expect(num("asin(0.5)")).toBe(30);
    expect(num("acos(0.5)")).toBe(60);
    expect(num("atan(1)")).toBe(45);
    expect(num("atan2(1, -1)")).toBe(135);
    expect(num("atan2(0, -5)")).toBe(180);
    expect(num("atan2(3, 4)")).toBeCloseTo(36.86989764584402, 12);
    expect(() => num("tan(90)")).toThrow(/infinite/);
  });

  it("snaps before floor, ceil and round, and rounds half away from zero", () => {
    expect(num("floor(0.1 * 3 * 10)")).toBe(3); // 3.0000000000000004
    expect(num("ceil(0.1 * 3 * 10)")).toBe(3);
    expect(num("round(2.5)")).toBe(3);
    expect(num("round(-2.5)")).toBe(-3);
    expect(num("hypot(3, 4)")).toBe(5);
    expect(num("min(W, H, D)")).toBe(600);
    expect(num("max(1)")).toBe(1);
    expect(num("abs(-2)")).toBe(2);
    expect(num("sqrt(16)")).toBe(4);
    expect(num("pi")).toBe(Math.PI);
  });

  it("compares within tol.snap and has booleans", () => {
    expect(evalBool("0.1 + 0.2 == 0.3", scope)).toBe(true);
    expect(evalBool("0.1 + 0.2 > 0.3", scope)).toBe(false);
    expect(evalBool("W > H and not (D > H)", scope)).toBe(true);
    expect(evalBool("W < H or H < D", scope)).toBe(false);
    expect(num("if(W > 1000, 1, 2)")).toBe(1);
    expect(num("if(W > 1000, 1, 1 / 0)")).toBe(1); // lazy: the other branch is not evaluated
  });

  it("reads accessors, members and selectors from the scope", () => {
    expect(num("sec(b3).t_mm + 2.5")).toBe(6.5);
    expect(num("pos(n3).z")).toBe(3);
    expect(num("count(tag:leg)")).toBe(4);
    expect(() => num("sec(b3).h_mm")).toThrow(/has no "h_mm" \(it has t_mm, width_mm\)/);
    expect(() => num("pos(n3).w")).toThrow(/\.x, \.y and \.z/);
  });

  it("reports errors instead of producing non-finite numbers", () => {
    expect(() => num("1 / 0")).toThrow(/division by zero/);
    expect(() => num("sqrt(-1)")).toThrow(/negative/);
    expect(() => num("asin(2)")).toThrow(/outside/);
    expect(() => num("10 ^ 400")).toThrow(/not finite/);
    expect(() => num("Q + 1")).toThrow(/unknown name "Q"/);
    expect(() => num("frob(1)")).toThrow(/unknown function "frob"/);
    expect(() => num("W > H")).toThrow(/expected a number/);
    expect(() => num("1 +")).toThrow(/unexpected end/);
    expect(() => num("1 < 2 < 3")).toThrow(/do not chain/);
    expect(() => num("2 $ 3")).toThrow(/unexpected "\$"/);
    expect(() => num("min()")).toThrow(/at least 1/);
    expect(Object.is(num("-0"), 0)).toBe(true);
  });

  it("lists the params an expression reads, not accessor arguments", () => {
    expect([...freeNames(parseExpr("W / 2 + max(H, D) + sec(b3).t_mm + pi"))].sort()).toEqual([
      "D",
      "H",
      "W",
    ]);
  });

  it("is a pure function of its input", () => {
    const ast = parseExpr("hypot(W, H) * sin(37) / 3");
    expect(evaluate(ast, scope)).toBe(evaluate(parseExpr("hypot(W, H) * sin(37) / 3"), scope));
  });
});
