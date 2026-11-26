import type { z } from "zod";
import { type Diagnostic, Diagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import {
  type Bar,
  type Connection,
  type CostLine,
  type Defaults,
  ENTITY_LISTS,
  ENTITY_MAPS,
  type Fx,
  type Node,
  type OpenItem,
  type OrderChoice,
  type OrderRule,
  type Param,
  type Part,
  type Pattern,
  PROJECT_SCHEMA,
  PROJECT_SHAPE,
  type PriceBand,
  ProjectItem,
  ProjectItemId,
  type RuleAction,
  type Run,
  type Variants,
} from "./schema.ts";

/** How the document names a project item (§4.8). */
export const PROJECT_ITEM = "project:";

/**
 * Reading a project document leniently (design §5.1: a half-edited document still draws). Every
 * top-level field and every entity is validated on its own: a bad one becomes a diagnostic and is
 * dropped, and everything else is kept. Entity maps come back sorted by id order (§2).
 */

/** A parsed document: every top-level field optional, entity maps in id order. */
export interface Doc {
  schema?: string;
  name?: string;
  catalogs: string[];
  currency?: string;
  price_basis: "regular" | "sale" | "lowest";
  defaults: Defaults;
  params: Record<string, Param>;
  nodes: Record<string, Node>;
  bars: Record<string, Bar>;
  runs: Record<string, Run>;
  connections: Record<string, Connection>;
  parts: Record<string, Part>;
  patterns: Record<string, Pattern>;
  /** Project items by their own id (`plate-a` for `project:plate-a`), each validated alone (§4.8). */
  items: Record<string, ProjectItem>;
  order: Record<string, OrderChoice>;
  /** Exchange rates by currency (§4.11). */
  fx: z.infer<typeof Fx>;
  /** Cost lines, price bands and open items: each entry validated on its own (§4.11, §4.12). */
  costs: CostLine[];
  price_bands: PriceBand[];
  open: OpenItem[];
  /** The project's switches for the order rules (§5.5); a rule it leaves out keeps its default. */
  order_rules: Partial<Record<OrderRule, RuleAction>>;
  /** The variants (§4.10), as written; derive has applied one already (`Derived.variant`). */
  variants?: Variants;
  /** Every other top-level field, as validated. */
  rest: Record<string, unknown>;
}

function issueText(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") {
    return `unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
  }
  return issue.message;
}

function pathText(path: readonly PropertyKey[]): string {
  let out = "";
  for (const p of path)
    out += typeof p === "number" ? `[${p}]` : out === "" ? String(p) : `/${String(p)}`;
  return out;
}

function report(
  d: Diagnostics,
  error: z.ZodError,
  entity: string | undefined,
  prefix: readonly PropertyKey[],
): void {
  for (const issue of error.issues) {
    const field = pathText([...prefix, ...issue.path]);
    d.error("schema", entity, `${field ? `${field}: ` : ""}${issueText(issue)}`, {
      ...(field ? { field } : {}),
    });
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export interface ParseResult {
  doc: Doc;
  diagnostics: Diagnostic[];
}

export function parseProject(raw: unknown): ParseResult {
  const d = new Diagnostics();
  const doc: Doc = {
    catalogs: [],
    price_basis: "regular",
    defaults: {},
    params: {},
    nodes: {},
    bars: {},
    runs: {},
    connections: {},
    parts: {},
    patterns: {},
    items: {},
    order: {},
    fx: {},
    costs: [],
    price_bands: [],
    open: [],
    order_rules: {},
    rest: {},
  };
  if (!isPlainObject(raw)) {
    d.error("schema", undefined, "the document is not a JSON object");
    return { doc, diagnostics: d.sorted() };
  }
  if (raw.schema !== PROJECT_SCHEMA) {
    d.error(
      "schema",
      undefined,
      `schema must be "${PROJECT_SCHEMA}", not ${JSON.stringify(raw.schema)}`,
      { field: "schema" },
    );
  } else doc.schema = PROJECT_SCHEMA;

  for (const key of Object.keys(raw).sort()) {
    if (!Object.hasOwn(PROJECT_SHAPE, key)) {
      d.error("schema", undefined, `unknown top-level field "${key}"`, { field: key });
    }
  }

  for (const [key, schema] of Object.entries(PROJECT_SHAPE)) {
    if (key === "schema" || !Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    const entityMap = ENTITY_MAPS[key as keyof typeof ENTITY_MAPS];
    if (entityMap) {
      if (!isPlainObject(value)) {
        d.error("schema", undefined, `${key} must be an object of entities by id`, { field: key });
        continue;
      }
      const out: Record<string, unknown> = {};
      for (const id of Object.keys(value).sort(compareIds)) {
        if (!entityMap.id.safeParse(id).success) {
          d.error("schema", id, `"${id}" is not a valid id in ${key}`, { field: key });
          continue;
        }
        const r = (entityMap.schema as z.ZodType).safeParse(value[id]);
        if (r.success) out[id] = r.data;
        else report(d, r.error, id, []);
      }
      (doc as unknown as Record<string, unknown>)[key] = out;
      continue;
    }
    if (key === "items") {
      // Project items, each on its own, named as the document refers to them: project:<id>.
      if (!isPlainObject(value)) {
        d.error("schema", undefined, "items must be an object of project items by id", {
          field: key,
        });
        continue;
      }
      for (const id of Object.keys(value).sort(compareIds)) {
        const entity = `${PROJECT_ITEM}${id}`;
        if (!ProjectItemId.safeParse(id).success) {
          d.error("schema", entity, `"${id}" is not a valid project item id`, { field: key });
          continue;
        }
        const r = ProjectItem.safeParse(value[id]);
        if (r.success) doc.items[id] = r.data;
        else report(d, r.error, entity, []);
      }
      continue;
    }
    const entityList = ENTITY_LISTS[key as keyof typeof ENTITY_LISTS];
    if (entityList) {
      if (!Array.isArray(value)) {
        d.error("schema", undefined, `${key} must be a list`, { field: key });
        continue;
      }
      const out: unknown[] = [];
      const seen = new Set<string>();
      value.forEach((entry, i) => {
        const idField = entityList.id;
        const id =
          idField && isPlainObject(entry) && typeof entry[idField] === "string"
            ? (entry[idField] as string)
            : undefined;
        const r = (entityList.schema as z.ZodType).safeParse(entry);
        if (!r.success) {
          report(d, r.error, id, [key, i]);
          return;
        }
        if (id !== undefined && seen.has(id)) {
          d.error("schema", id, `${key}[${i}]: ${id} is listed twice`, { field: `${key}[${i}]` });
          return;
        }
        if (id !== undefined) seen.add(id);
        out.push(r.data);
      });
      (doc as unknown as Record<string, unknown>)[key] = out;
      continue;
    }
    const r = (schema as z.ZodType).safeParse(value);
    if (!r.success) {
      report(d, r.error, undefined, [key]);
      continue;
    }
    switch (key) {
      case "name":
      case "currency":
        doc[key] = r.data as string;
        break;
      case "catalogs":
        doc.catalogs = r.data as string[];
        break;
      case "price_basis":
        doc.price_basis = r.data as Doc["price_basis"];
        break;
      case "defaults":
        doc.defaults = r.data as Defaults;
        break;
      case "params":
        doc.params = r.data as Record<string, Param>;
        break;
      case "order":
        doc.order = r.data as Doc["order"];
        break;
      case "fx":
        doc.fx = r.data as Doc["fx"];
        break;
      case "order_rules":
        doc.order_rules = r.data as Doc["order_rules"];
        break;
      case "variants":
        doc.variants = r.data as Variants;
        break;
      default:
        doc.rest[key] = r.data;
    }
  }
  return { doc, diagnostics: d.sorted() };
}
