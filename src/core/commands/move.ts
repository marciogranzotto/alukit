import { z } from "zod";
import { derive } from "../derive/derive.ts";
import { evalNumber } from "../expr.ts";
import { lockItems } from "../lock/source.ts";
import { Expr } from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { addScaled, cross, dist, dot, norm, scale, sub, type V3 } from "../vec.ts";
import { getEntity, isObject, withEntity, withoutEntity } from "./doc.ts";
import { checkAll, derivedBar, guard } from "./geometry.ts";
import { failed, requireEntity, withDoc } from "./helpers.ts";
import { drivenEnd, drivers, type End, endHold, movingAxes } from "./hold.ts";
import { len, offsetBy, plus } from "./numbers.ts";
import { referrers } from "./refs.ts";
import { refusal } from "./rewrite.ts";
import { type CommandContext, type CommandDef, done, type Outcome, type RawDoc } from "./types.ts";

/**
 * `moveEnd` (design §6, *2.3*): moves one end of a bar along the bar's own axis, the other end
 * staying where it is, so the bar gets longer or shorter. The app's end handles and its length
 * label send it, each followed by an `autoConnect` at the end, so an end that lands on another
 * bar joins it by the project's corner rule (§4.5), as drawing a bar does.
 *
 * Where the end goes is one of: a design length (`len_mm`), a cut length (`cut_mm`), a distance
 * outward (`by_mm`), or another bar (`to`): where the axis meets that bar's design line, or that
 * bar's end. What holds the end is `hold.ts`'s rule: a free end moves; one a node, a station,
 * another bar's end or a butt holds moves with `detach: true`, which writes it as coordinates and
 * drops it from its butt; one a pivot, miter, splice or its own plane sets is refused, and so is a
 * move that would overwrite a coordinate a param drives.
 */

type O = Record<string, unknown>;

const MoveEnd = z
  .strictObject({
    end: z
      .string()
      .regex(/^b\d+\.[ab]$/)
      .describe("the bar end to move, along its bar's axis; the other end stays"),
    len_mm: Expr.optional().describe(
      "the bar's new design length, from the other end's design point; an expression over params keeps them on a bar along a world axis",
    ),
    cut_mm: Expr.optional().describe(
      "the bar's new cut length: the end moves so the cut is this long, its plane being its own default after the move; an expression over params is kept, the design length written as it plus the ends' allowance (`W + 20`)",
    ),
    by_mm: z.number().optional().describe("move the end outward by this much; negative shortens"),
    to: z
      .string()
      .regex(/^b\d+(\.[ab])?$/)
      .optional()
      .describe(
        "a bar, or a bar's end: the end goes where its axis meets that bar's design line, or to that end's design point",
      ),
    detach: z
      .boolean()
      .optional()
      .describe(
        "free an end that a node, a station, another bar's end or a butt holds: write it as coordinates and drop it from its butt (the butt goes with its last end)",
      ),
  })
  .refine((a) => [a.len_mm, a.cut_mm, a.by_mm, a.to].filter((x) => x !== undefined).length === 1, {
    message: "give one of len_mm, cut_mm, by_mm or to",
  });

type Args = z.infer<typeof MoveEnd>;

/** What a move did, for its answer and its words. */
export interface MoveEndInfo {
  end: string;
  /** The design length before and after, mm. */
  from_mm: number;
  len_mm: number;
  /** The butt the end was dropped from (or that went with its last end). */
  detached?: string;
  /** The node, bar end or station bar the end no longer sits at. */
  left?: string;
}

export const moveEnd: CommandDef<Args> = {
  name: "moveEnd",
  group: "Structure",
  summary:
    "move one end of a bar along its own axis (to a length, a cut length, by a distance, or onto another bar); the other end stays",
  args: MoveEnd,
  describe(a, d) {
    const info = d.info as MoveEndInfo | undefined;
    const bar = a.end.split(".")[0] as string;
    if (!info) return `move ${a.end}`;
    const verb = info.len_mm >= info.from_mm ? "lengthen" : "shorten";
    const freed = [info.detached, info.left].filter((x) => x !== undefined);
    return `${verb} ${bar} at end ${a.end.slice(-1)} to ${info.len_mm} mm${
      freed.length > 0 ? `, freed from ${freed.join(" and ")}` : ""
    }`;
  },
  apply: (ctx, a) => guard(() => apply(ctx, a)),
};

const pointOf = (db: ReturnType<typeof derivedBar>, e: End): V3 | undefined =>
  e === "a" ? db.placed.A : db.placed.B;

/** The parameter along `Q + u·s` where it meets bar `to`'s design line or end, or why not. */
function meeting(ctx: CommandContext, Q: V3, u: V3, to: string): number {
  const [id, end] = to.split(".") as [string, End | undefined];
  const tb = derivedBar(ctx, id);
  const A = tb.placed.A;
  const B = tb.placed.B;
  if (!B) throw refusal("derive", `${id}'s end b does not derive`, { entity: id });
  if (end) {
    const P = end === "a" ? A : B;
    const s = dot(sub(P, Q), u);
    const off = dist(addScaled(Q, u, s), P);
    if (off > TOL.len) {
      throw refusal("geometry", `the axis misses ${to} by ${len(off)} mm`, { field: "to" });
    }
    return s;
  }
  const t = sub(B, A);
  const L = norm(t);
  const n = cross(u, t);
  const nn = norm(n);
  if (nn / L < 1e-9) {
    throw refusal("geometry", `the axis runs along ${id}, so it meets its line nowhere`, {
      field: "to",
    });
  }
  // The closest points of the two lines: Q + u·s and A + t·r.
  const w = sub(Q, A);
  const uu = 1;
  const ut = dot(u, t);
  const tt = dot(t, t);
  const uw = dot(u, w);
  const tw = dot(t, w);
  const den = uu * tt - ut * ut;
  const s = (ut * tw - tt * uw) / den;
  const r = (uu * tw - ut * uw) / den;
  const gap = dist(addScaled(Q, u, s), addScaled(A, t, r));
  if (gap > TOL.len) {
    throw refusal("geometry", `the axis misses ${id}'s line by ${len(gap)} mm`, { field: "to" });
  }
  if (r * L < -TOL.len || r * L > L + TOL.len) {
    throw refusal("geometry", `the axis meets ${id}'s line past its ends`, { field: "to" });
  }
  return s;
}

/** A written coordinate as a number, or the refusal for one a param drives. */
function constant(c: unknown, ctx: CommandContext): number {
  if (typeof c === "number") return c;
  return evalNumber(c as string, { name: (n) => ctx.derived().params.get(n) });
}

function apply(ctx: CommandContext, a: Args): Outcome {
  const doc = ctx.state.doc;
  const [bar, e] = a.end.split(".") as [string, End];
  const missing = requireEntity(doc, bar, "bars");
  if (missing.length > 0) return failed(missing);
  const spec = getEntity(doc, bar) as O;
  const db = derivedBar(ctx, bar);
  const o: End = e === "a" ? "b" : "a";
  const P = pointOf(db, e);
  const Q = pointOf(db, o);
  if (!P || !Q) throw refusal("derive", `${bar}'s ends do not derive`, { entity: bar });
  const L0 = dist(P, Q);
  const u = scale(sub(P, Q), 1 / L0);

  const hold = endHold(doc as O, bar, e, db.ends[e].by);
  if (hold.kind === "fixed") throw refusal("held", hold.words, { entity: bar, refs: hold.refs });
  if (hold.kind === "detach" && !a.detach) {
    throw refusal(
      "held",
      `${a.end} ${hold.words.join(" and ")}: give detach: true to free it and move it`,
      { entity: bar, field: e, refs: hold.refs },
    );
  }
  const driven = drivenEnd(doc as O, bar, e, u);
  if (driven) throw refusal("driven", driven.words, { entity: bar, field: e, refs: driven.params });
  if (e === "a" && isObject(spec.b) && spec.b.from === "a.cut") {
    throw refusal("args", `${bar}'s end b is counted from end a's cut: move end b instead`, {
      entity: bar,
    });
  }

  // The new design length, and an expression for it when one was given over params.
  const value = (field: "len_mm" | "cut_mm", x: Expr): number => {
    try {
      return constant(x, ctx);
    } catch (err) {
      throw refusal("expr", `${field}: ${(err as Error).message}`, { field });
    }
  };
  let L: number;
  let lenExpr: string | undefined;
  const cut = a.cut_mm === undefined ? undefined : value("cut_mm", a.cut_mm);
  if (a.to !== undefined) L = meeting(ctx, Q, u, a.to);
  else if (a.by_mm !== undefined) L = L0 + a.by_mm;
  else if (a.len_mm !== undefined) {
    L = value("len_mm", a.len_mm);
    if (drivers(a.len_mm)) lenExpr = a.len_mm as string;
  } else {
    if (!(cut !== undefined && cut > TOL.len)) {
      throw refusal(
        "length",
        `${bar} would be cut ${len(cut ?? 0)} mm long: a bar needs a length`,
        {
          entity: bar,
        },
      );
    }
    // The cut follows the end's own plane once it moves: its default, plus `extend_mm`.
    const ext = isObject(spec.ends) && isObject(spec.ends[e]) ? spec.ends[e].extend_mm : undefined;
    const extend = typeof ext === "number" ? ext : 0;
    L = L0 + (cut - db.lengths.cut) + (db.ends[e].move - extend);
  }
  if (!(L > TOL.len)) {
    throw refusal("length", `${bar} would be ${len(L)} mm long: a bar needs a length`, {
      entity: bar,
    });
  }

  const build = (L: number) => written(ctx, spec, bar, e, Q, u, L, L0, lenExpr, hold);
  let next = build(L);
  if (cut !== undefined && a.cut_mm !== undefined) {
    // The cut is derived (§4.5): one correction from the bar as it would be, for an end whose
    // other end's cut depends on its angle.
    const got = derive(next.doc, lockItems(ctx.state.lock)).bars.get(bar)?.lengths.cut;
    if (got !== undefined && Math.abs(got - cut) > 0.005) {
      L += cut - got;
      next = build(L);
    }
    // A cut over params keeps them: the design length is the cut plus what the ends add or take
    // (D-UX-17), so the cut stays the expression while the ends stay as they are.
    if (drivers(a.cut_mm)) {
      lenExpr = plus(a.cut_mm, len(L - cut)) as string;
      next = build(L);
    }
  }
  checkAll(ctx, next.doc, next.changed);
  const info: MoveEndInfo = {
    end: a.end,
    from_mm: len(L0),
    len_mm: len(L),
    ...(next.detached ? { detached: next.detached } : {}),
    ...(hold.kind === "detach" && hold.at ? { left: hold.at } : {}),
  };
  return done(withDoc(ctx, next.doc), { changed: next.changed, removed: next.removed }, info);
}

/** The document with the end written at length `L`, freed from what held it. */
function written(
  ctx: CommandContext,
  spec: O,
  bar: string,
  e: End,
  Q: V3,
  u: V3,
  L: number,
  L0: number,
  lenExpr: string | undefined,
  hold: ReturnType<typeof endHold>,
): { doc: RawDoc; changed: string[]; removed: string[]; detached?: string } {
  const N = addScaled(Q, u, L);
  const w = spec[e];
  const moving = new Set(movingAxes(u));
  const axial = moving.size === 1;
  const k = [...moving][0] as number;
  const sign = (u[k] as number) > 0 ? 1 : -1;
  const other = spec[e === "a" ? "b" : "a"];
  const freeB = e === "a" && isObject(spec.b) && spec.b.len_mm !== undefined;
  const freeHere = isObject(w) && w.len_mm !== undefined;
  // A length over params is kept where the document can hold it: a free end's `len_mm`, or the
  // coordinate along a world axis counted from the other end's. Elsewhere it is refused, never
  // written as the number it comes to (D-UX-17).
  if (lenExpr && !freeB && !freeHere && !(axial && Array.isArray(other))) {
    throw refusal(
      "expr",
      `${lenExpr} reads ${drivers(lenExpr)?.params.join(", ")}, which ${bar}'s end ${e} can keep only along a world axis from coordinates at its other end: give a number`,
      { entity: bar, field: e },
    );
  }
  /** The coordinate along the bar's world axis: the other end's plus the length, if one is kept. */
  const along = (): unknown =>
    lenExpr && !freeB ? offsetBy((other as Expr[])[k] as Expr, sign, lenExpr) : len(N[k] as number);
  let value: unknown;
  if (Array.isArray(w) && w.length === 3) {
    value = w.map((c, i) => {
      if (!moving.has(i)) return c;
      if (i === k && axial) return along();
      constant(c, ctx);
      return len(N[i] as number);
    });
  } else if (freeHere) {
    value = { ...w, len_mm: lenExpr ?? plus(constant(w.len_mm, ctx), L - L0) };
  } else {
    // Detached from a node, a bar end or a station: written as coordinates. A node written as
    // coordinates keeps the expressions of the axes the move leaves alone (`[0, 0, "H"]`).
    const nodes = isObject(ctx.state.doc.nodes) ? ctx.state.doc.nodes : {};
    const node = typeof w === "string" ? nodes[w] : undefined;
    const at = Array.isArray(node) ? node : isObject(node) && Array.isArray(node.at) ? node.at : [];
    value = [0, 1, 2].map((i) => {
      const c = at[i];
      if (!moving.has(i) && (typeof c === "number" || typeof c === "string")) return c;
      if (moving.has(i) && typeof c === "string" && drivers(c)) {
        throw refusal(
          "driven",
          `${bar}.${e} is at ${w as string}, whose ${"xyz"[i]} is ${c}: driven by ${drivers(c)?.params.join(", ")}; edit it instead`,
          { entity: bar, field: e },
        );
      }
      return i === k && axial ? along() : len(N[i] as number);
    });
  }
  const next: O = { ...spec, [e]: value };
  // Moving end a of a bar whose end b is a free length moves b with it unless the length takes
  // up the move (§4.3: a free end is counted from end a's design point).
  if (e === "a" && isObject(spec.b) && spec.b.len_mm !== undefined) {
    next.b = { ...spec.b, len_mm: lenExpr ?? plus(constant(spec.b.len_mm, ctx), L - L0) };
  }
  let doc = withEntity(ctx.state.doc, bar, next);
  const changed = [bar];
  const removed: string[] = [];
  let detached: string | undefined;
  if (hold.kind === "detach" && hold.conn) {
    detached = hold.conn;
    const c = getEntity(doc, hold.conn) as O;
    const ends = (c.ends as string[]).filter((x) => x !== `${bar}.${e}`);
    if (ends.length > 0) {
      doc = withEntity(doc, hold.conn, { ...c, ends });
      changed.push(hold.conn);
    } else {
      const refs = referrers(doc, hold.conn).map((r) => r.from);
      if (refs.length > 0) {
        throw refusal(
          "refs",
          `${bar}.${e} is ${hold.conn}'s last end, and ${refs.join(", ")} refer to ${hold.conn}: edit them first`,
          { entity: hold.conn, refs },
        );
      }
      doc = withoutEntity(doc, hold.conn);
      removed.push(hold.conn);
    }
  }
  return { doc, changed, removed, ...(detached ? { detached } : {}) };
}
