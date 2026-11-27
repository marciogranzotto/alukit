import { cosDeg, sinDeg } from "#core/trig.ts";
import type { BarJson, V3 } from "../../mesh/model.ts";
import type { GhostBar } from "../../viewer/overlay.ts";
import type { Model } from "../model.ts";
import { parseTyped } from "../tools/typed.ts";

/**
 * The geometry the transform and copy tools share (docs/ux/editing-audit.md §7.7; e3 decisions
 * in docs/ux/e3-decisions.md), pure, so the unit tests read it: where a selection's centre and
 * lowest corner are, a selection's bars drawn where a move, a turn or a mirror would put them
 * (the local preview, E-UX-20), how far a selection reaches along a direction and where a bar's
 * face lies (Align, E-UX-23), the copy counts typed after an offset (`4x`, `/4`, E-UX-6) and the
 * angle a ring's drag snaps to. Owner: E3.
 */

export type Axis = "x" | "y" | "z";
export const AXIS_INDEX: Readonly<Record<Axis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };
export const UNIT: Readonly<Record<Axis, V3>> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const neg = (a: V3): V3 => [0 - a[0], 0 - a[1], 0 - a[2]];
const q2 = (x: number) => {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
};

/** What a selection is made of, by kind (the Move tool's `MoveSet`, or any id list sorted so). */
export interface Members {
  bars: readonly string[];
  parts: readonly string[];
  nodes: readonly string[];
}

/** A selection's ids sorted by kind, as the model knows them; pattern copies and others left out. */
export function membersOf(m: Model, ids: Iterable<string>): Members {
  const bars: string[] = [];
  const parts: string[] = [];
  const nodes: string[] = [];
  for (const id of ids) {
    if (id.includes("@")) continue;
    if (m.derived.bars[id]) bars.push(id);
    else if (m.derived.parts?.[id]) parts.push(id);
    else if (m.derived.nodes[id]) nodes.push(id);
  }
  return { bars, parts, nodes };
}

/** The points a selection is placed by: its bars' design points, its nodes, its parts' points. */
function pointsOf(m: Model, set: Members): V3[] {
  const pts: V3[] = [];
  for (const b of set.bars) {
    const bar = m.derived.bars[b];
    if (bar) pts.push(bar.a, bar.b);
  }
  for (const n of set.nodes) {
    const p = m.derived.nodes[n];
    if (p) pts.push(p);
  }
  for (const p of set.parts) {
    const at = m.derived.parts[p]?.point ?? m.derived.parts[p]?.origin;
    if (at) pts.push(at);
  }
  return pts;
}

/** The centre of what a selection places: the mean of its points (the Move tool's base). */
export function centreOf(m: Model, set: Members): V3 {
  const pts = pointsOf(m, set);
  if (pts.length === 0) return [0, 0, 0];
  return scale(
    pts.reduce((acc, p) => add(acc, p), [0, 0, 0] as V3),
    1 / pts.length,
  );
}

/**
 * The lowest corner of what a selection places (least x, y and z of its points): where a pasted
 * copy hangs from the pointer, as AutoCAD pastes at the lower-left corner of what was copied. For
 * one bar along an axis it is an end of the bar, a place a person aims at.
 */
export function minCorner(m: Model, set: Members): V3 {
  const pts = pointsOf(m, set);
  if (pts.length === 0) return [0, 0, 0];
  return [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i] as number))) as unknown as V3;
}

/** A rigid map of the world, for points and for directions. */
export interface WorldMap {
  point(p: V3): V3;
  dir(v: V3): V3;
}

export function translation(d: V3): WorldMap {
  return { point: (p) => add(p, d), dir: (v) => v };
}

/**
 * A turn by `deg` about the world axis through `about`, counter-clockwise looking down the axis
 * toward the origin: the right-handed sense `transform` turns by, exact at quarter turns
 * (`cosDeg` and `sinDeg` read those from a table).
 */
export function turn(axis: Axis, deg: number, about: V3): WorldMap {
  const k = AXIS_INDEX[axis];
  const i = (k + 1) % 3;
  const j = (k + 2) % 3;
  const c = cosDeg(deg);
  const s = sinDeg(deg);
  const dir = (v: V3): V3 => {
    const out: [number, number, number] = [v[0], v[1], v[2]];
    out[i] = (v[i] as number) * c - (v[j] as number) * s;
    out[j] = (v[i] as number) * s + (v[j] as number) * c;
    return out;
  };
  return { dir, point: (p) => add(dir(sub(p, about)), about) };
}

/** The mirror image in the plane square to `axis` at `at`. */
export function reflection(axis: Axis, at: number): WorldMap {
  const k = AXIS_INDEX[axis];
  return {
    point: (p) => p.map((c, i) => (i === k ? 2 * at - c : c)) as unknown as V3,
    dir: (v) => v.map((c, i) => (i === k ? -c : c)) as unknown as V3,
  };
}

/**
 * Each bar drawn where `map` puts it, as the overlay's ghosts (at most `max`): the section's
 * frame and the design point mapped. A mirror's frame is left-handed, which three draws turned
 * the right way out (a negative determinant flips the front face), so the image is the body's.
 */
export function ghostsOf(m: Model, bars: readonly string[], map: WorldMap, max = 48): GhostBar[] {
  const out: GhostBar[] = [];
  for (const id of bars.slice(0, max)) {
    const b = m.derived.bars[id];
    const view = m.display.bars[id];
    const section = view ? m.display.sections[view.section] : undefined;
    if (!b || !view || !section) continue;
    const a = b.ends.a.point;
    out.push({
      section,
      x: map.dir(b.frame.x),
      y: map.dir(b.frame.y),
      t: map.dir(b.frame.z),
      a: map.point(a),
      len: norm(sub(b.ends.b.point, a)),
      shift: view.shift,
    });
  }
  return out;
}

/**
 * A bar's body as derive cuts it: the eight corners of its placed box between its two end planes
 * (each through the end's point, square to its normal, as the pick reads them), so an angled end
 * is cut as it is.
 */
export function barCorners(bar: BarJson): V3[] {
  const { x, y, z } = bar.frame;
  const [[x0, y0], [x1, y1]] = bar.box_mm;
  const out: V3[] = [];
  for (const u of [x0, x1]) {
    for (const v of [y0, y1]) {
      const o = add(add(bar.a, scale(x, u)), scale(y, v));
      for (const e of [bar.ends.a, bar.ends.b]) {
        const den = dot(z, e.normal);
        const s = Math.abs(den) < 1e-12 ? 0 : dot(sub(e.point, o), e.normal) / den;
        out.push(add(o, scale(z, s)));
      }
    }
  }
  return out;
}

/** How far a selection reaches along a unit direction: the greatest `p · n` of its bodies. */
export function extentAlong(m: Model, set: Members, n: V3): number | undefined {
  let best: number | undefined;
  const take = (p: V3) => {
    const d = dot(p, n);
    if (best === undefined || d > best) best = d;
  };
  for (const id of set.bars) {
    const bar = m.derived.bars[id];
    if (bar) for (const p of barCorners(bar)) take(p);
  }
  for (const id of set.parts) {
    const p = m.derived.parts[id]?.point ?? m.derived.parts[id]?.origin;
    if (p) take(p);
  }
  for (const id of set.nodes) {
    const p = m.derived.nodes[id];
    if (p) take(p);
  }
  return best;
}

export type BarFace = "+x" | "-x" | "+y" | "-y" | "a" | "b";

/** A bar's face as a plane: its outward unit normal, and where it lies along it (`p · n`). */
export function facePlane(bar: BarJson, face: BarFace): { n: V3; c: number } {
  if (face === "a" || face === "b") {
    const e = bar.ends[face];
    return { n: e.normal, c: dot(e.point, e.normal) + 0 };
  }
  const { x, y } = bar.frame;
  const [[x0, y0], [x1, y1]] = bar.box_mm;
  const side: Record<"+x" | "-x" | "+y" | "-y", [V3, number]> = {
    "+x": [x, x1],
    "-x": [neg(x), -x0],
    "+y": [y, y1],
    "-y": [neg(y), -y0],
  };
  const [n, off] = side[face];
  return { n, c: dot(bar.a, n) + off + 0 };
}

/** The face a world direction names, in words: "top" for +Z, "the +X side" for +X. */
export function sideWords(n: V3): string {
  const k = [0, 1, 2].find((i) => Math.abs(Math.abs(n[i] as number) - 1) < 1e-9);
  if (k === undefined) return "face";
  const sign = (n[k] as number) > 0 ? "+" : "-";
  if (k === 2) return sign === "+" ? "top" : "bottom";
  return `${sign}${"XY"[k]} side`;
}

/** An offset to 0.01 mm, as the document writes numbers. */
export const rounded = (d: V3): V3 => [q2(d[0]), q2(d[1]), q2(d[2])];

/** A count of copies, one token: `4x`, `x4`, `/4`, and alone `4*` or `*4`. */
const COPIES = /^(?:(\d+)x|x(\d+)|\/(\d+)|(\d+)\*|\*(\d+))$/i;
/** At most this many copies in one step. */
export const MAX_COPIES = 100;

/**
 * Copies asked for after an offset (E-UX-6, SketchUp's Measurements box): `4x` or `x4` (and,
 * typed alone, `4*` or `*4`) make four copies at the offset's spacing, `/4` divides the offset
 * into four gaps. The count is the last token, after a space or a comma, written with nothing
 * inside it, so `W /2` asks for two gaps while `W / 2` and `300/2` stay divisions. What is left
 * (`0, 0, -300`) is the offset itself, or empty when the pointer gives it. A token that names a
 * param (`x4`) stays a value.
 */
export function splitCopies(
  text: string,
  params: Readonly<Record<string, number>>,
): { rest: string; count?: number; divide?: number } | { why: string } {
  const t = text.trim();
  const cut = Math.max(t.lastIndexOf(" "), t.lastIndexOf(","));
  const token = t.slice(cut + 1);
  const rest = t
    .slice(0, cut + 1)
    .trim()
    .replace(/,$/, "")
    .trim();
  const m = COPIES.exec(token);
  if (!m || Object.hasOwn(params, token)) return { rest: t };
  // `4*` and `*4` only alone: after a value, `W *4` is a product.
  if ((m[4] !== undefined || m[5] !== undefined) && rest !== "") return { rest: t };
  const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
  if (n < 1) return { why: "a count of copies is 1 or more" };
  if (n > MAX_COPIES) return { why: `at most ${MAX_COPIES} copies in one step` };
  return m[3] !== undefined ? { rest, divide: n } : { rest, count: n };
}

/**
 * An angle typed in Rotate: degrees, as an expression over the params (`90`, `-45`, `=A / 2`,
 * `30°`), as the number it comes to; `transform` takes numbers (a turn keeps expressions only at
 * quarter turns, where it writes no angle).
 */
export function typedAngle(
  text: string,
  params: Readonly<Record<string, number>>,
): { deg: number } | { why: string } | undefined {
  const src = text
    .trim()
    .replace(/^=\s*/, "")
    .replace(/\s*(°|deg)$/i, "");
  const t = parseTyped(src, params);
  if (t.kind === "empty") return undefined;
  if (t.kind === "error") return { why: t.why };
  if (t.kind !== "value") return { why: "type one angle, in degrees" };
  return { deg: Math.round(t.value * 1e6) / 1e6 };
}

/** A ring's drag snapped to `step` degrees (SketchUp's angle snapping, 15° by default). */
export function snapAngle(deg: number, step = 15): number {
  const r = Math.round(deg / step) * step;
  return r === 0 ? 0 : r;
}
