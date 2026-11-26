import { z } from "zod";
import type { BuiltSection } from "#catalog/link.ts";
import type { DerivedBar } from "../derive/derive.ts";
import { evalNumber } from "../expr.ts";
import { compareIds } from "../ids.ts";
import { sortedJson } from "../lock/pin.ts";
import {
  BarId,
  type Expr,
  type Face,
  ItemRef,
  NodeId,
  RunId,
  Vec3Expr,
} from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { dist, type V3 } from "../vec.ts";
import { allIds, getEntity, isObject, type Kind, kindOf, nextId, withEntity } from "./doc.ts";
import { failed, requireEntity, withDoc } from "./helpers.ts";
import { type BarMap, mapBarFields, mapOps, mapStation, swapEnd } from "./maps.ts";
import { len, minus, negate, plus } from "./numbers.ts";
import { Refusal, type Rewriter, refusal, rewriteEntity } from "./rewrite.ts";
import { flipsU, hasSymmetry, mapFace, type Sym, symmetries } from "./sections.ts";
import {
  type CommandContext,
  type CommandDef,
  done,
  type Outcome,
  type RawDoc,
  refuse,
} from "./types.ts";
import { checkEntity } from "./validate.ts";

/**
 * The commands that move geometry (design §6): reverseBar, splitBar and autoConnect. They read
 * the derived model for positions and lengths, and rewrite every reference so that what the
 * document means stays where it was.
 */

type O = Record<string, unknown>;

/** Runs a command body that may throw a Refusal. */
export function guard(fn: () => Outcome): Outcome {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Refusal) return failed(e.errors);
    throw e;
  }
}

/** The bar item's section, from the lock. */
export function sectionOf(ctx: CommandContext, id: string, spec: O): BuiltSection {
  const defaults = isObject(ctx.state.doc.defaults) ? ctx.state.doc.defaults : {};
  const ref =
    (spec.item as string | undefined) ??
    (isObject(defaults.bar) ? (defaults.bar.item as string) : undefined);
  if (!ref)
    throw refusal("item", `${id} names no item, and defaults.bar.item is not set`, { entity: id });
  const found = ctx.items().item(ref);
  if (!found.ok || !found.bar) {
    throw refusal("item", `${id}: ${found.ok ? `${ref} is not a bar item` : found.message}`, {
      entity: id,
    });
  }
  return found.bar.section;
}

export function isFreeEnd(b: unknown): boolean {
  return isObject(b) && "len_mm" in b;
}

/** The bars of a run as written, in order. */
export function runBars(v: unknown): string[] {
  const list = Array.isArray(v) ? v : isObject(v) ? v.bars : undefined;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

/** The run a bar belongs to, if any. */
export function runOf(doc: RawDoc, bar: string): string | undefined {
  const runs = isObject(doc.runs) ? doc.runs : {};
  return Object.keys(runs)
    .sort(compareIds)
    .find((r) => runBars(runs[r]).includes(bar));
}

/** A derived bar, or a refusal naming why it does not derive. */
export function derivedBar(ctx: CommandContext, id: string): DerivedBar {
  const b = ctx.derived().bars.get(id);
  if (b) return b;
  const why = ctx
    .derived()
    .diagnostics.filter((d) => d.severity === "error" && d.entity === id)
    .map((d) => d.message);
  throw refusal("derive", `${id} does not derive${why.length > 0 ? `: ${why.join("; ")}` : ""}`, {
    entity: id,
  });
}

/** Rewrites every entity of the document; returns it and the ids that changed. */
export function rewriteAll(doc: RawDoc, rw: Rewriter): { doc: RawDoc; changed: string[] } {
  let out = doc;
  const changed: string[] = [];
  for (const id of allIds(doc)) {
    const kind = kindOf(id) as Kind;
    if (kind === "items") continue;
    const v = getEntity(doc, id);
    const nv = rewriteEntity(kind, id, v, rw);
    if (sortedJson(nv) !== sortedJson(v)) {
      out = withEntity(out, id, nv);
      changed.push(id);
    }
  }
  return { doc: out, changed };
}

/** Checks entities after an edit; the first problems refuse it. */
export function checkAll(ctx: CommandContext, doc: RawDoc, ids: readonly string[]): void {
  for (const id of ids) {
    const errors = checkEntity(ctx, doc, id);
    if (errors.length > 0) throw new Refusal(errors);
  }
}

/** A list of offsets that is its own negation, so turning u over leaves it the same. */
function symmetricList(xs: readonly unknown[]): boolean {
  const nums = xs.filter((x): x is number => typeof x === "number");
  if (nums.length !== xs.length) return false;
  const a = [...nums].sort((p, q) => p - q);
  const b = nums.map((x) => -x).sort((p, q) => p - q);
  return a.every((x, i) => Math.abs(x - (b[i] as number)) <= TOL.len);
}

// ---------------------------------------------------------------------------------------------
// reverseBar (§4.4)

/** The roll that keeps a reversed bar's body, per the section symmetry used (§4.4). */
const ROLL_REVERSE: Record<Sym, number> = { x: 0, y: 180, d: 90, a: 270 };

const ReverseBar = z.strictObject({
  id: z.union([BarId, RunId]).describe("a bar, or a run: every bar of it, and its order"),
});

export const reverseBar: CommandDef<z.infer<typeof ReverseBar>> = {
  name: "reverseBar",
  group: "Structure",
  summary:
    "swap a bar's ends and rewrite anchor, offset, roll and every reference, so the body stays",
  args: ReverseBar,
  apply: (ctx, a) => guard(() => reverse(ctx, a.id)),
};

function reverse(ctx: CommandContext, id: string): Outcome {
  const doc = ctx.state.doc;
  const isRun = id.startsWith("r");
  const missing = requireEntity(doc, id, isRun ? "runs" : "bars");
  if (missing.length > 0) return failed(missing);
  const bars = isRun ? runBars(getEntity(doc, id)) : [id];
  if (!isRun) {
    const run = runOf(doc, id);
    if (run) {
      return refuse(
        "run",
        `${id} is in run ${run}, whose bars all point the same way: reverse the run`,
        {
          entity: id,
          refs: [run],
        },
      );
    }
  }

  let m: Sym | undefined;
  const maps = new Map<string, BarMap>();
  for (const b of bars) {
    const spec = getEntity(doc, b) as O;
    if (isFreeEnd(spec.b)) {
      return refuse(
        "geometry",
        `${b}'s end b is a free end; give it a point before reversing the bar`,
        { entity: b },
      );
    }
    const section = sectionOf(ctx, b, spec);
    if (m === undefined) {
      m = symmetries(section)[0];
      if (m === undefined) {
        return refuse(
          "geometry",
          `section ${section.id} has no mirror symmetry, so ${b} reversed would be another body`,
          { entity: b },
        );
      }
    } else if (!hasSymmetry(section, m)) {
      return refuse("geometry", `the bars of ${id} do not share a symmetric section`, {
        entity: b,
      });
    }
    maps.set(b, { to: b, reversed: true, m, section });
  }
  const sym = m as Sym;
  if (isRun) maps.set(id, { ...(maps.get(bars[0] as string) as BarMap), to: id });

  const lengthOf = (layer: string): number => {
    const l = layer.startsWith("r")
      ? ctx.derived().runs.get(layer)?.len
      : derivedBar(ctx, layer).lengths.len;
    if (l === undefined) throw refusal("derive", `${layer} does not derive`, { entity: layer });
    return l;
  };

  const rw: Rewriter = {
    end: (ref) => (maps.has(ref.split(".")[0] as string) ? swapEnd(ref) : ref),
    station: (st, where) => {
      const bm = typeof st.bar === "string" ? maps.get(st.bar) : undefined;
      return bm ? mapStation(st, bm, where) : st;
    },
    face: (bar, face) => (maps.has(bar) ? mapFace(sym, face) : face),
    entity: (kind, eid, v) => {
      if (kind === "bars" && maps.has(eid)) {
        const bm = maps.get(eid) as BarMap;
        const out = mapBarFields(eid, v, sym, bm.section, ROLL_REVERSE[sym]);
        out.a = v.b;
        out.b = v.a;
        if (isObject(v.ends)) {
          out.ends = { ...(v.ends.b ? { a: v.ends.b } : {}), ...(v.ends.a ? { b: v.ends.a } : {}) };
        }
        if (v.ops !== undefined) out.ops = mapOps(v.ops, sym, true);
        if (isObject(v.holes)) out.holes = swapHoles(v.holes);
        return out;
      }
      if (kind === "parts" && isObject(v.on) && maps.has(v.on.bar as string)) {
        // The part's x runs along the bar (§4.7): turned end for end, it turns 180° about z.
        const roll = turnedRollPlus(v.roll_deg as Expr | undefined);
        const { roll_deg: _, ...rest } = v;
        return roll === undefined ? rest : { ...rest, roll_deg: roll };
      }
      if (kind === "patterns") {
        if (isObject(v.rail_holes) && maps.has(v.rail_holes.along as string)) {
          throw refusal(
            "geometry",
            `${eid} selects rail holes from ${v.rail_holes.along}'s start; reversing it would change the selection`,
            {
              entity: eid,
            },
          );
        }
        if (typeof v.along === "string" && maps.has(v.along)) {
          const out = { ...v };
          if (v.pitch_mm !== undefined) out.pitch_mm = negate(v.pitch_mm as Expr);
          if (Array.isArray(v.offsets_mm))
            out.offsets_mm = v.offsets_mm.map((o) => negate(o as Expr));
          return out;
        }
        return v;
      }
      if (kind === "connections") return reverseInConnection(eid, v, maps, sym, lengthOf);
      return v;
    },
  };

  const r = rewriteAll(doc, rw);
  let next = r.doc;
  if (isRun) {
    const run = getEntity(next, id);
    const order = [...bars].reverse();
    next = withEntity(next, id, Array.isArray(run) ? order : { ...(run as O), bars: order });
  }
  const changed = [...new Set([...r.changed, ...(isRun ? [id] : [])])].sort(compareIds);
  checkAll(ctx, next, changed);
  return done(withDoc(ctx, next), { changed }, { symmetry: sym });
}

function turnedRollPlus(r: Expr | undefined): Expr | undefined {
  const r0 = r ?? 0;
  if (typeof r0 === "string") return `${r0} + 180`;
  const v = (((r0 + 180) % 360) + 360) % 360;
  return v === 0 ? undefined : v;
}

function swapHoles(h: O): O {
  if (h.factory === "a" || h.factory === "b")
    return { ...h, factory: h.factory === "a" ? "b" : "a" };
  if (h.E_a_mm !== undefined) return { E_b_mm: h.E_a_mm };
  if (h.E_b_mm !== undefined) return { E_a_mm: h.E_b_mm };
  return h;
}

function reverseInConnection(
  id: string,
  v: O,
  maps: ReadonlyMap<string, BarMap>,
  m: Sym,
  lengthOf: (layer: string) => number,
): O {
  if (
    v.type === "butt" &&
    isObject(v.through_end) &&
    typeof v.through === "string" &&
    maps.has(v.through)
  ) {
    const te = v.through_end;
    return { ...v, through_end: { ...te, end: te.end === "a" ? "b" : "a" } };
  }
  if (v.type !== "face" || !Array.isArray(v.bars)) return v;
  const layers = v.bars as string[];
  const out: O = { ...v };
  if (Array.isArray(v.faces)) {
    out.faces = (v.faces as [Face, Face][]).map(([f, g], i) => [
      maps.has(layers[i] as string) ? mapFace(m, f) : f,
      maps.has(layers[i + 1] as string) ? mapFace(m, g) : g,
    ]);
  }
  const first = layers[0] as string;
  const st = v.stations;
  if (!maps.has(first) || !isObject(st)) return out;
  if (st.rail_holes !== undefined) {
    throw refusal(
      "geometry",
      `${id} selects rail holes along ${first} from its start; reversing it would change them`,
      {
        entity: id,
      },
    );
  }
  const stations: O = { ...st };
  if (Array.isArray(st.at_mm)) {
    const L = lengthOf(first);
    stations.at_mm = st.at_mm.map((e) => minus(L, e as Expr));
  }
  if (Array.isArray(st.across_mm)) {
    const face = Array.isArray(v.faces) ? (v.faces as [Face, Face][])[0]?.[0] : undefined;
    const flip = face ? flipsU(m, face) : m === "a" ? true : m === "d" ? false : undefined;
    if (flip === undefined && !symmetricList(st.across_mm)) {
      throw refusal(
        "geometry",
        `${id}: give its faces, so its across offsets can be turned with ${first}`,
        {
          entity: id,
        },
      );
    }
    if (flip) stations.across_mm = st.across_mm.map((e) => negate(e as Expr));
  }
  out.stations = stations;
  return out;
}

// ---------------------------------------------------------------------------------------------
// splitBar (§6)

const SplitBar = z.strictObject({
  id: BarId,
  at_mm: z.number().positive().describe("where to split, from end a's design point"),
  splice: z
    .union([
      z.literal(true),
      z.strictObject({
        connector: ItemRef.optional(),
        gap_mm: z.union([z.number(), z.string().min(1)]).optional(),
      }),
    ])
    .optional()
    .describe(
      "add a splice connection between the pieces; always added when they are in a run, which needs it",
    ),
  run: z
    .literal(true)
    .optional()
    .describe("make the pieces a run (a bar in a run gains the new piece anyway)"),
});

export const splitBar: CommandDef<z.infer<typeof SplitBar>> = {
  name: "splitBar",
  group: "Structure",
  summary: "split a bar in two at a distance from end a, optionally adding a splice and the run",
  args: SplitBar,
  apply: (ctx, a) => guard(() => split(ctx, a)),
};

const sameWritten = (p: unknown, q: unknown) => JSON.stringify(p) === JSON.stringify(q);

function vec3(x: unknown): x is [Expr, Expr, Expr] {
  return Array.isArray(x) && x.length === 3;
}

/** The split point: the written coordinates where the line keeps them, computed ones elsewhere. */
function splitPoint(spec: O, db: DerivedBar, s: number): [Expr, Expr, Expr] {
  const A = db.placed.A;
  const t = db.placed.frame.t;
  const numeric = (i: number) => len((A[i] as number) + (t[i] as number) * s);
  const pa = spec.a;
  if (!vec3(pa)) return [numeric(0), numeric(1), numeric(2)];
  const pb = spec.b;
  const axis = [0, 1, 2].filter((i) => Math.abs(Math.abs(t[i] as number) - 1) <= 1e-12);
  return [0, 1, 2].map((i) => {
    if (vec3(pb) && sameWritten(pa[i], pb[i])) return pa[i];
    if (axis.length === 1 && axis[0] === i)
      return plus(pa[i] as Expr, Math.sign(t[i] as number) * s);
    if (!vec3(pb) && Math.abs(t[i] as number) <= 1e-12) return pa[i];
    return numeric(i);
  }) as [Expr, Expr, Expr];
}

function split(ctx: CommandContext, a: z.infer<typeof SplitBar>): Outcome {
  const doc0 = ctx.state.doc;
  const missing = requireEntity(doc0, a.id, "bars");
  if (missing.length > 0) return failed(missing);
  const spec = getEntity(doc0, a.id) as O;
  if (isFreeEnd(spec.b) && (spec.b as O).from === "a.cut") {
    return refuse(
      "geometry",
      `${a.id}'s end b is counted from end a's cut; give it a point before splitting`,
      {
        entity: a.id,
      },
    );
  }
  const db = derivedBar(ctx, a.id);
  const L = db.lengths.len;
  const s = a.at_mm;
  if (!(s > TOL.len && s < L - TOL.len)) {
    return refuse("args", `at_mm must lie inside ${a.id}: between 0 and its length ${len(L)} mm`, {
      entity: a.id,
      field: "at_mm",
    });
  }

  const node = nextId(doc0, "n");
  let doc = withEntity(node.doc, node.id, splitPoint(spec, db, s));
  const piece = nextId(doc, "b");
  doc = piece.doc;
  const second = piece.id;
  const existingRun = runOf(doc0, a.id);
  let runId = existingRun;
  const created = [node.id, second];
  if (a.run && !existingRun) {
    const r = nextId(doc, "r");
    doc = r.doc;
    runId = r.id;
    created.push(r.id);
  }

  // Ops and stations are placed by their written distance, valued with the document's params.
  const params = ctx.derived().params;
  const scope = { name: (n: string) => params.get(n) };
  const value = (e: Expr, where: string): number => {
    try {
      return evalNumber(e, scope);
    } catch {
      throw refusal("expr", `${where}: cannot value ${JSON.stringify(e)}`, {
        entity: where.split("/")[0],
      });
    }
  };

  // The pieces: the first keeps end a, the second takes end b.
  const ops = Array.isArray(spec.ops) ? (spec.ops as O[]) : [];
  const firstOps: O[] = [];
  const secondOps: O[] = [];
  ops.forEach((op, i) => {
    const at = value(op.at_mm as Expr, `${a.id}/ops[${i}]/at_mm`);
    const fromB = (op.from ?? "a") === "b";
    if (!fromB) {
      if (at <= s) firstOps.push(op);
      else secondOps.push({ ...op, at_mm: plus(op.at_mm as Expr, -s) });
    } else if (at < L - s) secondOps.push(op);
    else firstOps.push({ ...op, at_mm: plus(op.at_mm as Expr, -(L - s)) });
  });
  const ends = isObject(spec.ends) ? spec.ends : {};
  const { ends: _e, ops: _o, holes: _h, b: oldB, ...shared } = spec;
  const first: O = { ...shared, b: node.id };
  if (ends.a !== undefined) first.ends = { a: ends.a };
  if (firstOps.length > 0) first.ops = firstOps;
  if (spec.holes !== undefined) first.holes = spec.holes;
  const { a: _a, ...rest } = shared;
  const secondB = isFreeEnd(oldB)
    ? { ...(oldB as O), len_mm: plus((oldB as O).len_mm as Expr, -s) }
    : oldB;
  const secondBar: O = { ...rest, a: node.id, b: secondB };
  if (ends.b !== undefined) secondBar.ends = { b: ends.b };
  if (secondOps.length > 0) secondBar.ops = secondOps;
  // Re-key in schema order: a before b (canonical form orders them on write anyway).
  doc = withEntity(doc, a.id, first);
  doc = withEntity(doc, second, secondBar);

  // Every reference to the old bar's end b, or to a station past the split, moves to the second
  // piece.
  const onFirst = new Set([a.id, second, node.id]);
  const rw: Rewriter = {
    end: (ref) => (ref === `${a.id}.b` ? `${second}.b` : ref),
    station: (st, where) => {
      if (st.bar !== a.id) return st;
      const from = (st.from as string | undefined) ?? "a";
      const at = value(st.at_mm as Expr, where);
      if (from === "a" || from === "a.cut") {
        if (at <= s || from === "a.cut") return st;
        return { ...st, bar: second, at_mm: plus(st.at_mm as Expr, -s) };
      }
      if (from === "b.cut") return { ...st, bar: second };
      if (at < L - s) return { ...st, bar: second };
      return { ...st, at_mm: plus(st.at_mm as Expr, -(L - s)) };
    },
    entity: (kind, eid, v) => {
      if (onFirst.has(eid)) return v;
      if (kind === "runs" && runBars(v).includes(a.id)) {
        const list = runBars(v).flatMap((b) => (b === a.id ? [a.id, second] : [b]));
        return Array.isArray(v) ? list : { ...v, bars: list };
      }
      if (kind === "patterns") {
        const out: O = { ...v };
        if (Array.isArray(v.template) && v.template.includes(a.id)) {
          out.template = v.template.flatMap((x) => (x === a.id ? [a.id, second] : [x]));
        }
        if (v.along === a.id && runId && runId !== existingRun) out.along = runId;
        if (isObject(v.rail_holes) && v.rail_holes.along === a.id) {
          if (!runId) throw needRun(eid, a.id, "selects rail holes along");
          out.rail_holes = { ...v.rail_holes, along: runId };
        }
        return out;
      }
      if (
        kind === "connections" &&
        v.type === "face" &&
        Array.isArray(v.bars) &&
        v.bars.includes(a.id)
      ) {
        if (!runId || runId === existingRun) throw needRun(eid, a.id, "has as a layer");
        const out: O = { ...v, bars: v.bars.map((x) => (x === a.id ? runId : x)) };
        if (Array.isArray(v.stack)) {
          out.stack = v.stack.map((e) =>
            isObject(e) && e.inside === a.id ? { ...e, inside: runId } : e,
          );
        }
        if (
          isObject(v.stations) &&
          isObject(v.stations.rail_holes) &&
          v.stations.rail_holes.along === a.id
        ) {
          out.stations = { ...v.stations, rail_holes: { ...v.stations.rail_holes, along: runId } };
        }
        return out;
      }
      return v;
    },
  };
  const r = rewriteAll(doc, rw);
  doc = r.doc;
  if (runId && runId !== existingRun) doc = withEntity(doc, runId, [a.id, second]);
  // A run's pieces are joined by splices (§4.3; derive refuses a run without them), so pieces in
  // a run, new or existing, get the splice whether or not it was asked for.
  const splice = a.splice ?? (runId ? true : undefined);
  if (splice) {
    const c = nextId(doc, "c");
    const opt = splice === true ? {} : splice;
    doc = withEntity(c.doc, c.id, { type: "splice", ends: [`${a.id}.b`, `${second}.a`], ...opt });
    created.push(c.id);
  }
  const changed = [...new Set([a.id, ...r.changed])]
    .filter((x) => !created.includes(x))
    .sort(compareIds);
  checkAll(ctx, doc, [...created, ...changed]);
  return done(withDoc(ctx, doc), { created, changed });
}

function needRun(id: string, bar: string, what: string): Refusal {
  return refusal(
    "run",
    `${id} ${what} ${bar}: split it with run: true, so the pieces become a run it can name`,
    {
      entity: id,
      refs: [bar],
    },
  );
}

// ---------------------------------------------------------------------------------------------
// autoConnect (§4.5 "Default connection", call 6)

const AutoConnect = z
  .strictObject({
    at: z.union([NodeId, Vec3Expr]).optional().describe("the point where the draw tool closed"),
    end: z
      .string()
      .regex(/^b\d+\.[ab]$/)
      .optional()
      .describe("or a bar end, at its design point"),
    connector: ItemRef.optional().describe("defaults.butt.connector when absent"),
    qty: z.int().min(1).optional(),
    optional: z
      .boolean()
      .optional()
      .describe(
        "do nothing, rather than refuse, when nothing butts at the point (the draw tool sends one for each end of a bar it adds)",
      ),
  })
  .refine((a) => (a.at === undefined) !== (a.end === undefined), { message: "give at or end" });

export const autoConnect: CommandDef<z.infer<typeof AutoConnect>> = {
  name: "autoConnect",
  group: "Connections",
  summary:
    "add the default butt where bar ends meet: through the bar passing the point, else a vertical, else the lowest id",
  args: AutoConnect,
  apply: (ctx, a) => guard(() => connectAt(ctx, a)),
};

function connectAt(ctx: CommandContext, a: z.infer<typeof AutoConnect>): Outcome {
  const d = ctx.derived();
  let P: V3 | undefined;
  if (a.end) {
    const [bar, e] = a.end.split(".") as [string, "a" | "b"];
    const b = derivedBar(ctx, bar);
    P = e === "a" ? b.placed.A : b.placed.B;
  } else if (typeof a.at === "string") P = d.nodes.get(a.at);
  else if (a.at) {
    const scope = { name: (n: string) => d.params.get(n) };
    try {
      P = a.at.map((c) => evalNumber(c, scope)) as unknown as V3;
    } catch (e) {
      return refuse("expr", `at: ${(e as Error).message}`, { field: "at" });
    }
  }
  if (!P) return refuse("derive", `the point ${a.end ?? JSON.stringify(a.at)} does not derive`);

  // Bar ends at the point that no provider claims yet.
  const ends: string[] = [];
  const passing: string[] = [];
  for (const [id, b] of [...d.bars].sort(([x], [y]) => compareIds(x, y))) {
    if (id.includes("@")) continue;
    for (const e of ["a", "b"] as const) {
      const pt = e === "a" ? b.placed.A : b.placed.B;
      if (pt && dist(pt, P) <= TOL.len && b.ends[e].by === "default") ends.push(`${id}.${e}`);
    }
    const A = b.placed.A;
    const t = b.placed.frame.t;
    const s = (P[0] - A[0]) * t[0] + (P[1] - A[1]) * t[1] + (P[2] - A[2]) * t[2];
    const foot: V3 = [A[0] + t[0] * s, A[1] + t[1] * s, A[2] + t[2] * s];
    if (s > TOL.len && s < b.lengths.len - TOL.len && dist(foot, P) <= TOL.len) passing.push(id);
  }
  const atEnds = [...new Set(ends.map((e) => e.split(".")[0] as string))];
  const vertical = (id: string) => {
    const t = d.bars.get(id)?.placed.frame.t as V3;
    return Math.hypot(t[0], t[1]) < TOL.vert;
  };
  const through = passing[0] ?? atEnds.find(vertical) ?? atEnds[0];
  const butting = through ? ends.filter((e) => !e.startsWith(`${through}.`)) : [];
  if (!through || butting.length === 0) {
    const why = through
      ? `only ${through} meets at that point: nothing butts on it`
      : "no bar end meets at that point";
    // The draw tool asks at every end it closes on; an end in the open is not a refusal there.
    if (a.optional) return done(ctx.state, {}, { skipped: why });
    return refuse("geometry", why);
  }
  const defaults =
    isObject(ctx.state.doc.defaults) && isObject(ctx.state.doc.defaults.butt)
      ? ctx.state.doc.defaults.butt
      : {};
  const connector = a.connector ?? (defaults.connector as string | undefined);
  const qty = a.qty ?? (defaults.qty as number | undefined);
  const c = nextId(ctx.state.doc, "c");
  const conn = {
    type: "butt",
    through,
    ends: butting,
    ...(connector ? { connector } : {}),
    ...(qty !== undefined ? { qty } : {}),
  };
  const doc = withEntity(c.doc, c.id, conn);
  checkAll(ctx, doc, [c.id]);
  return done(withDoc(ctx, doc), { created: [c.id] }, { through, ends: butting });
}
