import { compareIds } from "../ids.ts";
import type { Face } from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { add, addScaled, dot, scale, sub, type V3 } from "../vec.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar } from "./derive.ts";
import { outlineFaces } from "./outline.ts";
import { facePlane, localOf } from "./place.ts";
import { convexHull, convexPieces, discArea, type P2 } from "./polygon.ts";
import type { DerivedPart } from "./types.ts";

/**
 * What stands in front of a hole's mouth in a bar's face (after the round-4 acceptance, X9). A hole
 * a tool reaches through once the frame is built (a quick connector's cross hole, whose bush's set
 * screw is turned through it) is no use with another member over it, so derive drills it from a
 * face no other member covers, and says when it cannot.
 *
 * A member **covers** a mouth where its patch reaches into it: the part of its body within `depth`
 * of the face's plane outside the bar (the room a tool needs in front of the mouth, along the
 * hole's axis; also any part of it that goes into the bar), seen along the face's normal. A member
 * on the face (a butt's end, a layer of a face connection, a strip laid on it) covers it, and so
 * does one standing a few millimetres off it, which leaves no room for the tool either. Each body
 * is cut into convex prisms (a bar: its section's outline with its grooves closed, A3, in convex
 * pieces, between its two end faces; a placed part: its box); each prism is clipped to that slab
 * outside the face, and the clipped prism's vertices, seen along the normal, span a convex patch.
 * The mouth is the hole's disc on the face, shrunk by tol.len, so that a member whose edge only
 * meets its rim does not cover it. The share is the area of the patches in the mouth over the
 * mouth's area.
 *
 * The members are the other bars and the placed parts with a box; a connector's body (a cube) and
 * the fasteners are not (a v1 limit).
 *
 * **When a member arrives** (after the decided frame's ninth run, F11). The tool turns through the
 * mouth when the joint is made. A member placed after the frame's joints are made (a bar or a part
 * with `after_assembly`, a wall the frame is set against, a panel fitted last; or a part on a
 * station of such a bar, which cannot be there before its bar) is not there then; it stops the
 * tool only afterwards, when the joint would be re-tightened. Each cover says whether its member
 * arrives so (`later`); which joints it does not block is the joint's to say (`hardware.ts`).
 */

/**
 * The room a tool needs in front of a hole's mouth, along its axis, when the requirement gives none
 * (`access_mm`): an estimate, the length of a hex key's arm (call 57).
 */
export const ACCESS_MM = 30;

/**
 * A member over a mouth, and how much of the mouth its patch covers (0 to 1); `later` when the
 * member is placed after the frame's joints are made (F11).
 */
export interface Cover {
  id: string;
  share: number;
  later?: true;
}

/** A convex prism of a member's body: its corners, its edges, and its box in world terms. */
interface Prism {
  pts: V3[];
  edges: [number, number][];
  lo: V3;
  hi: V3;
}

function boxOf(pts: readonly V3[]): { lo: V3; hi: V3 } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i] as number, p[i] as number);
      hi[i] = Math.max(hi[i] as number, p[i] as number);
    }
  }
  return { lo, hi };
}

/** A point of a bar's section, local (lx, ly) off its design line, on one of its end planes. */
function onEnd(b: DerivedBar, lx: number, ly: number, e: { point: V3; normal: V3 }): V3 {
  const { A, frame } = b.placed;
  const O = add(A, add(scale(frame.x, lx), scale(frame.y, ly)));
  return addScaled(O, frame.t, dot(sub(e.point, O), e.normal) / dot(frame.t, e.normal));
}

/** A bar's body as convex prisms: its closed outline's convex pieces between its end faces. */
function barPrisms(b: DerivedBar): Prism[] {
  const [dx, dy] = localOf(b.placed, 0, 0);
  const ring = outlineFaces(b.placed.item.section).ring;
  return convexPieces(ring).map((piece) => {
    const k = piece.length;
    const pts = [
      ...piece.map(([x, y]) => onEnd(b, x + dx, y + dy, b.ends.a)),
      ...piece.map(([x, y]) => onEnd(b, x + dx, y + dy, b.ends.b)),
    ];
    const edges: [number, number][] = [];
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      edges.push([i, j], [k + i, k + j], [i, k + i]);
    }
    return { pts, edges, ...boxOf(pts) };
  });
}

/** A placed part's box as one prism, or none when its item gives no box. */
function partPrism(p: DerivedPart, box: readonly [V3, V3] | undefined): Prism | undefined {
  if (!p.placed || !box) return undefined;
  const pts: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const c = [0, 1, 2].map((a) => (box[(i >> a) & 1] as V3)[a] as number);
    pts.push(
      add(
        p.origin,
        add(
          add(scale(p.frame.x, c[0] as number), scale(p.frame.y, c[1] as number)),
          scale(p.frame.z, c[2] as number),
        ),
      ),
    );
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    for (let a = 0; a < 3; a++) {
      const j = i | (1 << a);
      if (j !== i) edges.push([i, j]);
    }
  }
  return { pts, edges, ...boxOf(pts) };
}

export class Covers {
  private readonly ctx: Ctx;
  private readonly bars: ReadonlyMap<string, DerivedBar>;
  private readonly parts: ReadonlyMap<string, DerivedPart>;
  private readonly prisms = new Map<string, Prism[]>();

  constructor(
    ctx: Ctx,
    bars: ReadonlyMap<string, DerivedBar>,
    parts: ReadonlyMap<string, DerivedPart>,
  ) {
    this.ctx = ctx;
    this.bars = bars;
    this.parts = parts;
  }

  private prismsOf(id: string): Prism[] {
    let ps = this.prisms.get(id);
    if (ps) return ps;
    const bar = this.bars.get(id);
    if (bar) ps = barPrisms(bar);
    else {
      const p = this.parts.get(id);
      const found = p ? this.ctx.items.item(p.item) : undefined;
      const box = found?.ok ? (found.item as { bbox_mm?: readonly [V3, V3] }).bbox_mm : undefined;
      const one = p ? partPrism(p, box) : undefined;
      ps = one ? [one] : [];
    }
    this.prisms.set(id, ps);
    return ps;
  }

  /**
   * Whether a member (a bar or a placed part) is placed after the frame's joints are made (F11):
   * its own `after_assembly`, or, for a part on a station, its bar's. A pattern's copy reads its
   * template's, whose fields it copies.
   */
  later(id: string): boolean {
    const spec = (map: ReadonlyMap<string, { spec: object }>) =>
      (map.get(id) ?? map.get(id.slice(0, id.includes("@") ? id.indexOf("@") : id.length)))?.spec;
    const own = (s: object | undefined) =>
      s !== undefined && "after_assembly" in s && s.after_assembly === true;
    if (this.bars.has(id)) return own(spec(this.ctx.bars));
    const p = this.parts.get(id);
    if (!p?.placed) return false;
    return own(spec(this.ctx.parts)) || (p.bar !== undefined && this.later(p.bar));
  }

  /**
   * The members whose patch within `depth` of `bar`'s face reaches into the mouth of a hole `d`
   * across centred at C (a point of the face's plane), in id order, with their shares; a member
   * placed after the frame's joints are made is marked `later` (F11).
   */
  mouth(bar: DerivedBar, face: Face, C: V3, d: number, depth: number): Cover[] {
    const P = bar.placed;
    const { p, n } = facePlane(P, face);
    const u = face === "+x" || face === "-x" ? P.frame.y : P.frame.x;
    const w = P.frame.t;
    const r = d / 2 - TOL.len;
    if (r <= 0) return [];
    const c: P2 = [dot(sub(C, p), u), dot(sub(C, p), w)];
    const ids = [
      ...[...this.bars.keys()].filter((id) => id !== P.id),
      ...[...this.parts.keys()].filter((id) => this.parts.get(id)?.placed),
    ];
    const out: Cover[] = [];
    // The slab in front of the mouth, from the face's plane (less tol.len, so that a member in
    // contact counts) out to `depth`.
    const lo = -TOL.len;
    const hi = Math.max(depth, 0) + TOL.len;
    for (const id of ids) {
      // The slab over the mouth, as a world box, to pass over the prisms far from it.
      const reach = r + hi + TOL.len;
      let area = 0;
      for (const pr of this.prismsOf(id)) {
        if ([0, 1, 2].some((a) => (pr.lo[a] as number) > (C[a] as number) + reach)) continue;
        if ([0, 1, 2].some((a) => (pr.hi[a] as number) < (C[a] as number) - reach)) continue;
        const h = pr.pts.map((X) => dot(sub(X, p), n));
        const kept: V3[] = pr.pts.filter(
          (_, i) => (h[i] as number) >= lo && (h[i] as number) <= hi,
        );
        for (const [i, j] of pr.edges) {
          const hi0 = h[i] as number;
          const hj = h[j] as number;
          for (const level of [lo, hi]) {
            if ((hi0 - level) * (hj - level) >= 0) continue;
            const t = (level - hi0) / (hj - hi0);
            kept.push(addScaled(pr.pts[i] as V3, sub(pr.pts[j] as V3, pr.pts[i] as V3), t));
          }
        }
        if (kept.length < 3) continue;
        const hull = convexHull(kept.map((X) => [dot(sub(X, p), u), dot(sub(X, p), w)] as P2));
        if (hull.length >= 3) area += discArea(c, r, hull);
      }
      const share = Math.min(1, area / (Math.PI * r * r));
      if (share > 1e-9)
        out.push({ id, share, ...(this.later(id) ? { later: true as const } : {}) });
    }
    return out.sort((a, b) => compareIds(a.id, b.id));
  }
}
