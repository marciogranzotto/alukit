import { insidePolygon } from "#core/project-items/geometry.ts";
import type { BarJson, PartJson, V3, ViewBar, ViewPart, ViewSection } from "../mesh/model.ts";

/**
 * Snapping (design §8): analytic, from the derived model, never a raycast against meshes. The
 * targets are nodes, bar ends, face centres, and lines along each bar (its design line, the
 * centre line of each face of its placed box, and the centre line of each groove), on which a
 * point lands at a station (§4.3); each placed part's datums and face centres, catalog parts and
 * the project's own plates, bent angles and placeholders alike (§4.8); then the grid on the work
 * plane. Pure: the caller gives the pointer's ray and a projection to the screen, so a test needs
 * no renderer.
 */

export type Face = "+x" | "-x" | "+y" | "-y";
export type P2 = readonly [number, number];

/** What a snapped point means, so the draw tool writes it as the document would (§4.3). */
export type SnapRef =
  | { kind: "node"; node: string }
  | { kind: "end"; bar: string; end: "a" | "b" }
  /** A point on a bar: on its design line, or on a face's or a groove's centre line. */
  | { kind: "station"; bar: string; at_mm: number; face?: Face; groove?: string }
  /** A point of a placed part (a datum, a face centre): a document point cannot name a part, so it is written as coordinates. */
  | { kind: "part"; part: string }
  | { kind: "grid" }
  | { kind: "free" };

export interface Snap {
  p: V3;
  ref: SnapRef;
  /** What the indicator says: "end b1.b", "b1 -x face at 100". */
  label: string;
  kind: "point" | "line" | "grid" | "free";
  /** For a line: its direction, so a constrained line can meet it. */
  line?: { a: V3; t: V3; len: number };
}

/** A snap point: a node, a bar end, a face centre. Lower `rank` wins a near tie. */
export interface SnapPoint {
  p: V3;
  ref: SnapRef;
  label: string;
  rank: number;
  /** The entity it belongs to: its node, bar (a copy by its own id) or part. */
  of: string;
}

/** A line along a bar, from its design point a (s = 0) to b (s = len). */
export interface SnapLine {
  bar: string;
  a: V3;
  t: V3;
  len: number;
  face?: Face;
  groove?: string;
  /** A pattern copy's line: a point on it is written as coordinates, not a station. */
  copy: boolean;
  label: string;
}

export interface SnapTargets {
  points: SnapPoint[];
  lines: SnapLine[];
}

/** What snapping reads of the view model (`alukit.view/1`). */
export interface SnapModel {
  nodes: Readonly<Record<string, V3>>;
  bars: Readonly<Record<string, BarJson>>;
  parts?: Readonly<Record<string, PartJson>>;
  display: {
    bars: Readonly<Record<string, ViewBar>>;
    sections: Readonly<Record<string, ViewSection>>;
    parts?: Readonly<Record<string, ViewPart>>;
  };
}

export interface Ray {
  o: V3;
  d: V3;
}

/** World point to screen pixels, or undefined when it is behind the camera. */
export type Project = (p: V3) => P2 | undefined;

/** Snap radii in pixels: a point wins inside its radius (a face centre inside a smaller one), a line inside its own. */
export const SNAP_PX = { point: 10, centre: 6, line: 7 } as const;

/** The default grid step (§8: 10 mm). */
export const GRID_MM = 10;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addScaled = (a: V3, b: V3, s: number): V3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const dist2 = (a: P2, b: P2) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** A length on the output quantum (0.01 mm, §2). */
export function q(x: number): number {
  const r = Math.round(x * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** A face's centre line in the bar's local x, y (§4.3): the middle of that side of the box. */
export function faceLocal(box: readonly [P2, P2], face: Face): P2 {
  const [[x0, y0], [x1, y1]] = box;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  switch (face) {
    case "+x":
      return [x1, cy];
    case "-x":
      return [x0, cy];
    case "+y":
      return [cx, y1];
    case "-y":
      return [cx, y0];
  }
}

const FACES: readonly Face[] = ["+x", "-x", "+y", "-y"];

/** Grooves by face, numbered from 1 by increasing section coordinate (§4.3), in local x, y. */
export function grooveLines(
  box: readonly [P2, P2],
  section: ViewSection,
  shift: P2,
): { name: string; local: P2 }[] {
  const out: { name: string; local: P2 }[] = [];
  for (const face of FACES) {
    const on = (section.grooves ?? [])
      .filter((g) => g.face === face)
      .map((g) => g.at_mm)
      .sort((a, b) => a - b);
    const [fx, fy] = faceLocal(box, face);
    on.forEach((g, i) => {
      const local: P2 = face === "+y" || face === "-y" ? [g + shift[0], fy] : [fx, g + shift[1]];
      out.push({ name: `${face}.${i + 1}`, local });
    });
  }
  return out;
}

/** A plate's outline centroid (area-weighted), when the outline has area and holds it. */
function plateCentre(outline: readonly P2[]): P2 | undefined {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i] as P2;
    const [x1, y1] = outline[(i + 1) % outline.length] as P2;
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-9) return undefined;
  const p: P2 = [cx / (3 * a), cy / (3 * a)];
  // A concave outline's centroid may lie in a notch, off the plate.
  return insidePolygon(p, outline) ? p : undefined;
}

/**
 * A part's snap points in its own frame (§3.2): its datums, and its origin unless a datum is
 * there; then the centre of each face it has, which are on the material: a box's six faces; a
 * plate's front (z = T) and back (z = 0) at its outline's centroid, when that lies on the plate;
 * a bent angle's flats, inside and outside, at the middle of each leg's flat (M6: leg a on the
 * mounting face along +y, leg b rising along +z, each flat from R + T to the leg's length).
 */
export function partPoints(
  view: ViewPart | undefined,
): { local: V3; name: string; rank: number }[] {
  const out: { local: V3; name: string; rank: number }[] = [];
  const datums = view?.datums ?? {};
  for (const [name, d] of Object.entries(datums))
    out.push({ local: d, name: `datum ${name}`, rank: 0 });
  if (!Object.values(datums).some((d) => d[0] === 0 && d[1] === 0 && d[2] === 0)) {
    out.push({ local: [0, 0, 0], name: "origin", rank: 0 });
  }
  const shape = view?.shape;
  if (shape?.kind === "plate") {
    const c = plateCentre(shape.outline);
    if (c) {
      out.push({ local: [c[0], c[1], shape.thickness], name: "front face centre", rank: 1 });
      out.push({ local: [c[0], c[1], 0], name: "back face centre", rank: 1 });
    }
  } else if (shape?.kind === "bent-angle") {
    const { thickness: T, radius: R, length: L } = shape;
    const [a, b] = shape.legs;
    const ya = (R + T + a) / 2;
    const zb = (R + T + b) / 2;
    out.push({ local: [L / 2, ya, 0], name: "leg a outside centre", rank: 1 });
    out.push({ local: [L / 2, ya, T], name: "leg a inside centre", rank: 1 });
    out.push({ local: [L / 2, 0, zb], name: "leg b outside centre", rank: 1 });
    out.push({ local: [L / 2, T, zb], name: "leg b inside centre", rank: 1 });
  } else if (view?.box) {
    const [[x0, y0, z0], [x1, y1, z1]] = view.box;
    const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const faces: [string, V3][] = [
      ["+x", [x1, c[1], c[2]]],
      ["-x", [x0, c[1], c[2]]],
      ["+y", [c[0], y1, c[2]]],
      ["-y", [c[0], y0, c[2]]],
      ["+z", [c[0], c[1], z1]],
      ["-z", [c[0], c[1], z0]],
    ];
    for (const [f, p] of faces) out.push({ local: p, name: `${f} face centre`, rank: 1 });
  }
  return out;
}

/** The snap targets of a model (§8). */
export function snapTargets(m: SnapModel): SnapTargets {
  const points: SnapPoint[] = [];
  const lines: SnapLine[] = [];
  for (const [id, p] of Object.entries(m.nodes)) {
    if (id.includes("@")) continue;
    points.push({ p, ref: { kind: "node", node: id }, label: `node ${id}`, rank: 0, of: id });
  }
  for (const [id, bar] of Object.entries(m.bars)) {
    const copy = id.includes("@");
    const view = m.display.bars[id];
    const section = view ? m.display.sections[view.section] : undefined;
    const t = bar.frame.z;
    const len = bar.len_mm;
    for (const end of ["a", "b"] as const) {
      const p = end === "a" ? bar.a : bar.b;
      points.push({
        p,
        ref: copy ? { kind: "free" } : { kind: "end", bar: id, end },
        label: `end ${id}.${end}`,
        rank: 0,
        of: id,
      });
    }
    const at = (lx: number, ly: number): V3 =>
      addScaled(addScaled(bar.a, bar.frame.x, lx), bar.frame.y, ly);
    lines.push({ bar: id, a: bar.a, t, len, copy, label: `on ${id}` });
    for (const face of FACES) {
      const [lx, ly] = faceLocal(bar.box_mm, face);
      const a = at(lx, ly);
      lines.push({ bar: id, a, t, len, face, copy, label: `${id} ${face} face` });
      points.push({
        p: addScaled(a, t, len / 2),
        ref: copy ? { kind: "free" } : { kind: "station", bar: id, at_mm: q(len / 2), face },
        label: `${id} ${face} face centre`,
        rank: 1,
        of: id,
      });
    }
    if (section && view) {
      for (const g of grooveLines(bar.box_mm, section, view.shift)) {
        lines.push({
          bar: id,
          a: at(g.local[0], g.local[1]),
          t,
          len,
          groove: g.name,
          copy,
          label: `${id} groove ${g.name}`,
        });
      }
    }
  }
  for (const [id, part] of Object.entries(m.parts ?? {})) {
    if (part.unplaced || !part.frame || !part.origin) continue;
    const { x, y, z } = part.frame;
    const o = part.origin;
    for (const lp of partPoints(m.display.parts?.[id])) {
      const [lx, ly, lz] = lp.local;
      points.push({
        p: addScaled(addScaled(addScaled(o, x, lx), y, ly), z, lz),
        ref: { kind: "part", part: id },
        label: `${id} ${lp.name}`,
        rank: lp.rank,
        of: id,
      });
    }
  }
  return { points, lines };
}

/**
 * The parameters of the closest points of a ray (o + d·u, u ≥ 0) and a line (a + t·s): the
 * classic two-line solution; parallel lines give s at the ray origin's foot.
 */
export function rayLineParams(ray: Ray, a: V3, t: V3): { u: number; s: number } {
  const w = sub(ray.o, a);
  const A = dot(ray.d, ray.d);
  const B = dot(ray.d, t);
  const C = dot(t, t);
  const D = dot(ray.d, w);
  const E = dot(t, w);
  const den = A * C - B * B;
  if (Math.abs(den) < 1e-12 * A * C) return { u: 0, s: E / C };
  return { u: (B * E - C * D) / den, s: (A * E - B * D) / den };
}

/** The station along a line nearest the ray, within the line's extent. */
function nearestOn(ray: Ray, l: SnapLine): number {
  const { s } = rayLineParams(ray, l.a, l.t);
  return Math.max(0, Math.min(l.len, s));
}

/** A station moved onto the grid along its line, unless that leaves the line. */
function onGrid(s: number, len: number, step: number): number {
  const g = Math.round(s / step) * step;
  return g >= 0 && g <= len ? g : s;
}

export interface SnapOptions {
  /** The pointer in screen pixels. */
  at: P2;
  ray: Ray;
  project: Project;
  /** Grid step along lines (mm). */
  step?: number;
  /**
   * Entities nothing of snaps to, by id (hidden ones, E-UX-9): a bar's ends, faces and lines, a
   * part's points, a node. A pattern copy is skipped when its own id is in the set.
   */
  skip?: ReadonlySet<string>;
  /** Points the view does not show (the section plane's far side): nothing snaps there. */
  hidden?: (p: V3) => boolean;
}

/** A line's snapped point as a snap: a station on the bar, or coordinates on a copy. */
export function lineSnap(l: SnapLine, s: number): Snap {
  const p = addScaled(l.a, l.t, s);
  const at = q(s);
  const ref: SnapRef = l.copy
    ? { kind: "free" }
    : {
        kind: "station",
        bar: l.bar,
        at_mm: at,
        ...(l.face ? { face: l.face } : {}),
        ...(l.groove ? { groove: l.groove } : {}),
      };
  return {
    p,
    ref,
    label: `${l.label} at ${at}`,
    kind: "line",
    line: { a: l.a, t: l.t, len: l.len },
  };
}

/** Screen distances closer than this (px²) are a tie, won by the target nearer the eye. */
const TIE_PX2 = 0.25;

/**
 * The best snap near the pointer: a point inside its radius, else a line inside its own. Of
 * targets drawn on top of each other (a face seen edge on hides the one behind it), the one
 * nearer the eye wins.
 */
export function findSnap(targets: SnapTargets, o: SnapOptions): Snap | undefined {
  const step = o.step ?? GRID_MM;
  const skip = o.skip ?? new Set<string>();
  const radius2 = (rank: number) => (rank === 0 ? SNAP_PX.point : SNAP_PX.centre) ** 2;
  const depth = (p: V3) => dot(sub(p, o.ray.o), o.ray.d);
  let best: { snap: Snap; score: number; depth: number } | undefined;
  for (const pt of targets.points) {
    if (skip.has(pt.of)) continue;
    if (o.hidden?.(pt.p)) continue;
    const sp = o.project(pt.p);
    if (!sp) continue;
    const d2 = dist2(sp, o.at);
    if (d2 > radius2(pt.rank)) continue;
    // A rank is worth 3 px: an end beats a face centre drawn almost on it.
    const score = Math.sqrt(d2) + pt.rank * 3;
    const z = depth(pt.p);
    if (!best || score < best.score - 0.5 || (score <= best.score + 0.5 && z < best.depth)) {
      best = { snap: { p: pt.p, ref: pt.ref, label: pt.label, kind: "point" }, score, depth: z };
    }
  }
  if (best) return best.snap;
  const rl = SNAP_PX.line ** 2;
  let bestLine: { l: SnapLine; s: number; d2: number; depth: number } | undefined;
  for (const l of targets.lines) {
    if (skip.has(l.bar)) continue;
    const s = nearestOn(o.ray, l);
    const p = addScaled(l.a, l.t, s);
    if (o.hidden?.(p)) continue;
    const sp = o.project(p);
    if (!sp) continue;
    const d2 = dist2(sp, o.at);
    if (d2 > rl) continue;
    const z = depth(p);
    if (
      !bestLine ||
      d2 < bestLine.d2 - TIE_PX2 ||
      (d2 <= bestLine.d2 + TIE_PX2 && z < bestLine.depth - 1e-6)
    ) {
      bestLine = { l, s, d2, depth: z };
    }
  }
  // Near the line; the station itself lands on the grid along it (§8: 10 mm by default).
  return bestLine ? lineSnap(bestLine.l, onGrid(bestLine.s, bestLine.l.len, step)) : undefined;
}

/**
 * Where a line through `from` along `dir` meets a snap line, if it does (closest approach within
 * `tol` mm, inside the line's extent): the draw tool's constrained end meeting a bar exactly.
 */
export function meetLine(
  from: V3,
  dir: V3,
  line: { a: V3; t: V3; len: number },
  tol = 0.5,
): { p: V3; s: number } | undefined {
  const { u, s } = rayLineParams({ o: from, d: dir }, line.a, line.t);
  if (s < -1e-6 || s > line.len + 1e-6) return undefined;
  const p1 = addScaled(from, dir, u);
  const p2 = addScaled(line.a, line.t, s);
  const gap = Math.sqrt(dot(sub(p1, p2), sub(p1, p2)));
  return gap <= tol ? { p: p2, s } : undefined;
}
