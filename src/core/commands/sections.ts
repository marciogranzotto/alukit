import type { BuiltSection } from "#catalog/link.ts";
import { anchorPoint } from "../derive/place.ts";
import type { Expr, Face } from "../project/schema.ts";
import type { Ring, Vec2 } from "../section-properties.ts";
import { TOL } from "../tolerances.ts";
import { negate } from "./numbers.ts";

/**
 * How a section maps onto itself (design §4.4). Reversing a bar or mirroring it turns its
 * section over: the same body is placed only by a section that has a mirror symmetry, and then
 * its faces, grooves, anchors and offsets take other names. The four mirror lines through the
 * box centre:
 *
 * - `x`: x ↦ 2cx − x (across the vertical centre line): `+x` ↔ `-x`;
 * - `y`: y ↦ 2cy − y: `+y` ↔ `-y`;
 * - `d`: across the diagonal, x and y swap (a square box only): `+x` ↔ `+y`, `-x` ↔ `-y`;
 * - `a`: across the other diagonal: `+x` ↔ `-y`, `-x` ↔ `+y`.
 *
 * `i`, the identity, is the bar left as it is.
 */

export type Sym = "x" | "y" | "d" | "a";
export type Map2 = Sym | "i";

/** The order a writer prefers a symmetry in, so the same document always gets the same edit. */
export const SYM_ORDER: readonly Sym[] = ["x", "y", "d", "a"];

/** The outline's tolerance for a symmetry: M1's for an outline against its nominal box. */
const OUTLINE_TOL = 0.1;

type Box = readonly [Vec2, Vec2];

function centre(box: Box): Vec2 {
  return [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
}

export function reflectPoint(m: Map2, box: Box, [x, y]: Vec2): Vec2 {
  const [cx, cy] = centre(box);
  switch (m) {
    case "i":
      return [x, y];
    case "x":
      return [2 * cx - x, y];
    case "y":
      return [x, 2 * cy - y];
    case "d":
      return [cx + (y - cy), cy + (x - cx)];
    case "a":
      return [cx - (y - cy), cy - (x - cx)];
  }
}

const FACES: Record<Map2, Record<Face, Face>> = {
  i: { "+x": "+x", "-x": "-x", "+y": "+y", "-y": "-y" },
  x: { "+x": "-x", "-x": "+x", "+y": "+y", "-y": "-y" },
  y: { "+x": "+x", "-x": "-x", "+y": "-y", "-y": "+y" },
  d: { "+x": "+y", "+y": "+x", "-x": "-y", "-y": "-x" },
  a: { "+x": "-y", "-y": "+x", "-x": "+y", "+y": "-x" },
};

export function mapFace(m: Map2, f: Face): Face {
  return FACES[m][f];
}

/**
 * Whether a station's `u` (§4.3: along local +x on the `±y` faces, +y on the `±x` faces) turns
 * the other way on the mapped face.
 */
export function flipsU(m: Map2, f: Face): boolean {
  const onY = f === "+y" || f === "-y";
  switch (m) {
    case "i":
    case "d":
      return false;
    case "x":
      return onY;
    case "y":
      return !onY;
    case "a":
      return true;
  }
}

/** A bar's `off_mm` [dx, dy], or a station's local offset with no face, under the map. */
export function mapOffset(m: Map2, [ox, oy]: readonly [Expr, Expr]): [Expr, Expr] {
  switch (m) {
    case "i":
      return [ox, oy];
    case "x":
      return [negate(ox), oy];
    case "y":
      return [ox, negate(oy)];
    case "d":
      return [oy, ox];
    case "a":
      return [negate(oy), negate(ox)];
  }
}

function segDist([px, py]: Vec2, [ax, ay]: Vec2, [bx, by]: Vec2): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function onBoundary(p: Vec2, rings: readonly Ring[]): boolean {
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      if (segDist(p, r[i] as Vec2, r[(i + 1) % r.length] as Vec2) <= OUTLINE_TOL) return true;
    }
  }
  return false;
}

/** The coordinate along a face that grooves are numbered by (§4.3). */
function along(f: Face, [x, y]: Vec2): number {
  return f === "+y" || f === "-y" ? x : y;
}

function facePoint(box: Box, f: Face, a: number): Vec2 {
  switch (f) {
    case "+x":
      return [box[1][0], a];
    case "-x":
      return [box[0][0], a];
    case "+y":
      return [a, box[1][1]];
    case "-y":
      return [a, box[0][1]];
  }
}

function grooveList(s: BuiltSection, f: Face): number[] {
  return s.grooves
    .filter((g) => g.face === f)
    .map((g) => g.at_mm)
    .sort((p, q) => p - q);
}

/** A groove `+y.2` under the map, or undefined when no groove sits where it lands. */
export function mapGroove(m: Map2, s: BuiltSection, groove: string): string | undefined {
  const f = groove.slice(0, 2) as Face;
  const k = Number(groove.slice(3));
  const at = grooveList(s, f)[k - 1];
  if (at === undefined) return undefined;
  const p = reflectPoint(m, s.bbox_mm, facePoint(s.bbox_mm, f, at));
  const f2 = mapFace(m, f);
  const i = grooveList(s, f2).findIndex((g) => Math.abs(g - along(f2, p)) <= TOL.len);
  return i < 0 ? undefined : `${f2}.${i + 1}`;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOL.len;
}

/** The name of a section point that an anchor can take: c, a face, a corner, or a datum. */
function anchorName(s: BuiltSection, [x, y]: Vec2): string | undefined {
  const [[x0, y0], [x1, y1]] = s.bbox_mm;
  const [cx, cy] = centre(s.bbox_mm);
  const xs = near(x, cx) ? "" : near(x, x1) ? "+x" : near(x, x0) ? "-x" : undefined;
  const ys = near(y, cy) ? "" : near(y, y1) ? "+y" : near(y, y0) ? "-y" : undefined;
  if (xs !== undefined && ys !== undefined) return xs + ys === "" ? "c" : xs + ys;
  for (const [name, [dx, dy]] of Object.entries(s.datums).sort(([p], [q]) => (p < q ? -1 : 1))) {
    if (near(dx, x) && near(dy, y)) return name;
  }
  return undefined;
}

/** An anchor under the map, or undefined when the point it lands on has no name. */
export function mapAnchor(m: Map2, s: BuiltSection, anchor: string): string | undefined {
  const p = anchorPoint(anchor, s.bbox_mm, s.datums);
  if (!p) return undefined;
  return anchorName(s, reflectPoint(m, s.bbox_mm, p));
}

/** Whether the section is its own image under the map: outline, grooves and datums. */
export function hasSymmetry(s: BuiltSection, m: Sym): boolean {
  const box = s.bbox_mm;
  const w = box[1][0] - box[0][0];
  const h = box[1][1] - box[0][1];
  if ((m === "d" || m === "a") && !near(w, h)) return false;
  const rings = [s.draw.outline, ...s.draw.holes];
  for (const r of rings)
    for (const v of r) if (!onBoundary(reflectPoint(m, box, v), rings)) return false;
  for (const g of s.grooves) {
    if (mapGroove(m, s, `${g.face}.${grooveList(s, g.face).indexOf(g.at_mm) + 1}`) === undefined) {
      return false;
    }
  }
  for (const name of Object.keys(s.datums)) if (mapAnchor(m, s, name) === undefined) return false;
  return true;
}

/** The section's mirror symmetries, in the order a writer prefers them. */
export function symmetries(s: BuiltSection): Sym[] {
  return SYM_ORDER.filter((m) => hasSymmetry(s, m));
}
