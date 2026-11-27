import { z } from "zod";
import { evalNumber } from "../expr.ts";
import { compareIds } from "../ids.ts";
import { type Expr, Pattern, PatternId } from "../project/schema.ts";
import { dot, unit, type V3 } from "../vec.ts";
import {
  getEntity,
  isObject,
  KIND_PREFIX,
  type Kind,
  kindOf,
  type MapKind,
  nextId,
  withEntity,
  withoutEntity,
} from "./doc.ts";
import { checkAll, guard } from "./geometry.ts";
import { failed, requireEntity, withDoc } from "./helpers.ts";
import { plus } from "./numbers.ts";
import { referrers } from "./refs.ts";
import { type Rewriter, refusal, rewriteEntity } from "./rewrite.ts";
import { type CommandContext, type CommandDef, done, type RawDoc, refuse } from "./types.ts";
import { idList } from "./words.ts";

/**
 * Patterns made ordinary (design §4.7, §6): `explodePattern` turns a pattern's copies into
 * entities of their own, and `array` makes copies that way at once. A copy is what derive makes
 * of it: the template's entities translated by k × pitch along the pattern's bar, run or
 * direction, references inside the template remapped and those outside kept; a station on the
 * pattern's bar slides along it, and inline points move. The copies no longer follow the
 * pattern's pitch, so each step is a number; coordinates written as expressions stay
 * expressions, so a copy still follows the params it was written with.
 */

type O = Record<string, unknown>;

const TEMPLATE_KINDS: Kind[] = ["nodes", "bars", "connections", "parts"];

interface Spec {
  template: string[];
  along: string | { dir: readonly [Expr, Expr, Expr] };
  pitch_mm?: Expr;
  count?: number;
  offsets_mm?: Expr[];
  skip?: number[];
  rail_holes?: unknown;
}

function evaluate(ctx: CommandContext, e: Expr, where: string): number {
  const params = ctx.derived().params;
  try {
    return evalNumber(e, { name: (n) => params.get(n) });
  } catch (err) {
    throw refusal("expr", `${where}: ${(err as Error).message}`);
  }
}

/** The pattern's axis and its steps, as derive computes them. */
function plan(
  ctx: CommandContext,
  spec: Spec,
  where: string,
): { t: V3; along?: string; steps: [number, number][] } {
  const d = ctx.derived();
  let t: V3 | undefined;
  let along: string | undefined;
  if (typeof spec.along === "string") {
    along = spec.along;
    t = along.startsWith("r") ? d.runs.get(along)?.t : d.bars.get(along)?.placed.frame.t;
    if (!t)
      throw refusal("derive", `${where}: ${along} does not derive, so the copies have no axis`);
  } else {
    const v = spec.along.dir.map((c, i) =>
      evaluate(ctx, c, `${where}/along/dir[${i}]`),
    ) as unknown as V3;
    t = unit(v);
    if (!t) throw refusal("args", `${where}: along.dir is a zero vector`);
  }
  let steps: [number, number][];
  if (spec.offsets_mm) {
    steps = spec.offsets_mm.map((o, i) => [i + 1, evaluate(ctx, o, `${where}/offsets_mm[${i}]`)]);
  } else if (spec.pitch_mm !== undefined && spec.count !== undefined) {
    const pitch = evaluate(ctx, spec.pitch_mm, `${where}/pitch_mm`);
    steps = [];
    for (let k = 1; k < spec.count; k++) steps.push([k, k * pitch]);
  } else throw refusal("args", `${where}: a pattern needs pitch_mm and count, or offsets_mm`);
  const skip = new Set(spec.skip ?? []);
  return { t, ...(along ? { along } : {}), steps: steps.filter(([k]) => !skip.has(k)) };
}

/** The axis of a bar or run, for a station that slides along the pattern. */
function axisOf(ctx: CommandContext, bar: string): V3 | undefined {
  const d = ctx.derived();
  return bar.startsWith("r") ? d.runs.get(bar)?.t : d.bars.get(bar)?.placed.frame.t;
}

/**
 * Makes the copies of a template into entities; returns the document, the ids made, and which
 * copy each one is (`b26@2` → `b37`: the template's id and the copy's number, as derive names a
 * pattern's copies).
 */
function makeCopies(
  ctx: CommandContext,
  doc0: RawDoc,
  spec: Spec,
  where: string,
): { doc: RawDoc; created: string[]; copies: Record<string, string> } {
  if (spec.rail_holes !== undefined) {
    throw refusal(
      "geometry",
      `${where}: its stations come from a rail's holes; exploding it would freeze a layout the rail decides`,
    );
  }
  const template = [...spec.template].sort(compareIds);
  const inTemplate = new Set(template);
  const { t, along, steps } = plan(ctx, spec, where);
  let doc = doc0;
  const created: string[] = [];
  const copies: Record<string, string> = {};
  for (const [k, step] of steps) {
    const ids = new Map<string, string>();
    for (const id of template) {
      const n = nextId(doc, KIND_PREFIX[kindOf(id) as MapKind]);
      doc = n.doc;
      ids.set(id, n.id);
    }
    const shift = (st: O, at: number, sign: number): O => ({
      ...st,
      at_mm: plus(st.at_mm as Expr, sign * at),
    });
    const rw: Rewriter = {
      id: (x) => ids.get(x) ?? x,
      end: (ref) => {
        const [bar, end] = ref.split(".") as [string, string];
        return `${ids.get(bar) ?? bar}.${end}`;
      },
      coords: (v) =>
        v.map((c, i) =>
          Math.abs(t[i] as number) <= 1e-12 ? c : plus(c, (t[i] as number) * step),
        ) as unknown as typeof v,
      station: (st, w) => {
        const bar = st.bar as string;
        if (inTemplate.has(bar)) return { ...st, bar: ids.get(bar) };
        const fromB = st.from === "b" || st.from === "b.cut";
        if (bar === along) return shift(st, step, fromB ? -1 : 1);
        const tb = axisOf(ctx, bar);
        const c = tb ? dot(tb, t) : 0;
        if (Math.abs(Math.abs(c) - 1) > 1e-9) {
          throw refusal(
            "geometry",
            `${w}: a station on ${bar}, which does not run along the pattern; give the copies points of their own`,
            {
              entity: w.split("/")[0],
            },
          );
        }
        return shift(st, step, (c > 0 ? 1 : -1) * (fromB ? -1 : 1));
      },
      pose: (p) =>
        Array.isArray(p.pos)
          ? {
              ...p,
              pos: (rw.coords as NonNullable<Rewriter["coords"]>)(p.pos as [Expr, Expr, Expr]),
            }
          : p,
      entity: (kind, id, v) => {
        if (kind !== "connections" || v.type !== "face" || !Array.isArray(v.bars)) return v;
        // The hook sees the copy: a first layer from the template is already its copy, which
        // carries the stations with it.
        const first = v.bars[0] as string;
        const st = v.stations;
        if ([...ids.values()].includes(first) || !isObject(st) || !Array.isArray(st.at_mm))
          return v;
        const tb = axisOf(ctx, first);
        const c = first === along ? 1 : tb ? dot(tb, t) : 0;
        if (Math.abs(Math.abs(c) - 1) > 1e-9) {
          throw refusal(
            "geometry",
            `${id}: its stations lie on ${first}, which does not run along the pattern`,
            { entity: id },
          );
        }
        return {
          ...v,
          stations: { ...st, at_mm: st.at_mm.map((e) => plus(e as Expr, Math.sign(c) * step)) },
        };
      },
    };
    for (const id of template) {
      const value = rewriteEntity(kindOf(id) as Kind, id, getEntity(doc0, id), rw);
      doc = withEntity(doc, ids.get(id) as string, value);
      created.push(ids.get(id) as string);
      copies[`${id}@${k}`] = ids.get(id) as string;
    }
  }
  return { doc, created, copies };
}

const ExplodePattern = z.strictObject({ id: PatternId });

export const explodePattern: CommandDef<z.infer<typeof ExplodePattern>> = {
  name: "explodePattern",
  group: "Parts and patterns",
  summary: "turn a pattern's copies into ordinary entities, so one can be edited on its own",
  args: ExplodePattern,
  describe: (a, d) => `explode ${a.id} into ${idList(d.created)}`,
  apply: (ctx, a) =>
    guard(() => {
      const doc = ctx.state.doc;
      const missing = requireEntity(doc, a.id, "patterns");
      if (missing.length > 0) return failed(missing);
      const users = referrers(doc, a.id);
      if (users.length > 0) {
        return refuse(
          "referenced",
          `${a.id} is used by ${users.map((r) => `${r.from} (${r.field})`).join(", ")}`,
          {
            entity: a.id,
            refs: users.map((r) => r.from),
          },
        );
      }
      const spec = getEntity(doc, a.id) as Spec;
      const r = makeCopies(ctx, withoutEntity(doc, a.id), spec, a.id);
      checkAll(ctx, r.doc, r.created);
      // Which entity each copy became (E1.6): the copies were derived already, so a preview
      // names them, rather than new bars and parts.
      return done(
        withDoc(ctx, r.doc),
        { created: r.created, removed: [a.id] },
        { copies: r.copies },
      );
    }),
};

const PatternShape = Pattern.shape;

const ArrayArgs = z
  .strictObject({
    ids: z.array(z.string()).min(1).describe("the nodes, bars, connections and parts to copy"),
    along: PatternShape.along,
    pitch_mm: PatternShape.pitch_mm,
    count: PatternShape.count,
    offsets_mm: PatternShape.offsets_mm,
    skip: PatternShape.skip,
  })
  .refine(
    (a) => (a.offsets_mm === undefined) !== (a.pitch_mm === undefined && a.count === undefined),
    {
      message: "give pitch_mm and count, or offsets_mm",
    },
  );

export const array: CommandDef<z.infer<typeof ArrayArgs>> = {
  name: "array",
  group: "Parts and patterns",
  summary: "copy entities at a pitch along a bar, run or direction, as ordinary entities (§4.7)",
  args: ArrayArgs,
  describe: (a, d) => `copy ${idList(a.ids)}, making ${idList(d.created)}`,
  apply: (ctx, a) =>
    guard(() => {
      const doc = ctx.state.doc;
      for (const id of a.ids) {
        const missing = requireEntity(doc, id, ...TEMPLATE_KINDS);
        if (missing.length > 0) return failed(missing);
      }
      if (typeof a.along === "string") {
        const missing = requireEntity(doc, a.along, "bars", "runs");
        if (missing.length > 0) return failed(missing);
        if (a.ids.includes(a.along))
          return refuse("args", `along: ${a.along} is among the entities it moves`);
      }
      const spec: Spec = {
        template: [...new Set(a.ids)],
        along: a.along,
        ...(a.pitch_mm !== undefined ? { pitch_mm: a.pitch_mm } : {}),
        ...(a.count !== undefined ? { count: a.count } : {}),
        ...(a.offsets_mm !== undefined ? { offsets_mm: a.offsets_mm } : {}),
        ...(a.skip !== undefined ? { skip: a.skip } : {}),
      };
      const r = makeCopies(ctx, doc, spec, "array");
      checkAll(ctx, r.doc, r.created);
      return done(withDoc(ctx, r.doc), { created: r.created });
    }),
};
