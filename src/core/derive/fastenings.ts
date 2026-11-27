import type { Item } from "#catalog/schema/items.ts";
import { type ExprScope, evalNumber } from "../expr.ts";
import { compareIds } from "../ids.ts";
import { type AnyItem, type BarItemInfo, fullRef } from "../items.ts";
import type { Face, FaceConnT, StackEntry } from "../project/schema.ts";
import type { Vec2 } from "../section-properties.ts";
import { clearanceHole, sleeveHole } from "../threads.ts";
import { TOL } from "../tolerances.ts";
import {
  add,
  addScaled,
  angleDeg,
  cross,
  dot,
  neg,
  norm,
  scale,
  sub,
  unit,
  type V3,
} from "../vec.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar, HoleOp } from "./derive.ts";
import {
  innerFacing,
  materialAlong,
  type OutlineFace,
  type OutlineFaces,
  outlineFaces,
} from "./outline.ts";
import { boxCentre, faceLocal, facePlane, localOf, onBar } from "./place.ts";
import { area2, ccw, clip, type P2 } from "./polygon.ts";
import { holePoint, selectHoles } from "./rails.ts";
import type {
  DerivedPart,
  FaceResult,
  FaceStation,
  HardwareUse,
  PlacedPart,
  PlacedRun,
  StationLayer,
  StockPiece,
} from "./types.ts";

/**
 * Face connections (design §4.5): two or more layers, head to nut, each adjacent pair in contact
 * (faces antiparallel and coplanar, or apart by the pair's declared gap, and overlapping). A
 * layer's faces are its bounding faces and, for a bar, the inner faces of its section's outline
 * (gap A3, outline.ts): an angle's inside leg faces, a channel's inner flanges. A fastened
 * connection puts one fastener at each station of its first layer, along the first layer's face
 * normal toward the second; it passes every layer, entering and leaving each by real faces: its
 * contact faces, and at the head and the nut the nearest face across the layer's material. Then:
 *
 * - `bolt`: an ISO 273 medium clearance hole in every layer, both walls of a hollow one; where a
 *   sleeve passes a wall, that wall's hole clears the sleeve: ISO 273 medium for a shank of its
 *   outside diameter, or that diameter plus the sleeve's `clearance_mm`;
 * - `screw`: clearance holes in the layers before the last, a tapped hole in the last (its near
 *   wall when hollow, or to `tap_depth_mm`);
 * - `tnut`: clearance holes in the layers before the last; the last holds the T-nut in the groove
 *   at the station, and counts to the groove's lip in the grip.
 *
 * A rail layer at one of its own holes is not drilled again. A fastener or sleeve cut from bar
 * stock is a piece for the cut list.
 */

export interface GenOut {
  fastenings: Map<string, FaceResult>;
  pieces: StockPiece[];
  hardware: HardwareUse[];
  /** Joint recipes the connections use (§3.4): not bought, so not hardware. */
  recipes: HardwareUse[];
}

interface BodyFace {
  /** `+x` … for a bounding face (§4.3); an inner face's name from outline.ts, `+x@-31.75`. */
  name: string;
  /** Which face of the body: the same on every piece of a run, which share one section. */
  key: string;
  /** A face of the bounding box (a bar's four, a part's six), which §4.3 names. */
  bounding: boolean;
  /** A point on the face's plane, its outward normal, §4.3's u, and the trimmed face. */
  p: V3;
  n: V3;
  u: V3;
  poly: V3[];
  /**
   * A bar's face: where its centre line lies, in the bar's local x, y. A bounding face's is
   * §4.3's (the box's centre across it); an inner face's is the foot of the perpendicular from the
   * box's centre line, so the same u measures across a leg's inner and outer faces.
   */
  centre?: readonly [number, number];
}

interface Body {
  readonly id: string;
  readonly bar?: DerivedBar;
  /** The bounding faces. */
  readonly faces: BodyFace[];
  /**
   * A bar's inner faces whose outward normal lies near `n` (or `-n` too, with `both`), in face
   * order; none for a part. A loose superset of the parallel ones, looked up by direction: a
   * section with radii has hundreds of inner faces, nearly all arc chords, and each is placed in
   * world terms only when it is asked for.
   */
  innerNear(n: V3, both?: boolean): BodyFace[];
  /** All of a bar's inner faces, in face order. */
  innerAll(): BodyFace[];
  /** An inner face by its key. */
  innerByKey(key: string): BodyFace | undefined;
}

/** A body's faces whose outward normal may be parallel to `n` (or `-n`, with `both`). */
function facesNear(body: Body, n: V3, both = false): BodyFace[] {
  const keep = (f: BodyFace) => (both ? Math.abs(dot(f.n, n)) : dot(f.n, n)) >= 0.99;
  return [...body.faces.filter(keep), ...body.innerNear(n, both)];
}

/**
 * The faces of `body` that could meet one of `other`'s, in face order: a bar's faces all hold its
 * axis, so when two bars cross, only a face square to both axes can; when they are parallel (or
 * `other` is a part) any face might.
 */
function facing(body: Body, other: Body): BodyFace[] {
  const t = body.bar?.placed.frame.t;
  const u = other.bar?.placed.frame.t;
  const m = t && u ? cross(t, u) : undefined;
  if (m && norm(m) > 1e-3) return facesNear(body, unit(m) as V3, true);
  return [...body.faces, ...body.innerAll()];
}

function faceByKey(body: Body, key: string): BodyFace {
  return (body.faces.find((f) => f.key === key) ?? body.innerByKey(key)) as BodyFace;
}

/**
 * Antiparallel within tol.ang. A loose dot-product test rejects most pairs before the angle
 * test, which decides: it keeps the result exactly the angle test's, and the inner faces of a
 * section with radii are many.
 */
function antiparallel(a: V3, b: V3): boolean {
  return dot(a, b) <= -0.99 && angleDeg(a, neg(b)) <= TOL.ang;
}

function parallel(a: V3, b: V3): boolean {
  return dot(a, b) >= 0.99 && angleDeg(a, b) <= TOL.ang;
}

interface Layer {
  ref: string;
  bodies: Body[];
  /** A bar or run layer's design line, for stations measured along it. */
  line?: { A: V3; t: V3; run?: PlacedRun };
}

const FACES: readonly Face[] = ["+x", "-x", "+y", "-y"];
const fmt = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

/** Where the line A + o + s·t meets an end face, as s. */
function sOnEnd(b: DerivedBar, o: V3, e: { point: V3; normal: V3 }): number {
  const bar = b.placed;
  return dot(sub(e.point, add(bar.A, o)), e.normal) / dot(bar.frame.t, e.normal);
}

const bodies = new WeakMap<DerivedBar, BarBody>();

/** A bar's body, built once per bar: its placement and ends are final by stage 4. */
function barBody(b: DerivedBar): BarBody {
  let body = bodies.get(b);
  if (!body) {
    body = new BarBody(b);
    bodies.set(b, body);
  }
  return body;
}

/**
 * A bar's faces, each trimmed by the end faces (§5.1: contacts on the trimmed bars): its four
 * bounding faces, and its section's inner faces, each placed when it is first asked for.
 */
class BarBody implements Body {
  readonly id: string;
  readonly bar: DerivedBar;
  readonly faces: BodyFace[];
  private readonly outline: OutlineFaces;
  private readonly placed: (BodyFace | undefined)[] = [];

  constructor(bar: DerivedBar) {
    this.bar = bar;
    const placed = bar.placed;
    const bx = placed.box;
    this.id = placed.id;
    this.outline = outlineFaces(placed.item.section);
    const edges: Record<Face, [readonly [number, number], readonly [number, number]]> = {
      "+x": [
        [bx.x1, bx.y0],
        [bx.x1, bx.y1],
      ],
      "-x": [
        [bx.x0, bx.y0],
        [bx.x0, bx.y1],
      ],
      "+y": [
        [bx.x0, bx.y1],
        [bx.x1, bx.y1],
      ],
      "-y": [
        [bx.x0, bx.y0],
        [bx.x1, bx.y0],
      ],
    };
    const { x, y } = placed.frame;
    this.faces = FACES.map((name): BodyFace => {
      const pl = facePlane(placed, name);
      const [o0, o1] = edges[name].map((l) => this.toWorld(l)) as [V3, V3];
      return {
        name,
        key: name,
        bounding: true,
        p: pl.p,
        n: pl.n,
        u: name === "+x" || name === "-x" ? y : x,
        poly: this.strip(o0, o1),
        centre: faceLocal(bx, name).at,
      };
    });
  }

  /** A local (x, y) offset in world terms. */
  private toWorld(l: readonly [number, number]): V3 {
    const { x, y } = this.bar.placed.frame;
    return add(scale(x, l[0]), scale(y, l[1]));
  }

  /** The face between the bar's lines at local offsets o0 and o1, trimmed by its end faces. */
  private strip(o0: V3, o1: V3): V3[] {
    const { A, frame } = this.bar.placed;
    const { a, b } = this.bar.ends;
    const at = (o: V3, e: { point: V3; normal: V3 }) =>
      addScaled(add(A, o), frame.t, sOnEnd(this.bar, o, e));
    return [at(o0, a), at(o1, a), at(o1, b), at(o0, b)];
  }

  private place(k: number): BodyFace {
    const hit = this.placed[k];
    if (hit) return hit;
    const bar = this.bar.placed;
    const f = this.outline.inner[k] as OutlineFace;
    const [cx, cy] = boxCentre(bar.box);
    const la = localOf(bar, f.a[0], f.a[1]);
    const lb = localOf(bar, f.b[0], f.b[1]);
    const [nx, ny] = f.n;
    // The foot of the perpendicular from the box's centre (cx, cy) onto the face's line.
    const off = (la[0] - cx) * nx + (la[1] - cy) * ny;
    // §4.3's u: local +y across a face that faces ±x, local +x across one that faces ±y; an
    // oblique face's u is the perpendicular nearer to that.
    const along: [number, number] = Math.abs(nx) >= Math.abs(ny) ? [-ny, nx] : [ny, -nx];
    if ((Math.abs(nx) >= Math.abs(ny) ? along[1] : along[0]) < 0) {
      along[0] = -along[0];
      along[1] = -along[1];
    }
    const oa = this.toWorld(la);
    const face: BodyFace = {
      name: f.name,
      key: `i${k}`,
      bounding: false,
      p: add(bar.A, oa),
      n: this.toWorld(f.n),
      u: this.toWorld(along),
      poly: this.strip(oa, this.toWorld(lb)),
      centre: [cx + off * nx, cy + off * ny],
    };
    this.placed[k] = face;
    return face;
  }

  innerNear(n: V3, both = false): BodyFace[] {
    if (this.outline.inner.length === 0) return [];
    // n in the section's terms; a direction off the section's plane meets no face of the bar.
    const { x, y } = this.bar.placed.frame;
    const n2: Vec2 = [dot(n, x), dot(n, y)];
    const len = Math.sqrt(n2[0] * n2[0] + n2[1] * n2[1]);
    if (len < 0.99) return [];
    const d: Vec2 = [n2[0] / len, n2[1] / len];
    const ks = innerFacing(this.outline, d);
    // The two windows are π apart, so no face is in both.
    if (both) ks.push(...innerFacing(this.outline, [-d[0], -d[1]]));
    return (both ? ks.sort((a, b) => a - b) : ks).map((k) => this.place(k));
  }

  innerAll(): BodyFace[] {
    return this.outline.inner.map((_, k) => this.place(k));
  }

  innerByKey(key: string): BodyFace | undefined {
    const k = key.startsWith("i") ? Number(key.slice(1)) : -1;
    return k >= 0 && k < this.outline.inner.length ? this.place(k) : undefined;
  }
}

/** A placed part's bounding box, as six faces in world terms. */
function partBody(p: PlacedPart, item: AnyItem): Body | undefined {
  const box = (item as { bbox_mm?: readonly [V3, V3] }).bbox_mm;
  if (!box) return undefined;
  const axes = [p.frame.x, p.frame.y, p.frame.z] as const;
  const names = ["x", "y", "z"] as const;
  const point = (c: readonly [number, number, number]) =>
    add(p.origin, add(add(scale(axes[0], c[0]), scale(axes[1], c[1])), scale(axes[2], c[2])));
  const faces: BodyFace[] = [];
  const at = (side: 0 | 1, axis: number) => (box[side] as V3)[axis] as number;
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    const ax = axes[i] as V3;
    for (const side of [0, 1] as const) {
      const corner = (a: 0 | 1, b: 0 | 1): V3 => {
        const c: [number, number, number] = [0, 0, 0];
        c[i] = at(side, i);
        c[j] = at(a, j);
        c[k] = at(b, k);
        return point(c);
      };
      const name = `${side === 1 ? "+" : "-"}${names[i]}`;
      faces.push({
        name,
        key: name,
        bounding: true,
        p: corner(0, 0),
        n: side === 1 ? ax : neg(ax),
        u: axes[j] as V3,
        poly: [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)],
      });
    }
  }
  return {
    id: p.id,
    faces,
    innerNear: () => [],
    innerAll: () => [],
    innerByKey: () => undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Plane polygons: overlap and containment

function to2(f: BodyFace, P: V3): P2 {
  const v = sub(P, f.p);
  return [dot(v, f.u), dot(v, cross(f.n, f.u))];
}

/** The area two faces share, the second projected onto the first's plane. */
const own = new WeakMap<BodyFace, P2[]>();

/** The face in its own plane's terms, counter-clockwise: the same on every call, so kept. */
function ownPoly(f: BodyFace): P2[] {
  let poly = own.get(f);
  if (!poly) {
    poly = ccw(f.poly.map((P) => to2(f, P)));
    own.set(f, poly);
  }
  return poly;
}

function overlap(f: BodyFace, g: BodyFace): number {
  const a = ownPoly(f);
  const b = ccw(g.poly.map((P) => to2(f, P)));
  const c = clip(b, a);
  return c.length < 3 ? 0 : Math.abs(area2(c));
}

/** A point of the face's plane is on the face, within tol.len of its edges. */
function onFace(f: BodyFace, P: V3): boolean {
  const poly = ownPoly(f);
  const [px, py] = to2(f, P);
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i] as P2;
    const [bx, by] = poly[(i + 1) % poly.length] as P2;
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    if (((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / len < -TOL.len) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------

export function generateFaces(
  ctx: Ctx,
  bars: ReadonlyMap<string, DerivedBar>,
  runs: ReadonlyMap<string, PlacedRun>,
  parts: ReadonlyMap<string, DerivedPart>,
  out: GenOut,
): void {
  for (const id of [...ctx.conns.keys()].sort(compareIds)) {
    const ent = ctx.conns.get(id);
    if (ent?.spec.type !== "face") continue;
    const r = new FaceGen(ctx, id, ent.spec, !ent.copy, bars, runs, parts, out).run();
    if (r) out.fastenings.set(id, r);
  }
}

/** Two adjacent layers' faces in contact. */
interface Contact {
  /** Their names, as reported, and their keys on the layers' bodies. */
  faces: [string, string];
  keys: [string, string];
  /** The first one's outward normal, toward the second layer. */
  n: V3;
}

interface Walk {
  body: Body;
  entry: BodyFace;
  exit: BodyFace;
  /** Along the axis from the station point. */
  we: number;
  wx: number;
}

/** A sleeve of the stack: its stock, its hollow layer, its length, and the hole it takes. */
interface StackSleeve {
  item: string;
  opt: Readonly<Record<string, string>>;
  layer: number;
  len_mm: number | string;
  /** The diameter of a hole the sleeve passes: its outside diameter and a clearance. */
  hole: number;
}

interface Hollow {
  shape: "rhs" | "tube";
  t: number;
  /** Outside radius, for a tube. */
  R: number;
}

class FaceGen {
  private readonly ctx: Ctx;
  private readonly id: string;
  private readonly spec: FaceConnT;
  private readonly report: boolean;
  private readonly bars: ReadonlyMap<string, DerivedBar>;
  private readonly runs: ReadonlyMap<string, PlacedRun>;
  private readonly parts: ReadonlyMap<string, DerivedPart>;
  private readonly out: GenOut;

  constructor(
    ctx: Ctx,
    id: string,
    spec: FaceConnT,
    report: boolean,
    bars: ReadonlyMap<string, DerivedBar>,
    runs: ReadonlyMap<string, PlacedRun>,
    parts: ReadonlyMap<string, DerivedPart>,
    out: GenOut,
  ) {
    this.ctx = ctx;
    this.id = id;
    this.spec = spec;
    this.report = report;
    this.bars = bars;
    this.runs = runs;
    this.parts = parts;
    this.out = out;
  }

  private error(code: string, message: string, extra: { field?: string; refs?: string[] } = {}) {
    if (this.report) this.ctx.d.error(code, this.id, message, extra);
  }

  run(): FaceResult | undefined {
    const { spec } = this;
    const layers: Layer[] = [];
    for (const ref of spec.bars) {
      const l = this.layer(ref);
      if (!l) return undefined;
      layers.push(l);
    }
    const gaps: number[] = [];
    for (let i = 0; i + 1 < layers.length; i++) {
      const g = spec.gaps_mm?.[i];
      const v = g === undefined ? 0 : this.ctx.num(this.id, `gaps_mm[${i}]`, g);
      if (v === undefined) return undefined;
      gaps.push(v);
    }
    if (spec.gaps_mm && spec.gaps_mm.length !== layers.length - 1) {
      this.error(
        "face",
        `gaps_mm has ${spec.gaps_mm.length} gaps for ${layers.length - 1} pairs of layers`,
        {
          field: "gaps_mm",
        },
      );
    }

    const contacts: (Contact & { gap: number })[] = [];
    for (let i = 0; i + 1 < layers.length; i++) {
      const c = this.contact(
        layers[i] as Layer,
        layers[i + 1] as Layer,
        gaps[i] as number,
        spec.faces?.[i],
      );
      if (!c) {
        const a = (layers[i] as Layer).ref;
        const b = (layers[i + 1] as Layer).ref;
        const g = gaps[i] as number;
        this.error(
          "face",
          `${a} and ${b} are not in contact: no faces of theirs are antiparallel, ${g === 0 ? "coplanar" : `${fmt(g)} mm apart`} and overlapping`,
          { refs: [a, b] },
        );
        return undefined;
      }
      contacts.push({ ...c, gap: gaps[i] as number });
    }
    const axis = (contacts[0] as { n: V3 }).n;
    for (const [i, c] of contacts.entries()) {
      if (angleDeg(c.n, axis) > TOL.ang) {
        this.error(
          "face",
          `the layers do not stack along one axis: pair ${i + 1} faces another way`,
        );
        return undefined;
      }
    }
    const result: FaceResult = {
      fastening: spec.fastening,
      layers: [...spec.bars],
      contacts: contacts.map((c) => ({ faces: c.faces, gap: c.gap })),
      stations: [],
      stack: [],
    };
    if (spec.fastening === "none") {
      if (spec.stations || spec.fastener || spec.stack) {
        this.error(
          "face",
          "a resting contact (fastening none) takes no stations, fastener or stack",
        );
      }
      return result;
    }
    this.fasten(layers, gaps, contacts, axis, result);
    return result;
  }

  private layer(ref: string): Layer | undefined {
    const { ctx } = this;
    if (ref.startsWith("r")) {
      const run = this.runs.get(ref);
      if (!run) {
        if (Object.hasOwn(ctx.doc.runs, ref)) ctx.depFailed(this.id, "bars", ref);
        return undefined;
      }
      const bodies: Body[] = [];
      for (const pb of run.bars) {
        const b = this.bars.get(pb.id);
        if (!b) {
          ctx.depFailed(this.id, "bars", pb.id);
          return undefined;
        }
        bodies.push(barBody(b));
      }
      return { ref, bodies, line: { A: run.A, t: run.t, run } };
    }
    if (ref.startsWith("p")) {
      const p = this.parts.get(ref);
      if (!p?.placed) {
        if (p && !p.placed)
          this.error("face", `${ref} is an unplaced line, not a layer`, { refs: [ref] });
        else if (ctx.parts.has(ref)) ctx.depFailed(this.id, "bars", ref);
        return undefined;
      }
      const found = ctx.items.item(p.item);
      const body = found.ok ? partBody(p, found.item) : undefined;
      if (!body) {
        this.error("face", `${ref}'s item ${p.item} has no bounding box to act as a layer`, {
          refs: [ref],
        });
        return undefined;
      }
      return { ref, bodies: [body] };
    }
    const b = this.bars.get(ref);
    if (!b) {
      if (ctx.bars.has(ref)) ctx.depFailed(this.id, "bars", ref);
      return undefined;
    }
    return { ref, bodies: [barBody(b)], line: { A: b.placed.A, t: b.placed.frame.t } };
  }

  /**
   * The faces of two adjacent layers in contact: antiparallel, at the gap, overlapping. The
   * bounding faces are tried first, so a pair that meets on them is found as it was before gap A3
   * (and `faces`, which names bounding faces, picks among them); then every pair with an inner
   * face in it, in face order.
   */
  private contact(
    A: Layer,
    B: Layer,
    gap: number,
    names: readonly [Face, Face] | undefined,
  ): Contact | undefined {
    const touch = (f: BodyFace, g: BodyFace) =>
      Math.abs(dot(sub(g.p, f.p), f.n) - gap) <= TOL.len && overlap(f, g) > TOL.len * TOL.len;
    const found = (f: BodyFace, g: BodyFace): Contact => ({
      faces: [f.name, g.name],
      keys: [f.key, g.key],
      n: f.n,
    });
    for (const ba of A.bodies) {
      for (const bb of B.bodies) {
        for (const f of ba.faces) {
          if (names && f.name !== names[0]) continue;
          for (const g of bb.faces) {
            if (names && g.name !== names[1]) continue;
            if (angleDeg(f.n, neg(g.n)) > TOL.ang) continue;
            if (touch(f, g)) return found(f, g);
          }
        }
      }
    }
    if (names) return undefined;
    for (const ba of A.bodies) {
      for (const bb of B.bodies) {
        for (const f of facing(ba, bb)) {
          for (const g of facesNear(bb, neg(f.n))) {
            if (f.bounding && g.bounding) continue;
            if (antiparallel(f.n, g.n) && touch(f, g)) return found(f, g);
          }
        }
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Fastened

  private fasten(
    layers: Layer[],
    gaps: number[],
    contacts: Contact[],
    axis: V3,
    result: FaceResult,
  ): void {
    const { ctx, spec, id } = this;
    const fastener = this.fastener();
    if (!fastener) return;
    result.fastener = fastener.out;
    const stack = this.stack(layers);
    if (!stack) return;
    result.stack = stack.hardware;

    const points = this.stationList(layers[0] as Layer);
    if (!points) return;
    if (points.length === 0) {
      this.error("face", "a fastened face connection needs stations", { field: "stations" });
      return;
    }
    const clearance = fastener.thread ? clearanceHole(fastener.thread) : undefined;
    let clearanceReported = false;
    const noClearance = () => {
      if (clearanceReported) return;
      clearanceReported = true;
      this.error(
        "face",
        fastener.thread
          ? `no ISO 273 clearance hole for thread ${fastener.thread}`
          : `the fastener ${fastener.out.item} gives no thread, so no hole can be sized for it`,
        { field: "fastener" },
      );
    };
    const tapDepth =
      spec.tap_depth_mm === undefined ? undefined : ctx.num(id, "tap_depth_mm", spec.tap_depth_mm);

    let k = 0;
    let sleeveNo = 0;
    for (const sp of points) {
      k++;
      const at = this.stationAt(layers[0] as Layer, (contacts[0] as Contact).keys[0], sp, k);
      if (!at) continue;
      const walk = this.walk(layers, contacts, at.P, axis, at.body, k);
      if (!walk) continue;
      const w0 = (walk[0] as Walk).we;
      const n = layers.length;
      const last = walk[n - 1] as Walk;
      const depth = (w: Walk) => w.wx - w.we;
      const counted = spec.fastening === "bolt" ? walk : walk.slice(0, n - 1);
      let grip = counted.reduce((s, w) => s + depth(w), 0) + gaps.reduce((s, g) => s + g, 0);
      if (spec.fastening === "tnut") {
        const lip = this.tnut(last, at.P, axis, k, stack.tnuts);
        if (lip === undefined) continue;
        grip += lip;
      }

      // Sleeves cut from bar stock, each in a hollow layer's bore, from its nut-side wall.
      const sleeves: { piece: string; len: number; from: number; to: number; hole: number }[] = [];
      let sleevesOk = true;
      for (const sl of stack.sleeves) {
        const w = walk[sl.layer] as Walk;
        const hollow = hollowOf(w.body);
        const bore = hollow && this.bore(w, hollow, at.P, axis);
        if (!hollow || bore === undefined) {
          this.error(
            "face",
            `station ${k}: the sleeve's layer ${w.body.id} is not hollow where the fastener passes it`,
            { refs: [w.body.id] },
          );
          sleevesOk = false;
          continue;
        }
        const len = this.sleeveLen(sl.len_mm, bore.inside);
        if (len === undefined || len <= 0) {
          sleevesOk = false;
          continue;
        }
        sleeveNo++;
        const piece = `${id}.s${sleeveNo}`;
        const to = bore.innerExit - w0;
        sleeves.push({ piece, len, from: to - len, to, hole: sl.hole });
        this.out.pieces.push({ source: piece, item: sl.item, opt: sl.opt, len });
      }
      if (!sleevesOk) continue;

      // Holes.
      for (const [i, w] of walk.entries()) {
        const b = w.body.bar;
        if (!b) continue; // a part's holes come with its item (M6 plates)
        if (spec.fastening === "tnut" && i === n - 1) continue;
        if (this.ownRailHole(b, at.P, axis)) continue;
        const hollow = hollowOf(w.body);
        if (spec.fastening === "screw" && i === n - 1) {
          if (!fastener.thread) {
            noClearance();
            continue;
          }
          const l = this.listing(b, w, at.P, axis, "entry", k);
          if (!l) continue;
          const depthTap = tapDepth ?? (hollow ? hollow.t : l.through ? undefined : w.wx - w.we);
          this.addHole(b, l.face, at.P, axis, l.w, {
            thread: fastener.thread,
            ...(depthTap !== undefined ? { depth: l.lead + depthTap } : {}),
          });
          continue;
        }
        if (clearance === undefined) {
          noClearance();
          continue;
        }
        const d = clearance;
        const segs: {
          from: number;
          to: number;
          entry: BodyFace | undefined;
          exit: BodyFace | undefined;
          wall: boolean;
        }[] = hollow
          ? this.walls(w, hollow, at.P, axis)
          : [{ from: w.we, to: w.wx, entry: w.entry, exit: w.exit, wall: false }];
        for (const sg of segs) {
          const a = sg.from - w0;
          const z = sg.to - w0;
          let dd = d;
          let cbore: { d: number; depth: number; atExit: boolean } | undefined;
          for (const sl of sleeves) {
            const lo = Math.max(a, sl.from);
            const hi = Math.min(z, sl.to);
            if (hi - lo <= TOL.len) continue;
            const full = sl.from <= a + TOL.len && sl.to >= z - TOL.len;
            if (full || sg.wall) dd = Math.max(dd, sl.hole);
            else cbore = { d: sl.hole, depth: hi - lo, atExit: sl.to >= z - TOL.len };
          }
          const cb = cbore ? { cbore: { d: cbore.d, depth: cbore.depth } } : {};
          if (!hollow) {
            // A solid layer's hole, listed from a bounding face (its op names one of the four):
            // a counterbore needs the face it opens in.
            const end = cbore ? (cbore.atExit ? "exit" : "entry") : "any";
            const l = this.listing(b, w, at.P, axis, end, k, cbore !== undefined);
            if (!l) continue;
            this.addHole(b, l.face, at.P, axis, l.w, {
              d: dd,
              ...cb,
              ...(l.through ? {} : { depth: l.lead + (w.wx - w.we) }),
            });
          } else if (cbore?.atExit && sg.exit) {
            this.addHole(b, sg.exit, at.P, axis, sg.to, { d: dd, ...cb, depth: z - a });
          } else {
            const face = sg.entry ?? (sg.exit as BodyFace);
            this.addHole(b, face, at.P, axis, sg.entry ? sg.from : sg.to, {
              d: dd,
              ...cb,
              depth: z - a,
            });
          }
        }
      }

      // The fastener and the stack, once per station.
      let piece: string | undefined;
      if (fastener.cut) {
        piece = `${id}.f${k}`;
        this.out.pieces.push({
          source: piece,
          item: fastener.cut.item,
          opt: fastener.cut.opt,
          len: fastener.cut.len,
        });
      } else {
        this.out.hardware.push({ item: fastener.out.item, opt: {}, qty: 1, source: id });
      }
      for (const h of stack.hardware)
        this.out.hardware.push({ item: h.item, opt: {}, qty: h.qty, source: id });

      const station: FaceStation = {
        k,
        bar: at.bar.placed.id,
        s: at.s,
        across: sp.u,
        point: at.P,
        axis,
        layers: walk.map((w): StationLayer => ({ id: w.body.id, from: w.we - w0, to: w.wx - w0 })),
        grip,
        ...(piece ? { piece } : {}),
        sleeves: sleeves.map((s) => ({ piece: s.piece, len: s.len })),
      };
      result.stations.push(station);
    }
  }

  /** The fastener: a catalog fastener, or a length of a bar item (§4.5). */
  private fastener():
    | {
        out: { item: string; len?: number };
        thread?: string;
        cut?: { item: string; opt: Readonly<Record<string, string>>; len: number };
      }
    | undefined {
    const { ctx, spec, id } = this;
    const f = spec.fastener;
    if (f === undefined) {
      this.error("face", `a ${spec.fastening} fastening needs a fastener`, { field: "fastener" });
      return undefined;
    }
    if (typeof f === "string") {
      const found = ctx.items.item(f);
      if (!found.ok) {
        this.error("item", found.message, { field: "fastener" });
        return undefined;
      }
      const thread = (found.item as { thread?: string }).thread;
      return { out: { item: found.id }, ...(thread ? { thread } : {}) };
    }
    const found = ctx.items.item(f.bar);
    if (!found.ok || !found.bar) {
      this.error("item", found.ok ? `${f.bar} is a ${found.item.kind}, not a bar` : found.message, {
        field: "fastener/bar",
      });
      return undefined;
    }
    const len = ctx.num(id, "fastener/len_mm", f.len_mm);
    if (len === undefined) return undefined;
    if (len <= 0) {
      this.error("face", `fastener/len_mm is ${fmt(len)}`, { field: "fastener/len_mm" });
      return undefined;
    }
    return {
      out: { item: found.id, len },
      ...(found.bar.thread ? { thread: found.bar.thread } : {}),
      cut: { item: found.id, opt: stockOptions(ctx, found.bar), len },
    };
  }

  /** The stack: loose hardware per station, sleeves, and the T-nuts among them. */
  private stack(layers: Layer[]):
    | {
        hardware: { item: string; qty: number }[];
        sleeves: StackSleeve[];
        tnuts: { id: string; item: Item }[];
      }
    | undefined {
    const { ctx, spec, id } = this;
    const hardware: { item: string; qty: number }[] = [];
    const sleeves: StackSleeve[] = [];
    const tnuts: { id: string; item: Item }[] = [];
    const consider = (ref: string) => {
      const found = ctx.items.item(ref);
      if (!found.ok) return;
      const it = found.item;
      if (it.kind === "fastener" && (it.subtype === "t-nut" || it.subtype === "hammer-screw")) {
        tnuts.push({ id: found.id, item: it });
      }
    };
    if (typeof spec.fastener === "string") consider(spec.fastener);
    let ok = true;
    (spec.stack ?? []).forEach((e: StackEntry, i) => {
      const field = `stack[${i}]`;
      const ref = typeof e === "string" ? e : e.item;
      const found = ctx.items.item(ref);
      if (!found.ok) {
        this.error("item", found.message, { field });
        ok = false;
        return;
      }
      if (typeof e === "object" && "inside" in e) {
        if (!found.bar) {
          this.error("item", `${ref} is a ${found.item.kind}: a sleeve is cut from a bar`, {
            field,
          });
          ok = false;
          return;
        }
        const layer = layers.findIndex((l) => l.ref === e.inside);
        if (layer < 0) {
          this.error("face", `${field}: inside ${e.inside}, which is not one of the layers`, {
            field: `${field}/inside`,
            refs: [e.inside],
          });
          ok = false;
          return;
        }
        const [[x0], [x1]] = found.bar.section.bbox_mm;
        const od = x1 - x0;
        // The hole a wall or a layer takes where the sleeve passes it (acceptance gap A7).
        let hole: number | undefined;
        if (e.clearance_mm !== undefined) {
          const c = ctx.num(id, `${field}/clearance_mm`, e.clearance_mm);
          if (c === undefined) {
            ok = false;
            return;
          }
          if (c < 0) {
            this.error("face", `${field}: clearance_mm is ${fmt(c)}; a hole clears its sleeve`, {
              field: `${field}/clearance_mm`,
            });
            ok = false;
            return;
          }
          hole = od + c;
        } else {
          hole = sleeveHole(od);
          if (hole === undefined) {
            this.error(
              "face",
              `${field}: no ISO 273 clearance for a sleeve of Ø${fmt(od)}; give its clearance_mm`,
              { field },
            );
            ok = false;
            return;
          }
        }
        sleeves.push({
          item: found.id,
          opt: stockOptions(ctx, found.bar),
          layer,
          len_mm: e.len_mm,
          hole,
        });
        return;
      }
      hardware.push({ item: found.id, qty: typeof e === "string" ? 1 : (e.qty ?? 1) });
      consider(ref);
    });
    return ok ? { hardware, sleeves, tnuts } : undefined;
  }

  /** The stations along the first layer: `at_mm`, rail holes or a pattern, each at every `across_mm`. */
  private stationList(L1: Layer): { s1: number; u: number }[] | undefined {
    const { ctx, spec, id } = this;
    const st = spec.stations ?? {};
    if (!L1.line) {
      this.error(
        "face",
        `the first layer ${L1.ref} is a part: stations are measured along a bar or a run`,
        {
          field: "bars",
        },
      );
      return undefined;
    }
    const line = L1.line;
    const across: number[] = [];
    for (const [i, a] of (st.across_mm ?? [0]).entries()) {
      const v = ctx.num(id, `stations/across_mm[${i}]`, a);
      if (v === undefined) return undefined;
      across.push(v);
    }
    const ats: number[] = [];
    for (const [i, a] of (st.at_mm ?? []).entries()) {
      const v = ctx.num(id, `stations/at_mm[${i}]`, a);
      if (v === undefined) return undefined;
      ats.push(v);
    }
    const along: number[] = [];
    const project = (P: V3, t: V3, field: string): number | undefined => {
      if (Math.min(angleDeg(t, line.t), angleDeg(t, neg(line.t))) > TOL.ang) {
        this.error("face", `${field}: not parallel to the first layer ${L1.ref}`, { field });
        return undefined;
      }
      return dot(sub(P, line.A), line.t);
    };
    if (st.rail_holes !== undefined) {
      const sel = st.rail_holes;
      const holes = selectHoles(ctx, id, "stations/rail_holes", sel, L1.ref, this.bars, this.runs);
      if (!holes) return undefined;
      for (const h of holes) {
        const b = this.bars.get(h.bar) as DerivedBar;
        const s1 = project(holePoint(b, h.s), b.placed.frame.t, "stations/rail_holes");
        if (s1 === undefined) return undefined;
        along.push(s1);
      }
    }
    if (st.pattern !== undefined) {
      const offs = this.patternOffsets(st.pattern, line, project);
      if (!offs) return undefined;
      for (const a of ats.length > 0 ? ats : [0]) for (const o of offs) along.push(a + o);
    } else along.push(...ats);
    return along.flatMap((s1) => across.map((u) => ({ s1, u })));
  }

  /** A pattern's stations along the first layer: 0 for the template, then each copy's step. */
  private patternOffsets(
    pid: string,
    line: { A: V3; t: V3 },
    project: (P: V3, t: V3, field: string) => number | undefined,
  ): number[] | undefined {
    const { ctx } = this;
    const rp = ctx.railPatterns.get(pid);
    if (rp) {
      const holes = selectHoles(
        ctx,
        this.id,
        "stations/pattern",
        rp.sel,
        rp.along,
        this.bars,
        this.runs,
      );
      if (!holes) return undefined;
      const out: number[] = [];
      for (const h of holes) {
        const b = this.bars.get(h.bar) as DerivedBar;
        const s = project(holePoint(b, h.s), b.placed.frame.t, "stations/pattern");
        if (s === undefined) return undefined;
        out.push(s);
      }
      const base = out[0] ?? 0;
      return out.map((s) => s - base);
    }
    const plan = ctx.patternPlans.get(pid);
    if (!plan) {
      if (!Object.hasOwn(ctx.doc.patterns, pid)) {
        this.error("ref", `stations/pattern: no pattern ${pid}`, {
          field: "stations/pattern",
          refs: [pid],
        });
      } else ctx.depFailed(this.id, "stations/pattern", pid);
      return undefined;
    }
    let t: V3 | undefined = plan.dir;
    if (plan.along) {
      t = plan.along.startsWith("r")
        ? this.runs.get(plan.along)?.t
        : this.bars.get(plan.along)?.placed.frame.t;
    }
    if (!t) {
      ctx.depFailed(this.id, "stations/pattern", pid);
      return undefined;
    }
    if (project(line.A, t, "stations/pattern") === undefined) return undefined;
    const sign = dot(t, line.t) < 0 ? -1 : 1;
    return [0, ...plan.steps.map(([, step]) => sign * step)];
  }

  /**
   * A station on the first layer's face toward the second, on that face's centre line (§4.3; an
   * inner face's is level with the box's centre) and `u` across it: its piece, distance and point.
   */
  private stationAt(
    L1: Layer,
    key: string,
    sp: { s1: number; u: number },
    k: number,
  ): { body: Body; bar: DerivedBar; s: number; P: V3 } | undefined {
    const line = L1.line as NonNullable<Layer["line"]>;
    let body = L1.bodies[0] as Body;
    let s = sp.s1;
    if (line.run) {
      const run = line.run;
      for (let i = 0; i + 1 < run.bars.length; i++) {
        if (Math.abs(sp.s1 - (run.ends[i] as number)) <= TOL.len) {
          this.error("joint", `station ${k} is on ${run.id}'s joint; move it off the joint`, {
            field: "stations",
            refs: [run.id],
          });
          return undefined;
        }
      }
      let i = 0;
      while (i < run.bars.length - 1 && sp.s1 > (run.ends[i] as number)) i++;
      body = L1.bodies[i] as Body;
      s = sp.s1 - (run.starts[i] as number);
    }
    const b = body.bar as DerivedBar;
    const face = faceByKey(body, key);
    const [cx, cy] = face.centre as readonly [number, number];
    const P = addScaled(onBar(b.placed, s, cx, cy), face.u, sp.u);
    if (!onFace(face, P)) {
      this.error(
        "face",
        `station ${k} (${fmt(sp.s1)} along ${L1.ref}, ${fmt(sp.u)} across) is off ${b.placed.id}'s face ${face.name}`,
        {
          field: "stations",
          refs: [b.placed.id],
        },
      );
      return undefined;
    }
    return { body, bar: b, s, P };
  }

  /**
   * Each layer the fastener's axis passes, from the head side. It enters a layer by its contact
   * face with the one before and leaves by its contact face with the one after; the first layer's
   * head side and the last one's nut side are the nearest face across the layer's material, facing
   * out along the axis: the far side of an angle's leg, not of its box. Every face it passes must
   * hold the axis. For a run, the piece the axis passes.
   */
  private walk(
    layers: Layer[],
    contacts: Contact[],
    P: V3,
    d: V3,
    first: Body,
    k: number,
  ): Walk[] | undefined {
    const out: Walk[] = [];
    /** A face by key and where the axis meets it; `held` when it is known to hold the axis. */
    const at = (body: Body, key: string, held = false) => {
      const f = faceByKey(body, key);
      const w = dot(sub(f.p, P), d);
      return held || onFace(f, addScaled(P, d, w)) ? { f, w } : undefined;
    };
    /** The nearest face facing `side` along the axis, past `from` that way, holding the axis. */
    const nearest = (body: Body, side: -1 | 1, from: number) => {
      const n = side < 0 ? neg(d) : d;
      let best: { f: BodyFace; w: number } | undefined;
      for (const f of facesNear(body, n)) {
        if (!parallel(f.n, n)) continue;
        const w = dot(sub(f.p, P), d);
        if (side * (w - from) <= TOL.len) continue;
        if (best && side * (w - best.w) >= 0) continue;
        if (onFace(f, addScaled(P, d, w))) best = { f, w };
      }
      return best;
    };
    for (const [i, l] of layers.entries()) {
      const inKey = i > 0 ? (contacts[i - 1] as Contact).keys[1] : undefined;
      const outKey = i + 1 < layers.length ? (contacts[i] as Contact).keys[0] : undefined;
      let hit: Walk | undefined;
      for (const body of i === 0 ? [first] : l.bodies) {
        const into = inKey === undefined ? undefined : at(body, inKey);
        // The station lies on the first layer's face toward the second (stationAt).
        const outOf = outKey === undefined ? undefined : at(body, outKey, i === 0);
        if ((inKey !== undefined && !into) || (outKey !== undefined && !outOf)) continue;
        const entry = into ?? (outOf && nearest(body, -1, outOf.w));
        const exit = outOf ?? (entry && nearest(body, 1, entry.w));
        if (!entry || !exit) continue;
        hit = { body, entry: entry.f, exit: exit.f, we: entry.w, wx: exit.w };
        break;
      }
      if (!hit) {
        this.error("face", `station ${k}: the fastener misses ${l.ref}`, {
          field: "stations",
          refs: [l.ref],
        });
        return undefined;
      }
      out.push(hit);
    }
    return out;
  }

  /** A rail layer at one of its own holes, through its running face, is not drilled again. */
  private ownRailHole(b: DerivedBar, P: V3, d: V3): boolean {
    if (!b.rail) return false;
    if (Math.min(angleDeg(d, b.placed.frame.y), angleDeg(d, neg(b.placed.frame.y))) > TOL.ang)
      return false;
    const s = dot(sub(P, b.placed.A), b.placed.frame.t);
    return b.rail.holes.some((h) => Math.abs(h - s) <= TOL.len);
  }

  /** The T-nut's groove on the last layer at the station: its lip, after the fit checks. */
  private tnut(
    last: Walk,
    P: V3,
    d: V3,
    k: number,
    tnuts: { id: string; item: Item }[],
  ): number | undefined {
    const b = last.body.bar;
    if (!b) {
      this.error("face", `station ${k}: a tnut fastening's last layer must be a grooved bar`);
      return undefined;
    }
    if (!last.entry.bounding) {
      // Grooves are declared on the four bounding faces (§3.5).
      this.error(
        "fit",
        `station ${k}: the T-nut's layer ${b.placed.id} meets the stack at its inner face ${last.entry.name}, which has no groove`,
        { field: "stations", refs: [b.placed.id] },
      );
      return undefined;
    }
    const face = last.entry.name as Face;
    const X = addScaled(P, d, last.we);
    const lx = dot(sub(X, b.placed.A), b.placed.frame.x);
    const ly = dot(sub(X, b.placed.A), b.placed.frame.y);
    const fl = faceLocal(b.placed.box, face);
    const g = b.placed.item.grooves.find((gr) => {
      if (gr.face !== face) return false;
      const local =
        fl.dir === "y"
          ? gr.at_mm - b.placed.anchor[0] + b.placed.off[0]
          : gr.at_mm - b.placed.anchor[1] + b.placed.off[1];
      return Math.abs((fl.dir === "y" ? lx : ly) - local) <= TOL.len;
    });
    if (!g) {
      this.error(
        "fit",
        `station ${k}: no groove of ${b.placed.id}'s face ${face} where the T-nut goes`,
        {
          field: "stations",
          refs: [b.placed.id],
        },
      );
      return undefined;
    }
    if (tnuts.length === 0 && this.report && k === 1) {
      this.ctx.d.warn("fit", this.id, "a tnut fastening lists no T-nut or hammer screw", {
        field: "stack",
      });
    }
    for (const t of tnuts) {
      if (!fitsGroove(t.id, t.item, b.placed.item, g.type) && k === 1) {
        this.error(
          "fit",
          `${t.id} does not fit ${b.placed.id} (${b.placed.item.system ?? "no system"}${g.type ? `, groove ${g.type}` : ""})`,
          { refs: [b.placed.id] },
        );
      }
    }
    if (g.lip_mm === undefined) {
      this.error(
        "fit",
        `station ${k}: the groove type of ${b.placed.id}'s face ${face} is unknown, so its lip is`,
        {
          refs: [b.placed.id],
        },
      );
      return undefined;
    }
    return g.lip_mm;
  }

  /** A hollow layer's bore where the axis crosses it: its inside depth and its nut-side inner face. */
  private bore(
    w: Walk,
    h: Hollow,
    P: V3,
    d: V3,
  ): { inside: number; innerExit: number } | undefined {
    const b = w.body.bar as DerivedBar;
    const outside = w.wx - w.we;
    const mid = (w.we + w.wx) / 2;
    if (h.shape === "rhs") {
      // The axis must cross the flat walls: inside the inner box across the section.
      const e = this.offAxis(b, P, d);
      const across = this.acrossHalf(b, d);
      if (Math.abs(e) >= across - h.t) return undefined;
      const inside = outside - 2 * h.t;
      return { inside, innerExit: w.wx - h.t };
    }
    const e = this.offAxis(b, P, d);
    const ri = h.R - h.t;
    if (Math.abs(e) >= ri) return undefined;
    const half = Math.sqrt(ri * ri - e * e);
    return { inside: 2 * half, innerExit: mid + half };
  }

  /** The walls of a hollow layer along the axis, each with its outer face. */
  private walls(
    w: Walk,
    h: Hollow,
    P: V3,
    d: V3,
  ): {
    from: number;
    to: number;
    entry: BodyFace | undefined;
    exit: BodyFace | undefined;
    wall: boolean;
  }[] {
    const b = w.body.bar as DerivedBar;
    if (h.shape === "rhs") {
      return [
        { from: w.we, to: w.we + h.t, entry: w.entry, exit: undefined, wall: true },
        { from: w.wx - h.t, to: w.wx, entry: undefined, exit: w.exit, wall: true },
      ];
    }
    const e = this.offAxis(b, P, d);
    const mid = (w.we + w.wx) / 2;
    const oh = Math.sqrt(Math.max(h.R * h.R - e * e, 0));
    const ri = h.R - h.t;
    const ih = Math.sqrt(Math.max(ri * ri - e * e, 0));
    return [
      { from: mid - oh, to: mid - ih, entry: w.entry, exit: undefined, wall: true },
      { from: mid + ih, to: mid + oh, entry: undefined, exit: w.exit, wall: true },
    ];
  }

  /** The axis's offset from the bar's box centre, across both the bar and the axis. */
  private offAxis(b: DerivedBar, P: V3, d: V3): number {
    const bar = b.placed;
    const v = unit(cross(d, bar.frame.t)) as V3;
    const [cx, cy] = [(bar.box.x0 + bar.box.x1) / 2, (bar.box.y0 + bar.box.y1) / 2];
    const C = add(bar.A, add(scale(bar.frame.x, cx), scale(bar.frame.y, cy)));
    return dot(sub(P, C), v);
  }

  /** Half the bar's box width across both the bar and the axis. */
  private acrossHalf(b: DerivedBar, d: V3): number {
    const bar = b.placed;
    const v = unit(cross(d, bar.frame.t)) as V3;
    return (
      (Math.abs(dot(v, bar.frame.x)) * (bar.box.x1 - bar.box.x0) +
        Math.abs(dot(v, bar.frame.y)) * (bar.box.y1 - bar.box.y0)) /
      2
    );
  }

  private sleeveLen(len: number | string, bore: number): number | undefined {
    const { ctx } = this;
    const scope: ExprScope = {
      name: (n) => (n === "bore" ? bore : ctx.scope.name(n)),
      ...(ctx.scope.accessor ? { accessor: ctx.scope.accessor } : {}),
    };
    try {
      return evalNumber(len, scope);
    } catch (e) {
      this.error("expr", `stack: the sleeve's len_mm: ${(e as Error).message}`, { field: "stack" });
      return undefined;
    }
  }

  /**
   * Where the axis lies in a bar's section (its outline's outer ring, grooved sides closed), as
   * intervals along the axis from the station point.
   */
  private material(b: DerivedBar, P: V3, d: V3): [number, number][] {
    const bar = b.placed;
    const { x, y } = bar.frame;
    const r = sub(P, bar.A);
    return materialAlong(
      outlineFaces(bar.item.section).ring,
      [dot(r, x) + bar.anchor[0] - bar.off[0], dot(r, y) + bar.anchor[1] - bar.off[1]],
      [dot(d, x), dot(d, y)],
    );
  }

  /**
   * The bounding face a solid layer's hole is listed from, since an op names one of the four
   * (§4.4), and how: `lead`, the distance from that face's plane to where the layer's material
   * starts, and `through`, whether nothing more of the section stands on the axis the way it is
   * drilled (else the op takes a depth). In order: the face the fastener enters by, as before gap
   * A3; the face it leaves by; then the bounding face parallel to either across open air, which an
   * I-beam's web needs. `end` asks for a hole that opens at that end (a counterbore, a tap), and
   * `flush` for one listed from the layer's own face. None fits: an error.
   */
  private listing(
    b: DerivedBar,
    w: Walk,
    P: V3,
    d: V3,
    end: "entry" | "exit" | "any",
    k: number,
    flush = false,
  ): { face: BodyFace; w: number; lead: number; through: boolean } | undefined {
    // Between two bounding faces the hole passes the whole section: nothing of it lies outside.
    const M = w.entry.bounding && w.exit.bounding ? [] : this.material(b, P, d);
    const some = (lo: number, hi: number) =>
      M.some(([a, z]) => Math.min(z, hi) - Math.max(a, lo) > TOL.len);
    const beyond = some(w.wx, Number.POSITIVE_INFINITY);
    const before = some(Number.NEGATIVE_INFINITY, w.we);
    const inSide = w.body.faces.find((f) => parallel(f.n, neg(d)));
    const outSide = w.body.faces.find((f) => parallel(f.n, d));
    if (end !== "exit" && w.entry.bounding)
      return { face: w.entry, w: w.we, lead: 0, through: !beyond };
    if (end !== "entry" && w.exit.bounding)
      return { face: w.exit, w: w.wx, lead: 0, through: !before };
    if (!flush && end !== "exit" && inSide) {
      const wB = dot(sub(inSide.p, P), d);
      if (!some(wB, w.we)) return { face: inSide, w: wB, lead: w.we - wB, through: !beyond };
    }
    if (!flush && end !== "entry" && outSide) {
      const wB = dot(sub(outSide.p, P), d);
      if (!some(w.wx, wB)) return { face: outSide, w: wB, lead: wB - w.wx, through: !before };
    }
    this.error(
      "face",
      `station ${k}: the hole in ${b.placed.id} cannot be listed from one of its four faces: more of its section stands on the fastener's axis`,
      { field: "stations", refs: [b.placed.id] },
    );
    return undefined;
  }

  /** A generated hole on a bar, where the axis meets the given face's plane. */
  private addHole(
    b: DerivedBar,
    face: BodyFace,
    P: V3,
    d: V3,
    w: number,
    fields: Partial<Pick<HoleOp, "d" | "thread" | "depth" | "cbore">>,
  ): void {
    const bar = b.placed;
    const X = addScaled(P, d, w);
    const s = dot(sub(X, bar.A), bar.frame.t);
    const name = face.name as Face;
    const fl = faceLocal(bar.box, name);
    const C = onBar(bar, s, fl.at[0], fl.at[1]);
    const across = dot(sub(X, C), face.u);
    b.ops.push({
      op: "hole",
      face: name,
      from: "a",
      at: s,
      ...(Math.abs(across) > TOL.len / 100 ? { across } : {}),
      ...fields,
      by: this.id,
    });
  }
}

/** A hollow bar's section: an RHS or a tube with a wall thickness. */
function hollowOf(body: Body): Hollow | undefined {
  const item = body.bar?.placed.item;
  if (!item) return undefined;
  const t = item.sectionParams.t_mm;
  if (t === undefined) return undefined;
  if (item.shape === "rhs") return { shape: "rhs", t, R: 0 };
  if (item.shape === "tube") {
    const d = item.sectionParams.d_mm;
    return d === undefined ? undefined : { shape: "tube", t, R: d / 2 };
  }
  return undefined;
}

/** A T-nut fits a bar when it names the bar's system, or the groove type it enters (§5.5). */
function fitsGroove(
  itemId: string,
  item: Item,
  bar: BarItemInfo,
  grooveType: string | undefined,
): boolean {
  const home = itemId.slice(0, itemId.indexOf(":"));
  const it = item as { fits?: readonly string[]; groove?: string };
  if (it.fits?.some((s) => bar.system !== undefined && fullRef(s, home) === bar.system))
    return true;
  return (
    it.groove !== undefined && grooveType !== undefined && fullRef(it.groove, home) === grooveType
  );
}

/**
 * A piece cut from a bar item outside the document's bars takes `defaults.bar.opt` for each
 * option its item has (as a bar does, M3a decision 10).
 */
export function stockOptions(ctx: Ctx, info: BarItemInfo): Record<string, string> {
  const out: Record<string, string> = {};
  const defaults = ctx.doc.defaults.bar?.opt ?? {};
  for (const name of Object.keys(info.options).sort()) {
    const v = defaults[name];
    if (v !== undefined && info.options[name]?.includes(v)) out[name] = v;
  }
  return out;
}
