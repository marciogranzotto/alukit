import { evaluate, freeNames, parseExpr } from "#core/expr.ts";
import { QUANTUM, quantize } from "#core/quantum.ts";

/**
 * Values typed into a tool's command bar or a form (D-UX-17, B R10): expressions in the
 * document's grammar (`#core/expr.ts`), the project's params, `mm`, `cm` and `m` after a number,
 * a sign, a list (`1000, 600`) and an absolute point (`[0, 0, H]`). A value with no param in it is
 * written as the number it comes to, so a plain length writes a plain number; one that reads a
 * param is written as the expression, so the param keeps driving it. Owner: S5.
 */

/** A value as a document writes it: a number, or an expression. */
export type Written = number | string;

/** One value: what it comes to (mm), and how it is written. */
export interface TypedNumber {
  value: number;
  written: Written;
  /** The params it reads, in the order they first appear. */
  params: string[];
}

export type Typed =
  | { kind: "empty" }
  | ({ kind: "value" } & TypedNumber)
  | { kind: "list"; items: TypedNumber[] }
  | { kind: "point"; items: [TypedNumber, TypedNumber, TypedNumber] }
  | { kind: "error"; why: string };

const UNIT: Readonly<Record<string, number>> = { mm: 1, cm: 10, m: 1000 };

const mm = (x: number) => quantize(x, QUANTUM.len_mm);

/**
 * Each number literal followed by a unit, as millimetres: `1.2m` is `1200`, `W - 5 cm` is
 * `W - 50`. A unit is a unit only right after a number that is not part of a name (`W2m` is a
 * name), and only when no letter follows it (`2 max(…)` is not two metres).
 */
export function withoutUnits(src: string): string {
  return src.replace(
    /(?<![A-Za-z0-9_.])((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(mm|cm|m)(?![A-Za-z0-9_])/g,
    (_all, n: string, unit: string) => String(mm(Number(n) * (UNIT[unit] ?? 1))),
  );
}

/** Splits at the commas outside parentheses and brackets. */
function topSplit(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(src.slice(from, i));
      from = i + 1;
    }
  }
  out.push(src.slice(from));
  return out.map((s) => s.trim());
}

/** One value, or why it cannot be read. */
export function typedNumber(
  src: string,
  params: Readonly<Record<string, number>>,
): TypedNumber | { why: string } {
  const text = withoutUnits(src.trim());
  if (text === "") return { why: "a value is missing" };
  let ast: ReturnType<typeof parseExpr>;
  try {
    ast = parseExpr(text);
  } catch (e) {
    return { why: `cannot read "${src.trim()}": ${(e as Error).message}` };
  }
  const names = [...freeNames(ast)];
  const unknown = names.filter((n) => params[n] === undefined);
  if (unknown.length > 0) {
    return {
      why: `${unknown.map((n) => `"${n}"`).join(", ")} ${unknown.length > 1 ? "are" : "is"} no param of this project`,
    };
  }
  let v: unknown;
  try {
    v = evaluate(ast, { name: (n) => params[n] });
  } catch (e) {
    return { why: `cannot work out "${src.trim()}": ${(e as Error).message}` };
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return { why: `"${src.trim()}" is not a number` };
  }
  return { value: mm(v), written: names.length === 0 ? mm(v) : text, params: names };
}

/** What was typed: nothing, one value, a list, a point, or why it cannot be read. */
export function parseTyped(text: string, params: Readonly<Record<string, number>>): Typed {
  const t = text.trim();
  if (t === "") return { kind: "empty" };
  if (t.startsWith("[")) {
    if (!t.endsWith("]")) return { kind: "error", why: "a point is [x, y, z]: close it with ]" };
    const parts = topSplit(t.slice(1, -1));
    if (parts.length !== 3) return { kind: "error", why: "a point is [x, y, z]: three values" };
    const items = parts.map((p) => typedNumber(p, params));
    const bad = items.find((x) => "why" in x);
    if (bad && "why" in bad) return { kind: "error", why: bad.why };
    return { kind: "point", items: items as [TypedNumber, TypedNumber, TypedNumber] };
  }
  const parts = topSplit(t);
  const items = parts.map((p) => typedNumber(p, params));
  const bad = items.find((x) => "why" in x);
  if (bad && "why" in bad) return { kind: "error", why: bad.why };
  const good = items as TypedNumber[];
  if (good.length === 1) return { kind: "value", ...(good[0] as TypedNumber) };
  return { kind: "list", items: good };
}

/** How a typed value reads back: `W / 2 + 20 = 620 mm`, or `1200 mm`. */
export function typedWords(n: TypedNumber, unit = "mm"): string {
  const v = `${Number.isInteger(n.value) ? n.value : n.value.toFixed(2)} ${unit}`;
  return typeof n.written === "string" ? `${n.written} = ${v}` : v;
}

/** A typed value as a command takes it: a number when it reads as one, else an expression. */
export function typedValue(text: string): number | string {
  const t = text.trim();
  return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : t;
}

/** A comma-separated list of numbers or expressions; undefined when a member is empty. */
export function valueList(text: string): (number | string)[] | undefined {
  if (text.trim() === "") return [];
  const parts = text.split(",").map((s) => s.trim());
  return parts.some((s) => s === "") ? undefined : parts.map(typedValue);
}
