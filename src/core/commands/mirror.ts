import { z } from "zod";
import type { HoleOp } from "../derive/derive.ts";
import { holeCentre } from "../derive/fastenings.ts";
import { faceNormal } from "../derive/on-piece.ts";
import { claimedEnds, ownJoints } from "../derive/own-joints.ts";
import { poseAxes } from "../derive/place.ts";
import { compareIds } from "../ids.ts";
import type { Expr, Face } from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { atan2Deg } from "../trig.ts";
import { cross, dist, dot, norm, sub, type V3 } from "../vec.ts";
import { asCopy, taggedWords, tagsOf } from "./copies.ts";
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
import { joinedTo } from "./patterns.ts";
import { Refusal, type Rewriter, refusal, rewriteEntity } from "./rewrite.ts";
import { flipsU, hasSymmetry, type Map2, mapFace, type Sym, symmetries } from "./sections.ts";
import {
  type CommandContext,
  type CommandDef,
  type CommandError,
  done,
  type Outcome,
} from "./types.ts";
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
 * The set's bars' own joints (`ownJoints`: those that claim only their ends) are mirrored with
 * them, landed the same way (design §6, *2.3*, review fixes, joins); one whose member has no image
 * is left out, and the image's ends it claimed are reported open.
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
    const info = d.info as MirrorInfo | undefined;
    const onto = Object.values(info?.onto ?? {});
    const open = info?.open ?? [];
    const there = Object.entries(info?.there ?? {});
    const selves = there.filter(([id, to]) => id === to).map(([id]) => id);
    const others = there
      .filter(([id, to]) => id !== to)
      .map(([id, to]) => `${id}'s image is ${to}`);
    const kept = [
      ...(selves.length > 0
        ? [`${idList(selves)} ${selves.length > 1 ? "are their own images" : "is its own image"}`]
        : []),
      ...others,
    ];
    const tags = taggedWords(info?.tagged);
    // The ends left open are the step's to say (`joinPhrases`): a join later in the step may
    // close them (the re-check's follow-up to N2).
    return {
      say: `mirror ${idList(a.ids)}, making ${idList(d.created)}${onto.length > 0 ? ` on ${idList([...new Set(onto)])}` : ""}${tags ? `, ${tags}` : ""}${kept.length > 0 ? `; ${kept.join("; ")}` : ""}`,
      ...(open.length > 0 ? { open } : {}),
    };
  },
  apply: (ctx, a) => guard(() => advised(ctx, a)),
};

/**
 * A refusal that advises including entities in the set (design §6, *2.3*, re-check N1). Its
 * advice is tried before it is given (`advised`), so it is never a step that is refused in turn.
 */
class Include extends Refusal {
  readonly why: string;
  readonly include: readonly string[];
  readonly extra: Partial<CommandError>;
  constructor(why: string, include: readonly string[], extra: Partial<CommandError> = {}) {
    const all = idList(include, include.length);
    super([{ code: "geometry", message: `${why}; include ${all}`, ...extra }]);
    this.why = why;
    this.include = include;
    this.extra = extra;
  }
}

/**
 * The mirror, or a refusal whose advice has been tried (re-check N1; recheck-fixes-core-decisions
 * 4–6): an advice to include entities is given only when the mirror with them goes through. Each
 * further inclusion that one asks for is tried too, and the advice names them all; when an
 * inclusion is refused for another reason, the refusal says that reason instead of advising it.
 */
function advised(ctx: CommandContext, a: z.infer<typeof Mirror>): Outcome {
  try {
    return mirrorSet(ctx, a);
  } catch (e) {
    if (!(e instanceof Include)) throw e;
    const ids = [...a.ids];
    const added: string[] = [];
    let asked: Include = e;
    for (;;) {
      const more = asked.include.filter((x) => !ids.includes(x));
      if (more.length === 0) throw refusal("geometry", e.why, e.extra);
      ids.push(...more);
      added.push(...more);
      try {
        mirrorSet(ctx, { ...a, ids });
      } catch (f) {
        if (f instanceof Include) {
          asked = f;
          continue;
        }
        if (f instanceof Refusal) {
          const why = f.errors.map((x) => x.message).join("; ");
          throw refusal(
            "geometry",
            `${e.why}; mirroring ${idList(added)} with it is refused too: ${why}`,
            e.extra,
          );
        }
        throw f;
      }
      throw added.length === e.include.length ? e : new Include(e.why, added, e.extra);
    }
  }
}

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
  const plane = `${AXES[k]} = ${at}`;

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
  /**
   * The bars already standing at a bar's image (the editing polish, gap 2; re-check N5): itself
   * when the plane maps it onto itself (it lies in the plane, or crosses it symmetrically), else
   * each existing bar that stands exactly where its image would.
   */
  const standing = (bar: string): BarMap[] => {
    const own = onto(bar, bar);
    if (own) return [own];
    return docBars.flatMap((x) => {
      const bm = x === bar ? undefined : onto(bar, x);
      return bm ? [bm] : [];
    });
  };

  // A bar of the set whose image already stands in the model is not copied, since its copy would
  // stand on that bar, the BOM counting it twice (re-check N5; recheck-fixes-core-decisions 9–11).
  // It is referred to as that bar, as a bar outside the set is; a mirror adds no holes to a bar,
  // so the holes written on it must have their images there already.
  const there = new Map<string, string>();
  const imageWords = (id: string, to: string) =>
    to === id ? `${id} is its own image across ${plane}` : `${id}'s image across ${plane} is ${to}`;
  for (const id of set.filter((x) => x.startsWith("b"))) {
    const found = standing(id);
    if (found.length === 0) continue;
    if (found.length > 1) {
      const ids = found.map((x) => x.to);
      throw refusal(
        "geometry",
        `${id}'s image across ${plane} is where ${idList(ids, ids.length)} ${ids.length === 2 ? "both" : "all"} stand, one on another: remove all but one`,
        { entity: id, refs: [id, ...ids] },
      );
    }
    const to = (found[0] as BarMap).to;
    if (!holesThere(ctx, id, to, R, Rdir)) {
      throw refusal(
        "geometry",
        `${imageWords(id, to)}, but its holes' images are not on ${to === id ? "it" : to}, and a mirror adds none to a bar: leave ${id} out, or add them to ${to === id ? "it" : to}`,
        { entity: id, refs: to === id ? [id] : [id, to] },
      );
    }
    there.set(id, to);
  }
  const copied = set.filter((x) => !there.has(x));
  if (copied.length === 0) {
    const phrases = [...there].map(([id, to]) =>
      to === id ? imageWords(id, to) : `${imageWords(id, to)}, already there`,
    );
    throw refusal(
      "geometry",
      `${phrases.join("; ")}: the mirror would make nothing, and ${there.size > 1 ? "copies would stand on them" : "a copy would stand on it"}`,
      { refs: [...new Set([...there].flat())] },
    );
  }

  // Copy ids, in id order per kind.
  let doc = doc0;
  const copyOf = new Map<string, string>();
  for (const id of copied) {
    const n = nextId(doc, KIND_PREFIX[kindOf(id) as MapKind]);
    doc = n.doc;
    copyOf.set(id, n.id);
  }

  // How each mirrored bar's section turns over, and the roll that places the image.
  const maps = new Map<string, BarMap>();
  const rollC = new Map<string, number>();
  const hand = new Map<string, O>();
  for (const id of copied.filter((x) => x.startsWith("b"))) {
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
  for (const id of copied.filter((x) => x.startsWith("r"))) {
    const bars = runBars(getEntity(doc0, id));
    const kept = bars.filter((b) => there.has(b));
    if (kept.length > 0) {
      throw refusal(
        "geometry",
        `${id}: ${kept.map((b) => imageWords(b, there.get(b) as string)).join("; ")}, so the run has no copy to make; leave ${id} out`,
        { entity: id, refs: kept },
      );
    }
    const first = maps.get(bars[0] as string);
    if (!first || !bars.every((b) => maps.has(b))) {
      const missing = bars.filter((b) => !maps.has(b));
      throw new Include(`${id}: a run is mirrored with all its bars`, missing, {
        code: "args",
        entity: id,
        refs: missing,
      });
    }
    maps.set(id, { ...first, to: copyOf.get(id) as string });
  }

  // A bar outside the set, or one of the set already standing at its image, is referred to as
  // the bar at its image (the editing polish, gap 2), so a bracket on one leg mirrored alone lands
  // on the opposite leg. Where none stands there, it is refused, saying why and, where that
  // helps, what to include.
  /** The bar a bar outside the set lands on; or why none, and what to include where that helps. */
  type Home = { map: BarMap } | { why: string; refs: string[]; include?: string[] };
  const homes = new Map<string, Home>();
  const homeOf = (bar: string): Home => {
    const hit = homes.get(bar);
    if (hit) return hit;
    let home: Home;
    if (bar.startsWith("r")) {
      const bars = runBars(getEntity(doc0, bar));
      home = { why: `run ${bar} is not mirrored`, refs: [bar], include: [bar, ...bars] };
    } else {
      const found = standing(bar);
      if (found.length === 1) home = { map: found[0] as BarMap };
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
        if (found.length > 1) {
          // Including the bar would stand a third body there (re-check N5): say what is wrong.
          const ids = found.map((x) => x.to);
          home = {
            why: `${bar} is not mirrored, and ${idList(ids, ids.length)} ${ids.length === 2 ? "both" : "all"} stand at its image across ${plane}, one on another: remove all but one`,
            refs: [bar, ...ids],
          };
        } else if (lined.length > 0) {
          // Including the bar would stand its image on top of these: say how they differ.
          const one = lined.length === 1 ? (lined[0] as string) : undefined;
          const own = sectionOf(ctx, bar, getEntity(doc0, bar) as O).id;
          const theirs = one && sectionOf(ctx, one, getEntity(doc0, one) as O).id;
          const how = !one
            ? "another section or placement"
            : theirs !== own
              ? `its section is ${theirs}, and ${bar}'s ${own}`
              : "the same section, placed otherwise: its roll, anchor or offset";
          home = {
            why: `${bar} is not mirrored, and ${idList(lined, lined.length)} ${one ? "stands" : "stand"} on its image's line but ${one ? "is" : "are"} not its mirror image (${how}): make ${one ? "it" : "one of them"} ${bar}'s mirror image, or place the image by hand`,
            refs: [bar, ...lined],
          };
        } else {
          home = {
            why: `${bar} is not mirrored, and no bar stands at its image across ${plane}`,
            refs: [bar],
            include: [bar],
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
    const extra = { entity: where.split("/")[0], refs: h.refs };
    if (h.include) throw new Include(`${where}: ${h.why}`, h.include, extra);
    throw refusal("geometry", `${where}: ${h.why}`, extra);
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
          throw new Include(`node ${x} is not mirrored and is off the plane`, [x], { refs: [x] });
        }
      }
      if (x.startsWith("b") || x.startsWith("r")) return outsideMap(x, x).to;
      if (x.startsWith("c") || x.startsWith("p")) {
        throw new Include(`${x} is named by what is mirrored`, [x], { refs: [x] });
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
      const why = `${where}: the plane is square to ${bar}, which is not mirrored and whose axis the mirror turns`;
      const extra = { entity: where.split("/")[0], refs: h.refs };
      if (h.include) throw new Include(why, h.include, extra);
      throw refusal("geometry", `${why}; ${h.why}`, extra);
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
          // Including the bar would stand its image on the bar it lands on (re-check N1, N5), so
          // the advice is what makes the two agree.
          throw refusal(
            "geometry",
            `${where}: it is measured from ${st.bar as string}.${e}'s cut, and ${bm.to}.${te} is not cut as its image; count it from a design point, or cut ${bm.to}.${te} as ${st.bar as string}.${e} is`,
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

  // The set's own joints come with it (*2.3*, review fixes, joins; call 121): each connection
  // that claims only ends of the mirrored bars, its members outside the set landed on the bars at
  // their images, as references are. A joint whose member has no image is left out, as a copy
  // that finds no new main part for a connected object leaves it, and the image's ends it would
  // have claimed are reported open. One the set names is mirrored as any member, or refused. A
  // bar already at its image is not copied, so its joints are not either: that bar has its own.
  const own = ownJoints(
    isObject(doc0.connections) ? doc0.connections : {},
    new Set(copied.filter((x) => x.startsWith("b"))),
  ).filter((c) => !copyOf.has(c));
  const implied: string[] = [];
  const open: string[] = [];
  for (const c of own) {
    try {
      rewriteEntity("connections", c, getEntity(doc0, c), rw);
      implied.push(c);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      for (const end of claimedEnds(getEntity(doc0, c))) open.push(rw.end?.(end) ?? end);
    }
  }
  for (const c of implied) {
    const n = nextId(doc, KIND_PREFIX.connections);
    doc = n.doc;
    copyOf.set(c, n.id);
  }

  const created: string[] = [];
  const joined: Record<string, string> = {};
  const tagged: Record<string, string[]> = {};
  for (const id of [...copied, ...implied]) {
    const kind = kindOf(id) as Kind;
    const copy = copyOf.get(id) as string;
    // An image is an entity of its own: its label numbered, its tags kept and said (review m2).
    const value = asCopy(doc, rewriteEntity(kind, id, getEntity(doc0, id), rw));
    doc = withEntity(doc, copy, value);
    created.push(copy);
    const to = kind === "connections" ? joinedTo(value, copyOf) : undefined;
    if (to !== undefined) joined[copy] = to;
    const tags = tagsOf(value);
    if (tags.length > 0) tagged[copy] = tags;
  }
  checkAll(ctx, doc, created);
  // The bars outside the set that the images landed on other than themselves.
  const rehomed = [...homes.entries()].flatMap(([bar, h]) =>
    "map" in h && h.map.to !== bar && !there.has(bar) ? [[bar, h.map.to] as const] : [],
  );
  open.sort(compareIds);
  return done(
    withDoc(ctx, doc),
    { created },
    {
      copies: Object.fromEntries(copyOf),
      ...(there.size > 0 ? { there: Object.fromEntries(there) } : {}),
      ...(rehomed.length > 0 ? { onto: Object.fromEntries(rehomed) } : {}),
      ...(Object.keys(joined).length > 0 ? { joined } : {}),
      ...(open.length > 0 ? { open } : {}),
      ...(Object.keys(tagged).length > 0 ? { tagged } : {}),
    },
  );
}

/**
 * Whether every hole written on bar `src` has its image on bar `dst`, the bar at `src`'s image
 * (re-check N5): the same hole, its centre at the image of `src`'s within tol.len and drilled
 * along the image of its face's normal; a plain through hole along its axis either way, as the
 * cut list counts it one hole from either face (§5.3).
 */
function holesThere(
  ctx: CommandContext,
  src: string,
  dst: string,
  R: (v: V3) => V3,
  Rdir: (v: V3) => V3,
): boolean {
  const a = derivedBar(ctx, src);
  const b = derivedBar(ctx, dst);
  const theirs = b.ops.filter((o): o is HoleOp => o.op === "hole");
  const kind = (o: HoleOp) => JSON.stringify([o.d, o.thread, o.depth, o.csk, o.cbore]);
  return a.ops.every((o) => {
    if (o.op !== "hole" || !o.written) return true;
    const X = R(holeCentre(a, o));
    const n = Rdir(faceNormal(a, o.face));
    const plain = o.depth === undefined && !o.csk && !o.cbore;
    return theirs.some((p) => {
      if (kind(p) !== kind(o)) return false;
      const along = dot(faceNormal(b, p.face), n);
      const d = sub(holeCentre(b, p), X);
      if (plain) return Math.abs(along) >= 1 - 1e-9 && norm(cross(d, n)) <= TOL.len;
      return along >= 1 - 1e-9 && norm(d) <= TOL.len;
    });
  });
}

/** What a mirror did beyond its copies: the bars outside the set its images landed on. */
export interface MirrorInfo {
  /** Each entity mirrored, and its copy; the set's own joints included. */
  copies: Record<string, string>;
  /**
   * A bar of the set whose image already stands in the model, and that bar (itself, when the
   * plane maps it onto itself): it is not copied (re-check N5). Absent when none.
   */
  there?: Record<string, string>;
  /** A bar outside the set whose image another bar stands at, and that bar; absent when none. */
  onto?: Record<string, string>;
  /** Each connection made, and the bar it joins the images to (a butt's through bar). */
  joined?: Record<string, string>;
  /** The images' ends left open: their joint's member has no image to land on. */
  open?: string[];
  /** Each image that carries tags, and its tags (review m2); absent when none does. */
  tagged?: Record<string, string[]>;
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
