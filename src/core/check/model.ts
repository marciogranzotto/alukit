// The one module outside src/core it reads: the bodies the viewer and the GLB draw, three-free.
import { modelExtent, type NoBox } from "../../mesh/extent.ts";
import { Ctx } from "../derive/context.ts";
import type { Derived, DerivedBar } from "../derive/derive.ts";
import { expandPatterns } from "../derive/patterns.ts";
import { type Ast, ExprError, type ExprScope, type Value } from "../expr.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import { dist, type V3 } from "../vec.ts";

/**
 * The accessors that read the derived model (design §4.9), for project checks only: document
 * values may not read the model they define. `len(b3)`, `cut(b3)`, `pos(n3)`, `dist(n1, n2)`,
 * `bbox()` and `count(tag:leg)` read the geometry: `bbox()` the extent of every body the viewer
 * draws and the GLB holds (`src/mesh/extent.ts`). `mass()` and `cost()` read the bill of
 * materials and the prices: the caller supplies them (`outputAccessors` in `outputs.ts`, as
 * `alukit check`, `do`, `order` and `costs` do), and a caller that does not reports a check that
 * uses them as pending, not failed.
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

/** "no box for test:TNUT-M8 (p9, p9@1): its item gives no bbox_mm", by item in id order. */
function noBoxText(parts: readonly NoBox[]): string {
  const byItem = new Map<string, string[]>();
  for (const p of parts) byItem.set(p.item, [...(byItem.get(p.item) ?? []), p.id]);
  const items = [...byItem.keys()].sort(compareIds);
  const list = items.map((i) => `${i} (${(byItem.get(i) as string[]).join(", ")})`).join(", ");
  return `no box for ${list}: ${items.length === 1 ? "its item gives" : "their items give"} no bbox_mm`;
}

function idArg(name: string, args: readonly Ast[], n = 1): string[] {
  if (args.length !== n || args.some((a) => a.t !== "name")) {
    throw new ExprError(`${name} takes ${n === 1 ? "one id" : `${n} ids`}`);
  }
  return args.map((a) => (a as { name: string }).name);
}

/** Every entity after pattern expansion, with its tags, as derive sees them (in its variant). */
function expandedTags(d: Derived, items: ItemSource): Map<string, readonly string[]> {
  const ctx = new Ctx(d.doc, items);
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
  // `sec()` and params as derive values them: the scope of the document the variant builds.
  const base = new Ctx(d.doc, input.items);
  let tags: Map<string, readonly string[]> | undefined;
  let box: ReturnType<typeof modelExtent> | undefined;

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
      box ??= modelExtent(d, input.items);
      // A part whose extent is not known leaves the box partial: never a pass on it (§4.9).
      if (!box.ok) throw new ExprError(`bbox(): ${noBoxText(box.noBox)}`);
      if (!box.extent) throw new ExprError("bbox(): no body derives");
      const { min, max } = box.extent;
      return { kind: "vec", v: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
    },
    count: (args) => {
      const [a] = args;
      if (args.length !== 1 || a?.t !== "sel" || a.key !== "tag") {
        throw new ExprError("count takes a tag selector: count(tag:leg)");
      }
      tags ??= expandedTags(d, input.items);
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
