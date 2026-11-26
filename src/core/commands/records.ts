import { z } from "zod";
import { LocalId } from "#catalog/schema/common.ts";
import { compareIds } from "../ids.ts";
import { diffLocks } from "../lock/diff.ts";
import { pinLock } from "../lock/pin.ts";
import { documentRefs } from "../lock/refs.ts";
import { ItemRef, OrderChoice, Param, ParamName, Variant, VariantName } from "../project/schema.ts";
import {
  fieldSchema,
  getEntity,
  hasEntity,
  isObject,
  type Kind,
  mergePatch,
  nextId,
  PROJECT_ITEM,
  withEntity,
  withField,
  withoutEntity,
} from "./doc.ts";
import { create, failed, patch, replace, requireEntity, SetArgs, withDoc } from "./helpers.ts";
import { paramReaders } from "./refs.ts";
import { type CommandDef, type CommandError, done, refuse } from "./types.ts";
import { checkEntity, exprErrors, itemResolves, schemaErrors } from "./validate.ts";

/**
 * Items, params and costs, organising, records, views and the lock (design §6). Costs, price
 * bands, checks, open items, decisions, variants and views are records whose schemas later
 * milestones complete; these commands give them ids and check them against whatever the
 * document's schema says today.
 */

// ---------------------------------------------------------------------------------------------
// Items (project items, §4.8)

const AddItem = z.strictObject({
  id: LocalId.describe("the item's id; the document refers to it as project:<id>"),
  item: z
    .record(z.string(), z.unknown())
    .describe("the item: plate, bent-angle, generic or placeholder (§4.8)"),
});

export const addItem: CommandDef<z.infer<typeof AddItem>> = {
  name: "addItem",
  group: "Items",
  summary: "define an item that exists only in this project, as project:<id>",
  args: AddItem,
  apply(ctx, a) {
    const id = `${PROJECT_ITEM}${a.id}`;
    if (hasEntity(ctx.state.doc, id))
      return refuse("exists", `${id} already exists`, { entity: id });
    const doc = withEntity(ctx.state.doc, id, a.item);
    const errors = checkEntity(ctx, doc, id);
    return errors.length > 0 ? failed(errors) : done(withDoc(ctx, doc), { created: [id] });
  },
};

const SetItem = z.strictObject({
  id: z.string().describe("project:<id>"),
  set: SetArgs.shape.set,
});

export const setItem: CommandDef<z.infer<typeof SetItem>> = {
  name: "setItem",
  group: "Items",
  summary: "change a project item",
  args: SetItem,
  apply: (ctx, a) => patch(ctx, a.id, a.set, "items"),
};

// ---------------------------------------------------------------------------------------------
// Params and costs

const SetParam = z.strictObject({
  name: ParamName,
  value: z
    .union([Param, z.null()])
    .describe("a number, an expression, a valued field; null removes it"),
});

export const setParam: CommandDef<z.infer<typeof SetParam>> = {
  name: "setParam",
  group: "Params and costs",
  summary: "set a param (a number, an expression or a valued field), or remove an unused one",
  args: SetParam,
  apply(ctx, a) {
    const doc = ctx.state.doc;
    const params = isObject(doc.params) ? doc.params : {};
    if (a.value === null) {
      if (!Object.hasOwn(params, a.name)) return refuse("missing", `there is no param ${a.name}`);
      const readers = paramReaders(doc, a.name);
      if (readers.length > 0) {
        return refuse(
          "referenced",
          `${a.name} is read by ${readers.map((r) => `${r.from} (${r.field})`).join(", ")}`,
          { refs: [...new Set(readers.map((r) => r.from))].sort(compareIds) },
        );
      }
      const rest = { ...params };
      delete rest[a.name];
      return done(withDoc(ctx, withField(doc, "params", rest)), { changed: [`params/${a.name}`] });
    }
    const next = withField(doc, "params", { ...params, [a.name]: a.value });
    const src = typeof a.value === "object" ? a.value.v : a.value;
    const errors = typeof src === "string" ? exprErrors(next, src, `params/${a.name}`, a.name) : [];
    return errors.length > 0
      ? failed(errors)
      : done(withDoc(ctx, next), { changed: [`params/${a.name}`] });
  },
};

const Record_ = z.record(z.string(), z.unknown());

const AddCost = z.strictObject({
  cost: Record_.describe(
    'a cost line without its id: { "label", "kind", "low_minor", "likely_minor", "high_minor", … } (§4.11)',
  ),
});

export const addCost: CommandDef<z.infer<typeof AddCost>> = {
  name: "addCost",
  group: "Params and costs",
  summary: "add a cost line that is not a part (machining, labour, freight, …); its id is K<n>",
  args: AddCost,
  apply: (ctx, a) => create(ctx, "K", withoutId(a.cost)),
};

export const setCost: CommandDef<z.infer<typeof SetArgs>> = {
  name: "setCost",
  group: "Params and costs",
  summary: "change a cost line",
  args: SetArgs,
  apply: (ctx, a) => patch(ctx, a.id, a.set, "costs"),
};

const SetPriceBands = z.strictObject({
  bands: z.array(Record_).describe("the whole list of price bands (§4.11); [] removes them"),
});

export const setPriceBands: CommandDef<z.infer<typeof SetPriceBands>> = {
  name: "setPriceBands",
  group: "Params and costs",
  summary: "replace the project's price bands",
  args: SetPriceBands,
  apply(ctx, a) {
    const errors = schemaErrors(fieldSchema("price_bands"), a.bands, undefined, "price_bands");
    if (errors.length > 0) return failed(errors);
    const doc = withField(ctx.state.doc, "price_bands", a.bands.length > 0 ? a.bands : undefined);
    return done(withDoc(ctx, doc), { changed: ["price_bands"] });
  },
};

const ChooseOffer = z.strictObject({
  item: ItemRef,
  offer: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("the SKU to order, bare or <catalog>:<sku>; null forgets the choice"),
  sale: z.enum(["cut", "stock"]).nullable().optional().describe("the cut-list mode (§5.3)"),
  kerf_mm: z.number().nonnegative().nullable().optional(),
  trim_mm: z.number().nonnegative().nullable().optional(),
});

export const chooseOffer: CommandDef<z.infer<typeof ChooseOffer>> = {
  name: "chooseOffer",
  group: "Params and costs",
  summary: "choose the offer, cut-list mode, kerf or trim for an item (§5.3, §5.4)",
  args: ChooseOffer,
  apply(ctx, a) {
    const doc = ctx.state.doc;
    if (!itemResolves(ctx, doc, a.item))
      return refuse("item", `no catalog item ${a.item}`, { refs: [a.item] });
    if (typeof a.offer === "string") {
      const offers = ctx
        .items()
        .offers(a.item)
        .map((o) => o.sku);
      const live = ctx.env.live?.offersOf(a.item).map((o) => `${o.catalog.id}:${o.sku}`) ?? [];
      const all = [...new Set([...offers, ...live])];
      const offer = a.offer;
      if (!all.some((s) => s === offer || s.endsWith(`:${offer}`))) {
        return refuse(
          "offer",
          `${a.item} has no offer "${a.offer}"; its offers: ${all.join(", ") || "none"}`,
          {
            refs: [a.item],
          },
        );
      }
    }
    const order = isObject(doc.order) ? doc.order : {};
    const { item, ...change } = a;
    const next = mergePatch(order[item], change);
    const rest = { ...order };
    if (isObject(next) && Object.keys(next).length > 0) rest[item] = next;
    else delete rest[item];
    const errors = isObject(next)
      ? schemaErrors(OrderChoice, next, undefined, `order/${item}`)
      : [];
    if (errors.length > 0) return failed(errors);
    const out = withField(doc, "order", Object.keys(rest).length > 0 ? rest : undefined);
    return done(withDoc(ctx, out), { changed: [`order/${item}`] });
  },
};

function withoutId(r: Record<string, unknown>): Record<string, unknown> {
  const { id: _, ...rest } = r;
  return rest;
}

// ---------------------------------------------------------------------------------------------
// Organising: tags and labels on nodes, bars, runs, connections, parts and patterns

const TAGGABLE: Kind[] = ["nodes", "bars", "runs", "connections", "parts", "patterns"];

/** An entity as an object, so it can carry a tag or label; and back to its short form. */
function expand(id: string, v: unknown): Record<string, unknown> {
  if (Array.isArray(v)) return id.startsWith("r") ? { bars: v } : { at: v };
  return isObject(v) ? v : {};
}

function compact(id: string, v: Record<string, unknown>): unknown {
  const keys = Object.keys(v);
  if (id.startsWith("n") && keys.length === 1 && keys[0] === "at") return v.at;
  if (id.startsWith("r") && keys.length === 1 && keys[0] === "bars") return v.bars;
  return v;
}

const Tag = z
  .strictObject({
    ids: z.array(z.string()).min(1),
    add: z.array(z.string().min(1)).optional(),
    remove: z.array(z.string().min(1)).optional(),
  })
  .refine((a) => (a.add?.length ?? 0) + (a.remove?.length ?? 0) > 0, {
    message: "give add or remove",
  });

export const tag: CommandDef<z.infer<typeof Tag>> = {
  name: "tag",
  group: "Organising",
  summary: "add tags to entities, or remove them",
  args: Tag,
  apply(ctx, a) {
    let doc = ctx.state.doc;
    const changed: string[] = [];
    for (const id of a.ids) {
      const missing = requireEntity(doc, id, ...TAGGABLE);
      if (missing.length > 0) return failed(missing);
      const v = expand(id, getEntity(doc, id));
      const tags = (Array.isArray(v.tags) ? (v.tags as string[]) : []).filter(
        (t) => !a.remove?.includes(t),
      );
      for (const t of a.add ?? []) if (!tags.includes(t)) tags.push(t);
      const { tags: _, ...rest } = v;
      doc = withEntity(doc, id, compact(id, tags.length > 0 ? { ...rest, tags } : rest));
      const errors = checkEntity(ctx, doc, id);
      if (errors.length > 0) return failed(errors);
      changed.push(id);
    }
    return done(withDoc(ctx, doc), { changed });
  },
};

const Label = z.strictObject({
  id: z.string(),
  label: z.string().min(1).nullable().describe("null removes it"),
});

export const label: CommandDef<z.infer<typeof Label>> = {
  name: "label",
  group: "Organising",
  summary: "give an entity a label, or remove it",
  args: Label,
  apply(ctx, a) {
    const missing = requireEntity(ctx.state.doc, a.id, ...TAGGABLE);
    if (missing.length > 0) return failed(missing);
    const { label: _, ...rest } = expand(a.id, getEntity(ctx.state.doc, a.id));
    return replace(ctx, a.id, compact(a.id, a.label === null ? rest : { ...rest, label: a.label }));
  },
};

// ---------------------------------------------------------------------------------------------
// Records: variants, checks, open items, decisions

function variantsOf(doc: Record<string, unknown>): {
  all: Record<string, unknown>;
  list: Record<string, unknown>;
} {
  const all = isObject(doc.variants) ? doc.variants : {};
  return { all, list: isObject(all.list) ? all.list : {} };
}

/**
 * A variant's own problems (§4.10): the items it swaps, on both sides, resolve, and its params'
 * expressions read params of the document or of the variant itself.
 */
function variantErrors(
  ctx: Parameters<CommandDef["apply"]>[0],
  name: string,
  v: Variant,
): CommandError[] {
  const doc = ctx.state.doc;
  const errors: CommandError[] = [];
  const at = `variants/list/${name}`;
  for (const [from, to] of Object.entries(v.swap ?? {})) {
    for (const ref of [from, to]) {
      if (itemResolves(ctx, doc, ref)) continue;
      errors.push({
        code: "item",
        field: `${at}/swap`,
        refs: [ref],
        message: `${at}/swap: no catalog item ${ref} (in the lock, or the project's catalogs)`,
      });
    }
  }
  const params = { ...(isObject(doc.params) ? doc.params : {}), ...(v.params ?? {}) };
  const scope = { ...doc, params };
  for (const [p, value] of Object.entries(v.params ?? {})) {
    const src = typeof value === "object" ? value.v : value;
    if (typeof src === "string") errors.push(...exprErrors(scope, src, p, `${at}/params/${p}`));
  }
  return errors;
}

function writeVariants(
  ctx: Parameters<CommandDef["apply"]>[0],
  all: Record<string, unknown>,
  name: string,
) {
  const errors = schemaErrors(fieldSchema("variants"), all, undefined, "variants");
  if (errors.length > 0) return failed(errors);
  const v = (all.list as Record<string, Variant>)[name] as Variant;
  const problems = variantErrors(ctx, name, v);
  if (problems.length > 0) return failed(problems);
  return done(withDoc(ctx, withField(ctx.state.doc, "variants", all)), {
    changed: [`variants/${name}`],
  });
}

const AddVariant = z.strictObject({
  name: VariantName,
  variant: Variant.describe(
    'the params it overrides and the items it swaps: { "params": { "H": "1100" }, "swap": { … } } (§4.10)',
  ),
  default: z.boolean().optional().describe("derive this variant when none is named"),
});

export const addVariant: CommandDef<z.infer<typeof AddVariant>> = {
  name: "addVariant",
  group: "Records",
  summary: "add a variant: params it overrides and items it swaps",
  args: AddVariant,
  apply(ctx, a) {
    const { all, list } = variantsOf(ctx.state.doc);
    if (Object.hasOwn(list, a.name)) return refuse("exists", `variant ${a.name} already exists`);
    return writeVariants(
      ctx,
      { ...all, ...(a.default ? { default: a.name } : {}), list: { ...list, [a.name]: a.variant } },
      a.name,
    );
  },
};

const SetVariant = z.strictObject({
  name: VariantName,
  set: Record_.optional().describe("a merge patch of the variant"),
  default: z.literal(true).optional().describe("make it the default variant"),
});

export const setVariant: CommandDef<z.infer<typeof SetVariant>> = {
  name: "setVariant",
  group: "Records",
  summary: "change a variant, or make it the default",
  args: SetVariant,
  apply(ctx, a) {
    const { all, list } = variantsOf(ctx.state.doc);
    if (!Object.hasOwn(list, a.name)) return refuse("missing", `there is no variant ${a.name}`);
    const v = a.set ? mergePatch(list[a.name], a.set) : list[a.name];
    return writeVariants(
      ctx,
      { ...all, ...(a.default ? { default: a.name } : {}), list: { ...list, [a.name]: v } },
      a.name,
    );
  },
};

const AddCheck = z.strictObject({
  check: Record_.describe(
    '{ "value", "op", "limit", "text", "severity" } or { "expr", "text" } (§4.9)',
  ),
});

export const addCheck: CommandDef<z.infer<typeof AddCheck>> = {
  name: "addCheck",
  group: "Records",
  summary: "add a project check, with its margin (§4.9); its id is C<n>",
  args: AddCheck,
  apply: (ctx, a) => create(ctx, "C", withoutId(a.check)),
};

const AddOpen = z.strictObject({
  open: Record_.describe(
    '{ "text", "blocks": "order" | null, "scope": [ids or "supplier:<id>"] } (§4.12)',
  ),
});

export const addOpen: CommandDef<z.infer<typeof AddOpen>> = {
  name: "addOpen",
  group: "Records",
  summary: "record an open item, which may block the order; its id is O<n>",
  args: AddOpen,
  apply: (ctx, a) => create(ctx, "O", withoutId(a.open)),
};

const ResolveOpen = z.strictObject({
  id: z.string().regex(/^O\d+$/),
  text: z.string().min(1).optional().describe("what was decided; defaults to the open item's text"),
  why: z.string().min(1).optional(),
});

export const resolveOpen: CommandDef<z.infer<typeof ResolveOpen>> = {
  name: "resolveOpen",
  group: "Records",
  summary:
    "close an open item: it leaves the list and a dated decision records how it was resolved",
  args: ResolveOpen,
  apply(ctx, a) {
    const missing = requireEntity(ctx.state.doc, a.id, "open");
    if (missing.length > 0) return failed(missing);
    const open = getEntity(ctx.state.doc, a.id) as Record<string, unknown>;
    const { id, doc } = nextId(withoutEntity(ctx.state.doc, a.id), "D");
    const decision = {
      date: ctx.env.today,
      text: a.text ?? `resolved: ${typeof open.text === "string" ? open.text : a.id}`,
      ...(a.why ? { why: a.why } : {}),
      resolves: a.id,
    };
    const next = withEntity(doc, id, decision);
    const errors = checkEntity(ctx, next, id);
    return errors.length > 0
      ? failed(errors)
      : done(withDoc(ctx, next), { created: [id], removed: [a.id] });
  },
};

const AddDecision = z.strictObject({
  text: z.string().min(1),
  why: z.string().min(1).optional(),
  date: z.iso.date().optional().describe("defaults to today"),
});

export const addDecision: CommandDef<z.infer<typeof AddDecision>> = {
  name: "addDecision",
  group: "Records",
  summary: "record a decision with its date and reason (§4.12); its id is D<n>",
  args: AddDecision,
  apply: (ctx, a) =>
    create(ctx, "D", {
      date: a.date ?? ctx.env.today,
      text: a.text,
      ...(a.why ? { why: a.why } : {}),
    }),
};

// ---------------------------------------------------------------------------------------------
// Views

const SaveView = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  view: Record_.nullable().describe('{ "pos": [x, y, z], "target": [x, y, z] }; null removes it'),
});

export const saveView: CommandDef<z.infer<typeof SaveView>> = {
  name: "saveView",
  group: "Views",
  summary: "save a named camera view (snapshots render named views, §7.3)",
  args: SaveView,
  apply(ctx, a) {
    const doc = ctx.state.doc;
    const views = { ...(isObject(doc.views) ? doc.views : {}) };
    if (a.view === null) {
      if (!Object.hasOwn(views, a.name)) return refuse("missing", `there is no view ${a.name}`);
      delete views[a.name];
    } else views[a.name] = a.view;
    const errors = schemaErrors(fieldSchema("views"), views, undefined, "views");
    if (errors.length > 0) return failed(errors);
    const next = withField(doc, "views", Object.keys(views).length > 0 ? views : undefined);
    return done(withDoc(ctx, next), { changed: [`views/${a.name}`] });
  },
};

// ---------------------------------------------------------------------------------------------
// Lock

const LockUpdate = z.strictObject({
  items: z.array(ItemRef).min(1).optional().describe("refresh only these items; all when absent"),
});

export const lockUpdate: CommandDef<z.infer<typeof LockUpdate>> = {
  name: "lockUpdate",
  group: "Lock",
  summary: "refresh the lock from the live catalogs, as one step of the log (§4.13)",
  args: LockUpdate,
  apply(ctx, a) {
    if (!ctx.env.live)
      return refuse("catalogs", "the live catalogs are not open, so the lock cannot be refreshed");
    const r = pinLock(
      ctx.env.live,
      documentRefs(ctx.state.doc),
      ctx.state.lock,
      a.items ? { kind: "refresh", only: a.items } : { kind: "refresh" },
    );
    const diff = diffLocks(ctx.state.lock, r.lock);
    return done(
      { doc: ctx.state.doc, lock: r.lock },
      {},
      { ...diff, kept: r.kept, missing: r.missing },
    );
  },
};
