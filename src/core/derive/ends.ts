import { compareIds } from "../ids.ts";
import type { ButtConn, Connection, EndSpec, MiterConn, SpliceConn } from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { atan2Deg } from "../trig.ts";
import {
  add,
  addScaled,
  angleDeg,
  cross,
  dist,
  dot,
  neg,
  scale,
  sub,
  unit,
  type V3,
} from "../vec.ts";
import type { Ctx } from "./context.ts";
import {
  barPrism,
  bodyPrism,
  boxCentre,
  centreLine,
  facePlane,
  placeBar,
  placePivot,
  resolvePoint,
} from "./place.ts";
import {
  type BarLengths,
  type Claim,
  END_PROVIDERS,
  type EndFace,
  type EndReport,
  type PlacedBar,
  type PlaneN,
  type Prism,
} from "./types.ts";

/**
 * Stage 3 (design §4.5, §5.1): every bar end gets exactly one end plane from exactly one
 * provider, in two sweeps: placement providers first, then end providers, which read an end face
 * the first sweep resolved. A chain of end providers is an error; nothing iterates. Then the
 * modifiers (`cut`, `extend_mm`), lengths and angles.
 */

type End = "a" | "b";

const key = (bar: string, end: End) => `${bar}.${end}`;

function splitEnd(ref: string): { bar: string; end: End } {
  const i = ref.lastIndexOf(".");
  return { bar: ref.slice(0, i), end: ref.slice(i + 1) as End };
}

/** The outward direction of an end along the axis: −t at a, +t at b. */
function endDir(bar: PlacedBar, end: End): V3 {
  return end === "a" ? neg(bar.frame.t) : bar.frame.t;
}

function designPoint(bar: PlacedBar, end: End): V3 | undefined {
  return end === "a" ? bar.A : bar.B;
}

/** A plane's normal signed to point away from the bar at this end. */
function outward(n: V3, bar: PlacedBar, end: End): V3 {
  return dot(n, endDir(bar, end)) < 0 ? neg(n) : n;
}

/** Where the line A + o + s·t meets a plane, as s. */
function sOn(bar: PlacedBar, o: V3, pl: PlaneN): number {
  return dot(sub(pl.p, add(bar.A, o)), pl.n) / dot(bar.frame.t, pl.n);
}

/** The four corners of the placed bounding box, as offsets from the design line. */
function corners(bar: PlacedBar): V3[] {
  const { x, y } = bar.frame;
  const b = bar.box;
  return [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ].map(([lx, ly]) => add(scale(x, lx as number), scale(y, ly as number)));
}

// ---------------------------------------------------------------------------------------------
// A line through a prism (the slab method)

interface Crossing {
  s: number;
  slab: number;
  /** 0: the slab's lo face, 1: its hi face. */
  side: 0 | 1;
}

function lineThrough(C: V3, t: V3, prism: Prism): { enter: Crossing; exit: Crossing } | undefined {
  let enter: Crossing | undefined;
  let exit: Crossing | undefined;
  prism.slabs.forEach((sl, i) => {
    const q0 = dot(sub(C, sl.origin), sl.n);
    const dq = dot(t, sl.n);
    if (Math.abs(dq) < 1e-12) {
      if (q0 < sl.lo || q0 > sl.hi) {
        enter = { s: Infinity, slab: i, side: 0 };
        exit = { s: -Infinity, slab: i, side: 0 };
      }
      return;
    }
    const sLo = (sl.lo - q0) / dq;
    const sHi = (sl.hi - q0) / dq;
    const a: Crossing = sLo < sHi ? { s: sLo, slab: i, side: 0 } : { s: sHi, slab: i, side: 1 };
    const b: Crossing = sLo < sHi ? { s: sHi, slab: i, side: 1 } : { s: sLo, slab: i, side: 0 };
    if (!enter || a.s > enter.s) enter = a;
    if (!exit || b.s < exit.s) exit = b;
  });
  if (!enter || !exit) return undefined; // parallel to every slab: no crossing
  const e = enter as Crossing;
  const x = exit as Crossing;
  if (!Number.isFinite(e.s) || !Number.isFinite(x.s) || e.s > x.s) return undefined;
  return { enter: e, exit: x };
}

/** The crossing's face: a point on it and its outward normal. */
function crossingFace(C: V3, t: V3, prism: Prism, c: Crossing): PlaneN {
  const sl = prism.slabs[c.slab] as Prism["slabs"][number];
  return { p: addScaled(C, t, c.s), n: c.side === 1 ? sl.n : neg(sl.n) };
}

/** True when `q` lies inside every slab but `skip`, more than tol.len from its faces. */
function clearOfEdges(q: V3, prism: Prism, skip: number): boolean {
  return prism.slabs.every((sl, i) => {
    if (i === skip) return true;
    const c = dot(sub(q, sl.origin), sl.n);
    return c >= sl.lo + TOL.len && c <= sl.hi - TOL.len;
  });
}

function faceName(prism: Prism, c: Crossing): string {
  return (prism.slabs[c.slab] as Prism["slabs"][number]).faces[c.side];
}

// ---------------------------------------------------------------------------------------------

export interface Stage3 {
  faces: Map<string, EndFace>;
  /** The derived per-bar lengths and end reports, for bars whose ends resolved. */
  lengths: Map<string, { lengths: BarLengths; ends: { a: EndReport; b: EndReport } }>;
}

export function resolveEnds(ctx: Ctx, placed: ReadonlyMap<string, PlacedBar>): Stage3 {
  const s3 = new Ends(ctx, placed);
  return s3.run();
}

class Ends {
  private readonly ctx: Ctx;
  private readonly placed: ReadonlyMap<string, PlacedBar>;
  private readonly claims = new Map<string, Claim[]>();
  private readonly faces = new Map<string, EndFace>();
  /** Connections already reported invalid, so each is reported once. */
  private readonly connPlanes = new Map<string, Map<string, PlaneN> | undefined>();

  constructor(ctx: Ctx, placed: ReadonlyMap<string, PlacedBar>) {
    this.ctx = ctx;
    this.placed = placed;
  }

  run(): Stage3 {
    this.collectClaims();
    const bars = [...this.placed.values()];
    const second: [PlacedBar, End, Claim][] = [];
    for (const bar of bars) {
      for (const end of ["a", "b"] as const) {
        const k = key(bar.id, end);
        const cs = this.claims.get(k) ?? [];
        let claim: Claim | undefined;
        if (cs.length > 1) {
          const names = cs.map((c) => c.name).sort(compareIds);
          this.ctx.d.error(
            "two-providers",
            k,
            `${k} has ${cs.length} providers (${names.join(", ")}); it falls back to the default`,
            { refs: names },
          );
        } else claim = cs[0];
        if (claim && END_PROVIDERS.has(claim.kind)) {
          second.push([bar, end, claim]);
          continue;
        }
        if (end === "b" && bar.free?.fromCut && !bar.B) {
          bar.B = addScaled(bar.A, bar.free.dir, bar.free.len);
        }
        this.finish(bar, end, claim, claim ? this.placementPlane(bar, end, claim) : undefined, 1);
      }
    }
    for (const [bar, end, claim] of second) {
      this.finish(bar, end, claim, this.endPlane(bar, end, claim), 2);
    }
    const lengths = new Map<
      string,
      { lengths: BarLengths; ends: { a: EndReport; b: EndReport } }
    >();
    for (const bar of bars) {
      const fa = this.faces.get(key(bar.id, "a"));
      const fb = this.faces.get(key(bar.id, "b"));
      if (!fa || !fb) continue;
      lengths.set(bar.id, this.lengths(bar, fa, fb));
    }
    return { faces: this.faces, lengths };
  }

  // -------------------------------------------------------------------------------------------
  // Claims

  private claim(owner: string, ref: string, c: Claim): void {
    const { bar } = splitEnd(ref);
    if (!this.ctx.bars.has(bar)) {
      this.ctx.d.error("ref", owner, `no bar ${bar} (in ${ref})`, { refs: [bar] });
      return;
    }
    if (!this.placed.has(bar)) return; // its own failure is reported
    const list = this.claims.get(ref) ?? [];
    if (list.some((x) => x.name === c.name && x.kind === c.kind)) {
      this.ctx.d.error("connection", owner, `${owner} names ${ref} twice`, { refs: [ref] });
      return;
    }
    list.push(c);
    this.claims.set(ref, list);
  }

  private collectClaims(): void {
    const { ctx } = this;
    const connIds = [...ctx.conns.keys()].sort(compareIds);
    for (const id of connIds) {
      const { spec } = ctx.conns.get(id) as { spec: Connection };
      switch (spec.type) {
        case "butt": {
          const through = spec.through;
          const kind =
            typeof through !== "string" ? "butt-body" : through.includes(".") ? "butt-end" : "butt";
          for (const e of spec.ends) this.claim(id, e, { kind, conn: id, name: id });
          if (kind !== "butt" && spec.through_end !== undefined) {
            const what = kind === "butt-end" ? "a bar's end" : "a body";
            ctx.d.error("connection", id, `through_end does not apply when through is ${what}`, {
              field: "through_end",
            });
          }
          if (kind === "butt") this.claimThroughEnd(id, spec);
          break;
        }
        case "miter":
        case "splice":
        case "pivot":
          for (const e of spec.ends) this.claim(id, e, { kind: spec.type, conn: id, name: id });
          break;
        case "face":
          break;
      }
    }
    for (const id of [...ctx.bars.keys()].sort(compareIds)) {
      const ends = ctx.bars.get(id)?.spec.ends;
      for (const end of ["a", "b"] as const) {
        const pl = ends?.[end]?.plane;
        if (!pl) continue;
        const kind = "point" in pl ? "plane-point" : "face" in pl ? "plane-face" : "plane-of";
        this.claim(id, key(id, end), { kind, name: `${id}.ends.${end}.plane` });
      }
      const pb = this.placed.get(id);
      if (pb?.free?.fromCut) {
        this.claim(id, key(id, "b"), { kind: "free", name: `${id}.b (free end from a.cut)` });
      }
    }
  }

  /** A butt's through end (§4.5): named, or claimed where it meets a butting end (a corner). */
  private claimThroughEnd(id: string, spec: ButtConn): void {
    const through = spec.through as string;
    const te = spec.through_end;
    if (typeof te === "object") {
      this.claim(id, key(through, te.end), {
        kind: "through",
        conn: id,
        mode: te.mode,
        name: id,
      });
      return;
    }
    const mode = te ?? "cover";
    if (mode === "none") return;
    const T = this.placed.get(through);
    if (!T) return;
    const butting = spec.ends
      .map(splitEnd)
      .map(({ bar, end }) => {
        const pb = this.placed.get(bar);
        return pb && designPoint(pb, end);
      })
      .filter((p): p is V3 => p !== undefined);
    for (const end of ["a", "b"] as const) {
      const p = designPoint(T, end);
      if (p && butting.some((q) => dist(p, q) <= TOL.len)) {
        this.claim(id, key(through, end), { kind: "through", conn: id, mode, name: id });
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Placement providers (sweep 1)

  private placementPlane(bar: PlacedBar, end: End, c: Claim): PlaneN | undefined {
    const { ctx } = this;
    const k = key(bar.id, end);
    switch (c.kind) {
      case "butt":
      case "butt-body":
      case "miter":
      case "splice":
      case "pivot":
        return this.connPlanesFor(c.conn as string)?.get(k);
      case "through":
        return this.throughPlane(bar, end, c);
      case "plane-point": {
        const pl = this.endSpec(bar, end)?.plane as {
          point: never;
          normal: [never, never, never] | string;
        };
        const copy = ctx.bars.get(bar.id)?.copy;
        const p = resolvePoint(ctx, pl.point, {
          id: bar.id,
          field: `ends/${end}/plane/point`,
          copy,
        });
        const nv =
          typeof pl.normal === "string"
            ? this.axisOf(k, pl.normal)
            : ctx.vec(bar.id, `ends/${end}/plane/normal`, pl.normal);
        if (!p || !nv) return undefined;
        const n = unit(nv);
        if (!n) {
          ctx.d.error("plane", k, "the plane's normal is a zero vector");
          return undefined;
        }
        return { p, n };
      }
      case "plane-face": {
        const pl = this.endSpec(bar, end)?.plane as { face: { bar: string; face: "+x" } };
        const other = placeBar(ctx, pl.face.bar);
        if (!other) {
          if (!ctx.bars.has(pl.face.bar)) {
            ctx.d.error("ref", k, `plane: no bar ${pl.face.bar}`, { refs: [pl.face.bar] });
          } else ctx.depFailed(k, "plane", pl.face.bar);
          return undefined;
        }
        return facePlane(other, pl.face.face);
      }
      default:
        return undefined;
    }
  }

  private endSpec(bar: PlacedBar, end: End): EndSpec | undefined {
    return this.ctx.bars.get(bar.id)?.spec.ends?.[end];
  }

  /**
   * A plane's normal taken from another bar (§4.5, G27): that bar's axis. An axis follows from
   * the design points alone, which never read a cut (§4.3), so the plane stays a placement
   * provider and stage 3 gains no dependency.
   */
  private axisOf(k: string, other: string): V3 | undefined {
    const { ctx } = this;
    const placed = placeBar(ctx, other);
    if (!placed) {
      if (!ctx.bars.has(other)) {
        ctx.d.error("ref", k, `plane: normal: no bar ${other}`, { refs: [other] });
      } else ctx.depFailed(k, "plane", other);
      return undefined;
    }
    return placed.frame.t;
  }

  /** Planes a connection sets, by end key; undefined when the connection is invalid. */
  private connPlanesFor(id: string): Map<string, PlaneN> | undefined {
    if (this.connPlanes.has(id)) return this.connPlanes.get(id);
    const ent = this.ctx.conns.get(id);
    let out: Map<string, PlaneN> | undefined;
    if (ent) {
      const spec = ent.spec;
      if (spec.type === "butt") out = this.butt(id, spec);
      else if (spec.type === "miter") out = this.miter(id, spec);
      else if (spec.type === "splice") out = this.splice(id, spec);
      else if (spec.type === "pivot") out = this.pivot(id, spec.ends);
    }
    this.connPlanes.set(id, out);
    return out;
  }

  /** A butt through a bar's side faces or a body: each butting end on the first face it meets. */
  private butt(id: string, spec: ButtConn): Map<string, PlaneN> | undefined {
    const { ctx } = this;
    const copy = ctx.conns.get(id)?.copy;
    let prism: Prism | undefined;
    let throughBar: string | undefined;
    if (typeof spec.through === "string") {
      throughBar = spec.through;
      const T = placeBar(ctx, throughBar);
      if (!T) {
        if (!ctx.bars.has(throughBar)) {
          ctx.d.error("ref", id, `through: no bar ${throughBar}`, { refs: [throughBar] });
        } else ctx.depFailed(id, "through", throughBar);
        return undefined;
      }
      prism = barPrism(T);
    } else {
      prism = bodyPrism(ctx, id, spec.through.body, spec.through.at, copy);
      if (!prism) return undefined;
    }
    const spacer = this.spacer(id, spec);
    if (spacer === undefined) return undefined;
    const out = new Map<string, PlaneN>();
    for (const ref of spec.ends) {
      const { bar, end } = splitEnd(ref);
      if (bar === throughBar) {
        ctx.d.error("butt-miss", id, `${ref} is an end of the through bar itself`, { refs: [ref] });
        continue;
      }
      const K = this.placed.get(bar);
      if (!K) continue;
      const { C, t } = centreLine(K);
      const hit = lineThrough(C, t, prism);
      if (!hit) {
        ctx.d.error(
          "butt-miss",
          id,
          `${ref}: the centre line of ${bar} misses ${throughBar ?? "the body"}`,
          { refs: [ref] },
        );
        continue;
      }
      const cr = end === "a" ? hit.exit : hit.enter;
      const face = crossingFace(C, t, prism, cr);
      if (!clearOfEdges(face.p, prism, cr.slab)) {
        ctx.d.error(
          "butt-miss",
          id,
          `${ref}: the centre line of ${bar} crosses ${throughBar ?? "the body"} within ${TOL.len} mm of an edge`,
          { refs: [ref] },
        );
        continue;
      }
      const p = addScaled(face.p, face.n, spacer);
      const sl = prism.slabs[cr.slab] as Prism["slabs"][number];
      const depth = sl.hi - sl.lo;
      const dp = designPoint(K, end);
      if (dp && Math.abs(dot(sub(dp, p), face.n)) > depth + spacer + TOL.len) {
        ctx.d.warn(
          "end-far",
          ref,
          `${ref} is ${fmt(Math.abs(dot(sub(dp, p), face.n)))} mm from ${faceName(prism, cr)} of ${throughBar ?? "the body"}, more than its depth (${fmt(depth)} mm) plus the spacer`,
          { refs: [id] },
        );
      }
      out.set(ref, { p, n: neg(face.n) });
    }
    return out;
  }

  /** The through bar's own end: cover (the farthest face of the butting prisms) or node. */
  private throughPlane(T: PlacedBar, end: End, c: Claim): PlaneN | undefined {
    const node = (): PlaneN | undefined => {
      const p = designPoint(T, end);
      return p && { p, n: endDir(T, end) };
    };
    if (c.mode === "node") return node();
    const spec = this.ctx.conns.get(c.conn as string)?.spec as ButtConn;
    const { C, t } = centreLine(T);
    let best: { s: number; plane: PlaneN } | undefined;
    for (const ref of spec.ends) {
      const K = this.placed.get(splitEnd(ref).bar);
      if (!K || K.id === T.id) continue;
      const prism = barPrism(K);
      const hit = lineThrough(C, t, prism);
      if (!hit) continue;
      for (const cr of [hit.enter, hit.exit]) {
        const better = !best || (end === "b" ? cr.s > best.s : cr.s < best.s);
        if (better) best = { s: cr.s, plane: crossingFace(C, t, prism, cr) };
      }
    }
    if (!best) {
      this.ctx.d.warn(
        "cover-none",
        key(T.id, end),
        `${c.conn}: ${T.id}'s centre line crosses no butting bar, so its end stops at the node`,
        { refs: [c.conn as string] },
      );
      return node();
    }
    return best.plane;
  }

  private miter(id: string, spec: MiterConn): Map<string, PlaneN> | undefined {
    const { ctx } = this;
    const [r1, r2] = spec.ends.map(splitEnd) as [
      { bar: string; end: End },
      { bar: string; end: End },
    ];
    const K1 = this.placed.get(r1.bar);
    const K2 = this.placed.get(r2.bar);
    if (!K1 || !K2) return undefined;
    if (K1.item.sectionId !== K2.item.sectionId) {
      ctx.d.error(
        "miter",
        id,
        `a miter joins one section: ${K1.id} is ${K1.item.sectionId}, ${K2.id} is ${K2.item.sectionId}`,
        { refs: [K1.id, K2.id] },
      );
      return undefined;
    }
    const L1 = centreLine(K1);
    const L2 = centreLine(K2);
    const b = dot(L1.t, L2.t);
    const denom = 1 - b * b;
    if (denom < 1e-12) {
      ctx.d.error("miter", id, "the two bars are parallel: use a splice", {
        refs: [K1.id, K2.id],
      });
      return undefined;
    }
    const w0 = sub(L1.C, L2.C);
    const dd = dot(L1.t, w0);
    const e = dot(L2.t, w0);
    const s = (b * e - dd) / denom;
    const u = (e - b * dd) / denom;
    const P1 = addScaled(L1.C, L1.t, s);
    const P2 = addScaled(L2.C, L2.t, u);
    if (dist(P1, P2) > TOL.len) {
      ctx.d.error(
        "miter",
        id,
        `the centre lines of ${K1.id} and ${K2.id} miss each other by ${fmt(dist(P1, P2))} mm`,
        { refs: [K1.id, K2.id] },
      );
      return undefined;
    }
    const X = scale(add(P1, P2), 0.5);
    // Each bar's body leaves X toward its other end; the bisector plane reflects one onto the other.
    const d1 = neg(endDir(K1, r1.end));
    const d2 = neg(endDir(K2, r2.end));
    const n = unit(sub(d1, d2));
    if (!n) {
      ctx.d.error("miter", id, "the two bars overlap", { refs: [K1.id, K2.id] });
      return undefined;
    }
    const reflect = (v: V3): V3 => addScaled(v, n, -2 * dot(v, n));
    const offs = (K: PlacedBar) => {
      const [cx, cy] = boxCentre(K.box);
      const c0 = add(scale(K.frame.x, cx), scale(K.frame.y, cy));
      return corners(K).map((o) => sub(o, c0));
    };
    const o1 = offs(K1).map(reflect);
    const o2 = offs(K2);
    const matches = (xs: V3[], ys: V3[]) => xs.every((p) => ys.some((q) => dist(p, q) <= TOL.len));
    if (!matches(o1, o2) || !matches(o2, o1)) {
      ctx.d.error(
        "miter",
        id,
        `${K1.id} and ${K2.id} do not mirror each other across the miter plane`,
        { refs: [K1.id, K2.id] },
      );
      return undefined;
    }
    return new Map([
      [spec.ends[0], { p: X, n }],
      [spec.ends[1], { p: X, n }],
    ]);
  }

  private splice(id: string, spec: SpliceConn): Map<string, PlaneN> | undefined {
    const { ctx } = this;
    const [r1, r2] = spec.ends.map(splitEnd) as [
      { bar: string; end: End },
      { bar: string; end: End },
    ];
    const K1 = this.placed.get(r1.bar);
    const K2 = this.placed.get(r2.bar);
    if (!K1 || !K2) return undefined;
    const refs = [K1.id, K2.id];
    const P1 = designPoint(K1, r1.end);
    const P2 = designPoint(K2, r2.end);
    if (!P1 || !P2) {
      ctx.d.error("splice", id, "a spliced end needs a design point, not a free end from a cut", {
        refs,
      });
      return undefined;
    }
    let ok = true;
    if (dist(P1, P2) > TOL.len) {
      ctx.d.error(
        "splice",
        id,
        `${spec.ends[0]} and ${spec.ends[1]} do not meet: ${fmt(dist(P1, P2))} mm apart`,
        { refs },
      );
      ok = false;
    }
    const a = angleDeg(K1.frame.t, K2.frame.t);
    if (a > TOL.ang && a < 180 - TOL.ang) {
      ctx.d.error("splice", id, `${K1.id} and ${K2.id} are not collinear (${fmt(a)}°)`, { refs });
      ok = false;
    }
    if (K1.item.id !== K2.item.id) {
      ctx.d.error("splice", id, `a splice joins one item: ${K1.item.id} and ${K2.item.id}`, {
        refs,
      });
      ok = false;
    }
    const c1 = corners(K1);
    const c2 = corners(K2);
    const same = (xs: V3[], ys: V3[]) => xs.every((p) => ys.some((q) => dist(p, q) <= TOL.len));
    if (ok && (!same(c1, c2) || !same(c2, c1))) {
      ctx.d.error("splice", id, `${K1.id} and ${K2.id} are not placed the same way`, { refs });
      ok = false;
    }
    if (!ok) return undefined;
    const gap = spec.gap_mm === undefined ? 0 : ctx.num(id, "gap_mm", spec.gap_mm);
    if (gap === undefined) return undefined;
    const d1 = endDir(K1, r1.end);
    const d2 = endDir(K2, r2.end);
    return new Map([
      [spec.ends[0], { p: addScaled(P1, d1, -gap / 2), n: d1 }],
      [spec.ends[1], { p: addScaled(P1, d2, -gap / 2), n: d2 }],
    ]);
  }

  /** A pivot's carried ends: cut square at the pivot's end distance from P (§4.5). */
  private pivot(id: string, ends: readonly string[]): Map<string, PlaneN> | undefined {
    const { ctx } = this;
    const pv = placePivot(ctx, id);
    if (!pv) return undefined;
    const out = new Map<string, PlaneN>();
    for (const ref of ends) {
      const { bar, end } = splitEnd(ref);
      const K = this.placed.get(bar);
      if (!K) continue;
      const pt = ctx.bars.get(bar)?.spec[end];
      if (!(typeof pt === "object" && !Array.isArray(pt) && "pivot" in pt && pt.pivot === id)) {
        ctx.d.error("pivot", id, `${ref}'s design point must be { "pivot": "${id}" }`, {
          refs: [ref],
        });
        continue;
      }
      const dOut = endDir(K, end);
      // The angle, in the hinge's plane of rotation (a check: nothing moves in v1).
      const into = neg(dOut);
      const r0 = pv.axis === "across" ? pv.baseT : pv.baseU;
      const hinge = pv.axis === "across" ? cross(pv.n, pv.baseT) : pv.baseT;
      const ang = atan2Deg(dot(into, pv.n), dot(into, r0));
      const [lo, hi] = pv.range;
      if (ang < lo - TOL.ang || ang > hi + TOL.ang) {
        ctx.d.error(
          "pivot-range",
          id,
          `${ref} sits at ${fmt(ang)}°, outside the hinge's range ${lo}°–${hi}°`,
          { refs: [ref] },
        );
      }
      if (Math.abs(dot(into, unit(hinge) ?? hinge)) > Math.sin((TOL.ang * Math.PI) / 180)) {
        ctx.d.warn("pivot-plane", id, `${ref} is not square to the hinge axis`, { refs: [ref] });
      }
      out.set(ref, { p: addScaled(pv.P, dOut, -pv.end), n: dOut });
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // End providers (sweep 2): each reads an end face resolved in sweep 1.

  /** The end face another end provider reads, or undefined when that would be a chain. */
  private readFace(reader: string, readerName: string, target: string): EndFace | undefined {
    const { ctx } = this;
    const { bar } = splitEnd(target);
    if (!ctx.bars.has(bar)) {
      ctx.d.error("ref", reader, `${readerName}: no bar ${bar}`, { refs: [bar] });
      return undefined;
    }
    // An end with one claim, an end provider, resolves in the second sweep too: reading it would
    // chain. An end with no claim or several resolved in the first sweep.
    const tcs = this.claims.get(target) ?? [];
    const tc = tcs[0];
    if (tcs.length === 1 && tc && END_PROVIDERS.has(tc.kind)) {
      ctx.d.error(
        "chain",
        reader,
        `${readerName} reads ${target}, whose own plane comes from another end (${tc.name}): a chain of end providers; ${reader} falls back to the default`,
        { refs: [readerName, target].sort(compareIds) },
      );
      return undefined;
    }
    const f = this.faces.get(target);
    if (!f) ctx.depFailed(reader, readerName, target);
    return f;
  }

  private endPlane(bar: PlacedBar, end: End, c: Claim): PlaneN | undefined {
    const { ctx } = this;
    const k = key(bar.id, end);
    if (c.kind === "plane-of") {
      const pl = this.endSpec(bar, end)?.plane as { of: string };
      const f = this.readFace(k, c.name, pl.of);
      return f?.face;
    }
    if (c.kind === "free") {
      const f = this.readFace(k, c.name, key(bar.id, "a"));
      const free = bar.free as NonNullable<PlacedBar["free"]>;
      if (!f) {
        bar.B = addScaled(bar.A, free.dir, free.len);
        return undefined;
      }
      const sa = sOn(bar, [0, 0, 0], f.face);
      bar.B = addScaled(bar.A, bar.frame.t, sa + free.len);
      return { p: bar.B, n: bar.frame.t };
    }
    // butt-end: bearing on another bar's end face, its normal reversed (§4.5, G17).
    const spec = ctx.conns.get(c.conn as string)?.spec as ButtConn;
    const target = spec.through as string;
    const f = this.readFace(k, c.conn as string, target);
    if (!f) return undefined;
    const T = this.placed.get(splitEnd(target).bar);
    if (!T) return undefined;
    const { C, t } = centreLine(bar);
    const dn = dot(t, f.face.n);
    if (Math.abs(dn) < 1e-12) {
      ctx.d.error(
        "butt-miss",
        c.conn as string,
        `${k}: the centre line is parallel to ${target}'s end face`,
        { refs: [k] },
      );
      return undefined;
    }
    const X = addScaled(C, t, dot(sub(f.face.p, C), f.face.n) / dn);
    if (!clearOfEdges(X, barPrism(T), -1)) {
      ctx.d.error(
        "butt-miss",
        c.conn as string,
        `${k}: the centre line crosses ${target}'s end face outside ${T.id}'s prism, or within ${TOL.len} mm of a side face`,
        { refs: [k] },
      );
      return undefined;
    }
    const spacer = this.spacer(c.conn as string, spec);
    if (spacer === undefined) return undefined;
    return { p: addScaled(f.face.p, f.face.n, spacer), n: neg(f.face.n) };
  }

  /** A butt's spacer (§4.5): given, else its connector's, else none. */
  private spacer(id: string, spec: ButtConn): number | undefined {
    const { ctx } = this;
    if (spec.spacer_mm !== undefined) return ctx.num(id, "spacer_mm", spec.spacer_mm);
    if (spec.connector === undefined) return 0;
    const found = ctx.items.item(spec.connector);
    if (!found.ok) {
      ctx.d.error("item", id, found.message, { field: "connector" });
      return 0;
    }
    const s = found.item.kind === "connector" ? found.item.spacer_mm : undefined;
    return s === undefined ? 0 : typeof s === "number" ? s : s.v;
  }

  // -------------------------------------------------------------------------------------------
  // Modifiers (§4.5): an angled end must declare its cut; `square`; `extend_mm`.

  private finish(
    bar: PlacedBar,
    end: End,
    claim: Claim | undefined,
    plane: PlaneN | undefined,
    sweep: 1 | 2,
  ): void {
    const { ctx } = this;
    const k = key(bar.id, end);
    const spec = this.endSpec(bar, end);
    // A miter is itself the declaration of an angled cut; every other provider's angled plane
    // needs the end's own `cut`.
    const cut = spec?.cut ?? (claim?.kind === "miter" ? "angle" : undefined);
    const out = endDir(bar, end);
    const fallback = (): PlaneN => {
      if (end === "b" && !bar.B && bar.free) bar.B = addScaled(bar.A, bar.free.dir, bar.free.len);
      return { p: designPoint(bar, end) as V3, n: out };
    };
    let by = claim;
    let pl = plane;
    if (!pl || !claim) {
      by = undefined;
      pl = fallback();
    } else {
      pl = { p: pl.p, n: outward(pl.n, bar, end) };
      const ang = angleDeg(pl.n, out);
      if (ang >= 90 - TOL.ang) {
        ctx.d.error("plane", k, `${claim.name}: the plane is parallel to ${bar.id}'s axis`, {
          refs: [claim.name],
        });
        by = undefined;
        pl = fallback();
      } else if (ang > TOL.ang && cut === undefined) {
        ctx.d.error(
          "angled-end",
          k,
          `${k} is cut at ${fmt(ang)}° by ${claim.name}: declare its cut ("angle" or "square"); it is drawn square at its design point`,
          { refs: [claim.name] },
        );
        by = undefined;
        pl = fallback();
      }
    }
    let square = angleDeg(pl.n, out) <= TOL.ang;
    if (!square && cut === "square") {
      const ss = corners(bar).map((o) => sOn(bar, o, pl as PlaneN));
      const s = end === "a" ? Math.max(...ss) : Math.min(...ss);
      pl = { p: addScaled(bar.A, bar.frame.t, s), n: out };
      square = true;
    }
    if (spec?.extend_mm !== undefined) {
      const e = ctx.num(k, "extend_mm", spec.extend_mm);
      if (e !== undefined) pl = { p: addScaled(pl.p, out, e), n: pl.n };
    }
    this.faces.set(k, {
      bar: bar.id,
      end,
      by,
      sweep,
      face: pl,
      square,
      ...(cut && by ? { cut } : {}),
    });
  }

  // -------------------------------------------------------------------------------------------
  // Lengths and angles (§4.5: reported per bar)

  private lengths(
    bar: PlacedBar,
    fa: EndFace,
    fb: EndFace,
  ): { lengths: BarLengths; ends: { a: EndReport; b: EndReport } } {
    const len = dist(bar.A, bar.B as V3);
    // Where each end face meets the box's four edges, along the axis from A.
    const cs = corners(bar);
    const atA = cs.map((o) => sOn(bar, o, fa.face));
    const atB = cs.map((o) => sOn(bar, o, fb.face));
    const lens = atB.map((s, i) => s - (atA[i] as number));
    // The long points: the farthest each end face reaches outward, on whichever edge it is.
    const la = Math.min(...atA);
    const lb = Math.max(...atB);
    const [cx, cy] = boxCentre(bar.box);
    const oc = add(scale(bar.frame.x, cx), scale(bar.frame.y, cy));
    const centre = sOn(bar, oc, fb.face) - sOn(bar, oc, fa.face);
    const sa = sOn(bar, [0, 0, 0], fa.face);
    const sb = sOn(bar, [0, 0, 0], fb.face);
    const cut = Math.max(...lens);
    if (cut <= 0) {
      this.ctx.d.error("length", bar.id, `the cut length is ${fmt(cut)} mm`);
    }
    return {
      lengths: { len, cut, centre, short: Math.min(...lens), span: lb - la, la, lb, sa, sb },
      ends: {
        a: this.report(bar, "a", fa, sa, -sa),
        b: this.report(bar, "b", fb, sb, sb - len),
      },
    };
  }

  private report(bar: PlacedBar, end: End, f: EndFace, s: number, move: number): EndReport {
    const e = endDir(bar, end);
    const n = f.face.n;
    const angle = f.square ? 0 : angleDeg(n, e);
    const out: EndReport = {
      by: f.by ? (f.by.conn ?? (f.by.kind === "free" ? "free" : "plane")) : "default",
      point: addScaled(bar.A, bar.frame.t, s),
      normal: n,
      move,
      angle,
      ...(f.cut ? { cut: f.cut } : {}),
    };
    if (!f.square) {
      const nz = dot(n, e);
      out.mitre = atan2Deg(dot(n, bar.frame.x), nz);
      out.bevel = (Math.asin(Math.max(-1, Math.min(1, dot(n, bar.frame.y)))) * 180) / Math.PI;
    }
    return out;
  }
}

function fmt(x: number): string {
  return (Math.round(x * 100) / 100).toFixed(2);
}
