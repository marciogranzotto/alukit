import { z } from "zod";
import { poseAxes } from "../derive/place.ts";
import { compareIds } from "../ids.ts";
import type { Expr, Face } from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { atan2Deg } from "../trig.ts";
import { dist, dot, type V3 } from "../vec.ts";
import {
  getEntity,
  isObject,
  KIND_PREFIX,
  type Kind,
  kindOf,
  type MapKind,
  nextId,
  withEntity,
} from "./doc.ts";
import { checkAll, derivedBar, guard, runBars, sectionOf } from "./geometry.ts";
import { failed, requireEntity, withDoc } from "./helpers.ts";
import { type BarMap, mapBarFields, mapOps, mapStation, swapEnd, turnedRoll } from "./maps.ts";
import { ang, minus, negate, reflect } from "./numbers.ts";
import { type Rewriter, refusal, rewriteEntity } from "./rewrite.ts";
import { flipsU, hasSymmetry, type Map2, mapFace, type Sym, symmetries } from "./sections.ts";
import { type CommandContext, type CommandDef, done, type Outcome } from "./types.ts";

/**
 * `mirror` (design §4.7, §6, call 21): copies entities as their mirror image in a plane square to
 * a world axis, as ordinary entities. References inside the set go to the copies; those outside
 * are kept, which is right only for what the plane maps onto itself: a node on the plane, or a
 * bar that lies in it or crosses it symmetrically (the bar a mirrored brace attaches to).
 * Anything else outside the set is refused, naming what to include.
 *
 * A mirrored bar keeps its item when its section has a mirror symmetry (§4.4's four lines, the
 * same a reversed bar uses); otherwise it takes the item's other `hand`, read as the section
 * mirrored across its vertical centre line; otherwise the command is refused. A part keeps its
 * item when its box is symmetric about its mounting datum across its own y, else takes the other
 * hand, else is refused.
 */

type O = Record<string, unknown>;

const AXES = ["x", "y", "z"] as const;
const KINDS: Kind[] = ["nodes", "bars", "runs", "connections", "parts"];

/** The roll that places the image, per section symmetry, when the bar's up is mirrored too or is
 * unchanged by the plane (case A), and when the plane turns its default up over (case B). */
const ROLL_A: Record<Sym, number> = { x: 0, y: 180, d: 90, a: 270 };
const ROLL_B: Record<Sym, number> = { x: 180, y: 0, d: 270, a: 90 };

const Mirror = z.strictObject({
  ids: z
    .array(z.string())
    .min(1)
    .describe("the nodes, bars, runs, connections and parts to mirror"),
  plane: z
    .strictObject({ axis: z.enum(AXES), at_mm: z.number() })
    .describe("the mirror plane: square to a world axis, at a coordinate along it"),
});

/** A map of a section's local (u, v) under the plane, as a 2×2 matrix by rows. */
const MATRIX: Record<Map2, readonly [number, number, number, number]> = {
  i: [1, 0, 0, 1],
  x: [-1, 0, 0, 1],
  y: [1, 0, 0, -1],
  d: [0, 1, 1, 0],
  a: [0, -1, -1, 0],
};

export const mirror: CommandDef<z.infer<typeof Mirror>> = {
  name: "mirror",
  group: "Parts and patterns",
  summary:
    "copy entities as their mirror image in a plane square to a world axis, as ordinary entities",
  args: Mirror,
  apply: (ctx, a) => guard(() => mirrorSet(ctx, a)),
};

function mirrorSet(ctx: CommandContext, a: z.infer<typeof Mirror>): Outcome {
  const doc0 = ctx.state.doc;
  const k = AXES.indexOf(a.plane.axis);
  const at = a.plane.at_mm;
  const set = [...new Set(a.ids)].sort(compareIds);
  for (const id of set) {
    const missing = requireEntity(doc0, id, ...KINDS);
    if (missing.length > 0) return failed(missing);
  }
  const R = (v: V3): V3 => v.map((c, i) => (i === k ? 2 * at - c : c)) as unknown as V3;
  const Rdir = (v: V3): V3 => v.map((c, i) => (i === k ? -c : c)) as unknown as V3;

  // Copy ids, in id order per kind.
  let doc = doc0;
  const copyOf = new Map<string, string>();
  for (const id of set) {
    const n = nextId(doc, KIND_PREFIX[kindOf(id) as MapKind]);
    doc = n.doc;
    copyOf.set(id, n.id);
  }

  // How each mirrored bar's section turns over, and the roll that places the image.
  const maps = new Map<string, BarMap>();
  const rollC = new Map<string, number>();
  const hand = new Map<string, O>();
  for (const id of set.filter((x) => x.startsWith("b"))) {
    const spec = getEntity(doc0, id) as O;
    const section = sectionOf(ctx, id, spec);
    const db = derivedBar(ctx, id);
    let m: Sym | undefined = symmetries(section)[0];
    if (m === undefined) {
      hand.set(id, otherHand(ctx, id, spec, "bar"));
      m = "x";
    }
    const t = db.placed.frame.t;
    const vertical = Math.hypot(t[0], t[1]) < TOL.vert;
    const caseB = spec.up === undefined && (vertical ? k === 1 : k === 2);
    maps.set(id, { to: copyOf.get(id) as string, reversed: false, m, section });
    rollC.set(id, (caseB ? ROLL_B : ROLL_A)[m]);
  }
  for (const id of set.filter((x) => x.startsWith("r"))) {
    const bars = runBars(getEntity(doc0, id));
    const first = maps.get(bars[0] as string);
    if (!first || !bars.every((b) => maps.has(b))) {
      throw refusal("args", `${id}: mirror its bars with it`, {
        entity: id,
        refs: bars.filter((b) => !maps.has(b)),
      });
    }
    maps.set(id, { ...first, to: copyOf.get(id) as string });
  }

  // A bar outside the set must be its own image: it lies in the plane, or crosses it symmetrically.
  const outside = new Map<string, BarMap>();
  const selfMap = (bar: string, where: string): BarMap => {
    const hit = outside.get(bar);
    if (hit) return hit;
    if (bar.startsWith("r")) {
      throw refusal("geometry", `${where}: run ${bar} is not mirrored; include it and its bars`, {
        refs: [bar],
      });
    }
    const db = derivedBar(ctx, bar);
    const { A, B, frame, box } = db.placed;
    const notOwn = () =>
      refusal(
        "geometry",
        `${where}: ${bar} is not mirrored and the plane does not map it onto itself; include it`,
        {
          entity: where.split("/")[0],
          refs: [bar],
        },
      );
    if (!B) throw notOwn();
    const RA = R(A);
    const RB = R(B);
    let reversed: boolean;
    if (dist(RA, A) <= TOL.len && dist(RB, B) <= TOL.len) reversed = false;
    else if (dist(RA, B) <= TOL.len && dist(RB, A) <= TOL.len) reversed = true;
    else throw notOwn();
    const Rx = Rdir(frame.x);
    const Ry = Rdir(frame.y);
    const got = [dot(Rx, frame.x), dot(Ry, frame.x), dot(Rx, frame.y), dot(Ry, frame.y)];
    const m = (Object.keys(MATRIX) as Map2[]).find((key) =>
      MATRIX[key].every((v, i) => Math.abs(v - (got[i] as number)) <= 1e-9),
    );
    const section = sectionOf(ctx, bar, getEntity(doc0, bar) as O);
    // The box, about the design line, must be its own image too.
    const [m00, m01, m10, m11] = MATRIX[m ?? "i"];
    const corners: [number, number][] = [
      [box.x0, box.y0],
      [box.x1, box.y1],
    ];
    const image = corners.map(
      ([u, v]) => [m00 * u + m01 * v, m10 * u + m11 * v] as [number, number],
    );
    const xs = image.map((p) => p[0]).sort((p, q) => p - q);
    const ys = image.map((p) => p[1]).sort((p, q) => p - q);
    const boxOwn =
      Math.abs((xs[0] as number) - box.x0) <= TOL.len &&
      Math.abs((xs[1] as number) - box.x1) <= TOL.len &&
      Math.abs((ys[0] as number) - box.y0) <= TOL.len &&
      Math.abs((ys[1] as number) - box.y1) <= TOL.len;
    if (m === undefined || !boxOwn || (m !== "i" && !hasSymmetry(section, m))) throw notOwn();
    const bm: BarMap = { to: bar, reversed, m, section };
    outside.set(bar, bm);
    return bm;
  };
  const mapOf = (bar: string, where: string) => maps.get(bar) ?? selfMap(bar, where);

  const rw: Rewriter = {
    id: (x) => {
      const c = copyOf.get(x);
      if (c) return c;
      if (x.startsWith("n")) {
        // A node outside the set is kept only when it lies on the plane.
        const p = ctx.derived().nodes.get(x);
        if (!p || Math.abs((p[k] as number) - at) > TOL.len) {
          throw refusal("geometry", `node ${x} is not mirrored and is off the plane; include it`, {
            refs: [x],
          });
        }
      }
      if (x.startsWith("b") || x.startsWith("r")) selfMap(x, x);
      if (x.startsWith("c") || x.startsWith("p")) {
        throw refusal("geometry", `${x} is named by what is mirrored; include it`, { refs: [x] });
      }
      return x;
    },
    end: (ref) => {
      const [bar, e] = ref.split(".") as [string, string];
      const c = copyOf.get(bar);
      if (c) return `${c}.${e}`;
      return selfMap(bar, ref).reversed ? swapEnd(ref) : ref;
    },
    coords: (v) => v.map((c, i) => (i === k ? reflect(c, at) : c)) as unknown as typeof v,
    direction: (v) => {
      if (typeof v === "string") return v[1] === AXES[k] ? `${v[0] === "+" ? "-" : "+"}${v[1]}` : v;
      return v.map((c, i) => (i === k ? negate(c) : c)) as unknown as typeof v;
    },
    station: (st, where) => mapStation(st, mapOf(st.bar as string, where), where),
    face: (bar, face, where) => mapFace(mapOf(bar, where).m, face),
    pose: (p, where) => {
      const { rot_deg: _, ...rest } = p;
      const rot = mirroredRot(p.rot_deg, k, where);
      return {
        ...rest,
        ...(Array.isArray(p.pos)
          ? { pos: (p.pos as Expr[]).map((c, i) => (i === k ? reflect(c, at) : c)) }
          : {}),
        ...(rot ? { rot_deg: rot } : {}),
      };
    },
    entity: (kind, id, v) => entityImage(ctx, kind, id, v, { maps, rollC, hand, mapOf, k }),
  };

  const created: string[] = [];
  for (const id of set) {
    const kind = kindOf(id) as Kind;
    const copy = copyOf.get(id) as string;
    doc = withEntity(doc, copy, rewriteEntity(kind, id, getEntity(doc0, id), rw));
    created.push(copy);
  }
  checkAll(ctx, doc, created);
  return done(withDoc(ctx, doc), { created }, { copies: Object.fromEntries(copyOf) });
}

interface Env {
  maps: ReadonlyMap<string, BarMap>;
  rollC: ReadonlyMap<string, number>;
  hand: ReadonlyMap<string, O>;
  mapOf: (bar: string, where: string) => BarMap;
  k: number;
}

function entityImage(ctx: CommandContext, kind: Kind, id: string, v: O, env: Env): O {
  if (kind === "bars") {
    const bm = env.maps.get(id) as BarMap;
    const out = mapBarFields(id, v, bm.m as Sym, bm.section, env.rollC.get(id) as number);
    if (v.ops !== undefined) out.ops = mapOps(v.ops, bm.m, false);
    const opt = env.hand.get(id);
    if (opt) out.opt = opt;
    return out;
  }
  if (kind === "parts") {
    if (isObject(v.on)) {
      const bm = env.mapOf(v.on.bar as string, `${id}/on`);
      // On a copy (or a bar in the plane) the part turns over in its own y: roll −ρ; on a bar
      // the plane reverses, measured from the other end: roll 180° − ρ (§4.7's part frame).
      const roll = turnedRoll(bm.reversed ? 180 : 0, v.roll_deg as Expr | undefined);
      const { roll_deg: _, ...rest } = v;
      const out: O = roll === undefined ? rest : { ...rest, roll_deg: roll };
      return withPartHand(ctx, id, out);
    }
    if (isObject(v.at)) return withPartHand(ctx, id, v);
    return v;
  }
  if (kind === "connections") {
    if (
      v.type === "butt" &&
      isObject(v.through_end) &&
      typeof v.through === "string" &&
      !v.through.includes(".")
    ) {
      const bm = env.mapOf(v.through, `${id}/through`);
      if (bm.reversed) {
        const te = v.through_end;
        return { ...v, through_end: { ...te, end: te.end === "a" ? "b" : "a" } };
      }
    }
    if (v.type === "face" && Array.isArray(v.bars)) return faceImage(ctx, id, v, env);
  }
  return v;
}

function faceImage(ctx: CommandContext, id: string, v: O, env: Env): O {
  // The hook sees the copy: its layers are the images' ids. Map them back to their maps.
  const layers = v.bars as string[];
  const byImage = new Map([...env.maps.values()].map((bm) => [bm.to, bm]));
  const mapOfImage = (l: string) => byImage.get(l) ?? env.mapOf(l, `${id}/bars`);
  const out: O = { ...v };
  if (Array.isArray(v.faces)) {
    out.faces = (v.faces as [Face, Face][]).map(([f, g], i) => [
      mapFace(mapOfImage(layers[i] as string).m, f),
      mapFace(mapOfImage(layers[i + 1] as string).m, g),
    ]);
  }
  const st = v.stations;
  if (!isObject(st)) return out;
  const first = mapOfImage(layers[0] as string);
  const stations: O = { ...st };
  if (first.reversed && Array.isArray(st.at_mm)) {
    const L = derivedBar(ctx, first.to).lengths.len;
    stations.at_mm = st.at_mm.map((e) => minus(L, e as Expr));
  }
  if (Array.isArray(st.across_mm)) {
    const face = Array.isArray(v.faces) ? (v.faces as [Face, Face][])[0]?.[0] : undefined;
    const m = first.m;
    const flip = face
      ? flipsU(m, face)
      : m === "a"
        ? true
        : m === "d" || m === "i"
          ? false
          : undefined;
    const sym =
      st.across_mm.every((x) => typeof x === "number") &&
      [...(st.across_mm as number[])].sort((p, q) => p - q).join() ===
        (st.across_mm as number[])
          .map((x) => -x)
          .sort((p, q) => p - q)
          .join();
    if (flip === undefined && !sym) {
      throw refusal("geometry", `${id}: give its faces, so its across offsets can be mirrored`, {
        entity: id,
      });
    }
    if (flip) stations.across_mm = st.across_mm.map((e) => negate(e as Expr));
  }
  if (st.rail_holes !== undefined && first.reversed) {
    throw refusal(
      "geometry",
      `${id}: its rail holes are selected from the start of a bar the plane reverses`,
      { entity: id },
    );
  }
  out.stations = stations;
  return out;
}

/** The other value of an item's `hand` option, or a refusal. */
function otherHand(ctx: CommandContext, id: string, spec: O, what: string): O {
  const ref = spec.item as string | undefined;
  const defaults =
    isObject(ctx.state.doc.defaults) && isObject(ctx.state.doc.defaults.bar)
      ? ctx.state.doc.defaults.bar
      : {};
  const itemRef = ref ?? (what === "bar" ? (defaults.item as string | undefined) : undefined);
  const found = itemRef ? ctx.items().item(itemRef) : undefined;
  const hands = found?.ok ? (found.item.options?.hand ?? []) : [];
  const opt = {
    ...((what === "bar" && !ref && isObject(defaults.opt) ? defaults.opt : {}) as O),
    ...((spec.opt ?? {}) as O),
  };
  if (hands.length !== 2) {
    throw refusal(
      "geometry",
      `${id}: ${itemRef ?? "its item"} is not symmetric and has no other hand, so its mirror image is another item`,
      {
        entity: id,
      },
    );
  }
  const now = (opt.hand as string | undefined) ?? hands[0];
  return { ...opt, hand: hands[0] === now ? hands[1] : hands[0] };
}

/** A part keeps its item when its box is symmetric across its own y about its landing datum. */
function withPartHand(ctx: CommandContext, id: string, v: O): O {
  const found = ctx.items().item(v.item as string);
  if (!found.ok) return v;
  const item = found.item as {
    kind: string;
    bbox_mm?: readonly [V3, V3];
    datums?: Record<string, V3>;
  };
  const landing = (item.kind === "carriage" ? item.datums?.run : item.datums?.mount) ?? [0, 0, 0];
  const box = item.bbox_mm;
  const dy = landing[1];
  const boxOk = !box || Math.abs(box[0][1] - dy + (box[1][1] - dy)) <= TOL.len;
  const datumsOk = Object.values(item.datums ?? {}).every((d) =>
    Object.values(item.datums ?? {}).some(
      (e) =>
        Math.abs(e[0] - d[0]) <= TOL.len &&
        Math.abs(e[1] - (2 * dy - d[1])) <= TOL.len &&
        Math.abs(e[2] - d[2]) <= TOL.len,
    ),
  );
  if (boxOk && datumsOk) return v;
  return { ...v, opt: otherHand(ctx, id, v, "part") };
}

/**
 * A pose's rotation mirrored (§4.7: about world X, then Y, then Z): the image's axes are the
 * plane's images of x and z and the negated image of y (the item turns over in its own y).
 */
function mirroredRot(rot: unknown, k: number, where: string): number[] | undefined {
  const r = Array.isArray(rot) ? rot : [0, 0, 0];
  if (!r.every((c) => typeof c === "number")) {
    throw refusal(
      "geometry",
      `${where}: the rotation is an expression; mirror needs numbers to turn it`,
      {
        entity: where.split("/")[0],
      },
    );
  }
  const [X, Y, Z] = poseAxes(r as unknown as V3);
  const flip = (v: V3, s: number): V3 => v.map((c, i) => s * (i === k ? -c : c)) as unknown as V3;
  const x = flip(X, 1);
  const y = flip(Y, -1);
  const z = flip(Z, 1);
  // Columns are the images of the axes: R = [x y z], R = Rz(c)·Ry(b)·Rx(a).
  const sb = -(x[2] as number);
  let a: number;
  let b: number;
  let c: number;
  if (Math.abs(sb) >= 1 - 1e-12) {
    b = sb > 0 ? 90 : -90;
    a = 0;
    c = atan2Deg(-(y[0] as number), y[1] as number);
  } else {
    b = atan2Deg(sb, Math.hypot(x[0] as number, x[1] as number));
    a = atan2Deg(y[2] as number, z[2] as number);
    c = atan2Deg(x[1] as number, x[0] as number);
  }
  const out = [a, b, c].map((d) => {
    const v = ang(((d % 360) + 360) % 360);
    return v >= 360 ? 0 : v;
  });
  return out.every((d) => d === 0) ? undefined : out;
}
