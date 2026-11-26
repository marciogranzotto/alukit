import { Ctx } from "../derive/context.ts";
import type { Derived, DerivedBar } from "../derive/derive.ts";
import { expandPatterns } from "../derive/patterns.ts";
import { type Ast, ExprError, type ExprScope, type Value } from "../expr.ts";
import type { ItemSource } from "../items.ts";
import { parseProject } from "../project/parse.ts";
import { addScaled, dist, dot, type V3 } from "../vec.ts";

/**
 * The accessors that read the derived model (design §4.9), for project checks only: document
 * values may not read the model they define. `len(b3)`, `cut(b3)`, `pos(n3)`, `dist(n1, n2)`,
 * `bbox()` and `count(tag:leg)` read the geometry. `mass()` and `cost()` read the bill of
 * materials and the prices; the caller supplies them, and until it does a check that uses them
 * is pending, not failed.
 */

/** An accessor: its arguments arrive unevaluated (entity ids and selectors). */
export type Accessor = (args: readonly Ast[]) => Value;

/** An accessor this build does not evaluate yet: the check is reported as pending. */
export class PendingAccessor extends ExprError {
  constructor(name: string) {
    super(`${name}() needs the bill of materials and prices, which this check does not have`);
    this.name = "PendingAccessor";
  }
}

/** Accessors that read the bill of materials and the prices, supplied by their callers. */
export const PENDING = ["mass", "cost"] as const;

function idArg(name: string, args: readonly Ast[], n = 1): string[] {
  if (args.length !== n || args.some((a) => a.t !== "name")) {
    throw new ExprError(`${name} takes ${n === 1 ? "one id" : `${n} ids`}`);
  }
  return args.map((a) => (a as { name: string }).name);
}

/**
 * The corners of a bar's body: its placed box swept between its end planes. Exact for every
 * planar cut: each corner line meets its end plane.
 */
export function bodyCorners(b: DerivedBar): V3[] {
  const { frame, box } = b.placed;
  const out: V3[] = [];
  for (const e of [b.ends.a, b.ends.b]) {
    const along = dot(e.normal, frame.t);
    for (const u of [box.x0, box.x1]) {
      for (const v of [box.y0, box.y1]) {
        const off = addScaled(addScaled([0, 0, 0], frame.x, u), frame.y, v);
        const s = Math.abs(along) < 1e-12 ? 0 : -dot(e.normal, off) / along;
        out.push(addScaled(addScaled(e.point, off, 1), frame.t, s));
      }
    }
  }
  return out;
}

/** The model's extent along each world axis, over the bar bodies. */
export function modelBox(d: Derived): { min: V3; max: V3 } | undefined {
  let min: number[] | undefined;
  let max: number[] | undefined;
  for (const b of d.bars.values()) {
    for (const c of bodyCorners(b)) {
      min = min ? min.map((m, i) => Math.min(m, c[i] as number)) : [...c];
      max = max ? max.map((m, i) => Math.max(m, c[i] as number)) : [...c];
    }
  }
  return min && max ? { min: min as unknown as V3, max: max as unknown as V3 } : undefined;
}

/** Every entity after pattern expansion, with its tags, as derive sees them. */
function expandedTags(raw: unknown, items: ItemSource): Map<string, readonly string[]> {
  const ctx = new Ctx(parseProject(raw).doc, items);
  expandPatterns(ctx);
  const out = new Map<string, readonly string[]>();
  for (const m of [ctx.nodes, ctx.bars, ctx.conns, ctx.parts]) {
    for (const [id, e] of m) {
      const spec = e.spec as unknown;
      const tags =
        typeof spec === "object" &&
        spec !== null &&
        Array.isArray((spec as { tags?: unknown }).tags)
          ? ((spec as { tags: string[] }).tags as readonly string[])
          : [];
      out.set(id, tags);
    }
  }
  const runs = ctx.doc.runs as Record<string, unknown>;
  for (const [id, r] of Object.entries(runs)) {
    const tags =
      typeof r === "object" &&
      r !== null &&
      !Array.isArray(r) &&
      Array.isArray((r as { tags?: unknown }).tags)
        ? ((r as { tags: string[] }).tags as readonly string[])
        : [];
    out.set(id, tags);
  }
  return out;
}

export interface ModelScopeInput {
  raw: unknown;
  derived: Derived;
  items: ItemSource;
  /** More accessors (`mass`, `cost`), from the bill of materials and the prices. */
  accessors?: Readonly<Record<string, Accessor>>;
}

/** The scope a project check is evaluated in: params, `sec()`, and the model accessors. */
export function modelScope(input: ModelScopeInput): ExprScope {
  const { derived: d } = input;
  // `sec()` and params as derive values them: the document's own scope.
  const base = new Ctx(parseProject(input.raw).doc, input.items);
  let tags: Map<string, readonly string[]> | undefined;
  let box: { min: V3; max: V3 } | undefined | null = null;

  const bar = (name: string, id: string): DerivedBar => {
    const b = d.bars.get(id);
    if (b) return b;
    throw new ExprError(`${name}(${id}): no bar ${id} that derives`);
  };
  const node = (name: string, id: string): V3 => {
    const p = d.nodes.get(id);
    if (p) return p;
    throw new ExprError(`${name}(${id}): no node ${id} that derives`);
  };

  const accessors: Record<string, Accessor> = {
    len: (args) => {
      const [id] = idArg("len", args) as [string];
      const run = d.runs.get(id);
      return run ? run.len : bar("len", id).lengths.len;
    },
    cut: (args) => bar("cut", idArg("cut", args)[0] as string).lengths.cut,
    pos: (args) => ({ kind: "vec", v: node("pos", idArg("pos", args)[0] as string) }),
    dist: (args) => {
      const [p, q] = idArg("dist", args, 2) as [string, string];
      return dist(node("dist", p), node("dist", q));
    },
    bbox: (args) => {
      if (args.length !== 0) throw new ExprError("bbox takes no arguments");
      if (box === null) box = modelBox(d);
      if (!box) throw new ExprError("bbox(): no bar derives");
      const { min, max } = box;
      return { kind: "vec", v: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
    },
    count: (args) => {
      const [a] = args;
      if (args.length !== 1 || a?.t !== "sel" || a.key !== "tag") {
        throw new ExprError("count takes a tag selector: count(tag:leg)");
      }
      tags ??= expandedTags(input.raw, input.items);
      let n = 0;
      for (const t of tags.values()) if (t.includes(a.value)) n++;
      return n;
    },
    ...input.accessors,
  };

  return {
    name: (n) => d.params.get(n),
    accessor: (name, args) => {
      const f = accessors[name];
      if (f) return f(args);
      if ((PENDING as readonly string[]).includes(name)) throw new PendingAccessor(name);
      return base.scope.accessor?.(name, args);
    },
  };
}
