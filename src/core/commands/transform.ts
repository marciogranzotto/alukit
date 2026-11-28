import { z } from "zod";
import { barFrame } from "../derive/frame.ts";
import { poseAxes } from "../derive/place.ts";
import { evalNumber } from "../expr.ts";
import { compareIds } from "../ids.ts";
import { type Expr, Vec3Expr } from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { atan2Deg, cosDeg, sinDeg } from "../trig.ts";
import { AXIS, dist, dot, norm, scale, sub, type V3 } from "../vec.ts";
import { getEntity, isObject, kindOf, withEntity, withoutEntity } from "./doc.ts";
import { checkAll, guard, runBars } from "./geometry.ts";
import { failed, requireEntity, withDoc } from "./helpers.ts";
import { drivers } from "./hold.ts";
import { addedRoll } from "./maps.ts";
import { axisMeetsLine } from "./move.ts";
import { ang, len, minus, negate, offsetBy, plus } from "./numbers.ts";
import { referrers } from "./refs.ts";
import { refusal } from "./rewrite.ts";
import { type CommandContext, type CommandDef, done, type Outcome, type RawDoc } from "./types.ts";
import { idList } from "./words.ts";

/**
 * `transform` (design §6, *2.3*; docs/ux/drag-ends-decisions.md, "The Move tool"; the editing
 * audit's E-UX-3 to E-UX-5): moves or turns nodes, bars, runs, parts and patterns' templates as
 * one step, keeping what is written in its form (E-UX-4). An inline point moves, an expression
 * keeping its params (`W` moved by 100 is `W + 100`); a node moves as `moveNode` moves it, so what
 * uses it follows; a part on a station rides its bar, or, moved alone along it, changes `at_mm`;
 * a part at a world pose moves its pose; a pattern's template moves and its copies follow. A turn
 * is about a world axis through a point; at a multiple of 90° every number is exact (§4.4's table)
 * and an expression is kept; at another angle one is refused rather than written as a number.
 *
 * What joins the moved set to the rest is kept or freed by `joined`:
 * - **follow** (the default) keeps every joint. A joined end of the rest that bears on a moved bar
 *   slides along its own bar to stay on it (a post under a rail that rises grows with it); one
 *   written on a moved bar (a station, its end, a pivot on it) follows by itself; a node shared
 *   with the rest moves, and its other users follow. A move that would break a joint anyway (an
 *   end that cannot slide to stay on, an end that leaves the bar it butts on) is refused, naming it.
 * - **detach** frees them: the moved set's ends leave the butts, mitres, splices, pivots and face
 *   connections that join it to the rest (a connection goes with its last end or layer), and the
 *   rest's ends written on the moved set are written as coordinates where they are.
 *
 * A bar end named alone (`b5.b`, the editing polish's gap 1) moves by the offset while its bar's
 * other end stays, so the bar stretches, as AutoCAD's STRETCH moves the endpoints inside a
 * crossing window and leaves the rest (docs/ux/polish-editing-decisions.md 1–6). The end belongs
 * to the moved set: a joint between it and what moves is kept, one between it and the rest is
 * followed or freed as above. A stretched bar carries the ends that bear on it only when its line
 * moves (the end goes off its axis); along its axis its line stays, and so do they. Translation
 * only: a turn moves whole entities.
 */

type O = Record<string, unknown>;
type End = "a" | "b";
type Vec = [Expr, Expr, Expr];

const AXES = ["x", "y", "z"] as const;
const ENDS: readonly End[] = ["a", "b"];

const Transform = z
  .strictObject({
    ids: z
      .array(z.string())
      .min(1)
      .describe(
        "the nodes, bars, runs, parts, patterns (their templates) and connections to move; a bar end (b5.b) moves alone, its bar stretching while the other end stays (with by only)",
      ),
    by: Vec3Expr.optional().describe(
      "[dx, dy, dz]: move by this; an expression over params is kept (W moved by D is W + D)",
    ),
    rotate: z
      .strictObject({
        axis: z.enum(AXES).describe("the world axis to turn about"),
        deg: z.number().describe("counter-clockwise looking down the axis toward the origin"),
        about: z
          .tuple([z.number(), z.number(), z.number()])
          .describe("a point the axis passes through"),
      })
      .optional()
      .describe("turn about a world axis through a point; exact at multiples of 90°"),
    joined: z
      .enum(["follow", "detach"])
      .optional()
      .describe(
        "what joins the moved set to the rest: follow (default) keeps each joint, the rest's joined ends sliding along their own bars to stay on what moved, or refuses naming the joint it would break; detach frees them",
      ),
  })
  .refine((a) => (a.by === undefined) !== (a.rotate === undefined), {
    message: "give by or rotate",
  });

type Args = z.infer<typeof Transform>;

/** What a transform did, for its answer and its words. */
export interface TransformInfo {
  /** Every entity written, the moved set first. */
  moved: string[];
  /** What comes along: the rest's bar ends that keep a joint (`b2.a`), slid along their bars or at a point that moved, and the parts on moved bars. */
  followed: string[];
  /** The connections the moved set left (removed, or with fewer ends or layers). */
  freed: string[];
  /** A written expression the move kept, one per param it reads: `b3.a y: W + 100`. */
  kept: string[];
  /** The bar ends that moved alone (`b5.b`), their bars stretching; absent when none did. */
  stretched?: string[];
}

/** The bars of some bar ends, each once, in the ends' order. */
const barsOf = (ends: readonly string[]): string[] => [
  ...new Set(ends.map((x) => x.split(".")[0] as string)),
];

/** Bar ends in id order, end a before end b. */
const compareEnds = (x: string, y: string): number =>
  compareIds(x.split(".")[0] as string, y.split(".")[0] as string) || (x < y ? -1 : x > y ? 1 : 0);

export const transform: CommandDef<Args> = {
  name: "transform",
  group: "Structure",
  summary:
    "move or turn nodes, bars, runs, parts and pattern templates as one step, keeping or freeing what joins them to the rest",
  args: Transform,
  describe(a, d) {
    const info = d.info as TransformInfo | undefined;
    const what = idList(a.ids);
    const head = a.by
      ? `move ${what} by [${a.by.join(", ")}]`
      : `turn ${what} ${a.rotate?.deg}° about ${a.rotate?.axis} through [${a.rotate?.about.join(", ")}]`;
    if (!info) return head;
    const tail = [
      info.stretched?.length ? `stretching ${idList(barsOf(info.stretched))}` : "",
      info.followed.length > 0 ? `${idList(info.followed)} following` : "",
      info.freed.length > 0 ? `freed from ${idList(info.freed)}` : "",
      info.kept.length > 0 ? `keeping ${idList(info.kept, 2)}` : "",
    ].filter((x) => x !== "");
    return tail.length > 0 ? `${head}, ${tail.join(", ")}` : head;
  },
  apply: (ctx, a) => guard(() => apply(ctx, a)),
};

// ---------------------------------------------------------------------------------------------
// The motion: a translation or a turn, on numbers and on written coordinates.

interface Motion {
  /** A point. */
  num(p: V3): V3;
  /** A direction. */
  dir(v: V3): V3;
  /** Written coordinates, keeping expressions, or the refusal for one it cannot keep. */
  point(c: readonly unknown[], where: string): Vec;
  /** A written direction: an axis name, or three values. */
  axis(d: unknown, where: string): unknown;
  /** A world pose's rotation, as `rot_deg`. */
  rot(rot: V3): V3;
  /** The turn's exact matrix by rows, or undefined for a translation. */
  R?: [V3, V3, V3];
  /** The translation, numbers, and as written. */
  d?: V3;
  by?: Vec;
}

const q6 = (x: number) => {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};
const mul = (R: [V3, V3, V3], v: V3): V3 => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];

function motionOf(ctx: CommandContext, a: Args): Motion {
  const scope = { name: (n: string) => ctx.derived().params.get(n) };
  if (a.by) {
    const by = a.by as Vec;
    let d: V3;
    try {
      d = by.map((x) => evalNumber(x, scope)) as unknown as V3;
    } catch (e) {
      throw refusal("expr", `by: ${(e as Error).message}`, { field: "by" });
    }
    return {
      num: (p) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]],
      dir: (v) => v,
      point: (c) => c.map((x, i) => offsetBy(x as Expr, 1, by[i] as Expr)) as Vec,
      axis: (x) => x,
      rot: (r) => r,
      d,
      by,
    };
  }
  const r = a.rotate as NonNullable<Args["rotate"]>;
  const k = AXES.indexOf(r.axis);
  const c = cosDeg(r.deg);
  const s = sinDeg(r.deg);
  // The plane's two axes, in the right-handed order about axis k: (y, z) about x, and so on.
  const i = (k + 1) % 3;
  const j = (k + 2) % 3;
  const rows = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const set = (r: number, col: number, v: number) => {
    (rows[r] as number[])[col] = v;
  };
  set(k, k, 1);
  set(i, i, c);
  set(i, j, -s);
  set(j, i, s);
  set(j, j, c);
  const R = rows as unknown as [V3, V3, V3];
  const C = r.about as V3;
  const quarter = Math.abs(c * s) < 1e-12 && Math.abs(Math.abs(c) + Math.abs(s) - 1) < 1e-12;
  const num = (p: V3): V3 => {
    const v = mul(R, sub(p, C));
    return [v[0] + C[0], v[1] + C[1], v[2] + C[2]];
  };
  const value = (x: unknown) => evalNumber(x as Expr, scope);
  return {
    num,
    dir: (v) => mul(R, v),
    point(cs, where) {
      if (quarter) {
        // Each new coordinate is ±one old one plus a constant: exact, and an expression kept.
        return [0, 1, 2].map((o) => {
          const row = R[o] as V3;
          const from = row.findIndex((x) => x !== 0);
          const sign = row[from] as number;
          const k0 = (C[o] as number) - sign * (C[from] as number);
          const src = cs[from] as Expr;
          return sign > 0 ? plus(src, len(k0)) : minus(len(k0), src);
        }) as Vec;
      }
      const moving = [i, j];
      for (const o of moving) {
        const p = drivers(cs[o]);
        if (p) {
          throw refusal(
            "expr",
            `${where} ${"xyz"[o]} is ${cs[o] as string}, which a turn of ${r.deg}° cannot keep: turn by a multiple of 90°, or write a number`,
            { field: "rotate" },
          );
        }
      }
      const p = num(cs.map(value) as unknown as V3);
      return [0, 1, 2].map((o) => (o === k ? cs[o] : len(p[o] as number))) as Vec;
    },
    axis(d, where) {
      if (typeof d === "string") {
        const v = mul(R, AXIS[d as keyof typeof AXIS]);
        const name = Object.entries(AXIS).find(([, w]) => dist(w, v) < 1e-12)?.[0];
        return name ?? v.map(q6);
      }
      const cs = d as readonly unknown[];
      if (quarter) {
        return [0, 1, 2].map((o) => {
          const row = R[o] as V3;
          const from = row.findIndex((x) => x !== 0);
          const src = cs[from] as Expr;
          return (row[from] as number) > 0 ? src : negate(src);
        });
      }
      if (cs.some((x) => drivers(x))) {
        throw refusal("expr", `${where} reads a param a turn of ${r.deg}° cannot keep`, {
          field: "rotate",
        });
      }
      return mul(R, cs.map(value) as unknown as V3).map(q6);
    },
    rot(rot) {
      // The pose's axes turned, read back as rotations about world X, then Y, then Z.
      const [ex, ey, ez] = poseAxes(rot).map((v) => mul(R, v)) as [V3, V3, V3];
      // M's columns are the turned axes: M = Rz(γ)·Ry(β)·Rx(α).
      const m20 = ex[2];
      const beta = atan2Deg(-m20, Math.hypot(ex[0], ex[1]));
      let alpha: number;
      let gamma: number;
      if (Math.hypot(ex[0], ex[1]) < 1e-12) {
        alpha = 0;
        gamma = atan2Deg(-ey[0], ey[1]);
      } else {
        alpha = atan2Deg(ey[2], ez[2]);
        gamma = atan2Deg(ex[1], ex[0]);
      }
      return [ang(alpha), ang(beta), ang(gamma)];
    },
    R,
  };
}

// ---------------------------------------------------------------------------------------------

const isEndRef = (x: unknown): x is string => typeof x === "string" && /^b\d+\.[ab]$/.test(x);
const barOf = (ref: string) => ref.split(".")[0] as string;
const isNode = (x: unknown): x is string => typeof x === "string" && /^n\d+$/.test(x);
const isVec = (x: unknown): x is unknown[] => Array.isArray(x) && x.length === 3;

function apply(ctx: CommandContext, a: Args): Outcome {
  const doc0 = ctx.state.doc;
  const D = ctx.derived();
  const mode = a.joined ?? "follow";
  const motion = motionOf(ctx, a);
  const bars0 = (isObject(doc0.bars) ? doc0.bars : {}) as Record<string, O>;
  const nodes0 = (isObject(doc0.nodes) ? doc0.nodes : {}) as Record<string, unknown>;
  const conns0 = (isObject(doc0.connections) ? doc0.connections : {}) as Record<string, O>;
  const runs0 = isObject(doc0.runs) ? doc0.runs : {};

  /** A derived bar's design point at an end. */
  const placed = (id: string, e: End): V3 => {
    const b = D.bars.get(id);
    const p = e === "a" ? b?.placed.A : b?.placed.B;
    if (!p) throw refusal("derive", `${id} does not derive`, { entity: id });
    return p;
  };
  /** A derived bar's unit axis, from end a to end b. */
  const axisOf = (id: string): V3 => {
    const A = placed(id, "a");
    const B = placed(id, "b");
    return scale(sub(B, A), 1 / dist(B, A));
  };

  // The moved set: what was named, with runs as their bars and patterns as their templates, and
  // the bar ends named alone.
  const M = {
    bars: new Set<string>(),
    nodes: new Set<string>(),
    parts: new Set<string>(),
    ends: new Set<string>(),
  };
  const named = { conns: new Set<string>() };
  const take = (id: string) => {
    const kind = kindOf(id);
    if (kind === "bars") M.bars.add(id);
    else if (kind === "nodes") M.nodes.add(id);
    else if (kind === "parts") M.parts.add(id);
    else if (kind === "connections") named.conns.add(id);
    else if (kind === "runs") for (const b of runBars(runs0[id])) M.bars.add(b);
    else {
      throw refusal(
        "args",
        `${id} does not move: transform takes nodes, bars, runs, parts, patterns and connections`,
        { entity: id },
      );
    }
  };
  for (const id of a.ids) {
    if (isEndRef(id)) {
      const missing = requireEntity(doc0, barOf(id), "bars");
      if (missing.length > 0) return failed(missing);
      M.ends.add(id);
      continue;
    }
    const missing = requireEntity(doc0, id);
    if (missing.length > 0) return failed(missing);
    if (kindOf(id) === "patterns") {
      const p = getEntity(doc0, id) as O;
      for (const t of (p.template as string[]) ?? []) take(t);
    } else take(id);
  }
  // An end named with its bar is the bar's; both ends of a bar are the bar.
  for (const ref of [...M.ends]) {
    const b = barOf(ref);
    if (M.bars.has(b)) M.ends.delete(ref);
    else if (M.ends.has(`${b}.${ref.endsWith(".a") ? "b" : "a"}`)) {
      M.bars.add(b);
      M.ends.delete(`${b}.a`);
      M.ends.delete(`${b}.b`);
    }
  }
  if (motion.R && M.ends.size > 0) {
    const ref = [...M.ends].sort(compareEnds)[0] as string;
    throw refusal(
      "args",
      `${ref} is an end: a turn moves whole entities; turn ${barOf(ref)}, or move the end by an offset`,
      { entity: barOf(ref), field: "ids" },
    );
  }
  // A run moves whole or is a joint: a station on it rides it only when every bar of it moves.
  const movedBar = (b: string): boolean =>
    M.bars.has(b) || (kindOf(b) === "runs" && runBars(runs0[b]).every((x) => M.bars.has(x)));
  /** Whether a bar end moves: its bar does, or it was named alone. */
  const endMoves = (ref: string): boolean => M.bars.has(barOf(ref)) || M.ends.has(ref);
  /** The bars whose line moves although they do not: an end moved alone, off the bar's axis. */
  const turned = new Set<string>();
  for (const ref of M.ends) {
    const b = barOf(ref);
    const u = axisOf(b);
    const d = motion.d as V3;
    if (norm(sub(d, scale(u, dot(d, u)))) > TOL.len) turned.add(b);
  }
  /** Whether a bar's design line moves: the bar does, or an end of it goes off its axis. */
  const lineMoves = (b: string): boolean => M.bars.has(b) || turned.has(b);
  /** A bar's design line after the move, from its derived design points. */
  const movedLine = (b: string): [V3, V3] => {
    const A = placed(b, "a");
    const B = placed(b, "b");
    if (M.bars.has(b)) return [motion.num(A), motion.num(B)];
    return [M.ends.has(`${b}.a`) ? motion.num(A) : A, M.ends.has(`${b}.b`) ? motion.num(B) : B];
  };

  let doc = doc0;
  const changed = new Set<string>();
  const removed = new Set<string>();
  const followed = new Set<string>();
  const freed = new Set<string>();
  const kept: string[] = [];
  const keptParams = new Set<string>();
  const write = (id: string, v: unknown) => {
    doc = withEntity(doc, id, v);
    changed.add(id);
  };
  const bar = (id: string) => getEntity(doc, id) as O;

  /** Records a kept expression in the words, once per param. */
  const keep = (where: string, before: unknown, after: unknown) => {
    if (typeof after !== "string" || after === before) return;
    const p = drivers(after)?.params ?? [];
    if (p.some((x) => !keptParams.has(x))) kept.push(`${where} ${after}`);
    for (const x of p) keptParams.add(x);
  };
  const moveVec = (c: readonly unknown[], where: string): Vec => {
    const out = motion.point(c, where);
    out.forEach((x, i) => {
      keep(`${where} ${"xyz"[i]}:`, c[i], x);
    });
    return out;
  };

  const here = (p: V3): Vec => p.map((x) => len(x)) as Vec;

  /** A station on a bar that stays, moved along that bar, or the refusal for a move off it. */
  const slide = (st: O, where: string): O | undefined => {
    const on = st.bar as string;
    const b = D.bars.get(on);
    if (!motion.d || !b?.placed.B || kindOf(on) !== "bars") return undefined;
    const u = scale(sub(b.placed.B, b.placed.A), 1 / dist(b.placed.B, b.placed.A));
    const s = dot(motion.d, u);
    if (norm(sub(motion.d, scale(u, s))) > TOL.len) return undefined;
    const back = st.from === "b" || st.from === "b.cut" ? -1 : 1;
    // Along a world axis, a typed offset is kept as written (`D` moves `at_mm` by `D`).
    const k = u.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-12);
    const step: Expr =
      k >= 0 && motion.by && (motion.d as V3).every((x, i) => i === k || x === 0)
        ? (motion.by[k] as Expr)
        : len(s);
    const sign = (back * (k >= 0 ? Math.sign(u[k] as number) : 1)) as 1 | -1;
    const at = k >= 0 ? offsetBy(st.at_mm as Expr, sign, step) : plus(st.at_mm as Expr, back * s);
    keep(`${where} at_mm:`, st.at_mm, at);
    return { ...st, at_mm: at };
  };

  /**
   * A free length (`{ len_mm, dir }`, §4.3) after the move of the end it reaches (sign 1) or the
   * end a it is counted from (−1): it takes up a move along its direction, a typed offset along a
   * world axis kept as written; any other move is refused, since the end would leave its line.
   */
  const lengthBy = (w: O, u: V3, sign: 1 | -1, subject: string, m: string): Expr => {
    const dir = typeof w.dir === "string" ? w.dir : `[${(w.dir as unknown[]).join(", ")}]`;
    if (sign < 0 && w.from === "a.cut") {
      throw refusal(
        "args",
        `${subject} counted from end a's cut, which moving end a alone would move: move ${m} whole`,
        { entity: m },
      );
    }
    const d = motion.d as V3;
    const s = dot(d, u);
    if (norm(sub(d, scale(u, s))) > TOL.len) {
      throw refusal(
        "geometry",
        `${subject} a free length along ${dir} from end a, which the move does not run along: move ${m} whole, or along ${dir}`,
        { entity: m },
      );
    }
    const k = u.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-12);
    const out =
      k >= 0 && motion.by && d.every((x, i) => i === k || x === 0)
        ? offsetBy(
            w.len_mm as Expr,
            (sign * Math.sign(u[k] as number)) as 1 | -1,
            motion.by[k] as Expr,
          )
        : plus(w.len_mm as Expr, sign * s);
    keep(`${m}.b len_mm:`, w.len_mm, out);
    return out;
  };

  /** A moved bar's end, written where the motion takes it. */
  const movedEnd = (m: string, e: End, w: unknown, where: string): unknown => {
    if (isVec(w)) return moveVec(w, where);
    if (isNode(w)) {
      if (M.nodes.has(w)) return w;
      const users = referrers(doc0, w).filter((r) => r.from !== w);
      const moves = (r: { from: string; field: string }) =>
        kindOf(r.from) === "bars" && (M.bars.has(r.from) || M.ends.has(`${r.from}.${r.field}`));
      const shared = users.some((r) => !moves(r));
      if (!shared || mode === "follow") {
        M.nodes.add(w);
        return w;
      }
      const n = nodes0[w];
      const at = isVec(n) ? n : isObject(n) && isVec(n.at) ? n.at : undefined;
      return at ? moveVec(at, where) : here(motion.num(D.nodes.get(w) ?? placed(m, e)));
    }
    if (isEndRef(w)) {
      const [x, xe] = w.split(".") as [string, End];
      if (M.bars.has(x) || M.ends.has(w)) return w;
      if (mode === "detach") return here(motion.num(placed(m, e)));
      // A point shared with the rest: the other bar's end comes along.
      followed.add(w);
      const xs = bar(x);
      write(x, { ...xs, [xe]: movedEnd(x, xe, xs[xe], w) });
      return w;
    }
    if (isObject(w) && isObject(w.on)) {
      if (movedBar(w.on.bar as string)) return w;
      const st = slide(w.on, where);
      if (st) return { on: st };
      if (mode === "detach") return here(motion.num(placed(m, e)));
      throw refusal(
        "geometry",
        `${where} is on ${w.on.bar as string}, which does not run along the move: move along it, or give joined: "detach" to free it`,
        { entity: m, field: e },
      );
    }
    if (isObject(w) && typeof w.pivot === "string") {
      const c = conns0[w.pivot];
      const base = isObject(c) && isObject(c.base) ? (c.base.bar as string) : "";
      if (movedBar(base)) return w;
      if (mode === "detach") {
        leave(w.pivot, [`${m}.${e}`]);
        return here(motion.num(placed(m, e)));
      }
      throw refusal(
        "geometry",
        `${where} is at pivot ${w.pivot}, whose base ${base} stays: give joined: "detach" to free it`,
        { entity: m, field: e },
      );
    }
    if (isObject(w) && w.len_mm !== undefined) {
      return motion.R ? { ...w, dir: motion.axis(w.dir, `${where} dir`) } : w;
    }
    return w;
  };

  /** Drops ends (or layers) from a connection; it goes with its last, or its second-last layer. */
  const leave = (c: string, members: readonly string[]) => {
    const conn = getEntity(doc, c) as O | undefined;
    if (!conn || removed.has(c)) return;
    freed.add(c);
    const key = conn.type === "face" ? "bars" : "ends";
    const list = (conn[key] as string[]).filter((x) => !members.includes(x));
    const min = conn.type === "face" || conn.type === "miter" || conn.type === "splice" ? 2 : 1;
    if (list.length >= min) {
      write(c, { ...conn, [key]: list });
      return;
    }
    const refs = referrers(doc, c).map((r) => r.from);
    const outside = refs.filter((r) => r !== c && !removed.has(r));
    if (outside.length > 0) {
      throw refusal(
        "refs",
        `freeing ${idList(members)} removes ${c}, and ${idList(outside)} refer to it: edit them first`,
        { entity: c, refs: outside },
      );
    }
    doc = withoutEntity(doc, c);
    changed.delete(c);
    removed.add(c);
  };

  // 1. The moved bars: their ends, and under a turn their frame fields.
  for (const m of [...M.bars].sort(compareIds)) {
    const spec = bar(m);
    const next: O = { ...spec };
    for (const e of ENDS) next[e] = movedEnd(m, e, spec[e], `${m}.${e}`);
    if (motion.R) turnFrame(ctx, m, spec, next, motion);
    write(m, next);
  }

  // 1b. The ends named alone: each moves, its bar's other end staying, so the bar stretches.
  for (const ref of [...M.ends].sort(compareEnds)) {
    const [m, e] = ref.split(".") as [string, End];
    const spec = bar(m);
    const w = spec[e];
    const u = axisOf(m);
    const next: O = { ...spec };
    if (isObject(w) && w.len_mm !== undefined) {
      // A free length from end a (§4.3): it takes up a move along its direction.
      next[e] = { ...w, len_mm: lengthBy(w, u, 1, `${ref} is`, m) };
    } else {
      next[e] = movedEnd(m, e, w, ref);
      const b = spec.b;
      if (e === "a" && isObject(b) && b.len_mm !== undefined) {
        // End b counted from end a would go with it: its length takes up the move instead.
        next.b = { ...b, len_mm: lengthBy(b, u, -1, `${m}'s end b is`, m) };
      }
    }
    write(m, next);
  }

  // 2. Nodes in the moved set: as moveNode moves them, so what uses them follows.
  for (const n of [...M.nodes].sort(compareIds)) {
    const v = nodes0[n];
    if (isVec(v)) write(n, moveVec(v, n));
    else if (isObject(v) && isVec(v.at)) write(n, { ...v, at: moveVec(v.at, n) });
    else if (isObject(v) && isObject(v.on)) {
      if (movedBar(v.on.bar as string)) continue;
      const st = slide(v.on, n);
      if (st) write(n, { ...v, on: st });
      else if (mode === "detach") {
        const { on: _on, ...rest } = v;
        write(n, { ...rest, at: here(motion.num(D.nodes.get(n) as V3)) });
      } else {
        throw refusal(
          "geometry",
          `${n} is on ${v.on.bar as string}, which does not run along the move: move along it, or give joined: "detach" to free it`,
          { entity: n },
        );
      }
    } else if (isObject(v) && typeof v.pivot === "string") {
      throw refusal("geometry", `${n} is at pivot ${v.pivot}: move the pivot's base bar instead`, {
        entity: n,
      });
    }
  }

  // 3. Parts: on a station they ride their bar, or move along it; at a pose, the pose moves.
  for (const p of [...M.parts].sort(compareIds)) {
    const v = getEntity(doc0, p) as O;
    if (isObject(v.on)) {
      if (movedBar(v.on.bar as string)) continue;
      const st = motion.R ? undefined : slide(v.on, p);
      if (!st) {
        throw refusal(
          "geometry",
          `${p} is on ${v.on.bar as string}: it moves along ${v.on.bar as string} only`,
          { entity: p },
        );
      }
      write(p, { ...v, on: st });
    } else if (isObject(v.at)) {
      const pose = v.at as O;
      const pos = moveVec(pose.pos as unknown[], `${p} pos`);
      let rot = pose.rot_deg as unknown[] | undefined;
      if (motion.R) {
        const scope = { name: (n: string) => D.params.get(n) };
        if (rot?.some((x) => drivers(x))) {
          throw refusal("expr", `${p}'s rot_deg reads a param, which a turn cannot keep`, {
            entity: p,
          });
        }
        const r0 = (rot ?? [0, 0, 0]).map((x) => evalNumber(x as Expr, scope)) as unknown as V3;
        rot = [...motion.rot(r0)];
      }
      const at: O = { pos, ...(rot && rot.some((x) => x !== 0) ? { rot_deg: rot } : {}) };
      write(p, { ...v, at });
    } else {
      throw refusal("args", `${p} is not placed: there is nothing to move`, { entity: p });
    }
  }

  // 4. Connections: what joins the moved set to the rest.
  for (const c of Object.keys(conns0).sort(compareIds)) {
    const conn = conns0[c] as O;
    if (removed.has(c)) continue;
    if (conn.type === "butt") {
      const through = conn.through;
      const ends = (conn.ends as string[]) ?? [];
      const body = isObject(through);
      const tBar = body ? undefined : barOf(through as string);
      const allEnds = ends.every(endMoves);
      // A through bar moves when its line does; through a bar's end, when that end moves too.
      const movedThrough = tBar
        ? lineMoves(tBar) || (isEndRef(through) && endMoves(through))
        : named.conns.has(c) || allEnds;
      const rest = ends.filter((x) => !endMoves(x));
      const mine = ends.filter(endMoves);
      if (body && movedThrough && isObject(through)) {
        const at = through.at;
        const nat = isVec(at)
          ? moveVec(at, `${c} at`)
          : isObject(at) && isVec(at.pos)
            ? { ...at, pos: moveVec(at.pos as unknown[], `${c} at`) }
            : at;
        write(c, { ...(getEntity(doc, c) as O), through: { ...through, at: nat } });
      }
      if (movedThrough && rest.length > 0) {
        if (mode === "detach") leave(c, rest);
        else if (tBar) for (const r of rest) follow(r, tBar, c);
      } else if (!movedThrough && mine.length > 0 && mode === "detach") leave(c, mine);
    } else if (conn.type === "miter" || conn.type === "splice") {
      const ends = conn.ends as string[];
      const n = ends.filter(endMoves).length;
      if (n > 0 && n < ends.length && mode === "detach") leave(c, ends);
    } else if (conn.type === "pivot") {
      const base = isObject(conn.base) ? (conn.base.bar as string) : "";
      const ends = (conn.ends as string[]) ?? [];
      if (movedBar(base)) {
        const rest = ends.filter((x) => !endMoves(x));
        if (rest.length > 0 && mode === "detach") leave(c, rest);
      }
    } else if (conn.type === "face") {
      const layers = conn.bars as string[];
      const moved = layers.filter((x) => movedBar(x) || M.parts.has(x));
      if (moved.length > 0 && moved.length < layers.length && mode === "detach") leave(c, moved);
    }
  }

  /** A rest end that bears on bar `t` (butt `c`), whose line moves: along its own bar, to stay on `t`. */
  function follow(ref: string, t: string, c: string) {
    const [r, e] = ref.split(".") as [string, End];
    const spec = bar(r);
    const w = spec[e];
    // Written on the moved bar, or at a point that moves with it: it follows by itself.
    if (isObject(w) && isObject(w.on) && movedBar(w.on.bar as string)) return;
    if (isEndRef(w) && endMoves(w)) return;
    if (isNode(w) && M.nodes.has(w)) return;
    const P = placed(r, e);
    const Q = placed(r, e === "a" ? "b" : "a");
    const L = dist(P, Q);
    const u = scale(sub(P, Q), 1 / L);
    const [tA, tB] = movedLine(t);
    const m = axisMeetsLine(Q, u, tA, tB);
    if ("why" in m) {
      throw refusal(
        "geometry",
        `${ref} butts on ${t} (${c}) and cannot follow it along ${r}: ${m.why.replaceAll("{bar}", t)}; give joined: "detach" to free it`,
        { entity: r, field: e, refs: [c] },
      );
    }
    const delta = m.s - L;
    if (Math.abs(delta) < TOL.len / 10) return;
    let value: unknown;
    if (isVec(w)) {
      const axial = u.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-12);
      // Along a world axis, by the typed offset itself when the move is along that axis too.
      const exact =
        axial >= 0 &&
        motion.by &&
        motion.d &&
        motion.d.every((x, i) => i === axial || x === 0) &&
        Math.abs(delta * (u[axial] as number) - (motion.d[axial] as number)) < 1e-9;
      value = w.map((x, i) => {
        const ui = u[i] as number;
        if (Math.abs(ui) < 1e-12) return x;
        const out =
          exact && i === axial
            ? offsetBy(x as Expr, 1, motion.by?.[i] as Expr)
            : plus(x as Expr, delta * ui);
        keep(`${ref} ${"xyz"[i]}:`, x, out);
        return out;
      });
    } else if (e === "b" && isObject(w) && w.len_mm !== undefined) {
      value = { ...w, len_mm: plus(w.len_mm as Expr, delta) };
    } else {
      throw refusal(
        "geometry",
        `${ref} butts on ${t} (${c}) but is written at ${typeof w === "string" ? w : "a reference"}, which does not slide: give joined: "detach" to free it, or move that too`,
        { entity: r, field: e, refs: [c] },
      );
    }
    followed.add(ref);
    write(r, { ...spec, [e]: value });
  }

  // 5. The rest's ends written on the moved set: under follow they come along by themselves, and
  // are named; under detach they stay where they are. An end at a moved node always comes along.
  for (const r of Object.keys(bars0).sort(compareIds)) {
    if (M.bars.has(r) || removed.has(r)) continue;
    const spec = bar(r);
    let next: O | undefined;
    for (const e of ENDS) {
      // An end named alone moved in 1b.
      if (M.ends.has(`${r}.${e}`)) continue;
      const w = spec[e];
      if (isNode(w) && M.nodes.has(w)) {
        followed.add(`${r}.${e}`);
        continue;
      }
      const onMoved =
        (isEndRef(w) && endMoves(w)) ||
        (isObject(w) && isObject(w.on) && movedBar(w.on.bar as string)) ||
        (isObject(w) && typeof w.pivot === "string" && pivotMoves(w.pivot));
      if (!onMoved) continue;
      if (mode === "follow") {
        followed.add(`${r}.${e}`);
        continue;
      }
      if (isObject(w) && typeof w.pivot === "string") leave(w.pivot, [`${r}.${e}`]);
      next = { ...(next ?? spec), [e]: here(placed(r, e)) };
    }
    if (next) write(r, next);
  }
  // Parts on a moved bar ride it, in either mode: named, so the words say what comes along.
  const parts0 = (isObject(doc0.parts) ? doc0.parts : {}) as Record<string, O>;
  for (const p of Object.keys(parts0).sort(compareIds)) {
    const on = parts0[p]?.on;
    if (!M.parts.has(p) && isObject(on) && movedBar(on.bar as string)) followed.add(p);
  }
  function pivotMoves(c: string): boolean {
    const conn = conns0[c];
    return isObject(conn) && isObject(conn.base) && movedBar(conn.base.bar as string);
  }

  const ids = [...changed].sort(compareIds);
  checkAll(ctx, doc, ids);
  const next = withDoc(ctx, doc as RawDoc);

  // Follow keeps every joint: a move that breaks one anyway is refused, naming it. The state it
  // would leave is derived through the batch's shared derives, so the joins after it reuse it.
  if (mode === "follow") {
    const key = (d: { code: string; entity?: string; message: string }) =>
      `${d.code}|${d.entity ?? ""}|${d.message}`;
    const before = new Set(D.diagnostics.filter((d) => d.severity === "error").map(key));
    const after = ctx.deriveOf(next);
    const broke = after.diagnostics.filter((d) => d.severity === "error" && !before.has(key(d)));
    if (broke.length > 0) {
      throw refusal(
        "geometry",
        `this move would break a joint: ${broke
          .slice(0, 3)
          .map((d) => d.message)
          .join(
            "; ",
          )}${broke.length > 3 ? ` (and ${broke.length - 3} more)` : ""}; give joined: "detach" to free what joins it`,
        { refs: [...new Set(broke.map((d) => d.entity).filter((x): x is string => !!x))] },
      );
    }
  }

  const first = [...M.bars, ...barsOf([...M.ends]), ...M.nodes, ...M.parts].filter((x) =>
    changed.has(x),
  );
  const info: TransformInfo = {
    moved: [...first.sort(compareIds), ...ids.filter((x) => !first.includes(x))],
    followed: [...followed].sort(compareIds),
    freed: [...freed].sort(compareIds),
    kept,
    ...(M.ends.size > 0 ? { stretched: [...M.ends].sort(compareEnds) } : {}),
  };
  return done(next, { changed: ids, removed: [...removed] }, info);
}

/**
 * A turned bar's `up`, `roll_deg` and end planes, so its body is the old one turned (§4.4): an
 * `up` turns with it and the roll stays; otherwise the roll is what puts the turned x axis where
 * the default frame of the turned axis would not, added to the roll as written.
 */
function turnFrame(ctx: CommandContext, id: string, spec: O, next: O, motion: Motion): void {
  const db = ctx.derived().bars.get(id);
  if (!db) throw refusal("derive", `${id} does not derive`, { entity: id });
  if (spec.up !== undefined) next.up = motion.axis(spec.up, `${id} up`);
  else {
    const t = motion.dir(db.placed.frame.t);
    const x = motion.dir(db.placed.frame.x);
    const base = barFrame(t, undefined, 0);
    if ("problem" in base) throw refusal("geometry", `${id}: ${base.problem}`, { entity: id });
    const want = atan2Deg(dot(x, base.frame.y), dot(x, base.frame.x));
    const scope = { name: (n: string) => ctx.derived().params.get(n) };
    const r0 = spec.roll_deg === undefined ? 0 : evalNumber(spec.roll_deg as Expr, scope);
    const roll = addedRoll(
      spec.roll_deg as Expr | undefined,
      ang((((want - r0) % 360) + 360) % 360),
    );
    if (roll === undefined) delete next.roll_deg;
    else next.roll_deg = roll;
  }
  if (isObject(spec.ends)) {
    const ends: O = { ...spec.ends };
    for (const e of ENDS) {
      const es = spec.ends[e];
      if (!isObject(es) || !isObject(es.plane) || es.plane.normal === undefined) continue;
      const pl = es.plane;
      ends[e] = {
        ...es,
        plane: {
          ...pl,
          ...(isVec(pl.point) ? { point: motion.point(pl.point, `${id}.${e} plane`) } : {}),
          ...(isVec(pl.normal) ? { normal: motion.axis(pl.normal, `${id}.${e} normal`) } : {}),
        },
      };
    }
    next.ends = ends;
  }
}
