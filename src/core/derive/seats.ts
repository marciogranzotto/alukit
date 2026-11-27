import { num } from "#catalog/schema/common.ts";
import { compareIds } from "../ids.ts";
import { TOL } from "../tolerances.ts";
import { add, addScaled, cross, dot, neg, scale, sub, unit, type V3 } from "../vec.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar } from "./derive.ts";
import { outlineFaces } from "./outline.ts";
import { facePlane, localOf } from "./place.ts";
import {
  area2,
  ccw,
  convexPieces,
  distanceOutside,
  isConvex,
  type P2,
  sharedArea,
  triangulate,
} from "./polygon.ts";
import type { ButtFace, ButtHead, ButtSeat } from "./types.ts";

/**
 * A butt's end faces on the faces they bear on (§4.5, after acceptance run 4). Stage 3 placed each
 * butting end on the first face its centre line meets, and checked only that line: the end face
 * itself may reach past the face (an **overhang**), and the butting bar may go into the
 * receiving body beyond the face (an **overlap**). Both are measured on the trimmed bars:
 *
 * - The butting **end face** is its section's outline with every grooved side closed (A3), on the
 *   end's plane. The **face** it bears on is the receiving body's: a side of the through bar's
 *   box, whole across (A3: a grooved side is its bounding plane) and trimmed by its end faces;
 *   the through bar's end face, its outline with its grooves closed; or a side of a through
 *   body's box. Both are seen along the face's normal.
 * - The **overhang** is how far the end face reaches past the face's outline, the greatest
 *   distance of one of its vertices from it, with the area of it that lies past it. Past the
 *   connector's `overhang_mm`, else the project's `defaults.butt.overhang_mm`, else 0, by more
 *   than tol.len: a `connection` warning (§5.5).
 * - The **overlap** is how far the butting bar's body, its outline with its grooves closed between
 *   its two end faces, goes into the receiving body (the through bar's box between its end faces,
 *   or the body's box) beyond the face's plane. More than tol.len: a `connection` error (§5.5).
 */

export interface ButtSeats {
  ends: ButtSeat[];
  /** Its connector's screw heads, seated in stage 4 (after the alternative frame's acceptance, F2b). */
  heads?: ButtHead[];
}

/** A half-space, n · X ≤ c. */
interface Half {
  n: V3;
  c: number;
}

/** The face an end bears on, in world terms, and the body behind it. */
interface Receiver {
  /** `b1 +y`, `b1.b`, `<item> +x`. */
  on: string;
  /** `b1's face +y`, `b1's end b`, `<item>'s face +x`. */
  text: string;
  /** The receiving body, `b1` or the item, and its face, for the overlap's words. */
  body: string;
  face: string;
  bar?: string;
  /** A point of the face's plane, and its outward normal. */
  p: V3;
  n: V3;
  poly: V3[];
  /** The face as convex pieces, for the area the end face shares with it; `convex`: one. */
  pieces: V3[][];
  convex: boolean;
  /** The receiving body's half-spaces. */
  halves: Half[];
}

export function buttSeats(
  ctx: Ctx,
  bars: ReadonlyMap<string, DerivedBar>,
  faces: ReadonlyMap<string, ReadonlyMap<string, ButtFace>>,
): Map<string, ButtSeats> {
  const out = new Map<string, ButtSeats>();
  for (const id of [...faces.keys()].sort(compareIds)) {
    const spec = ctx.conns.get(id)?.spec;
    const by = faces.get(id);
    if (spec?.type !== "butt" || !by) continue;
    const limit = overhangLimit(ctx, spec.connector);
    const seats: ButtSeat[] = [];
    for (const ref of spec.ends) {
      const f = by.get(ref);
      const i = ref.lastIndexOf(".");
      const K = bars.get(ref.slice(0, i));
      const end = ref.slice(i + 1) as "a" | "b";
      // An end whose plane is not this butt's, after an error, has no seat of the butt's.
      if (!f || !K || K.ends[end].by !== id) continue;
      const R = receiver(bars, f);
      if (!R) continue;
      const seat = measure(K, end, ref, R);
      seats.push(seat);
      const refs = R.bar ? [K.placed.id, R.bar] : [K.placed.id];
      if (seat.overhang > limit.mm + TOL.len) {
        const pct = ((100 * seat.overhang_area) / seat.area).toFixed(1);
        const more = limit.by ? `, more than the ${mm(limit.mm)} mm ${limit.by} allows` : "";
        ctx.d.warn(
          "connection",
          id,
          `${ref}'s end face overhangs ${R.text} by ${mm(seat.overhang)} mm: ${mm(seat.overhang_area)} of its ${mm(seat.area)} mm² (${pct} %) bear on nothing${more}`,
          { refs },
        );
      }
      if (seat.overlap > TOL.len) {
        const what = R.bar ? "the two bars overlap" : "the bar and the body overlap";
        ctx.d.error(
          "connection",
          id,
          `${ref} goes ${mm(seat.overlap)} mm into ${R.body} beyond its ${R.face}: ${what}`,
          { refs },
        );
      }
    }
    if (seats.length > 0) out.set(id, { ends: seats });
  }
  return out;
}

/** The overhang a butt allows: its connector's, else the project's, else none. */
function overhangLimit(ctx: Ctx, own: string | undefined): { mm: number; by?: string } {
  const def = ctx.doc.defaults.butt;
  const connector = own ?? def?.connector;
  if (connector) {
    const found = ctx.items.item(connector);
    if (found.ok && found.item.kind === "connector" && found.item.overhang_mm !== undefined) {
      return { mm: num(found.item.overhang_mm), by: found.id };
    }
  }
  if (def?.overhang_mm !== undefined) {
    return { mm: def.overhang_mm, by: "defaults.butt.overhang_mm" };
  }
  return { mm: 0 };
}

/** A bar's box between its end faces, as half-spaces. */
function barHalves(T: DerivedBar): Half[] {
  const { A, frame, box } = T.placed;
  const ax = dot(A, frame.x);
  const ay = dot(A, frame.y);
  return [
    { n: frame.x, c: ax + box.x1 },
    { n: neg(frame.x), c: -(ax + box.x0) },
    { n: frame.y, c: ay + box.y1 },
    { n: neg(frame.y), c: -(ay + box.y0) },
    ...(["a", "b"] as const).map((e) => ({
      n: T.ends[e].normal,
      c: dot(T.ends[e].normal, T.ends[e].point),
    })),
  ];
}

/** A point of a bar's section, local (lx, ly) off its design line, on one of its end planes. */
function onEnd(b: DerivedBar, lx: number, ly: number, e: { point: V3; normal: V3 }): V3 {
  const { A, frame } = b.placed;
  const O = add(A, add(scale(frame.x, lx), scale(frame.y, ly)));
  return addScaled(O, frame.t, dot(sub(e.point, O), e.normal) / dot(frame.t, e.normal));
}

/**
 * A section's outline with its grooves closed, counter-clockwise, its convex pieces and its
 * triangles, in section terms: worked once per section.
 */
interface Shape {
  ring: P2[];
  convex: boolean;
  pieces: P2[][];
  tris: P2[][];
}

const shapes = new WeakMap<object, Shape>();

function shapeOf(section: DerivedBar["placed"]["item"]["section"]): Shape {
  let s = shapes.get(section);
  if (!s) {
    const ring = ccw(outlineFaces(section).ring);
    s = { ring, convex: isConvex(ring), pieces: convexPieces(ring), tris: triangulate(ring) };
    shapes.set(section, s);
  }
  return s;
}

/** A bar's outline, its convex pieces and its triangles, in local terms (a shift of the section's). */
function localShape(b: DerivedBar): Shape {
  const s = shapeOf(b.placed.item.section);
  const [dx, dy] = localOf(b.placed, 0, 0);
  const move = (ps: readonly P2[]): P2[] => ps.map(([x, y]) => [x + dx, y + dy]);
  return {
    ring: move(s.ring),
    convex: s.convex,
    pieces: s.pieces.map(move),
    tris: s.tris.map(move),
  };
}

function receiver(bars: ReadonlyMap<string, DerivedBar>, f: ButtFace): Receiver | undefined {
  if (f.kind === "body") {
    const sl = f.prism.slabs[f.slab];
    if (!sl) return undefined;
    const others = f.prism.slabs.filter((_, k) => k !== f.slab);
    const [j, k] = others;
    if (!j || !k) return undefined;
    const base = (s: (typeof f.prism.slabs)[number], v: number) => scale(s.n, v);
    const at = (vj: number, vk: number) =>
      add(sl.origin, add(base(sl, f.side ? sl.hi : sl.lo), add(base(j, vj), base(k, vk))));
    const halves = f.prism.slabs.flatMap((s) => {
      const o = dot(s.n, s.origin);
      return [
        { n: s.n, c: o + s.hi },
        { n: neg(s.n), c: -(o + s.lo) },
      ];
    });
    return {
      on: `${f.item} ${f.face}`,
      text: `${f.item}'s face ${f.face}`,
      body: f.item,
      face: `face ${f.face}`,
      p: at(j.lo, k.lo),
      n: f.side ? sl.n : neg(sl.n),
      poly: [at(j.lo, k.lo), at(j.hi, k.lo), at(j.hi, k.hi), at(j.lo, k.hi)],
      pieces: [[at(j.lo, k.lo), at(j.hi, k.lo), at(j.hi, k.hi), at(j.lo, k.hi)]],
      convex: true,
      halves,
    };
  }
  const T = bars.get(f.bar);
  if (!T) return undefined;
  if (f.kind === "end") {
    const e = T.ends[f.end];
    const shape = localShape(T);
    return {
      on: `${T.placed.id}.${f.end}`,
      text: `${T.placed.id}'s end ${f.end}`,
      body: T.placed.id,
      face: `end ${f.end}`,
      bar: T.placed.id,
      p: e.point,
      n: e.normal,
      poly: shape.ring.map(([lx, ly]) => onEnd(T, lx, ly, e)),
      pieces: shape.pieces.map((pc) => pc.map(([lx, ly]) => onEnd(T, lx, ly, e))),
      convex: shape.convex,
      halves: barHalves(T),
    };
  }
  const { box } = T.placed;
  const edge: Record<typeof f.face, [P2, P2]> = {
    "+x": [
      [box.x1, box.y0],
      [box.x1, box.y1],
    ],
    "-x": [
      [box.x0, box.y0],
      [box.x0, box.y1],
    ],
    "+y": [
      [box.x0, box.y1],
      [box.x1, box.y1],
    ],
    "-y": [
      [box.x0, box.y0],
      [box.x1, box.y0],
    ],
  };
  const [o0, o1] = edge[f.face];
  const pl = facePlane(T.placed, f.face);
  const poly = [
    onEnd(T, o0[0], o0[1], T.ends.a),
    onEnd(T, o1[0], o1[1], T.ends.a),
    onEnd(T, o1[0], o1[1], T.ends.b),
    onEnd(T, o0[0], o0[1], T.ends.b),
  ];
  return {
    on: `${T.placed.id} ${f.face}`,
    text: `${T.placed.id}'s face ${f.face}`,
    body: T.placed.id,
    face: `face ${f.face}`,
    bar: T.placed.id,
    p: pl.p,
    n: pl.n,
    poly,
    pieces: [poly],
    convex: true,
    halves: barHalves(T),
  };
}

function measure(K: DerivedBar, end: "a" | "b", ref: string, R: Receiver): ButtSeat {
  // The face's plane in 2D: u, w across it.
  const u = unit(cross(R.n, Math.abs(R.n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) as V3;
  const w = cross(R.n, u);
  const to2 = (X: V3): P2 => {
    const v = sub(X, R.p);
    return [dot(v, u), dot(v, w)];
  };
  const shape = localShape(K);
  const E = ccw(shape.ring.map(([lx, ly]) => to2(onEnd(K, lx, ly, K.ends[end]))));
  const F = ccw(R.poly.map(to2));
  const area = Math.abs(area2(E));
  let overhang = 0;
  for (const v of E) overhang = Math.max(overhang, distanceOutside(v, F));
  // Every vertex on a convex face: all of the end face is on it.
  const outside =
    R.convex && overhang === 0
      ? 0
      : area -
        sharedArea(
          E,
          R.pieces.map((pc) => pc.map(to2)),
        );
  return {
    end: ref,
    on: R.on,
    area,
    overhang: snap(overhang, TOL.len / 100),
    overhang_area: snap(outside, TOL.len * TOL.len),
    overlap: snap(overlap(K, shape, R), TOL.len / 100),
  };
}

/**
 * How far the butting bar goes into the receiving body beyond the face: the greatest depth below
 * the face's plane, n · (p − X), of a point X of both. The bar's body is its outline's prism
 * between its end faces; cut into the outline's triangles, each piece and the receiving body are
 * convex, so the depth is a linear programme over their half-spaces, greatest at a vertex: the
 * meeting point of three of their planes that lies in all of them. A piece none of whose own
 * vertices goes past the plane by more than tol.len is not tried, and when no vertex of the bar
 * does, the depth is 0.
 */
function overlap(K: DerivedBar, shape: Shape, R: Receiver): number {
  const { ring } = shape;
  const depth = (X: V3) => dot(sub(R.p, X), R.n);
  const { A, frame } = K.placed;
  const ends = [K.ends.a, K.ends.b];
  const at = (p: P2, e: (typeof ends)[number]) => onEnd(K, p[0], p[1], e);
  let deepest = 0;
  for (const e of ends) for (const p of ring) deepest = Math.max(deepest, depth(at(p, e)));
  if (deepest <= TOL.len) return 0;
  const endHalves: Half[] = ends.map((e) => ({ n: e.normal, c: dot(e.normal, e.point) }));
  const world = (l: P2) => add(scale(frame.x, l[0]), scale(frame.y, l[1]));
  let best = 0;
  for (const tri of shape.tris) {
    if (Math.max(...ends.flatMap((e) => tri.map((p) => depth(at(p, e))))) <= TOL.len) continue;
    const sides: Half[] = tri.map((a, k) => {
      const b = tri[(k + 1) % 3] as P2;
      // Inside the counter-clockwise triangle is left of each edge: L · (X − A) ≥ L · a.
      const L = world([-(b[1] - a[1]), b[0] - a[0]]);
      return { n: neg(L), c: -(dot(L, A) + dot(L, world(a))) };
    });
    best = Math.max(best, deepestIn([...sides, ...endHalves, ...R.halves], depth));
  }
  return best;
}

/** The greatest of a linear function over the polytope of some half-spaces: 0 when it is empty. */
function deepestIn(hs: readonly Half[], f: (X: V3) => number): number {
  let best = 0;
  const n = hs.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const X = meet(hs[i] as Half, hs[j] as Half, hs[k] as Half);
        if (!X) continue;
        if (hs.every((h) => dot(h.n, X) <= h.c + 1e-7)) best = Math.max(best, f(X));
      }
    }
  }
  return best;
}

/** Where three planes meet (Cramer's rule), or undefined when they do not meet in one point. */
function meet(a: Half, b: Half, c: Half): V3 | undefined {
  const bc = cross(b.n, c.n);
  const det = dot(a.n, bc);
  if (Math.abs(det) < 1e-12) return undefined;
  const ca = cross(c.n, a.n);
  const ab = cross(a.n, b.n);
  return scale(add(add(scale(bc, a.c), scale(ca, b.c)), scale(ab, c.c)), 1 / det);
}

const snap = (x: number, eps: number) => (x <= eps ? 0 : x);
const mm = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
