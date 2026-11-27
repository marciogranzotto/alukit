import type { Diagnostic } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import { type Doc, parseProject } from "../project/parse.ts";
import type { Expr, Face } from "../project/schema.ts";
import { projectItems } from "../project-items/source.ts";
import type { V3 } from "../vec.ts";
import { attach } from "./attach.ts";
import { Ctx } from "./context.ts";
import { resolveEnds } from "./ends.ts";
import { expandPatterns } from "./patterns.ts";
import { nodePoint, placeBar, placePivot, placeRun } from "./place.ts";
import type {
  BarLengths,
  DerivedPart,
  EndFace,
  EndReport,
  FaceResult,
  HardwareUse,
  PlacedBar,
  PlacedPivot,
  PlacedRun,
  RailLayout,
  StockPiece,
} from "./types.ts";
import { applyVariant } from "./variant.ts";

/**
 * `derive(doc, items, { variant }) → Derived` (design §5): a pure function. Stage 1 applies the
 * variant (§4.10: the one named, else the document's default) and values params; then place
 * (points, frames, runs, pivots, pattern copies), ends (two sweeps, modifiers, lengths) and
 * attach (stage 4). It never throws on document content: problems are diagnostics, and an
 * entity that cannot resolve is left out while the rest derives (§5.1).
 */

/**
 * A hole on a bar (§4.4): one a person adds in `ops`, or one stage 4 generates (§5.1), valued:
 * along the axis from the named design point.
 */
export interface HoleOp {
  op: "hole";
  face: Face;
  from: "a" | "b";
  at: number;
  /** Across the face from its centre line, in §4.3's u (generated holes only). */
  across?: number;
  d?: number;
  thread?: string;
  depth?: number;
  csk?: { d: number; angle: number };
  cbore?: { d: number; depth: number };
  /** The connection that generated it. */
  by?: string;
}

/** A tapped hole in a bar's end, along its axis: a splice stud's, an end connector's (§5.1). */
export interface EndTapOp {
  op: "end-tap";
  from: "a" | "b";
  thread: string;
  depth?: number;
  by: string;
}

/**
 * A hole into a bar's end face, along its axis (acceptance gap A4): one a connector `requires` in
 * the through bar of a butt that bears on that end (§4.5, G17). It stands where the butting bar's
 * centre line, moved by the spacer, meets the end face: `off` from the section's box centre, in
 * the section's x and y. Drilled `d` or tapped `thread`; `depth` along the axis, else through.
 */
export interface EndHoleOp {
  op: "end-hole";
  from: "a" | "b";
  /** In the section's x and y, from its box centre; absent at the centre. */
  off?: readonly [number, number];
  d?: number;
  thread?: string;
  depth?: number;
  by: string;
}

export type ResolvedOp = HoleOp | EndTapOp | EndHoleOp;

export interface DerivedBar {
  placed: PlacedBar;
  lengths: BarLengths;
  ends: { a: EndReport; b: EndReport };
  /** The holes a person wrote, then the machining stage 4 generates (§5.1). */
  ops: ResolvedOp[];
  /** A rail's hole layout (§4.7). */
  rail?: RailLayout;
}

export interface Derived {
  /** The document the variant builds, parsed. */
  doc: Doc;
  /** The variant derived (§4.10); undefined for the document as written. */
  variant?: string;
  params: ReadonlyMap<string, number>;
  nodes: ReadonlyMap<string, V3>;
  /** Placed bars whose ends resolved, in id order. */
  bars: ReadonlyMap<string, DerivedBar>;
  runs: ReadonlyMap<string, PlacedRun>;
  pivots: ReadonlyMap<string, PlacedPivot>;
  faces: ReadonlyMap<string, EndFace>;
  /** Parts, placed or counted only (§4.7), in id order. */
  parts: ReadonlyMap<string, DerivedPart>;
  /** Face connections' contacts and fastenings (§4.5), in id order. */
  fastenings: ReadonlyMap<string, FaceResult>;
  /** Fasteners and sleeves cut from bar stock (§4.5): the cut list nests them with the bars. */
  pieces: readonly StockPiece[];
  /** Every counted item that is not a bar or a part: connectors, fastener sets, stacks (§5.4). */
  hardware: readonly HardwareUse[];
  /**
   * The joint recipes the connections use (§3.4, acceptance gap A2): connectors with no body,
   * whose fasteners and machining are in `hardware`, `pieces` and the bars' ops. Not bought.
   */
  recipes: readonly HardwareUse[];
  diagnostics: Diagnostic[];
}

function sortedKeys<T>(m: ReadonlyMap<string, T>): string[] {
  return [...m.keys()].sort(compareIds);
}

export interface DeriveOptions {
  /** The variant to derive; absent: the document's default variant, if it names one. */
  variant?: string;
}

export function derive(raw: unknown, items: ItemSource, opts: DeriveOptions = {}): Derived {
  // Stage 1: the variant (§4.10) and the document it builds; the items it reads, the catalogs'
  // and the document's own (§4.8); then params in dependency order.
  const v = applyVariant(raw, items, opts.variant);
  const parsed = parseProject(v.raw);
  const own = projectItems(items, parsed.doc);
  const ctx = new Ctx(parsed.doc, own.source);
  for (const d of parsed.diagnostics) ctx.d.add(d);
  for (const d of own.diagnostics) ctx.d.add(d);
  for (const d of v.diagnostics) ctx.d.add(d);

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

  // Stage 4: rail holes, parts, face contacts and fastenings, generated machining, hardware.
  const gen = attach(ctx, bars, runs);

  return {
    doc: ctx.doc,
    ...(v.variant !== undefined ? { variant: v.variant } : {}),
    params,
    nodes,
    bars,
    runs,
    pivots,
    faces: s3.faces,
    parts: gen.parts,
    fastenings: gen.fastenings,
    pieces: gen.pieces,
    hardware: gen.hardware,
    recipes: gen.recipes,
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
