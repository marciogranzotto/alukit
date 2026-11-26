import type { Item } from "#catalog/schema/items.ts";
import { compareIds } from "../ids.ts";
import { fullRef } from "../items.ts";
import type { Part, Station } from "../project/schema.ts";
import { snapInt } from "../quantum.ts";
import { cosDeg, sinDeg } from "../trig.ts";
import { add, cross, scale, sub, type V3 } from "../vec.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar } from "./derive.ts";
import { poseAxes, resolvePoint, resolveStation } from "./place.ts";
import { selectHoles } from "./rails.ts";
import type { Copy, DerivedPart, PlacedPart, PlacedRun, UnplacedPart } from "./types.ts";

/**
 * Parts (design §4.7), in stage 4 since a part may measure from a cut end and may stand at a
 * rail's holes. A part's own frame (§3.2: +z away from the face it mounts on, +x along the bar)
 * is laid on its station: +z along the face's outward normal, +x along the bar's axis, +y = z × x;
 * `roll_deg` turns it about z; its `mount` datum lands on the station, a carriage's `run` datum
 * instead, and an item with neither lands its origin. A station with no face lays +z along the
 * bar's local y. At a world pose the frame turns by `rot_deg` and the same datum lands at `pos`.
 * Unplaced entries are counted, never drawn.
 */

export function placeParts(
  ctx: Ctx,
  bars: ReadonlyMap<string, DerivedBar>,
  runs: ReadonlyMap<string, PlacedRun>,
): Map<string, DerivedPart> {
  const out = new Map<string, DerivedPart>();
  const atHoles = new Set<string>();
  for (const rp of ctx.railPatterns.values()) for (const t of rp.template) atHoles.add(t);

  for (const id of [...ctx.parts.keys()].sort(compareIds)) {
    if (atHoles.has(id)) continue;
    const ent = ctx.parts.get(id);
    if (!ent) continue;
    const p = placePart(ctx, id, ent.spec, ent.copy, bars, runs);
    if (p) out.set(id, p);
  }

  for (const [pid, rp] of [...ctx.railPatterns].sort(([a], [b]) => compareIds(a, b))) {
    const holes = selectHoles(ctx, pid, "rail_holes", rp.sel, rp.along, bars, runs);
    if (!holes) continue;
    for (const tid of rp.template) {
      const spec = ctx.doc.parts[tid];
      if (!spec || !("on" in spec)) continue;
      const offset = ctx.num(tid, "on/at_mm", spec.on.at_mm);
      if (offset === undefined) continue;
      holes.forEach((h, k) => {
        if (k > 0 && rp.skip.has(k)) return;
        const id = k === 0 ? tid : `${tid}@${k}`;
        const on: Station = { ...spec.on, at_mm: h.r + offset, from: "a" };
        const p = placePart(ctx, id, { ...spec, on }, undefined, bars, runs, pid);
        if (p) out.set(id, p);
      });
    }
  }
  return new Map([...out].sort(([a], [b]) => compareIds(a, b)));
}

function partOptions(
  ctx: Ctx,
  id: string,
  ref: string,
  item: Item,
  own: Readonly<Record<string, string>> | undefined,
  report: boolean,
): Record<string, string> {
  const opts = item.options ?? {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(own ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    out[name] = value;
    if (!report) continue;
    const values = opts[name];
    if (values === undefined) {
      ctx.d.error("option", id, `${ref} has no option "${name}"`, { field: `opt/${name}` });
    } else if (!values.includes(value)) {
      ctx.d.error("option", id, `${name} "${value}" is not one of ${ref}'s: ${values.join(", ")}`, {
        field: `opt/${name}`,
      });
    }
  }
  return out;
}

function placePart(
  ctx: Ctx,
  id: string,
  spec: Part,
  copy: Copy | undefined,
  bars: ReadonlyMap<string, DerivedBar>,
  runs: ReadonlyMap<string, PlacedRun>,
  railPattern?: string,
): DerivedPart | undefined {
  const { d } = ctx;
  const report = copy === undefined && (railPattern === undefined || !id.includes("@"));
  const found = ctx.items.item(spec.item);
  if (!found.ok) {
    if (report) d.error("item", id, found.message, { field: "item" });
    return undefined;
  }
  const item = found.item;
  const base = {
    id,
    item: found.id,
    kind: item.kind,
    opt: partOptions(ctx, id, spec.item, item, spec.opt, report),
  };

  if ("unplaced" in spec) {
    const q = ctx.num(id, "qty", spec.qty);
    if (q === undefined) return undefined;
    const n = snapInt(q);
    if (!Number.isInteger(n) || n < 1) {
      d.error("part", id, `qty is ${q}: an unplaced line counts whole units, at least 1`, {
        field: "qty",
      });
      return undefined;
    }
    const out: UnplacedPart = { placed: false, ...base, qty: n, why: spec.why };
    return out;
  }

  const withDatums = item as Item & { datums?: Record<string, V3> };
  const datumName =
    item.kind === "carriage" ? "run" : withDatums.datums?.mount !== undefined ? "mount" : "origin";
  const datum: V3 = withDatums.datums?.[datumName] ?? [0, 0, 0];

  let point: V3;
  let axes: [V3, V3, V3];
  let onBar: { bar: string; s: number } | undefined;
  if ("at" in spec) {
    const pos = resolvePoint(ctx, spec.at.pos, { id, field: "at/pos", copy });
    if (!pos) return undefined;
    const rot = spec.at.rot_deg ? ctx.vec(id, "at/rot_deg", spec.at.rot_deg) : [0, 0, 0];
    if (!rot) return undefined;
    point = pos;
    axes = poseAxes(rot as V3);
  } else {
    const st = stationFromCut(ctx, id, spec.on, bars, runs);
    if (!st) return undefined;
    const sp = resolveStation(ctx, st, { id, field: "on", copy });
    if (!sp) return undefined;
    const x0 = sp.bar.frame.t;
    const z = sp.normal ?? sp.bar.frame.y;
    const y0 = cross(z, x0);
    const roll = spec.roll_deg === undefined ? 0 : (ctx.num(id, "roll_deg", spec.roll_deg) ?? 0);
    const c = cosDeg(roll);
    const s = sinDeg(roll);
    const x = add(scale(x0, c), scale(y0, s));
    const y = sub(scale(y0, c), scale(x0, s));
    point = sp.point;
    axes = [x, y, z];
    onBar = { bar: sp.bar.id, s: sp.s };
    fitCarriage(ctx, id, item, found.id, bars.get(sp.bar.id), report);
  }
  const [X, Y, Z] = axes;
  const origin = sub(point, add(add(scale(X, datum[0]), scale(Y, datum[1])), scale(Z, datum[2])));
  const pattern = railPattern ?? copy?.pattern;
  const out: PlacedPart = {
    placed: true,
    ...base,
    ...(onBar ?? {}),
    datum: datumName,
    point,
    frame: { x: X, y: Y, z: Z },
    origin,
    ...(pattern ? { pattern } : {}),
  };
  return out;
}

/**
 * A station measured from a cut end (§4.3: parts may) becomes one measured from design point a:
 * the cut is where the end face crosses the design line, as for a free end counted from a cut.
 */
function stationFromCut(
  ctx: Ctx,
  id: string,
  st: Station,
  bars: ReadonlyMap<string, DerivedBar>,
  runs: ReadonlyMap<string, PlacedRun>,
): Station | undefined {
  if (st.from !== "a.cut" && st.from !== "b.cut") return st;
  const at = ctx.num(id, "on/at_mm", st.at_mm);
  if (at === undefined) return undefined;
  let first: DerivedBar | undefined;
  let last: DerivedBar | undefined;
  let lastStart = 0;
  if (st.bar.startsWith("r")) {
    const run = runs.get(st.bar);
    first = run && bars.get((run.bars[0] as { id: string }).id);
    last = run && bars.get((run.bars[run.bars.length - 1] as { id: string }).id);
    lastStart = run ? (run.starts[run.starts.length - 1] as number) : 0;
  } else {
    first = bars.get(st.bar);
    last = first;
  }
  if (!first || !last) {
    ctx.depFailed(id, "on", st.bar);
    return undefined;
  }
  const s = st.from === "a.cut" ? first.lengths.sa + at : lastStart + last.lengths.sb - at;
  return { ...st, at_mm: s, from: "a" };
}

/** A carriage stands on a rail of its rail system (§5.5, Fit). */
function fitCarriage(
  ctx: Ctx,
  id: string,
  item: Item,
  itemId: string,
  bar: DerivedBar | undefined,
  report: boolean,
): void {
  if (item.kind !== "carriage" || !report || !bar) return;
  const want = fullRef(item.rail_system, itemId.slice(0, itemId.indexOf(":")));
  const have = bar.placed.item.system;
  if (have !== want) {
    ctx.d.error(
      "fit",
      id,
      `${itemId} runs on ${want}; ${bar.placed.id} is ${have ? `a ${have}` : "not a rail"}`,
      { refs: [bar.placed.id] },
    );
  }
}
