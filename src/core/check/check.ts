import { liesOn } from "../commands/join.ts";
import { onOutline } from "../commands/sections.ts";
import { cutList } from "../cutlist/cutlist.ts";
import type { Derived } from "../derive/derive.ts";
import type { PlacedBar } from "../derive/types.ts";
import { type Diagnostic, Diagnostics, type Severity, sortDiagnostics } from "../diagnostics.ts";
import { type Ast, evalNumber, evaluate, parseExpr } from "../expr.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import { QUANTUM, quantize } from "../quantum.ts";
import { TOL } from "../tolerances.ts";
import { dist, dot, type V3 } from "../vec.ts";
import { unjoinedButts, unjoinedMessage } from "./joints.ts";
import { type Accessor, modelScope, PendingAccessor } from "./model.ts";

/**
 * `alukit check` on a derived model (design §5.5): derive's own diagnostics, the cut list's,
 * unconnected ends, butts that name no connector, and the project's checks with their margins
 * (§4.9). The file-level checks
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
 * provider. An end a provider claims is connected even when its claim fails (two providers, an
 * angled end with no cut declared): that failure is its error, and the end is not open (*2.3*,
 * E1.2). The through member of a butt at that point counts as connected: a through bar (its end
 * is claimed, or left on purpose with `through_end: "none"`), or a bar end a butt bears on
 * (`through: "b31.b"`, an end plate).
 *
 * *2.3* (review fixes, joins; B3): **an end that lies on another bar**, on its face or inside it,
 * with no provider, where a butt through that bar would bear on it (`liesOn`, the rule
 * `autoConnect` joins it by), is open too: a rail clicked between two posts' faces, or a copy
 * run into the rails it should butt on. Nothing holds it and nothing is bought to, and a bar run
 * into another is cut too long. Not between two context bars, whose joints are made already.
 */
export function unconnectedEnds(derived: Derived, d: Diagnostics): void {
  const ends: { ref: string; bar: string; p: V3; free: boolean }[] = [];
  for (const [id, b] of derived.bars) {
    for (const e of ["a", "b"] as const) {
      const p = e === "a" ? b.placed.A : b.placed.B;
      const ref = `${id}.${e}`;
      if (p) ends.push({ ref, bar: id, p, free: (derived.claims.get(ref) ?? []).length === 0 });
    }
  }
  // For each butting end, the through members it bears on: bar ids and bar ends.
  const throughAt = new Map<string, Set<string>>();
  for (const c of Object.values(derived.doc.connections)) {
    if (c.type !== "butt" || typeof c.through !== "string") continue;
    for (const e of c.ends) throughAt.set(e, (throughAt.get(e) ?? new Set()).add(c.through));
  }
  const seen = new Set<number>();
  const alone: (typeof ends)[number][] = [];
  ends.forEach((e, i) => {
    if (seen.has(i)) return;
    const group = [i];
    for (let j = i + 1; j < ends.length; j++) {
      if (!seen.has(j) && dist(e.p, (ends[j] as (typeof ends)[number]).p) <= TOL.len) group.push(j);
    }
    for (const j of group) seen.add(j);
    if (group.length < 2) {
      if (e.free) alone.push(e);
      return;
    }
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

  // A free end that meets no other end, but lies on a bar (B3). A bar end a butt bears on (an
  // end plate's, a block's) is the joint's through member, as at a corner.
  const borne = new Set([...throughAt.values()].flatMap((s) => [...s]));
  const bars = [...derived.bars].sort(([x], [y]) => compareIds(x, y));
  for (const e of alone) {
    const K = derived.bars.get(e.bar)?.placed;
    if (!K || borne.has(e.ref)) continue;
    const end = e.ref.slice(e.ref.lastIndexOf(".") + 1) as "a" | "b";
    for (const [id, T] of bars) {
      if (derived.context.has(e.bar) && derived.context.has(id)) continue;
      const on = liesOn(K, end, T);
      if (!on) continue;
      const how =
        on.depth > TOL.len
          ? `runs ${shown(on.depth)} mm into ${id}, past its ${on.face} face,`
          : `lies on ${id}'s ${on.face} face`;
      d.warn("unconnected", e.ref, `${e.ref} ${how} with no connection`, { refs: [e.ref, id] });
      break;
    }
  }
}

/**
 * Butts that name no connector, and no project default (`joints.ts`; review B1): a note on each,
 * as an unconnected end is one per corner, so a step's new and resolved diagnostics name the butts
 * it made or joined. A note, not a warning: the joint derives, and what it means for the order is
 * the order rule `no-connector`'s to judge, which a project may make block or turn off (a frame
 * welded, or joined with hardware bought elsewhere).
 */
export function noConnector(derived: Derived, d: Diagnostics): void {
  for (const butt of unjoinedButts(derived)) {
    d.info("butt-no-connector", butt, unjoinedMessage([butt]));
  }
}

/**
 * Two bars in one place (*2.3*, re-check N5; docs/ux/recheck-fixes-core-decisions.md 12–14): a
 * bar standing where another of its section stands, on the same line (its design points the
 * other's, either way, within tol.len) and placed as the same body (every vertex of its outline,
 * placed, on the other's placed outline within the section's tolerance), however it was made: a
 * paste, a duplicate, a mirror of old. The cut list and the BOM count both, so it is a warning on
 * the later bar, naming the first it stands on, as Tekla's clash check reports two identical
 * objects that completely overlap. A bar on the same line but beside it is not one.
 */
export function coincidentBars(derived: Derived, d: Diagnostics): void {
  const placed = [...derived.bars.values()]
    .map((b) => b.placed)
    .filter((p): p is PlacedBar & { B: V3 } => p.B !== undefined)
    .map((p) => ({ p, key: Math.min(p.A[0], p.B[0]) }))
    .sort((x, y) => x.key - y.key || compareIds(x.p.id, y.p.id));
  const first = new Map<string, string>();
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i] as (typeof placed)[number];
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j] as (typeof placed)[number];
      if (b.key - a.key > TOL.len) break;
      if (!sameBody(a.p, b.p)) continue;
      const [one, two] = compareIds(a.p.id, b.p.id) < 0 ? [a.p.id, b.p.id] : [b.p.id, a.p.id];
      const was = first.get(two);
      if (was === undefined || compareIds(one, was) < 0) first.set(two, one);
    }
  }
  for (const [two, one] of [...first].sort(([x], [y]) => compareIds(x, y))) {
    const counted = !derived.context.has(one) && !derived.context.has(two);
    d.warn(
      "coincident",
      two,
      `${two} stands where ${one} does: the same section on the same line, one body in one place${counted ? ", so the BOM counts it twice" : ""}; remove one of them`,
      { refs: [one, two] },
    );
  }
}

/** Whether two placed bars are one body: the same section, line and placed outline. */
function sameBody(p: PlacedBar & { B: V3 }, q: PlacedBar & { B: V3 }): boolean {
  if (p.item.sectionId !== q.item.sectionId) return false;
  const same = dist(p.A, q.A) <= TOL.len && dist(p.B, q.B) <= TOL.len;
  if (!same && !(dist(p.A, q.B) <= TOL.len && dist(p.B, q.A) <= TOL.len)) return false;
  const s = p.item.section;
  for (const ring of [s.draw.outline, ...s.draw.holes]) {
    for (const [u, v] of ring) {
      // The vertex placed at p's design point a (§4.4), then read in q's section frame.
      const lx = u - (p.anchor[0] as number) + (p.off[0] as number);
      const ly = v - (p.anchor[1] as number) + (p.off[1] as number);
      const W = p.A.map(
        (c, i) => c + lx * (p.frame.x[i] as number) + ly * (p.frame.y[i] as number),
      );
      const r = W.map((c, i) => c - (q.A[i] as number)) as unknown as V3;
      const x = dot(r, q.frame.x) + (q.anchor[0] as number) - (q.off[0] as number);
      const y = dot(r, q.frame.y) + (q.anchor[1] as number) - (q.off[1] as number);
      if (!onOutline(s, [x, y])) return false;
    }
  }
  return true;
}

/** Everything `alukit check` reports about a derived model. */
export function checkModel(input: CheckInput): CheckOutput {
  const d = new Diagnostics();
  for (const x of input.derived.diagnostics) d.add(x);
  for (const x of cutList({ derived: input.derived, items: input.items }).diagnostics) d.add(x);
  unconnectedEnds(input.derived, d);
  coincidentBars(input.derived, d);
  noConnector(input.derived, d);
  const checks = projectChecks(input, d);
  return { checks, diagnostics: sortDiagnostics(d.sorted()) };
}
