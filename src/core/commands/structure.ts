import { z } from "zod";
import { compareIds } from "../ids.ts";
import { Bar, BarId, ConnId, NodeId, Station, Vec3Expr } from "../project/schema.ts";
import { getEntity, isObject, kindOf, mergePatch, withEntity, withoutEntity } from "./doc.ts";
import { create, failed, patch, replace, requireEntity, SetArgs, withDoc } from "./helpers.ts";
import { plus } from "./numbers.ts";
import { type Ref, references, referrers, withoutEntry } from "./refs.ts";
import { type CommandDef, done, type RawDoc, refuse } from "./types.ts";
import { checkEntity } from "./validate.ts";
import { changed, idList, over } from "./words.ts";

/** Structure (design §6): nodes, bars, runs, and removing any entity. */

const Common = {
  label: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  only_in: z.array(z.string().min(1)).optional(),
  not_in: z.array(z.string().min(1)).optional(),
};
const COMMON_KEYS = ["label", "tags", "only_in", "not_in"] as const;

function commonOf(v: unknown): Record<string, unknown> {
  if (!isObject(v)) return {};
  return Object.fromEntries(COMMON_KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]));
}

/** A node as written: `[x, y, z]` when it has only a position, an object otherwise. */
function nodeValue(
  pos: { at?: unknown; on?: unknown; pivot?: unknown },
  common: Record<string, unknown>,
): unknown {
  if (pos.at !== undefined && Object.keys(common).length === 0) return pos.at;
  return { ...pos, ...common };
}

const exactlyOne = (o: Record<string, unknown>, keys: string[]) =>
  keys.filter((k) => o[k] !== undefined).length === 1;

const AddNode = z
  .strictObject({
    at: Vec3Expr.optional().describe("a point: [x, y, z], numbers or expressions"),
    on: Station.optional().describe("a point on a bar or run, which follows it (§4.3)"),
    pivot: ConnId.optional().describe("a pivot connection's point"),
    ...Common,
  })
  .refine((a) => exactlyOne(a, ["at", "on", "pivot"]), { message: "give one of at, on or pivot" });

export const addNode: CommandDef<z.infer<typeof AddNode>> = {
  name: "addNode",
  group: "Structure",
  summary: "add a named point that several entities share",
  args: AddNode,
  describe: (_a, d) => over("add", "point", d.created),
  apply(ctx, a) {
    const { at, on, pivot, ...rest } = a;
    const pos = at !== undefined ? { at } : on !== undefined ? { on } : { pivot };
    return create(ctx, "n", nodeValue(pos, rest));
  },
};

const MoveNode = z
  .strictObject({
    id: NodeId,
    at: Vec3Expr.optional().describe("the new point"),
    on: Station.optional().describe("a point on a bar or run"),
    pivot: ConnId.optional(),
    by: z
      .tuple([z.number(), z.number(), z.number()])
      .optional()
      .describe("move by [dx, dy, dz] mm"),
  })
  .refine((a) => exactlyOne(a, ["at", "on", "pivot", "by"]), {
    message: "give one of at, on, pivot or by",
  });

export const moveNode: CommandDef<z.infer<typeof MoveNode>> = {
  name: "moveNode",
  group: "Structure",
  summary: "move a node to a point, onto a bar, or by an offset; what uses it follows",
  args: MoveNode,
  describe: (a) => over("move", "point", [a.id]),
  apply(ctx, a) {
    const doc = ctx.state.doc;
    const missing = requireEntity(doc, a.id, "nodes");
    if (missing.length > 0) return failed(missing);
    const cur = getEntity(doc, a.id);
    const common = commonOf(cur);
    let pos: { at?: unknown; on?: unknown; pivot?: unknown };
    if (a.by) {
      const at = Array.isArray(cur) ? cur : isObject(cur) ? cur.at : undefined;
      if (!Array.isArray(at) || at.length !== 3) {
        return refuse("args", `${a.id} is not at a point of its own; give at, on or pivot`, {
          entity: a.id,
        });
      }
      const by = a.by;
      pos = { at: at.map((c, i) => plus(c as number | string, by[i] as number)) };
    } else if (a.at !== undefined) pos = { at: a.at };
    else if (a.on !== undefined) pos = { on: a.on };
    else pos = { pivot: a.pivot };
    return replace(ctx, a.id, nodeValue(pos, common));
  },
};

export const addBar: CommandDef<z.infer<typeof Bar>> = {
  name: "addBar",
  group: "Structure",
  summary: "add a bar of any bar item between two points (§4.4)",
  args: Bar,
  describe: (_a, d) => over("add", "bar", d.created),
  apply: (ctx, a) => create(ctx, "b", a),
};

export const setBar: CommandDef<z.infer<typeof SetArgs>> = {
  name: "setBar",
  group: "Structure",
  summary: "change a bar's fields (item, points, anchor, roll, ends, ops, …)",
  args: SetArgs,
  describe: (a) => changed(a.id, a.set),
  apply: (ctx, a) => patch(ctx, a.id, a.set, "bars"),
};

/** A run as written: a list of bars, or an object when it has labels or tags. */
function runValue(v: Record<string, unknown>): unknown {
  const common = commonOf(v);
  return Object.keys(common).length === 0 ? v.bars : { bars: v.bars, ...common };
}

const AddRun = z.strictObject({
  bars: z
    .array(BarId)
    .min(2)
    .describe("collinear bars joined by splices, in order, all a → b (§4.3)"),
  ...Common,
});

export const addRun: CommandDef<z.infer<typeof AddRun>> = {
  name: "addRun",
  group: "Structure",
  summary: "name a line of spliced bars, so stations and patterns can span its joints",
  args: AddRun,
  describe: (_a, d) => over("add", "run", d.created),
  apply: (ctx, a) => create(ctx, "r", runValue(a)),
};

export const setRun: CommandDef<z.infer<typeof SetArgs>> = {
  name: "setRun",
  group: "Structure",
  summary: "change a run's bars, label or tags",
  args: SetArgs,
  describe: (a) => changed(a.id, a.set),
  apply(ctx, a) {
    const missing = requireEntity(ctx.state.doc, a.id, "runs");
    if (missing.length > 0) return failed(missing);
    const cur = getEntity(ctx.state.doc, a.id);
    const asObject = Array.isArray(cur) ? { bars: cur } : cur;
    const next = mergePatch(asObject, a.set);
    return replace(ctx, a.id, isObject(next) ? runValue(next) : next);
  },
};

// ---------------------------------------------------------------------------------------------
// removeEntity (§6, review m10)

const RemoveEntity = z.strictObject({
  id: z.string().describe("any entity: n1, b7, r1, c3, p4, pt1, K1, C1, O1, D1, or project:<item>"),
  cascade: z
    .boolean()
    .optional()
    .describe("also remove what refers to it, and drop it from lists that can lose it"),
});

function getAt(v: unknown, path: readonly (string | number)[]): unknown {
  let cur = v;
  for (const k of path)
    cur =
      isObject(cur) || Array.isArray(cur)
        ? (cur as Record<string, unknown>)[k as string]
        : undefined;
  return cur;
}

function setAt(v: unknown, path: readonly (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [k, ...rest] = path as [string, ...(string | number)[]];
  const o = isObject(v) ? v : {};
  return { ...o, [k]: setAt(o[k], rest, value) };
}

/** What a list member names: an id, a bar of an end reference, a sleeve's hollow layer. */
function memberTarget(x: unknown): string | undefined {
  if (typeof x === "string") return /^b\d+\.[ab]$/.test(x) ? x.split(".")[0] : x;
  if (isObject(x) && typeof x.inside === "string") return x.inside;
  return undefined;
}

function describeRefs(refs: readonly Ref[]): string {
  return refs.map((r) => `${r.from} (${r.field})`).join(", ");
}

export const removeEntity: CommandDef<z.infer<typeof RemoveEntity>> = {
  name: "removeEntity",
  group: "Structure",
  summary: "remove an entity; refused while anything refers to it, unless cascade",
  args: RemoveEntity,
  describe: (_a, d) => `remove ${idList(d.removed)}`,
  apply(ctx, a) {
    let doc: RawDoc = ctx.state.doc;
    if (a.id.includes("@")) {
      return refuse(
        "args",
        `${a.id} is a pattern copy: skip it in its pattern, or explode the pattern first`,
        {
          entity: a.id,
        },
      );
    }
    const missing = requireEntity(doc, a.id);
    if (missing.length > 0) return failed(missing);
    const direct = referrers(doc, a.id).filter((r) => r.from !== a.id);
    if (direct.length > 0 && !a.cascade) {
      return refuse(
        "referenced",
        `${a.id} is referred to by ${describeRefs(direct)}; remove or change those first, or pass cascade: true`,
        { entity: a.id, refs: [...new Set(direct.map((r) => r.from))].sort(compareIds) },
      );
    }

    const removed = new Set<string>();
    const changed = new Set<string>();
    const queue = [a.id];
    while (queue.length > 0) {
      const x = queue.shift() as string;
      if (removed.has(x)) continue;
      removed.add(x);
      for (const r of references(doc)) {
        if (r.to !== x || removed.has(r.from)) continue;
        if (kindOf(r.from) === undefined) {
          return refuse(
            "referenced",
            `${r.from} refers to ${x} (${r.field}); cascade removes entities and drops list members, it does not rewrite ${r.from}: change it first`,
            { entity: a.id, refs: [r.from] },
          );
        }
        if (r.how === "member" && r.entry) {
          // An entry keyed by the bar's end (a face named for its side holes, F12) goes with it.
          doc = withEntity(doc, r.from, withoutEntry(getEntity(doc, r.from), r.entry));
          changed.add(r.from);
          continue;
        }
        if (r.how === "member" && r.list) {
          const v = getEntity(doc, r.from);
          const list = getAt(v, r.list.path);
          if (Array.isArray(list)) {
            const kept = list.filter((m) => memberTarget(m) !== x);
            if (kept.length >= r.list.min) {
              doc = withEntity(doc, r.from, setAt(v, r.list.path, kept));
              changed.add(r.from);
              continue;
            }
          }
        }
        queue.push(r.from);
      }
    }
    for (const x of removed) doc = withoutEntity(doc, x);
    const stillChanged = [...changed].filter((x) => !removed.has(x)).sort(compareIds);
    for (const x of stillChanged) {
      const errors = checkEntity(ctx, doc, x);
      if (errors.length > 0) return failed(errors);
    }
    return done(withDoc(ctx, doc), {
      removed: [...removed].sort(compareIds),
      changed: stillChanged,
    });
  },
};
