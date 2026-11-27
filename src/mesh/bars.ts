import {
  type BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Path,
  Shape,
  Vector2,
} from "three";
import type { BarJson, V3, ViewBar, ViewSection } from "./model.ts";

/**
 * Bar meshes (design §8, Rendering). Node-safe: three's geometry classes only, no renderer, so
 * the viewer and the GLB writer (§9) share them.
 *
 * - One unit-length extrusion per section: the display outline (§3.5) with its holes, from
 *   z = 0 to z = 1.
 * - A bar with square ends is that geometry under one matrix: the section's local x and y on the
 *   bar's frame, shifted by its anchor and offset, z scaled to the bar's length between its end
 *   planes. Bars that share a section become one `InstancedMesh`.
 * - A bar with an angled end gets its own geometry: each vertex of the prism moves along the axis
 *   to its end plane, which is exact for a planar cut.
 * - Edges: the section's sharp edges, found once per section, carried by the same map per bar
 *   into one merged buffer (`EdgesGeometry` cannot be instanced, review m11).
 */

/** Below this angle between faces an edge is smooth and not drawn (degrees). */
const EDGE_ANGLE_DEG = 30;

/** Ends within this angle of square are drawn square (the output quantum of angles, §2). */
const SQUARE_DEG = 0.005;

/** The unit extrusion of a section: the display outline and its holes, z from 0 to 1. */
export function sectionGeometry(s: ViewSection): BufferGeometry {
  const shape = new Shape(s.outline.map(([x, y]) => new Vector2(x, y)));
  for (const h of s.holes) shape.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))));
  const g = new ExtrudeGeometry(shape, { depth: 1, steps: 1, bevelEnabled: false });
  // Not needed for drawing, and a bar's texture-free material never reads them.
  g.deleteAttribute("uv");
  return g;
}

/** The sharp edges of a section's unit extrusion, as segment end points (x, y, z ∈ {0, 1}). */
export function sectionEdges(unit: BufferGeometry): Float32Array {
  const e = new EdgesGeometry(unit, EDGE_ANGLE_DEG);
  const out = Float32Array.from((e.getAttribute("position") as BufferAttribute).array);
  e.dispose();
  return out;
}

/**
 * A section's edges split for drawing (docs/ux/visual-design.md §5.2), as segment end points in
 * the unit extrusion's space (x, y, z ∈ {0, 1}):
 *
 * - `outline`: the outer ring at both ends; along the bar, a line at each corner of the section's
 *   convex hull that is a crease, and where a flat outer face ends (a hull corner on the
 *   section's box with a side along it). That last line is the silhouette of a rounded profile
 *   from the standard views, whose corner arcs are too fine to be creases.
 * - `detail`: every other crease along the bar (slot lips, inner chambers) and the holes' rings
 *   at both ends.
 *
 * Together they hold every edge `sectionEdges` finds, plus the flat-face lines.
 */
export function sectionEdgeSets(s: ViewSection): { outline: Float32Array; detail: Float32Array } {
  const outline: number[] = [];
  const detail: number[] = [];
  const ring = openRing(s.outline);
  const hull = hullOf(ring);
  const [[x0, y0], [x1, y1]] = boxOfRing(ring);
  const eps = Math.max(x1 - x0, y1 - y0) * 1e-9 + 1e-9;
  const onBox = (p: readonly [number, number]) =>
    Math.abs(p[0] - x0) <= eps ||
    Math.abs(p[0] - x1) <= eps ||
    Math.abs(p[1] - y0) <= eps ||
    Math.abs(p[1] - y1) <= eps;
  /** Both ends on one side of the box: a flat outer face's edge. */
  const alongBox = (p: readonly [number, number], q: readonly [number, number]) =>
    (Math.abs(p[0] - x0) <= eps && Math.abs(q[0] - x0) <= eps) ||
    (Math.abs(p[0] - x1) <= eps && Math.abs(q[0] - x1) <= eps) ||
    (Math.abs(p[1] - y0) <= eps && Math.abs(q[1] - y0) <= eps) ||
    (Math.abs(p[1] - y1) <= eps && Math.abs(q[1] - y1) <= eps);
  const along = (out: number[], p: readonly [number, number]) =>
    out.push(p[0], p[1], 0, p[0], p[1], 1);
  const loops = (out: number[], r: readonly (readonly [number, number])[]) => {
    for (const z of [0, 1]) {
      r.forEach((p, i) => {
        const q = r[(i + 1) % r.length] as readonly [number, number];
        out.push(p[0], p[1], z, q[0], q[1], z);
      });
    }
  };

  loops(outline, ring);
  ring.forEach((p, i) => {
    const prev = ring[(i - 1 + ring.length) % ring.length] as readonly [number, number];
    const next = ring[(i + 1) % ring.length] as readonly [number, number];
    const crease = isCrease(prev, p, next);
    const flatEnd = onBox(p) && alongBox(prev, p) !== alongBox(p, next);
    if (hull.has(i) && (crease || flatEnd)) along(outline, p);
    else if (crease) along(detail, p);
  });
  for (const h of s.holes) {
    const r = openRing(h);
    loops(detail, r);
    r.forEach((p, i) => {
      const prev = r[(i - 1 + r.length) % r.length] as readonly [number, number];
      const next = r[(i + 1) % r.length] as readonly [number, number];
      if (isCrease(prev, p, next)) along(detail, p);
    });
  }
  return { outline: Float32Array.from(outline), detail: Float32Array.from(detail) };
}

/** A ring without its closing point, when it repeats the first. */
function openRing(r: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const first = r[0];
  const last = r[r.length - 1];
  const closed = r.length > 1 && first && last && first[0] === last[0] && first[1] === last[1];
  return closed ? r.slice(0, -1) : [...r];
}

function boxOfRing(
  r: readonly (readonly [number, number])[],
): [[number, number], [number, number]] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of r) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [
    [x0, y0],
    [x1, y1],
  ];
}

/** Whether the outline turns by more than the edge angle at `p`: the side faces meet sharply. */
function isCrease(
  a: readonly [number, number],
  p: readonly [number, number],
  b: readonly [number, number],
): boolean {
  const ux = p[0] - a[0];
  const uy = p[1] - a[1];
  const vx = b[0] - p[0];
  const vy = b[1] - p[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu === 0 || lv === 0) return false;
  const cos = (ux * vx + uy * vy) / (lu * lv);
  return cos < Math.cos((EDGE_ANGLE_DEG * Math.PI) / 180);
}

/** The indices of a ring's strict convex hull corners (Andrew's monotone chain). */
function hullOf(r: readonly (readonly [number, number])[]): Set<number> {
  const idx = r
    .map((_, i) => i)
    .sort((i, j) => {
      const p = r[i] as readonly [number, number];
      const q = r[j] as readonly [number, number];
      return p[0] - q[0] || p[1] - q[1];
    });
  const [[x0, y0], [x1, y1]] = boxOfRing(r);
  const tol = Math.max(x1 - x0, y1 - y0) ** 2 * 1e-12;
  const cross = (o: number, a: number, b: number) => {
    const O = r[o] as readonly [number, number];
    const A = r[a] as readonly [number, number];
    const B = r[b] as readonly [number, number];
    return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  };
  const half = (order: number[]) => {
    const out: number[] = [];
    for (const i of order) {
      while (
        out.length >= 2 &&
        cross(out[out.length - 2] as number, out[out.length - 1] as number, i) <= tol
      )
        out.pop();
      out.push(i);
    }
    out.pop();
    return out;
  };
  return new Set([...half(idx), ...half([...idx].reverse())]);
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The bar's frame: design point A, local x and y, axis t (a → b), and its section's shift. */
interface Frame {
  A: V3;
  x: V3;
  y: V3;
  t: V3;
  shift: readonly [number, number];
}

function frameOf(bar: BarJson, view: ViewBar): Frame {
  return { A: bar.a, x: bar.frame.x, y: bar.frame.y, t: bar.frame.z, shift: view.shift };
}

/** True when both ends are square to the axis: one matrix places the unit geometry. */
export function squareEnds(bar: BarJson): boolean {
  return (
    Math.abs(bar.ends.a.angle_deg) <= SQUARE_DEG && Math.abs(bar.ends.b.angle_deg) <= SQUARE_DEG
  );
}

/** Where an end plane crosses the line through `A + o` along t, as a distance along t from A. */
function along(f: Frame, o: V3, end: BarJson["ends"]["a"]): number {
  const tn = dot(f.t, end.normal);
  const rel: V3 = [
    end.point[0] - f.A[0] - o[0],
    end.point[1] - f.A[1] - o[1],
    end.point[2] - f.A[2] - o[2],
  ];
  return dot(rel, end.normal) / tn;
}

/** The world point of section point (u, v) at distance s along the axis. */
function place(f: Frame, u: number, v: number, s: number): [number, number, number] {
  const a = u + f.shift[0];
  const b = v + f.shift[1];
  return [
    f.A[0] + a * f.x[0] + b * f.y[0] + s * f.t[0],
    f.A[1] + a * f.x[1] + b * f.y[1] + s * f.t[1],
    f.A[2] + a * f.x[2] + b * f.y[2] + s * f.t[2],
  ];
}

/**
 * The matrix that places a section's unit extrusion on a bar with square ends: its columns are
 * the local x, the local y and the axis scaled to the length, and the corner of the section's
 * origin at end a.
 */
export function squareMatrix(bar: BarJson, view: ViewBar): Matrix4 {
  const f = frameOf(bar, view);
  const sa = along(f, [0, 0, 0], bar.ends.a);
  const sb = along(f, [0, 0, 0], bar.ends.b);
  const L = sb - sa;
  const o = place(f, 0, 0, sa);
  // The frame is right-handed (x = y × t, §4.4), so the map keeps faces facing out.
  // biome-ignore format: a matrix reads best by rows
  return new Matrix4().set(
    f.x[0], f.y[0], f.t[0] * L, o[0],
    f.x[1], f.y[1], f.t[1] * L, o[1],
    f.x[2], f.y[2], f.t[2] * L, o[2],
    0, 0, 0, 1,
  );
}

/**
 * Maps points of a section's unit space onto a bar: z = 0 to end a's plane, z = 1 to end b's,
 * each along the axis from its own (x, y). Exact for any planar cut; for square ends it agrees
 * with `squareMatrix`.
 */
export function barMapper(
  bar: BarJson,
  view: ViewBar,
): (x: number, y: number, z: number) => [number, number, number] {
  const f = frameOf(bar, view);
  return (x, y, z) => {
    const a = x + f.shift[0];
    const b = y + f.shift[1];
    const o: V3 = [a * f.x[0] + b * f.y[0], a * f.x[1] + b * f.y[1], a * f.x[2] + b * f.y[2]];
    const s = z < 0.5 ? along(f, o, bar.ends.a) : along(f, o, bar.ends.b);
    return place(f, x, y, s);
  };
}

/** A bar with an angled end: its own geometry, in world coordinates. */
export function angledGeometry(unit: BufferGeometry, bar: BarJson, view: ViewBar): BufferGeometry {
  const map = barMapper(bar, view);
  const src = (unit.getAttribute("position") as BufferAttribute).array;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const p = map(src[i] as number, src[i + 1] as number, src[i + 2] as number);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2];
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(out, 3));
  if (unit.index) g.setIndex(unit.index.clone());
  // The unit's groups, its ends and its sides, so the ends can take their own material.
  for (const x of unit.groups) g.addGroup(x.start, x.count, x.materialIndex);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A section's edges mapped onto a bar, appended to `out` from `at`; returns the next index. */
export function appendEdges(
  edges: Float32Array,
  bar: BarJson,
  view: ViewBar,
  out: Float32Array,
  at: number,
): number {
  const map = barMapper(bar, view);
  let k = at;
  for (let i = 0; i < edges.length; i += 3) {
    const p = map(edges[i] as number, edges[i + 1] as number, edges[i + 2] as number);
    out[k++] = p[0];
    out[k++] = p[1];
    out[k++] = p[2];
  }
  return k;
}

/** The eight corners of a bar's body: its section's box swept between its end planes. */
export function barCorners(
  bar: BarJson,
  view: ViewSection,
  place: ViewBar,
): [number, number, number][] {
  const map = barMapper(bar, place);
  const [[x0, y0], [x1, y1]] = view.bbox;
  const out: [number, number, number][] = [];
  for (const z of [0, 1])
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ] as const)
      out.push(map(x, y, z));
  return out;
}
