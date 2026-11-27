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
import { idList } from "./words.ts";

/**
 * `mirror` (design §4.7, §6, call 21): copies entities as their mirror image in a plane square to
 * a world axis, as ordinary entities. References inside the set go to the copies. A node outside
 * it is kept only when it lies on the plane. A bar outside it is taken as the bar at its image
 * (design §6, call 112; docs/ux/polish-editing-decisions.md 8–11): itself when it lies in the
 * plane or crosses it symmetrically (the bar a mirrored brace attaches to), else an existing bar
 * of the same section standing exactly where its image would (the opposite leg a bracket lands
 * on). Anything else outside the set is refused, naming what to include.
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
    .describe(
      "the nodes, bars, runs, connections and parts to mirror; a bar they name outside the set is taken as the bar at its image: itself, or an existing bar standing there (a bracket on one leg lands on the opposite leg)",
    ),
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
  describe(a, d) {
    const onto = Object.values((d.info as MirrorInfo | undefined)?.onto ?? {});
    return `mirror ${idList(a.ids)}, making ${idList(d.created)}${onto.length > 0 ? ` on ${idList([...new Set(onto)])}` : ""}`;
  },
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

  // A bar outside the set is referred to as the bar at its image (the editing polish, gap 2):
  // itself when the plane maps it onto itself (it lies in the plane, or crosses it
  // symmetrically), else an existing bar that stands exactly where its image would, so a bracket
  // on one leg mirrored alone lands on the opposite leg. Where no bar stands there, it is refused.
  const docBars = Object.keys(isObject(doc0.bars) ? doc0.bars : {}).sort(compareIds);
  /** How bar `src`'s image lies on bar `dst`, or undefined when it is not `dst`'s body. */
  const onto = (src: string, dst: string): BarMap | undefined => {
    const s = derivedBar(ctx, src).placed;
    const d = ctx.derived().bars.get(dst)?.placed;
    if (!s.B || !d?.B) return undefined;
    const RA = R(s.A);
    const RB = R(s.B);
    let reversed: boolean;
    if (dist(RA, d.A) <= TOL.len && dist(RB, d.B) <= TOL.len) reversed = false;
    else if (dist(RA, d.B) <= TOL.len && dist(RB, d.A) <= TOL.len) reversed = true;
    else return undefined;
    const Rx = Rdir(s.frame.x);
    const Ry = Rdir(s.frame.y);
    const got = [dot(Rx, d.frame.x), dot(Ry, d.frame.x), dot(Rx, d.frame.y), dot(Ry, d.frame.y)];
    const m = (Object.keys(MATRIX) as Map2[]).find((key) =>
      MATRIX[key].every((v, i) => Math.abs(v - (got[i] as number)) <= 1e-9),
    );
    const section = sectionOf(ctx, src, getEntity(doc0, src) as O);
    if (dst !== src && sectionOf(ctx, dst, getEntity(doc0, dst) as O).id !== section.id) {
      return undefined;
    }
    // The box, about the design line, must land on the other's (its own, for itself).
    const [m00, m01, m10, m11] = MATRIX[m ?? "i"];
    const corners: [number, number][] = [
      [s.box.x0, s.box.y0],
      [s.box.x1, s.box.y1],
    ];
    const image = corners.map(
      ([u, v]) => [m00 * u + m01 * v, m10 * u + m11 * v] as [number, number],
    );
    const xs = image.map((p) => p[0]).sort((p, q) => p - q);
    const ys = image.map((p) => p[1]).sort((p, q) => p - q);
    const boxOn =
      Math.abs((xs[0] as number) - d.box.x0) <= TOL.len &&
      Math.abs((xs[1] as number) - d.box.x1) <= TOL.len &&
      Math.abs((ys[0] as number) - d.box.y0) <= TOL.len &&
      Math.abs((ys[1] as number) - d.box.y1) <= TOL.len;
    if (m === undefined || !boxOn || (m !== "i" && !hasSymmetry(section, m))) return undefined;
    return { to: dst, reversed, m, section };
  };
  type Home = { map: BarMap } | { why: string; refs: string[] };
  const homes = new Map<string, Home>();
  /** The bar a bar outside the set lands on, or why none. */
  const homeOf = (bar: string): Home => {
    const hit = homes.get(bar);
    if (hit) return hit;
    let home: Home;
    if (bar.startsWith("r"))
      home = { why: `run ${bar} is not mirrored; include it and its bars`, refs: [bar] };
    else {
      const own = onto(bar, bar);
      if (own) home = { map: own };
      else {
        const s = derivedBar(ctx, bar).placed;
        const RA = R(s.A);
        const RB = s.B ? R(s.B) : undefined;
        const lined = docBars.filter((x) => {
          const d = x === bar ? undefined : ctx.derived().bars.get(x)?.placed;
          if (!d?.B || !RB) return false;
          return (
            (dist(RA, d.A) <= TOL.len && dist(RB, d.B) <= TOL.len) ||
            (dist(RA, d.B) <= TOL.len && dist(RB, d.A) <= TOL.len)
          );
        });
        const found = lined.flatMap((x) => {
          const bm = onto(bar, x);
          return bm ? [bm] : [];
        });
        const plane = `${AXES[k]} = ${at}`;
        if (found.length === 1) home = { map: found[0] as BarMap };
        else if (found.length > 1) {
          const ids = found.map((x) => x.to);
          home = {
            why: `${bar} is not mirrored, and ${idList(ids)} all stand at its image across ${plane}; include ${bar}`,
            refs: [bar, ...ids],
          };
        } else if (lined.length > 0) {
          home = {
            why: `${bar} is not mirrored, and ${idList(lined)} ${lined.length > 1 ? "stand" : "stands"} on its image's line but ${lined.length > 1 ? "are" : "is"} not its mirror image (another section or placement); include ${bar}`,
            refs: [bar, ...lined],
          };
        } else {
          home = {
            why: `${bar} is not mirrored, and no bar stands at its image across ${plane}; include ${bar}`,
            refs: [bar],
          };
        }
      }
    }
    homes.set(bar, home);
    return home;
  };
  const outsideMap = (bar: string, where: string): BarMap => {
    const h = homeOf(bar);
    if ("map" in h) return h.map;
    throw refusal("geometry", `${where}: ${h.why}`, {
      entity: where.split("/")[0],
      refs: h.refs,
    });
  };
  const mapOf = (bar: string, where: string) => maps.get(bar) ?? outsideMap(bar, where);
  /** The map that produced a bar id as rewritten: a copy's, or an outside bar's home. */
  const mapOfImage = (id: string, where: string): BarMap => {
    for (const bm of maps.values()) if (bm.to === id) return bm;
    for (const h of homes.values()) if ("map" in h && h.map.to === id) return h.map;
    return outsideMap(id, where);
  };

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
      if (x.startsWith("b") || x.startsWith("r")) return outsideMap(x, x).to;
      if (x.startsWith("c") || x.startsWith("p")) {
        throw refusal("geometry", `${x} is named by what is mirrored; include it`, { refs: [x] });
      }
      return x;
    },
    end: (ref) => {
      const [bar, e] = ref.split(".") as [string, string];
      const c = copyOf.get(bar);
      if (c) return `${c}.${e}`;
      const bm = outsideMap(bar, ref);
      return bm.reversed ? swapEnd(`${bm.to}.${e}`) : `${bm.to}.${e}`;
    },
    axisBar: (bar, where) => {
      // A plane square to a bar reads only its axis t. Its image is square to R(t), so a bar
      // outside the set still serves when R(t) = ±t: its axis lies in the plane's directions
      // (t_k = 0) or is square to the plane; otherwise the bar standing at its image does.
      const c = copyOf.get(bar);
      if (c) return c;
      const t = derivedBar(ctx, bar).placed.frame.t;
      const along = Math.abs(t[k] as number);
      if (along <= 1e-9 || Math.abs(along - 1) <= 1e-9) return bar;
      const h = homeOf(bar);
      if ("map" in h) return h.map.to;
      throw refusal(
        "geometry",
        `${where}: the plane is square to ${bar}, which is not mirrored and whose axis the mirror turns; include it`,
        { entity: where.split("/")[0], refs: [bar] },
      );
    },
    coords: (v) => v.map((c, i) => (i === k ? reflect(c, at) : c)) as unknown as typeof v,
    direction: (v) => {
      if (typeof v === "string") return v[1] === AXES[k] ? `${v[0] === "+" ? "-" : "+"}${v[1]}` : v;
      return v.map((c, i) => (i === k ? negate(c) : c)) as unknown as typeof v;
    },
    station: (st, where) => {
      const bm = mapOf(st.bar as string, where);
      const from = (st.from as string | undefined) ?? "a";
      // Measured from a cut, on a bar outside the set: the bar it lands on must be cut there as
      // the image of this one, or the station would land elsewhere than the image.
      if (from.endsWith(".cut") && !maps.has(st.bar as string)) {
        const e = from[0] as "a" | "b";
        const te = bm.reversed ? (e === "a" ? "b" : "a") : e;
        const was = derivedBar(ctx, st.bar as string).ends[e].move;
        const now = derivedBar(ctx, bm.to).ends[te].move;
        if (Math.abs(was - now) > TOL.len) {
          throw refusal(
            "geometry",
            `${where}: it is measured from ${st.bar as string}.${e}'s cut, and ${bm.to}.${te} is not cut as its image; include ${st.bar as string}`,
            { entity: where.split("/")[0], refs: [st.bar as string, bm.to] },
          );
        }
      }
      return mapStation(st, bm, where);
    },
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
    entity: (kind, id, v) =>
      entityImage(ctx, kind, id, v, { maps, rollC, hand, mapOf, mapOfImage }),
  };

  const created: string[] = [];
  for (const id of set) {
    const kind = kindOf(id) as Kind;
    const copy = copyOf.get(id) as string;
    doc = withEntity(doc, copy, rewriteEntity(kind, id, getEntity(doc0, id), rw));
    created.push(copy);
  }
  checkAll(ctx, doc, created);
  // The bars outside the set that the images landed on other than themselves.
  const rehomed = [...homes.entries()].flatMap(([bar, h]) =>
    "map" in h && h.map.to !== bar ? [[bar, h.map.to] as const] : [],
  );
  return done(
    withDoc(ctx, doc),
    { created },
    {
      copies: Object.fromEntries(copyOf),
      ...(rehomed.length > 0 ? { onto: Object.fromEntries(rehomed) } : {}),
    },
  );
}

/** What a mirror did beyond its copies: the bars outside the set its images landed on. */
export interface MirrorInfo {
  /** Each entity mirrored, and its copy. */
  copies: Record<string, string>;
  /** A bar outside the set whose image another bar stands at, and that bar; absent when none. */
  onto?: Record<string, string>;
}

interface Env {
  maps: ReadonlyMap<string, BarMap>;
  rollC: ReadonlyMap<string, number>;
  hand: ReadonlyMap<string, O>;
  mapOf: (bar: string, where: string) => BarMap;
  /** The map that produced a bar id as the images name it (a hook sees the rewritten entity). */
  mapOfImage: (id: string, where: string) => BarMap;
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
      const bm = env.mapOfImage(v.on.bar as string, `${id}/on`);
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
      const bm = env.mapOfImage(v.through, `${id}/through`);
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
  const mapOfImage = (l: string) => env.mapOfImage(l, `${id}/bars`);
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
