import {
  type Bar,
  type Face,
  type FreeEnd,
  isPose,
  type Point,
  type Pose,
  type Station,
} from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { cosDeg, reduceDeg, sinDeg } from "../trig.ts";
import {
  AXIS,
  add,
  addScaled,
  angleDeg,
  cross,
  dist,
  dot,
  norm,
  scale,
  sub,
  unit,
  type V3,
} from "../vec.ts";
import type { Ctx } from "./context.ts";
import type {
  Box,
  Copy,
  Frame,
  PlacedBar,
  PlacedPivot,
  PlacedRun,
  Prism,
  StationPoint,
} from "./types.ts";

/**
 * Stage 2 (design §5.1): points, bar frames and placed sections, runs, pivot points and pattern
 * copies, in dependency order. Everything here depends only on design points and placements,
 * never on a cut (§4.3), so it never iterates.
 */

/** Who asks for a point: an entity, possibly a pattern copy, and the field being resolved. */
export interface Owner {
  id: string;
  field: string;
  copy?: Copy | undefined;
}

// ---------------------------------------------------------------------------------------------
// Frames (design §4.4)

/**
 * A bar's frame from its direction `d = B − A`: t along the bar; y is `up` (or world +Z, or +Y
 * for a vertical bar) with its t component removed; x = y × t; then roll about t,
 * counter-clockwise seen from B looking toward A, exact at multiples of 90°.
 */
export function barFrame(
  d: V3,
  up: V3 | undefined,
  rollDeg: number,
): { frame: Frame; vertical: boolean; nearVertical: boolean } | { problem: string } {
  const len = norm(d);
  const t = unit(d);
  if (!t || len < TOL.len) return { problem: "zero-length" };
  const horizontal = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
  const vertical = horizontal < TOL.vert * len;
  const nearVertical = !vertical && horizontal < TOL.nearVert * len;
  let u: V3 = vertical ? AXIS["+y"] : AXIS["+z"];
  if (up) {
    const uu = unit(up);
    if (!uu) return { problem: "up-parallel" };
    const a = angleDeg(uu, t);
    if (a < TOL.ang || a > 180 - TOL.ang) return { problem: "up-parallel" };
    u = uu;
  }
  const y0 = unit(sub(u, scale(t, dot(u, t)))) as V3;
  const x0 = cross(y0, t);
  const r = reduceDeg(rollDeg);
  const c = cosDeg(r);
  const s = sinDeg(r);
  const x: V3 =
    r === 0 ? x0 : [x0[0] * c + y0[0] * s, x0[1] * c + y0[1] * s, x0[2] * c + y0[2] * s];
  const y: V3 =
    r === 0 ? y0 : [y0[0] * c - x0[0] * s, y0[1] * c - x0[1] * s, y0[2] * c - x0[2] * s];
  return { frame: { t, x, y }, vertical, nearVertical };
}

/** The anchor's point in section coordinates (§4.4). */
function anchorPoint(
  name: string,
  bbox: readonly [readonly [number, number], readonly [number, number]],
  datums: Readonly<Record<string, readonly [number, number]>>,
): readonly [number, number] | undefined {
  const [[x0, y0], [x1, y1]] = bbox;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (name === "c") return [cx, cy];
  const m = /^([+-][xy])([+-][xy])?$/.exec(name);
  if (m) {
    let x = cx;
    let y = cy;
    const parts = [m[1], m[2]].filter((p): p is string => p !== undefined);
    if (parts.length === 2 && parts[0]?.[1] === parts[1]?.[1]) return undefined; // "+x-x"
    for (const p of parts) {
      if (p === "+x") x = x1;
      else if (p === "-x") x = x0;
      else if (p === "+y") y = y1;
      else y = y0;
    }
    return [x, y];
  }
  return datums[name];
}

/** The local x, y (relative to the design line) of a point of the placed section. */
export function localOf(bar: PlacedBar, sx: number, sy: number): [number, number] {
  return [sx - bar.anchor[0] + bar.off[0], sy - bar.anchor[1] + bar.off[1]];
}

/** A point on the bar's design line at `s` from A, moved by local (lx, ly). */
export function onBar(bar: PlacedBar, s: number, lx = 0, ly = 0): V3 {
  const { t, x, y } = bar.frame;
  return addScaled(addScaled(addScaled(bar.A, t, s), x, lx), y, ly);
}

export function boxCentre(b: Box): [number, number] {
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
}

/** A point on the bar's bounding-box centre line, and the axis (§4.5). */
export function centreLine(bar: PlacedBar): { C: V3; t: V3 } {
  const [cx, cy] = boxCentre(bar.box);
  return { C: onBar(bar, 0, cx, cy), t: bar.frame.t };
}

/** The bar's infinite prism: its placed bounding box swept along the axis (§4.5). */
export function barPrism(bar: PlacedBar): Prism {
  const { x, y } = bar.frame;
  return {
    owner: bar.id,
    slabs: [
      { n: x, origin: bar.A, lo: bar.box.x0, hi: bar.box.x1, faces: ["-x", "+x"] },
      { n: y, origin: bar.A, lo: bar.box.y0, hi: bar.box.y1, faces: ["-y", "+y"] },
    ],
  };
}

/** The plane of a face of the placed bounding box, with the face's outward normal. */
export function facePlane(bar: PlacedBar, face: Face): { p: V3; n: V3 } {
  const { x, y } = bar.frame;
  switch (face) {
    case "+x":
      return { p: addScaled(bar.A, x, bar.box.x1), n: x };
    case "-x":
      return { p: addScaled(bar.A, x, bar.box.x0), n: scale(x, -1) };
    case "+y":
      return { p: addScaled(bar.A, y, bar.box.y1), n: y };
    case "-y":
      return { p: addScaled(bar.A, y, bar.box.y0), n: scale(y, -1) };
  }
}

// ---------------------------------------------------------------------------------------------
// Bars

export function placeBar(ctx: Ctx, id: string): PlacedBar | undefined {
  return ctx.memo(ctx.placedBars, id, () => computeBar(ctx, id));
}

function isFreeEnd(b: Bar["b"]): b is FreeEnd {
  return typeof b === "object" && !Array.isArray(b) && "len_mm" in b;
}

function computeBar(ctx: Ctx, id: string): PlacedBar | undefined {
  const ent = ctx.bars.get(id);
  if (!ent) return undefined;
  const { spec, copy } = ent;
  const { d } = ctx;

  const ref = spec.item ?? ctx.doc.defaults.bar?.item;
  if (!ref) {
    d.error("item", id, "the bar names no item, and defaults.bar.item is not set", {
      field: "item",
    });
    return undefined;
  }
  const found = ctx.items.item(ref);
  if (!found.ok) {
    d.error("item", id, found.message, { field: "item" });
    return undefined;
  }
  if (!found.bar) {
    d.error("item", id, `${ref} is a ${found.item.kind}, not a bar`, { field: "item" });
    return undefined;
  }
  const item = found.bar;
  const opt = barOptions(spec.opt, ctx.doc.defaults.bar?.opt, item.options);

  const A = resolvePoint(ctx, spec.a, { id, field: "a", copy });
  if (!A) return undefined;

  let B: V3 | undefined;
  let dvec: V3;
  let free: PlacedBar["free"];
  if (isFreeEnd(spec.b)) {
    const dirRaw = ctx.dir(id, "b/dir", spec.b.dir);
    const len = ctx.num(id, "b/len_mm", spec.b.len_mm);
    if (!dirRaw || len === undefined) return undefined;
    const dir = unit(dirRaw);
    if (!dir) {
      d.error("zero-length", id, "b/dir is a zero vector", { field: "b/dir" });
      return undefined;
    }
    const fromCut = spec.b.from === "a.cut";
    free = { len, dir, fromCut };
    dvec = scale(dir, len);
    if (len < TOL.len) {
      d.error("zero-length", id, `the free end's length ${len} is below ${TOL.len} mm`, {
        field: "b/len_mm",
      });
      return undefined;
    }
    if (!fromCut) B = addScaled(A, dir, len);
  } else {
    B = resolvePoint(ctx, spec.b, { id, field: "b", copy });
    if (!B) return undefined;
    dvec = sub(B, A);
  }

  let up: V3 | undefined;
  if (spec.up !== undefined) up = ctx.dir(id, "up", spec.up);
  const roll = spec.roll_deg === undefined ? 0 : (ctx.num(id, "roll_deg", spec.roll_deg) ?? 0);

  let fr = barFrame(dvec, up, roll);
  if ("problem" in fr && fr.problem === "up-parallel") {
    d.error("up-parallel", id, "up is parallel to the bar's axis; the default up is used", {
      field: "up",
    });
    fr = barFrame(dvec, undefined, roll);
  }
  if ("problem" in fr) {
    d.error("zero-length", id, `the bar is shorter than ${TOL.len} mm`, { field: "b" });
    return undefined;
  }
  if (fr.nearVertical && spec.up === undefined) {
    d.warn("near-vertical", id, "a near-vertical bar without `up`: its frame flips easily", {
      field: "up",
    });
  }

  const section = item.section;
  const anchorName = spec.anchor ?? "c";
  let anchor = anchorPoint(anchorName, section.bbox_mm, section.datums);
  if (!anchor) {
    d.error("anchor", id, `no anchor "${anchorName}" on section ${item.sectionId}; using c`, {
      field: "anchor",
    });
    anchor = anchorPoint("c", section.bbox_mm, section.datums) as [number, number];
  }
  let off: [number, number] = [0, 0];
  if (spec.off_mm) {
    const ox = ctx.num(id, "off_mm[0]", spec.off_mm[0]);
    const oy = ctx.num(id, "off_mm[1]", spec.off_mm[1]);
    off = [ox ?? 0, oy ?? 0];
  }
  const [[bx0, by0], [bx1, by1]] = section.bbox_mm;
  const box: Box = {
    x0: bx0 - anchor[0] + off[0],
    x1: bx1 - anchor[0] + off[0],
    y0: by0 - anchor[1] + off[1],
    y1: by1 - anchor[1] + off[1],
  };
  return {
    id,
    item,
    opt,
    A,
    B,
    frame: fr.frame,
    box,
    anchor,
    off,
    ...(free ? { free } : {}),
    ...(copy ? { copy } : {}),
  };
}

/** A bar's options: its own, else the defaults' for the option names its item has. */
function barOptions(
  own: Readonly<Record<string, string>> | undefined,
  defaults: Readonly<Record<string, string>> | undefined,
  itemOptions: Readonly<Record<string, readonly string[]>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(itemOptions).sort()) {
    const v = own?.[name] ?? defaults?.[name];
    if (v !== undefined) out[name] = v;
  }
  for (const [k, v] of Object.entries(own ?? {})) if (!(k in out)) out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Points

/** The translation of a pattern copy (design §4.7), or undefined while its axis is unknown. */
export function copyShift(ctx: Ctx, copy: Copy, owner: string): V3 | undefined {
  if (copy.dir) return scale(copy.dir, copy.step);
  const along = copy.along as string;
  let t: V3 | undefined;
  if (along.startsWith("r")) t = placeRun(ctx, along)?.t;
  else t = placeBar(ctx, along)?.frame.t;
  if (!t) {
    ctx.depFailed(owner, `pattern ${copy.pattern}`, along);
    return undefined;
  }
  return scale(t, copy.step);
}

export function resolvePoint(ctx: Ctx, p: Point, owner: Owner): V3 | undefined {
  if (typeof p === "string") {
    const v = placeNode(ctx, p, owner);
    return v;
  }
  if (Array.isArray(p)) {
    const v = ctx.vec(owner.id, owner.field, p);
    if (!v) return undefined;
    if (!owner.copy) return v;
    const shift = copyShift(ctx, owner.copy, owner.id);
    return shift && add(v, shift);
  }
  if ("on" in p) {
    return resolveStation(ctx, p.on, { ...owner, field: `${owner.field}/on` })?.point;
  }
  const pv = placePivot(ctx, p.pivot);
  if (!pv) {
    if (!ctx.conns.has(p.pivot)) {
      ctx.d.error("ref", owner.id, `${owner.field}: no connection ${p.pivot}`, {
        field: owner.field,
        refs: [p.pivot],
      });
    } else ctx.depFailed(owner.id, owner.field, p.pivot);
    return undefined;
  }
  return pv.P;
}

function placeNode(ctx: Ctx, id: string, owner: Owner): V3 | undefined {
  if (!ctx.nodes.has(id)) {
    ctx.d.error("ref", owner.id, `${owner.field}: no node ${id}`, {
      field: owner.field,
      refs: [id],
    });
    return undefined;
  }
  const v = nodePoint(ctx, id);
  if (!v) ctx.depFailed(owner.id, owner.field, id);
  return v;
}

/** A node's point (§4.3), resolved once. */
export function nodePoint(ctx: Ctx, id: string): V3 | undefined {
  const ent = ctx.nodes.get(id);
  if (!ent) return undefined;
  return ctx.memo(ctx.placedNodes, id, () => {
    const { spec, copy } = ent;
    const me: Owner = { id, field: "point", copy };
    if (Array.isArray(spec)) return resolvePoint(ctx, spec as Point, me);
    if ("at" in spec) return resolvePoint(ctx, spec.at, me);
    if ("on" in spec) return resolvePoint(ctx, { on: spec.on }, me);
    return resolvePoint(ctx, { pivot: spec.pivot }, me);
  });
}

/** Resolves a station (§4.3). Points that other bars depend on may not measure from a cut. */
export function resolveStation(ctx: Ctx, st: Station, owner: Owner): StationPoint | undefined {
  const { d } = ctx;
  const field = owner.field;
  let at = ctx.num(owner.id, `${field}/at_mm`, st.at_mm);
  if (at === undefined) return undefined;
  const from = st.from ?? "a";
  if (from === "a.cut" || from === "b.cut") {
    d.error(
      "station",
      owner.id,
      `${field}: a point other bars depend on measures from a design point, not from "${from}"`,
      { field: `${field}/from` },
    );
    return undefined;
  }

  // A pattern copy: a station on the bar or run it moves along slides along it; any other
  // station outside the template is translated. One inside the template names the copy's bar.
  const copy = owner.copy;
  const inside = st.bar.includes("@");
  let shift: V3 | undefined;
  if (copy && !inside) {
    if (copy.along === st.bar) at += from === "a" ? copy.step : -copy.step;
    else {
      shift = copyShift(ctx, copy, owner.id);
      if (!shift) return undefined;
    }
  }

  let bar: PlacedBar | undefined;
  let s: number;
  if (st.bar.startsWith("r")) {
    const run = placeRun(ctx, st.bar);
    if (!run) {
      if (!Object.hasOwn(ctx.doc.runs, st.bar)) {
        d.error("ref", owner.id, `${field}: no run ${st.bar}`, { field, refs: [st.bar] });
      } else ctx.depFailed(owner.id, field, st.bar);
      return undefined;
    }
    const sr = from === "a" ? at : run.len - at;
    const n = run.bars.length;
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(sr - (run.ends[i] as number)) <= TOL.len) {
        d.error(
          "joint",
          owner.id,
          `${field}: the station is on ${run.id}'s joint between ${run.bars[i]?.id} and ${run.bars[i + 1]?.id}; name the piece instead`,
          { field, refs: [run.id] },
        );
        return undefined;
      }
    }
    let i = 0;
    while (i < n - 1 && sr > (run.ends[i] as number)) i++;
    bar = run.bars[i] as PlacedBar;
    s = sr - (run.starts[i] as number);
  } else {
    bar = placeBar(ctx, st.bar);
    if (!bar) {
      if (!ctx.bars.has(st.bar)) {
        d.error("ref", owner.id, `${field}: no bar ${st.bar}`, { field, refs: [st.bar] });
      } else ctx.depFailed(owner.id, field, st.bar);
      return undefined;
    }
    if (from === "a") s = at;
    else {
      if (!bar.B) {
        d.error(
          "station",
          owner.id,
          `${field}: ${bar.id}'s end b is counted from its cut, so nothing may measure from it`,
          { field: `${field}/from`, refs: [bar.id] },
        );
        return undefined;
      }
      s = dist(bar.A, bar.B) - at;
    }
  }

  const { x, y } = bar.frame;
  let lx: number;
  let ly: number;
  let normal: V3 | undefined;
  let u: V3 | undefined;
  const faceName = (st.face ?? st.groove?.slice(0, 2)) as Face | undefined;
  if (faceName) {
    const fp = faceLocal(bar.box, faceName);
    [lx, ly] = fp.at;
    normal = fp.dir === "x" ? scale(x, fp.sign) : scale(y, fp.sign);
    u = fp.dir === "x" ? y : x;
    if (st.groove) {
      const k = Number(st.groove.slice(3));
      const on = bar.item.section.grooves
        .filter((g) => g.face === faceName)
        .map((g) => g.at_mm)
        .sort((a, b) => a - b);
      const g = on[k - 1];
      if (g === undefined) {
        d.error(
          "station",
          owner.id,
          `${field}: section ${bar.item.sectionId} has ${on.length} groove${on.length === 1 ? "" : "s"} on ${faceName}, not ${k}`,
          { field: `${field}/groove` },
        );
        return undefined;
      }
      if (fp.dir === "y") lx = localOf(bar, g, 0)[0];
      else ly = localOf(bar, 0, g)[1];
    }
  } else {
    lx = 0;
    ly = 0;
  }
  let point = onBar(bar, s, lx, ly);
  if (st.off_mm) {
    const ou = ctx.num(owner.id, `${field}/off_mm[0]`, st.off_mm[0]);
    const ov = ctx.num(owner.id, `${field}/off_mm[1]`, st.off_mm[1]);
    if (ou === undefined || ov === undefined) return undefined;
    point = addScaled(addScaled(point, u ?? x, ou), normal ?? y, ov);
  }
  if (shift) point = add(point, shift);
  return { point, bar, s, ...(normal ? { normal } : {}), ...(u ? { u } : {}) };
}

/** A face's centre line in local coordinates, and which local axis its normal runs along. */
function faceLocal(b: Box, face: Face): { at: [number, number]; dir: "x" | "y"; sign: 1 | -1 } {
  const [cx, cy] = boxCentre(b);
  switch (face) {
    case "+x":
      return { at: [b.x1, cy], dir: "x", sign: 1 };
    case "-x":
      return { at: [b.x0, cy], dir: "x", sign: -1 };
    case "+y":
      return { at: [cx, b.y1], dir: "y", sign: 1 };
    case "-y":
      return { at: [cx, b.y0], dir: "y", sign: -1 };
  }
}

// ---------------------------------------------------------------------------------------------
// Runs (§4.3)

export function placeRun(ctx: Ctx, id: string): PlacedRun | undefined {
  const spec = ctx.doc.runs[id];
  if (spec === undefined) return undefined;
  return ctx.memo(ctx.placedRuns, id, () => {
    const ids = Array.isArray(spec) ? spec : spec.bars;
    const bars: PlacedBar[] = [];
    for (const b of ids) {
      const pb = placeBar(ctx, b);
      if (!pb) {
        if (!ctx.bars.has(b)) ctx.d.error("ref", id, `no bar ${b}`, { refs: [b] });
        else ctx.depFailed(id, "bars", b);
        return undefined;
      }
      if (!pb.B) {
        ctx.d.error("run", id, `${b}'s end b is counted from its cut; a run needs design points`, {
          refs: [b],
        });
        return undefined;
      }
      bars.push(pb);
    }
    let ok = true;
    const first = bars[0] as PlacedBar;
    const t = first.frame.t;
    for (let i = 0; i + 1 < bars.length; i++) {
      const p = bars[i] as PlacedBar;
      const q = bars[i + 1] as PlacedBar;
      if (angleDeg(p.frame.t, q.frame.t) > TOL.ang) {
        ctx.d.error("run", id, `${q.id} does not point the same way as ${p.id}`, {
          refs: [p.id, q.id],
        });
        ok = false;
      }
      if (!splicedInOrder(ctx, p.id, q.id)) {
        ctx.d.error("run", id, `no splice joins ${p.id}.b to ${q.id}.a`, { refs: [p.id, q.id] });
        ok = false;
      }
    }
    if (!ok) return undefined;
    const starts = bars.map((b) => dot(sub(b.A, first.A), t));
    const ends = bars.map((b) => dot(sub(b.B as V3, first.A), t));
    return { id, bars, A: first.A, t, starts, ends, len: ends[ends.length - 1] as number };
  });
}

function splicedInOrder(ctx: Ctx, p: string, q: string): boolean {
  const want = new Set([`${p}.b`, `${q}.a`]);
  for (const { spec } of ctx.conns.values()) {
    if (spec.type !== "splice") continue;
    if (want.has(spec.ends[0]) && want.has(spec.ends[1]) && spec.ends[0] !== spec.ends[1]) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Pivots (§4.5): P = base point + height along the base face's outward normal.

export function placePivot(ctx: Ctx, id: string): PlacedPivot | undefined {
  const ent = ctx.conns.get(id);
  if (!ent) return undefined;
  return ctx.memo(ctx.placedPivots, id, () => {
    const { spec, copy } = ent;
    if (spec.type !== "pivot") {
      ctx.d.error("pivot", id, `${id} is a ${spec.type}, not a pivot`);
      return undefined;
    }
    if (spec.base.face === undefined && spec.base.groove === undefined) {
      ctx.d.error("pivot", id, "base: a pivot's base station names a face or a groove", {
        field: "base",
      });
      return undefined;
    }
    const found = ctx.items.item(spec.connector);
    if (!found.ok) {
      ctx.d.error("item", id, found.message, { field: "connector" });
      return undefined;
    }
    const geo = found.item.kind === "connector" ? found.item.pivot : undefined;
    if (!geo) {
      ctx.d.error("pivot", id, `${spec.connector} has no pivot geometry`, { field: "connector" });
      return undefined;
    }
    const st = resolveStation(ctx, spec.base, { id, field: "base", copy });
    if (!st?.normal || !st.u) return undefined;
    const height = num(geo.height_mm);
    return {
      id,
      P: addScaled(st.point, st.normal, height),
      n: st.normal,
      baseT: st.bar.frame.t,
      baseU: st.u,
      axis: spec.axis,
      height,
      end: num(geo.end_mm),
      range: geo.range_deg,
    };
  });
}

function num(v: number | { v: number }): number {
  return typeof v === "number" ? v : v.v;
}

// ---------------------------------------------------------------------------------------------
// Bodies (§4.5): an item's bounding box at a point or a pose, as a through member.

/** The rotation of a pose: about world X, then Y, then Z (§4.7), exact at multiples of 90°. */
export function poseAxes(rot: V3): [V3, V3, V3] {
  const rx = (v: V3, a: number): V3 => {
    const c = cosDeg(a);
    const s = sinDeg(a);
    return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
  };
  const ry = (v: V3, a: number): V3 => {
    const c = cosDeg(a);
    const s = sinDeg(a);
    return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  };
  const rz = (v: V3, a: number): V3 => {
    const c = cosDeg(a);
    const s = sinDeg(a);
    return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
  };
  const r = (v: V3) => rz(ry(rx(v, rot[0]), rot[1]), rot[2]);
  return [r(AXIS["+x"]), r(AXIS["+y"]), r(AXIS["+z"])];
}

/** A body's box as a prism of three slabs, or undefined with a diagnostic. */
export function bodyPrism(
  ctx: Ctx,
  conn: string,
  ref: string,
  at: Point | Pose,
  copy: Copy | undefined,
): Prism | undefined {
  const found = ctx.items.item(ref);
  if (!found.ok) {
    ctx.d.error("item", conn, found.message, { field: "through/body" });
    return undefined;
  }
  const item = found.item as {
    kind: string;
    bbox_mm?: readonly [V3, V3];
    body?: { size_mm: V3 };
    datums?: Record<string, V3>;
  };
  let box = item.bbox_mm;
  if (!box && item.body) {
    const [sx, sy, sz] = item.body.size_mm;
    box = [
      [-sx / 2, -sy / 2, -sz / 2],
      [sx / 2, sy / 2, sz / 2],
    ];
  }
  if (!box) {
    ctx.d.error("item", conn, `${ref} has no bounding box to act as a through member`, {
      field: "through/body",
    });
    return undefined;
  }
  const owner: Owner = { id: conn, field: "through/at", copy };
  let pos: V3 | undefined;
  let rot: V3 = [0, 0, 0];
  if (isPose(at)) {
    pos = resolvePoint(ctx, at.pos, owner);
    if (at.rot_deg) rot = ctx.vec(conn, "through/at/rot_deg", at.rot_deg) ?? rot;
  } else pos = resolvePoint(ctx, at, owner);
  if (!pos) return undefined;
  const datum = item.datums?.mount ?? [0, 0, 0];
  const axes = poseAxes(rot);
  return {
    owner: ref,
    slabs: axes.map((n, i) => ({
      n,
      origin: pos as V3,
      lo: ((box as readonly [V3, V3])[0][i] as number) - (datum[i] as number),
      hi: ((box as readonly [V3, V3])[1][i] as number) - (datum[i] as number),
      faces: [`-${"xyz"[i]}`, `+${"xyz"[i]}`] as const,
    })),
  };
}
