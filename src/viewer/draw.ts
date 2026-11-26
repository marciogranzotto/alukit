import { plus } from "#core/commands/numbers.ts";
import { anchorPoint, barFrame } from "#core/derive/frame.ts";
import type { V3, ViewSection } from "../mesh/model.ts";
import {
  GRID_MM,
  meetLine,
  type P2,
  type Project,
  q,
  type Ray,
  rayLineParams,
  type Snap,
} from "./snap.ts";
import { onGrid, rayPlane, through, type WorkPlane } from "./workplane.ts";

/**
 * The draw-bar gesture (design §8, Tools): click a snap point; the line follows the axis it
 * infers (X, Y or Z), or, with Shift, any direction in the work plane through the start; type a
 * length and press Enter, or click a snap point to close on it; R rolls the section, A cycles the
 * anchor; the item comes from the palette. The whole gesture becomes one batch of commands (§7.1:
 * a tab holds no unsaved state): the bar, and with auto-connect an `autoConnect` at each end,
 * which does nothing where nothing butts (§4.5's default connection).
 *
 * Points are written as the document would write them (§4.3): a node by its id, another bar's end
 * as that end is written (so a point written from params keeps following them), a point on a bar
 * as a station, anything else as coordinates.
 */

/** A point as a document writes it (§4.3). */
export type PointJson = string | readonly (number | string)[] | Record<string, unknown>;

export type Axis = "x" | "y" | "z";
export const AXES: Readonly<Record<Axis, V3>> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** What the document holds that writing a point reads: the bars as written. */
export interface WrittenDoc {
  bars?: Readonly<Record<string, unknown>>;
}

/** A point of the gesture: where it is, and how it is written. */
export interface DrawPoint {
  p: V3;
  written: PointJson;
  /** What it snapped to, for the indicator. */
  label: string;
}

/** The end under the pointer while drawing. */
export interface DrawEnd extends DrawPoint {
  how: "snap" | "meet" | "axis" | "free" | "typed";
  axis?: Axis;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addScaled = (a: V3, b: V3, s: number): V3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function coords(p: V3): number[] {
  return [q(p[0]), q(p[1]), q(p[2])];
}

/** How a snapped point is written (§4.3). */
export function writtenPoint(snap: Snap, doc: WrittenDoc): PointJson {
  const r = snap.ref;
  switch (r.kind) {
    case "node":
      return r.node;
    case "end": {
      const bar = doc.bars?.[r.bar];
      const w = isObj(bar) ? bar[r.end] : undefined;
      // A node, an inline point (numbers or expressions), a station or a pivot point is shared
      // as written; a free end (`len_mm`) has no point of its own to share.
      if (typeof w === "string" || Array.isArray(w)) return w as PointJson;
      if (isObj(w) && (w.on !== undefined || w.pivot !== undefined)) return w;
      return coords(snap.p);
    }
    case "station":
      return {
        on: {
          bar: r.bar,
          at_mm: r.at_mm,
          ...(r.groove ? { groove: r.groove } : r.face ? { face: r.face } : {}),
        },
      };
    default:
      return coords(snap.p);
  }
}

/**
 * An end at `d` along `dir` from the start: written from the start's own written coordinates
 * when the start is an inline point and `dir` a world axis, so an end drawn from a point written
 * with params (`[0, 0, "H"]`) keeps them; coordinates otherwise.
 */
function endFrom(start: DrawPoint, dir: V3, d: number): PointJson {
  const p = addScaled(start.p, dir, d);
  const w = start.written;
  const k = dir.findIndex((c) => Math.abs(c) === 1);
  const axial = k >= 0 && dir.every((c, i) => i === k || c === 0);
  if (Array.isArray(w) && w.length === 3 && axial) {
    return w.map((c, i) =>
      i === k ? plus(c as number | string, (dir[k] as number) * d) : c,
    ) as PointJson;
  }
  return coords(p);
}

export interface EndOptions {
  ray: Ray;
  /** The pointer, in screen pixels. */
  at: P2;
  project: Project;
  /** A snap target (point or line) under the pointer, if any. */
  snap?: Snap | undefined;
  /** Shift: free in the work plane through the start. */
  free: boolean;
  plane: WorkPlane;
  doc: WrittenDoc;
  step?: number;
}

/** The axis through `S` whose screen image passes nearest the pointer, and the station on it. */
export function inferAxis(
  S: V3,
  o: Pick<EndOptions, "ray" | "at" | "project">,
): { axis: Axis; s: number } | undefined {
  let best: { axis: Axis; s: number; d: number } | undefined;
  for (const axis of ["x", "y", "z"] as const) {
    const e = AXES[axis];
    const { s } = rayLineParams(o.ray, S, e);
    const sp = o.project(addScaled(S, e, s));
    if (!sp) continue;
    const d = Math.hypot(sp[0] - o.at[0], sp[1] - o.at[1]);
    if (!best || d < best.d) best = { axis, s, d };
  }
  return best && { axis: best.axis, s: best.s };
}

/**
 * The end under the pointer: a snap point closes on it; a snap line is met by an axis through
 * the start when one crosses it there, else closes where the pointer is on it; otherwise the
 * inferred axis, or the work plane with Shift, at a length on the grid.
 */
export function endUnder(start: DrawPoint, o: EndOptions): DrawEnd | undefined {
  const step = o.step ?? GRID_MM;
  const S = start.p;
  const snap = o.snap;
  if (snap && (snap.kind === "point" || snap.kind === "line")) {
    if (snap.kind === "line" && snap.line && !o.free && snap.ref.kind === "station") {
      // An axis through the start that meets the line: the exact crossing, not a grid step.
      let best: { p: V3; s: number; axis: Axis; d: number } | undefined;
      for (const axis of ["x", "y", "z"] as const) {
        const m = meetLine(S, AXES[axis], snap.line);
        if (!m || len3(sub(m.p, S)) < 1e-6) continue;
        const d = len3(sub(m.p, snap.p));
        if (!best || d < best.d) best = { ...m, axis, d };
      }
      if (best && best.d <= step * 2) {
        const ref = { ...snap.ref, at_mm: q(best.s) };
        const met: Snap = { ...snap, p: best.p, ref };
        return {
          p: best.p,
          written: writtenPoint(met, o.doc),
          label: `${snap.label.replace(/ at [-\d.]+$/, "")} at ${q(best.s)}`,
          how: "meet",
          axis: best.axis,
        };
      }
    }
    if (len3(sub(snap.p, S)) < 1e-6) return undefined;
    return { p: snap.p, written: writtenPoint(snap, o.doc), label: snap.label, how: "snap" };
  }
  if (o.free) {
    const plane = through(o.plane, S);
    const hit = rayPlane(o.ray, plane);
    if (!hit) return undefined;
    const p = onGrid(plane, hit, step);
    if (len3(sub(p, S)) < 1e-6) return undefined;
    return { p, written: coords(p), label: `free in ${o.plane.label}`, how: "free" };
  }
  const ax = inferAxis(S, o);
  if (!ax) return undefined;
  const s = Math.round(ax.s / step) * step;
  if (s === 0) return undefined;
  const e = AXES[ax.axis];
  return {
    p: addScaled(S, e, s),
    written: endFrom(start, e, s),
    label: `${s > 0 ? "+" : "-"}${ax.axis} ${Math.abs(s)}`,
    how: "axis",
    axis: ax.axis,
  };
}

/** The end a typed length gives, along the current direction from the start. */
export function typedEnd(start: DrawPoint, toward: V3, length: number): DrawEnd | undefined {
  const d = sub(toward, start.p);
  const n = len3(d);
  if (!(n > 1e-9) || !(length > 0)) return undefined;
  // Snap a direction within 1e-9 of a world axis onto it, so the written end stays axial.
  const dir = d.map((c) => {
    const x = c / n;
    return Math.abs(x) < 1e-9 ? 0 : Math.abs(Math.abs(x) - 1) < 1e-9 ? Math.sign(x) : x;
  }) as unknown as V3;
  const axis = (["x", "y", "z"] as const).find((_, i) => Math.abs(dir[i] as number) === 1);
  return {
    p: addScaled(start.p, dir, length),
    written: endFrom(start, dir, length),
    label: `typed ${length}`,
    how: "typed",
    ...(axis ? { axis } : {}),
  };
}

/** Parses a typed length: a positive number of millimetres. */
export function parseLength(text: string): number | undefined {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return undefined;
  const v = Number(t);
  return v > 0 ? v : undefined;
}

/** The bar's frame and section shift for a preview: the rule derive uses (§4.4). */
export function previewPlacement(
  A: V3,
  B: V3,
  roll: number,
  section: Pick<ViewSection, "bbox" | "datums">,
  anchor: string,
): { x: V3; y: V3; t: V3; len: number; shift: P2 } | undefined {
  const fr = barFrame(sub(B, A), undefined, roll);
  if ("problem" in fr) return undefined;
  const ap = anchorPoint(anchor, section.bbox, section.datums ?? {}) ??
    anchorPoint("c", section.bbox, {}) ?? [0, 0];
  return {
    x: fr.frame.x,
    y: fr.frame.y,
    t: fr.frame.t,
    len: len3(sub(B, A)),
    shift: [0 - ap[0], 0 - ap[1]],
  };
}

/** The next anchor of a list, wrapping (A, §8). */
export function nextAnchor(anchors: readonly string[], current: string): string {
  const i = anchors.indexOf(current);
  return anchors[(i + 1) % anchors.length] ?? "c";
}

/** The next roll: a quarter turn (R, §8). */
export function nextRoll(roll: number): number {
  return (roll + 90) % 360;
}

export interface BarGesture {
  item: string;
  opt?: Readonly<Record<string, string>>;
  a: DrawPoint;
  b: DrawPoint;
  anchor: string;
  roll: number;
  autoConnect: boolean;
}

/**
 * Where autoConnect looks for an end: a node by its id, an inline point as written (its params
 * evaluate exactly), anything else by its coordinates.
 */
function connectAt(p: DrawPoint): string | (number | string)[] {
  if (typeof p.written === "string") return p.written;
  return Array.isArray(p.written) ? [...p.written] : [...p.p];
}

/** The gesture as one batch (§7.1): the bar, then autoConnect at each end that may meet others. */
export function barCommands(g: BarGesture): { cmd: string; args: Record<string, unknown> }[] {
  const bar: Record<string, unknown> = {
    item: g.item,
    ...(g.opt && Object.keys(g.opt).length > 0 ? { opt: g.opt } : {}),
    a: g.a.written,
    b: g.b.written,
    ...(g.anchor !== "c" ? { anchor: g.anchor } : {}),
    ...(g.roll !== 0 ? { roll_deg: g.roll } : {}),
  };
  const out: { cmd: string; args: Record<string, unknown> }[] = [{ cmd: "addBar", args: bar }];
  if (g.autoConnect) {
    for (const p of [g.a, g.b])
      out.push({ cmd: "autoConnect", args: { at: connectAt(p), optional: true } });
  }
  return out;
}
