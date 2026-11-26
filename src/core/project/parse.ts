import type { z } from "zod";
import { type Diagnostic, Diagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import {
  type Bar,
  type Connection,
  type Defaults,
  ENTITY_MAPS,
  type Node,
  type OrderChoice,
  type Param,
  type Part,
  type Pattern,
  PROJECT_SCHEMA,
  PROJECT_SHAPE,
  type Run,
} from "./schema.ts";

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
  order: Record<string, OrderChoice>;
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
    order: {},
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
      default:
        doc.rest[key] = r.data;
    }
  }
  return { doc, diagnostics: d.sorted() };
}
