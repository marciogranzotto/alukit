import { z } from "zod";
import { sortedJson } from "../lock/pin.ts";
import { isPath } from "../project/paths.ts";
import { PROJECT_SHAPE } from "../project/schema.ts";
import { fieldSchema, isObject, mergePatch, withField } from "./doc.ts";
import { failed, withDoc } from "./helpers.ts";
import { type CommandDef, type CommandError, done, type RawDoc } from "./types.ts";
import { itemResolves, schemaErrors } from "./validate.ts";
import { fieldWords } from "./words.ts";

/**
 * The project's own settings (design §4.2, §6; BE-1): its name, the catalogs it names, its
 * currency, price basis and exchange rates, its defaults and its order rules, changed by one
 * command, `setProject`, as one step. Its arguments are an RFC 7396 merge patch over those
 * fields: an object merges into what is there, `null` removes, and a list (the catalogs)
 * replaces the whole list. Each field it leaves is validated by the document's schema, as a
 * command validates what it changes (§6).
 *
 * A catalog it adds is a built-in id, or a folder that resolves inside the project's folder
 * (§7.2's confinement of the paths a request names): a catalog elsewhere stays a hand edit of
 * `alukit.json`. The catalogs it keeps are not judged again.
 */

/** The fields `setProject` changes, in the schema's order (§4.2). */
export const PROJECT_FIELDS = [
  "name",
  "catalogs",
  "currency",
  "price_basis",
  "fx",
  "defaults",
  "order_rules",
] as const;
type Field = (typeof PROJECT_FIELDS)[number];

/**
 * The merge patch (RFC 7396) of a schema: an object's fields each optional and nullable, its
 * nested objects and maps patches in turn; anything else is replaced whole.
 */
function patchOf(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional) return patchOf(schema.unwrap() as z.ZodType);
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    return z.strictObject(
      Object.fromEntries(
        Object.entries(shape).map(([k, v]) => [
          k,
          withDescription(patchOf(v).nullable(), v).optional(),
        ]),
      ),
    );
  }
  if (schema instanceof z.ZodRecord) {
    const value = patchOf(schema.valueType as z.ZodType).nullable();
    // An enum-keyed map (the order rules) is partial: each key is optional, as in the document.
    return (schema.def as { partial?: boolean }).partial === true
      ? z.partialRecord(schema.keyType, value)
      : z.record(schema.keyType, value);
  }
  return schema;
}

/** `to` with `from`'s description, when it has one: the reference documents the field. */
function withDescription(to: z.ZodType, from: z.ZodType): z.ZodType {
  const inner = from instanceof z.ZodOptional ? (from.unwrap() as z.ZodType) : from;
  const d = from.description ?? inner.description;
  return d ? to.describe(d) : to;
}

const DESCRIBE: Readonly<Record<Field, string>> = {
  name: "the project's name",
  catalogs:
    "the whole list, in merge order (§3.1): built-in ids, or folders inside the project (./parts)",
  currency: "the project's currency, a 3-letter code (BRL)",
  price_basis: "regular, sale or lowest (§4.11)",
  fx: "exchange rates by currency (§4.11): { EUR: 6.2 }; null removes one",
  defaults:
    "bar { item, opt }, butt { connector, qty, overhang_mm }, cutting { kerf_mm, trim_mm }; null removes",
  order_rules: "an order rule's action, block, warn or off (§5.5); null restores its default",
};

const SetProject = z
  .strictObject(
    Object.fromEntries(
      PROJECT_FIELDS.map((k) => [
        k,
        patchOf(PROJECT_SHAPE[k] as z.ZodType)
          .nullable()
          .optional()
          .describe(DESCRIBE[k]),
      ]),
    ) as Record<Field, z.ZodOptional<z.ZodNullable<z.ZodType>>>,
  )
  .refine((a) => Object.keys(a).length > 0, { message: "give a field to change" });
type SetProjectArgs = Partial<Record<Field, unknown>>;

/** Why a catalog the document newly names may not be added, or undefined. */
function catalogProblem(name: string, ctx: Parameters<CommandDef["apply"]>[0]): string | undefined {
  const places = ctx.env.catalogs;
  if (isPath(name)) {
    return places
      ? places.folder(name)
      : `${name}: a folder can be named only where the project's folder is known (the server or the CLI)`;
  }
  if (places && !places.builtin.includes(name)) {
    return `there is no built-in catalog ${name} (built in: ${places.builtin.join(", ")})`;
  }
  return undefined;
}

/** Every catalog item a field names (`defaults.bar.item`, `defaults.butt.connector`). */
function itemRefs(doc: RawDoc): { field: string; ref: string }[] {
  const d = isObject(doc.defaults) ? doc.defaults : {};
  const out: { field: string; ref: string }[] = [];
  const at = (group: string, key: string) => {
    const g = d[group];
    const ref = isObject(g) ? g[key] : undefined;
    if (typeof ref === "string") out.push({ field: `defaults/${group}/${key}`, ref });
  };
  at("bar", "item");
  at("butt", "connector");
  return out;
}

export const setProject: CommandDef<SetProjectArgs> = {
  name: "setProject",
  group: "Project",
  summary:
    "change the project's name, catalogs, currency, price basis, fx, defaults or order rules: a merge patch, one step",
  args: SetProject as unknown as z.ZodType<SetProjectArgs>,
  describe(a) {
    const fields = Object.keys(a);
    return `change the project's ${fieldWords(fields)}`;
  },
  catalogsAfter(a) {
    if (!Object.hasOwn(a, "catalogs")) return undefined;
    return Array.isArray(a.catalogs) ? (a.catalogs as string[]) : [];
  },
  apply(ctx, a) {
    const was = ctx.state.doc;
    let doc = was;
    const changed: string[] = [];
    const errors: CommandError[] = [];
    for (const k of PROJECT_FIELDS) {
      if (!Object.hasOwn(a, k)) continue;
      const patch = a[k];
      const next = patch === null ? undefined : mergePatch(was[k], patch);
      if (next !== undefined) errors.push(...schemaErrors(fieldSchema(k), next, undefined, k));
      doc = withField(doc, k, next);
      if (sortedJson(next ?? null) !== sortedJson(was[k] ?? null)) changed.push(k);
    }
    if (errors.length > 0) return failed(errors);

    const kept = new Set(Array.isArray(was.catalogs) ? was.catalogs : []);
    const added = (Array.isArray(doc.catalogs) ? (doc.catalogs as string[]) : []).filter(
      (c) => !kept.has(c),
    );
    for (const c of added) {
      const why = catalogProblem(c, ctx);
      if (why) errors.push({ code: "catalog", field: "catalogs", refs: [c], message: why });
    }
    // The defaults' items, newly named, resolve: in the lock, or the catalogs now named.
    const before = new Set(itemRefs(was).map((r) => `${r.field}\u0000${r.ref}`));
    for (const r of itemRefs(doc)) {
      if (before.has(`${r.field}\u0000${r.ref}`) || itemResolves(ctx, doc, r.ref)) continue;
      errors.push({
        code: "item",
        field: r.field,
        refs: [r.ref],
        message: `${r.field}: no catalog item ${r.ref} (in the lock, or the project's catalogs)`,
      });
    }
    if (errors.length > 0) return failed(errors);
    return done(withDoc(ctx, doc), { changed });
  },
};
