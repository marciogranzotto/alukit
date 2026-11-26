import type { z } from "zod";
import { ExprError, freeNames, parseExpr } from "../expr.ts";
import { itemRefSource } from "../lock/refs.ts";
import { type PathKey, stringsWithPattern, visitExprs } from "../schema-walk.ts";
import {
  entityJsonSchema,
  entitySchema,
  getEntity,
  hasEntity,
  isObject,
  KIND_NOUN,
  type Kind,
  kindOf,
  PROJECT_ITEM,
} from "./doc.ts";
import { outgoing } from "./refs.ts";
import type { CommandContext, CommandError, RawDoc } from "./types.ts";

/**
 * What a command checks before it accepts an entity it created or changed: the entity's schema,
 * that what it names exists, that its expressions parse and read known params, and that its
 * catalog items resolve (in the lock, or the live catalogs when they are open). Problems that
 * need the whole model (a cycle, a butt that misses its face) are derive's diagnostics, which
 * the answer reports; they do not refuse a command (§5.1: a half-edited document still draws).
 */

const pathText = (p: readonly (string | number | symbol)[]) => p.map(String).join("/");

export function schemaErrors(
  schema: z.ZodType,
  value: unknown,
  entity?: string,
  prefix = "",
): CommandError[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const field = [prefix, pathText(i.path)].filter((x) => x !== "").join("/");
    const keys =
      i.code === "unrecognized_keys"
        ? `unknown field ${i.keys.map((k) => `"${k}"`).join(", ")}`
        : i.message;
    return {
      code: "schema",
      ...(entity ? { entity } : {}),
      ...(field ? { field } : {}),
      message: `${field ? `${field}: ` : ""}${keys}`,
    };
  });
}

/** An expression's own problems: its syntax, and names that are not params. */
export function exprErrors(
  doc: RawDoc,
  src: string,
  entity: string,
  field: string,
): CommandError[] {
  try {
    const ast = parseExpr(src);
    const params = isObject(doc.params) ? doc.params : {};
    const unknown = [...freeNames(ast)].filter((n) => !Object.hasOwn(params, n)).sort();
    return unknown.map((n) => ({
      code: "expr",
      entity,
      field,
      message: `${field}: "${n}" is not a param`,
    }));
  } catch (e) {
    if (!(e instanceof ExprError)) throw e;
    return [{ code: "expr", entity, field, message: `${field}: ${e.message}` }];
  }
}

/** Whether a catalog item resolves, in the lock or in the live catalogs. */
export function itemResolves(ctx: CommandContext, doc: RawDoc, ref: string): boolean {
  if (ref.startsWith(PROJECT_ITEM)) return hasEntity(doc, ref);
  if (ctx.items().item(ref).ok) return true;
  return ctx.env.live?.get("item", ref, "") !== undefined;
}

/** Whether a catalog material resolves, in the lock or in the live catalogs. */
function materialResolves(ctx: CommandContext, ref: string): boolean {
  if (Object.hasOwn(ctx.state.lock.materials, ref)) return true;
  return ctx.env.live?.get("material", ref, "") !== undefined;
}

/** Every problem of one entity, as the document now stands. */
export function checkEntity(ctx: CommandContext, doc: RawDoc, id: string): CommandError[] {
  const kind = kindOf(id) as Kind;
  const value = getEntity(doc, id);
  if (value === undefined) return [];
  const errors = schemaErrors(entitySchema(kind), value, id);
  if (errors.length > 0) return errors;

  for (const r of outgoing(doc, id)) {
    if (kindOf(r.to) === undefined || !hasEntity(doc, r.to)) {
      const what = kindOf(r.to);
      errors.push({
        code: "ref",
        entity: id,
        field: r.field,
        refs: [r.to],
        message: `${r.field}: there is no ${what ? KIND_NOUN[what] : "entity"} ${r.to}`,
      });
    }
  }

  const visit = (src: string, path: readonly PathKey[]) => {
    errors.push(...exprErrors(doc, src, id, pathText(path)));
  };
  if (kind === "checks") {
    for (const k of ["value", "limit", "expr"]) {
      const v = (value as Record<string, unknown>)[k];
      if (typeof v === "string") visit(v, [k]);
    }
  } else visitExprs(value, entityJsonSchema(kind), visit);

  if (kind === "items") {
    // A project item's material is a catalog's (§4.8): pinned in the lock, or in the live
    // catalogs, from which the next save pins it.
    const material = isObject(value) ? value.material : undefined;
    if (typeof material === "string" && !materialResolves(ctx, material)) {
      errors.push({
        code: "item",
        entity: id,
        field: "material",
        refs: [material],
        message: `material: no catalog material ${material} (in the lock, or the project's catalogs)`,
      });
    }
  } else {
    stringsWithPattern(value, entityJsonSchema(kind), itemRefSource(), (ref, path) => {
      if (ref.startsWith(PROJECT_ITEM) || itemResolves(ctx, doc, ref)) return;
      errors.push({
        code: "item",
        entity: id,
        field: pathText(path),
        refs: [ref],
        message: `${pathText(path)}: no catalog item ${ref} (in the lock, or the project's catalogs)`,
      });
    });
  }
  return errors;
}
