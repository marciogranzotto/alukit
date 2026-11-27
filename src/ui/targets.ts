import type { Ref } from "#core/problems/types.ts";
import { barCorners } from "../mesh/bars.ts";
import { applyMatrix } from "../mesh/data.ts";
import type { V3 } from "../mesh/model.ts";
import { partShape } from "../mesh/place.ts";
import { cornerKey, cornersOf } from "./corners.ts";
import type { Model } from "./model.ts";

/**
 * What a list of refs stands for (docs/ux/plan.md §5.3), in two ways. `ids` are the entities the
 * refs name: what Show selects (src/ui/focus.ts), what a filter by the selection matches, what
 * the callout steps through. `bodies` are what draws them in the scene: what the view tints on a
 * hover, pulses, keeps out of the ghost and badges. Then the points to anchor a callout at and
 * the box to frame. Pure. Owner: S3.
 *
 * - an entity → itself; its bodies: a bar or a part itself; a connection itself (its fasteners
 *   are drawn under its id) and its bars; a run its bars; a pattern its template and copies; a
 *   node none (a point);
 * - a part of an entity (`c23.f1`) → the entity; a bar's end (`b9.b`) → its bar, at the end;
 * - a corner (`corner:<key>`) → the corner, which the selection holds; its bodies: its bars;
 * - an item (`forseti:PF40-01`, `project:plate-a`) → what uses it: its BOM lines' sources;
 * - an open item (`O1`) → its scope;
 * - a supplier (`supplier:<id>`) → the sources of its lines' items, given the order (`ctx`);
 * - no refs at all (a check with no entity) → the whole model: no ids, the model's box.
 *
 * Ids and bodies come in the order the refs give them, each once. Points are world points (Z up,
 * mm), the first ref's first: a bar's middle, an end's point, a part's origin, a fastener's head,
 * a corner's or a node's point. The box holds every body and point.
 */

export interface Targets {
  ids: string[];
  bodies: string[];
  points: V3[];
  box?: [V3, V3];
}

/** What else may resolve refs: the order answer, for suppliers' lines. */
export interface TargetContext {
  order?: { suppliers?: readonly { supplier: string; lines: readonly { item: string }[] }[] };
}

/** The kinds of document entity a ref may name, as the outline lists them. */
const ENTITY_KINDS = ["bars", "runs", "connections", "parts", "patterns", "nodes"] as const;

/** How deep refs may lead to refs (an open item's scope names an item, whose sources...). */
const DEPTH = 4;

const SUPPLIER = "supplier:";

/** The derived butts and pivots, which the view model carries beyond `Model`'s typed fields. */
interface Extra {
  butts?: Record<string, { ends: { end: string; on: string }[] }>;
  pivots?: Record<string, unknown>;
}

interface Written {
  ends?: unknown;
  through?: unknown;
  bars?: unknown;
  base?: { bar?: unknown };
}

function written(m: Model, kind: (typeof ENTITY_KINDS)[number]): Record<string, unknown> {
  const w = m.doc?.[kind];
  return typeof w === "object" && w !== null ? (w as Record<string, unknown>) : {};
}

/**
 * Whether an id is an entity of the model: written, or derived (a copy too). A connection's copy
 * (`c26@1`) is written nowhere: the derived butts, pivots and fastenings name it, and so do the
 * bar ends it claims.
 */
function isEntity(m: Model, id: string): boolean {
  const d = m.derived as (Model["derived"] & Extra) | undefined;
  return (
    id in (d?.bars ?? {}) ||
    id in (d?.parts ?? {}) ||
    ENTITY_KINDS.some((k) => id in written(m, k)) ||
    id in (d?.butts ?? {}) ||
    id in (d?.pivots ?? {}) ||
    id in (d?.fastenings ?? {}) ||
    Object.values(d?.bars ?? {}).some((b) => b.ends?.a.by === id || b.ends?.b.by === id)
  );
}

const strings = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];

const barOf = (ref: string) => ref.split(".")[0] as string;

export function resolveTargets(m: Model, refs: readonly Ref[], ctx: TargetContext = {}): Targets {
  const ids: string[] = [];
  const bodies: string[] = [];
  const seen = { ids: new Set<string>(), bodies: new Set<string>() };
  const points: V3[] = [];
  const bars = m.derived?.bars ?? {};
  const parts = m.derived?.parts ?? {};
  let corners: ReturnType<typeof cornersOf> | undefined;

  const add = (id: string) => {
    if (seen.ids.has(id)) return;
    seen.ids.add(id);
    ids.push(id);
  };
  const draw = (id: string) => {
    if (seen.bodies.has(id)) return;
    seen.bodies.add(id);
    bodies.push(id);
  };
  const middle = (id: string): V3 | undefined => {
    const b = bars[id];
    return b?.a && [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2, (b.a[2] + b.b[2]) / 2];
  };

  /** A connection's bars: what the written spec names, and what the derived ends say. */
  const connectionBars = (id: string): string[] => {
    const out: string[] = [];
    const spec = written(m, "connections")[id] as Written | undefined;
    if (spec) {
      out.push(...strings(spec.ends).map(barOf));
      if (typeof spec.through === "string") out.push(barOf(spec.through));
      for (const b of strings(spec.bars)) {
        const run = m.derived?.runs?.[b];
        out.push(...(run ? run.bars : [b]));
      }
      if (typeof spec.base?.bar === "string") out.push(spec.base.bar);
    }
    const butt = (m.derived as Extra | undefined)?.butts?.[id];
    for (const e of butt?.ends ?? []) out.push(barOf(e.end), barOf(e.on.split(" ")[0] as string));
    for (const [bid, b] of Object.entries(bars)) {
      if (b.ends?.a.by === id || b.ends?.b.by === id) out.push(bid);
    }
    return out.filter((b) => b in bars);
  };

  const resolve = (ref: Ref, depth: number): void => {
    if (depth > DEPTH) return;
    const key = cornerKey(ref);
    if (key !== undefined) {
      corners ??= cornersOf(m);
      const c = corners.find((x) => x.key === key);
      if (!c) return;
      add(ref);
      points.push(c.at);
      for (const b of c.bars) draw(b);
      return;
    }
    if (ref.startsWith(SUPPLIER)) {
      const s = ctx.order?.suppliers?.find((x) => x.supplier === ref.slice(SUPPLIER.length));
      for (const l of s?.lines ?? []) resolve(l.item, depth + 1);
      return;
    }
    const open = Array.isArray(m.doc?.open)
      ? (m.doc.open as { id?: unknown; scope?: unknown }[]).find((o) => o.id === ref)
      : undefined;
    if (open) {
      for (const r of strings(open.scope)) resolve(r, depth + 1);
      return;
    }
    const id = barOf(ref);
    if (!isEntity(m, id)) {
      // An item: what uses it, from the BOM's lines and recipes.
      const sources = [
        ...(m.bom?.groups ?? []).flatMap((g) => g.lines.filter((l) => l.item === ref)),
        ...(m.bom?.recipes ?? []).filter((r) => r.item === ref),
      ].flatMap((l) => l.sources);
      for (const s of sources) resolve(s, depth + 1);
      return;
    }
    add(id);
    const end = ref.slice(id.length);
    const bar = bars[id];
    if (bar) {
      draw(id);
      const p =
        end === ".a" || end === ".b" ? bar.ends?.[end === ".a" ? "a" : "b"].point : middle(id);
      if (p) points.push(p);
      return;
    }
    const part = parts[id];
    if (part) {
      draw(id);
      const p = part.origin ?? part.point;
      if (p) points.push(p);
      return;
    }
    const node = m.derived?.nodes?.[id];
    if (node) {
      points.push(node);
      return;
    }
    const run = m.derived?.runs?.[id];
    if (run) {
      for (const b of run.bars) draw(b);
      const p = middle(run.bars[0] as string);
      if (p) points.push(p);
      return;
    }
    const pattern = written(m, "patterns")[id] as { template?: unknown } | undefined;
    if (pattern) {
      const copies = [...Object.entries(bars), ...Object.entries(parts)]
        .filter(([, x]) => x.pattern === id)
        .map(([cid]) => cid);
      for (const t of [...strings(pattern.template), ...copies]) if (isEntity(m, t)) draw(t);
      return;
    }
    // A connection: itself (its fasteners) and its bars, and where it is: its first fastener's
    // head, else its first end.
    const cbars = connectionBars(id);
    draw(id);
    for (const b of cbars) draw(b);
    const fastener = (m.display?.fasteners ?? []).find((f) => f.connection === id);
    const first = bars[cbars[0] as string];
    if (fastener) points.push(fastener.head);
    else if (first?.ends) {
      const which = first.ends.a.by === id ? "a" : first.ends.b.by === id ? "b" : undefined;
      points.push(which ? first.ends[which].point : (middle(cbars[0] as string) as V3));
    }
  };

  for (const r of refs) resolve(r, 0);
  const box = boxOf(m, refs.length === 0 ? undefined : bodies, points);
  return { ids, bodies, points, ...(box ? { box } : {}) };
}

/**
 * The box of some entities' bodies and of some points, in world coordinates: bars by their
 * bodies' corners, parts by their placed boxes, a connection by its fasteners. Every body when
 * `ids` is undefined.
 */
export function boxOf(
  m: Model,
  ids: readonly string[] | undefined,
  points: readonly V3[] = [],
): [V3, V3] | undefined {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const grow = (p: V3) => {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i] as number, p[i] as number);
      hi[i] = Math.max(hi[i] as number, p[i] as number);
    }
  };
  const bars = m.derived?.bars ?? {};
  const parts = m.derived?.parts ?? {};
  const wanted = ids ? new Set(ids) : undefined;
  const has = (id: string) => wanted === undefined || wanted.has(id);
  for (const [id, b] of Object.entries(bars)) {
    if (!has(id)) continue;
    const view = m.display?.bars[id];
    const section = view ? m.display.sections[view.section] : undefined;
    if (view && section) for (const c of barCorners(b, section, view)) grow(c);
    else if (b.a) {
      grow(b.a);
      grow(b.b);
    }
  }
  for (const [id, p] of Object.entries(parts)) {
    if (!has(id)) continue;
    const placed = partShape(p, m.display?.parts[id]);
    if (!placed) continue;
    const [a, z] = placed.box;
    for (const x of [a[0], z[0]])
      for (const y of [a[1], z[1]])
        for (const w of [a[2], z[2]]) grow(applyMatrix(placed.matrix, [x, y, w]));
  }
  for (const f of m.display?.fasteners ?? []) {
    if (!has(f.connection)) continue;
    grow(f.head);
    grow([
      f.head[0] + f.axis[0] * f.len,
      f.head[1] + f.axis[1] * f.len,
      f.head[2] + f.axis[2] * f.len,
    ]);
  }
  for (const p of points) grow(p);
  if (!((lo[0] as number) <= (hi[0] as number))) return undefined;
  return [lo as unknown as V3, hi as unknown as V3];
}
