import { cutList } from "../cutlist/cutlist.ts";
import type { Derived } from "../derive/derive.ts";
import { type Diagnostic, Diagnostics, type Severity, sortDiagnostics } from "../diagnostics.ts";
import { type Ast, evalNumber, evaluate, parseExpr } from "../expr.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import { QUANTUM, quantize } from "../quantum.ts";
import { TOL } from "../tolerances.ts";
import { dist, type V3 } from "../vec.ts";
import { type Accessor, modelScope, PendingAccessor } from "./model.ts";

/**
 * `alukit check` on a derived model (design §5.5): derive's own diagnostics, the cut list's,
 * unconnected ends, and the project's checks with their margins (§4.9). The file-level checks
 * (the lock behind the catalogs, a file not in canonical form) belong to the caller, which reads
 * the files. The M4a server runs the same function after each step.
 */

export const CHECK_SCHEMA = "alukit.check/1";

const OPS = ["<", "<=", ">", ">=", "==", "!="] as const;
type Op = (typeof OPS)[number];
const SEVERITIES: readonly Severity[] = ["error", "warn", "info"];

export interface CheckResult {
  id: string;
  text?: string;
  severity: Severity;
  /** `value op limit`, or a plain condition `expr`. */
  value?: number;
  op?: Op;
  limit?: number;
  /** How far the value is inside its limit (negative: outside), rounded to the mm quantum. */
  margin?: number;
  /** Whether it holds; absent when it could not be evaluated. */
  pass?: boolean;
  /** Why it could not be evaluated. */
  problem?: string;
  /** It reads the bill of materials or prices, which this caller did not supply. */
  pending?: true;
}

export interface CheckInput {
  raw: unknown;
  derived: Derived;
  items: ItemSource;
  accessors?: Readonly<Record<string, Accessor>>;
}

export interface CheckOutput {
  checks: CheckResult[];
  diagnostics: Diagnostic[];
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** The margin of `value op limit`: how far inside the limit, so negative means it fails. */
function marginOf(op: Op, value: number, limit: number): number | undefined {
  switch (op) {
    case "<":
    case "<=":
      return limit - value;
    case ">":
    case ">=":
      return value - limit;
    case "==":
      return -Math.abs(value - limit);
    case "!=":
      return undefined;
  }
}

function shown(x: number): string {
  return String(quantize(x, QUANTUM.len_mm));
}

/** Evaluates the project's `checks` records (§4.9). */
export function projectChecks(input: CheckInput, d: Diagnostics): CheckResult[] {
  const records = (
    isObject(input.raw) && Array.isArray(input.raw.checks) ? input.raw.checks : []
  ) as unknown[];
  if (records.length === 0) return [];
  const scope = modelScope(input);
  const out: CheckResult[] = [];
  records.forEach((rec, i) => {
    const r = isObject(rec) ? rec : {};
    const id = typeof r.id === "string" ? r.id : `checks[${i}]`;
    const severity = SEVERITIES.includes(r.severity as Severity)
      ? (r.severity as Severity)
      : "error";
    const text = typeof r.text === "string" ? r.text : undefined;
    const res: CheckResult = { id, ...(text ? { text } : {}), severity };
    const label = `${id}${text ? ` (${text})` : ""}`;
    const plain = typeof r.expr === "string";
    const op = r.op as Op;
    if (!plain && !(typeof r.value === "string" || typeof r.value === "number")) {
      res.problem = "give value, op and limit, or expr";
    } else if (!plain && !OPS.includes(op)) {
      res.problem = `op must be one of ${OPS.join(" ")}`;
    } else if (!plain && !(typeof r.limit === "string" || typeof r.limit === "number")) {
      res.problem = "give a limit";
    }
    if (res.problem) {
      d.error("check", id, `${label}: ${res.problem}`);
      out.push(res);
      return;
    }
    try {
      if (plain) {
        const v = evaluate(parseExpr(r.expr as string), scope);
        if (typeof v !== "boolean") throw new Error("expr must be a condition");
        res.pass = v;
      } else {
        const value = evalNumber(r.value as number | string, scope);
        const limit = evalNumber(r.limit as number | string, scope);
        // The comparison is the language's own, within tol.snap (§4.9, §5.2).
        const cmp: Ast = {
          t: "bin",
          op,
          l: { t: "num", v: value },
          r: { t: "num", v: limit },
          pos: 0,
        };
        res.value = value;
        res.op = op;
        res.limit = limit;
        const margin = marginOf(op, value, limit);
        if (margin !== undefined) res.margin = quantize(margin, QUANTUM.len_mm);
        res.pass = evaluate(cmp, scope) as boolean;
      }
    } catch (e) {
      if (e instanceof PendingAccessor) {
        res.pending = true;
        res.problem = e.message;
        d.info("check-pending", id, `${label}: not evaluated: ${e.message}`);
      } else {
        res.problem = e instanceof Error ? e.message : String(e);
        d.error("check", id, `${label}: cannot be evaluated: ${res.problem}`);
      }
      out.push(res);
      return;
    }
    if (!res.pass) {
      const detail = plain
        ? `${r.expr as string} does not hold`
        : `${String(r.value)} = ${shown(res.value as number)}, not ${op} ${shown(res.limit as number)}${res.margin !== undefined ? ` (margin ${shown(res.margin)})` : ""}`;
      d.add({ severity, code: "check", entity: id, message: `${label}: ${detail}` });
    }
    out.push(res);
  });
  return out;
}

/**
 * Unconnected ends (§5.5): a point where two or more bar ends meet and an end there has no
 * provider. The through member of a butt at that point counts as connected: a through bar
 * (its end is claimed, or left on purpose with `through_end: "none"`), or a bar end a butt
 * bears on (`through: "b31.b"`, an end plate).
 */
export function unconnectedEnds(derived: Derived, d: Diagnostics): void {
  const ends: { ref: string; bar: string; p: V3; free: boolean }[] = [];
  for (const [id, b] of derived.bars) {
    for (const e of ["a", "b"] as const) {
      const p = e === "a" ? b.placed.A : b.placed.B;
      if (p) ends.push({ ref: `${id}.${e}`, bar: id, p, free: b.ends[e].by === "default" });
    }
  }
  // For each butting end, the through members it bears on: bar ids and bar ends.
  const throughAt = new Map<string, Set<string>>();
  for (const c of Object.values(derived.doc.connections)) {
    if (c.type !== "butt" || typeof c.through !== "string") continue;
    for (const e of c.ends) throughAt.set(e, (throughAt.get(e) ?? new Set()).add(c.through));
  }
  const seen = new Set<number>();
  ends.forEach((e, i) => {
    if (seen.has(i)) return;
    const group = [i];
    for (let j = i + 1; j < ends.length; j++) {
      if (!seen.has(j) && dist(e.p, (ends[j] as (typeof ends)[number]).p) <= TOL.len) group.push(j);
    }
    for (const j of group) seen.add(j);
    if (group.length < 2) return;
    const here = group.map((j) => ends[j] as (typeof ends)[number]);
    const through = new Set(here.flatMap((x) => [...(throughAt.get(x.ref) ?? [])]));
    const loose = here.filter((x) => x.free && !through.has(x.bar) && !through.has(x.ref));
    if (loose.length === 0) return;
    const refs = here.map((x) => x.ref).sort(compareIds);
    const at = e.p.map((c) => shown(c)).join(", ");
    const names = loose.map((x) => x.ref).join(", ");
    d.warn(
      "unconnected",
      (loose[0] as (typeof loose)[number]).ref,
      `${refs.join(", ")} meet at (${at}); ${names} ${loose.length === 1 ? "has" : "have"} no connection`,
      { refs },
    );
  });
}

/** Everything `alukit check` reports about a derived model. */
export function checkModel(input: CheckInput): CheckOutput {
  const d = new Diagnostics();
  for (const x of input.derived.diagnostics) d.add(x);
  for (const x of cutList({ derived: input.derived, items: input.items }).diagnostics) d.add(x);
  unconnectedEnds(input.derived, d);
  const checks = projectChecks(input, d);
  return { checks, diagnostics: sortDiagnostics(d.sorted()) };
}
