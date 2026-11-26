import type { Diagnostic } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import { type Doc, parseProject } from "../project/parse.ts";
import type { Expr, Face } from "../project/schema.ts";
import type { V3 } from "../vec.ts";
import { Ctx } from "./context.ts";
import { resolveEnds } from "./ends.ts";
import { expandPatterns } from "./patterns.ts";
import { nodePoint, placeBar, placePivot, placeRun } from "./place.ts";
import type { BarLengths, EndFace, EndReport, PlacedBar, PlacedPivot, PlacedRun } from "./types.ts";

/**
 * `derive(doc, items) → Derived` (design §5): a pure function. M3a runs stages 1–3: resolve
 * (params), place (points, frames, runs, pivots, pattern copies) and ends (two sweeps, modifiers,
 * lengths). It never throws on document content: problems are diagnostics, and an entity that
 * cannot resolve is left out while the rest derives (§5.1).
 */

/** A hole a person adds in `ops` (§4.4), valued: along the axis from the named design point. */
export interface ResolvedOp {
  op: "hole";
  face: Face;
  from: "a" | "b";
  at: number;
  d?: number;
  thread?: string;
  depth?: number;
  csk?: { d: number; angle: number };
  cbore?: { d: number; depth: number };
}

export interface DerivedBar {
  placed: PlacedBar;
  lengths: BarLengths;
  ends: { a: EndReport; b: EndReport };
  ops: ResolvedOp[];
}

export interface Derived {
  doc: Doc;
  params: ReadonlyMap<string, number>;
  nodes: ReadonlyMap<string, V3>;
  /** Placed bars whose ends resolved, in id order. */
  bars: ReadonlyMap<string, DerivedBar>;
  runs: ReadonlyMap<string, PlacedRun>;
  pivots: ReadonlyMap<string, PlacedPivot>;
  faces: ReadonlyMap<string, EndFace>;
  diagnostics: Diagnostic[];
}

function sortedKeys<T>(m: ReadonlyMap<string, T>): string[] {
  return [...m.keys()].sort(compareIds);
}

export function derive(raw: unknown, items: ItemSource): Derived {
  const parsed = parseProject(raw);
  const ctx = new Ctx(parsed.doc, items);
  for (const d of parsed.diagnostics) ctx.d.add(d);

  // Stage 1: params, in dependency order.
  const params = ctx.allParams();

  // Stage 2: pattern copies, then everything placed in id order (each resolves its own
  // dependencies first).
  expandPatterns(ctx);
  const nodes = new Map<string, V3>();
  for (const id of sortedKeys(ctx.nodes)) {
    const v = nodePoint(ctx, id);
    if (v) nodes.set(id, v);
  }
  const placed = new Map<string, PlacedBar>();
  for (const id of sortedKeys(ctx.bars)) {
    const b = placeBar(ctx, id);
    if (b) placed.set(id, b);
  }
  const runs = new Map<string, PlacedRun>();
  for (const id of Object.keys(ctx.doc.runs).sort(compareIds)) {
    const r = placeRun(ctx, id);
    if (r) runs.set(id, r);
  }
  const pivots = new Map<string, PlacedPivot>();
  for (const id of sortedKeys(ctx.conns)) {
    if (ctx.conns.get(id)?.spec.type !== "pivot") continue;
    const p = placePivot(ctx, id);
    if (p) pivots.set(id, p);
  }
  checkFaceRefs(ctx);

  // Stage 3: end planes in two sweeps, then lengths.
  const s3 = resolveEnds(ctx, placed);
  const bars = new Map<string, DerivedBar>();
  for (const [id, pb] of placed) {
    const l = s3.lengths.get(id);
    if (l) bars.set(id, { placed: pb, ...l, ops: resolveOps(ctx, id) });
  }

  return {
    doc: ctx.doc,
    params,
    nodes,
    bars,
    runs,
    pivots,
    faces: s3.faces,
    diagnostics: ctx.d.sorted(),
  };
}

function resolveOps(ctx: Ctx, id: string): ResolvedOp[] {
  const ops = ctx.bars.get(id)?.spec.ops ?? [];
  const out: ResolvedOp[] = [];
  ops.forEach((op, i) => {
    const f = `ops[${i}]`;
    const n = (x: Expr | undefined, name: string) =>
      x === undefined ? undefined : ctx.num(id, `${f}/${name}`, x);
    const at = n(op.at_mm, "at_mm");
    if (at === undefined) return;
    const d = n(op.d_mm, "d_mm");
    const depth = n(op.depth_mm, "depth_mm");
    const csk = op.csk && {
      d: n(op.csk.d_mm, "csk/d_mm"),
      angle: n(op.csk.angle_deg, "csk/angle_deg"),
    };
    const cbore = op.cbore && {
      d: n(op.cbore.d_mm, "cbore/d_mm"),
      depth: n(op.cbore.depth_mm, "cbore/depth_mm"),
    };
    out.push({
      op: "hole",
      face: op.face,
      from: op.from ?? "a",
      at,
      ...(d !== undefined ? { d } : {}),
      ...(op.thread ? { thread: op.thread } : {}),
      ...(depth !== undefined ? { depth } : {}),
      ...(csk?.d !== undefined && csk.angle !== undefined
        ? { csk: { d: csk.d, angle: csk.angle } }
        : {}),
      ...(cbore?.d !== undefined && cbore.depth !== undefined
        ? { cbore: { d: cbore.d, depth: cbore.depth } }
        : {}),
    });
  });
  return out;
}

/** A face connection never changes a cut (§4.5); its layers must still exist. */
function checkFaceRefs(ctx: Ctx): void {
  for (const id of sortedKeys(ctx.conns)) {
    const spec = ctx.conns.get(id)?.spec;
    if (spec?.type !== "face") continue;
    for (const layer of spec.bars) {
      const known = layer.startsWith("r")
        ? Object.hasOwn(ctx.doc.runs, layer)
        : layer.startsWith("p")
          ? ctx.parts.has(layer)
          : ctx.bars.has(layer);
      if (!known) ctx.d.error("ref", id, `bars: no ${layer}`, { field: "bars", refs: [layer] });
    }
  }
}
