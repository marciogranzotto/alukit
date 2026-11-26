import { z } from "zod";
import { compareIds } from "../ids.ts";
import { projectJsonSchema } from "../project/canonical.ts";
import { ENTITY_MAPS, PROJECT_SHAPE } from "../project/schema.ts";
import type { JsonSchema } from "../schema-walk.ts";
import type { RawDoc } from "./types.ts";

/**
 * Reading and writing entities in a raw document without changing the input (design §6:
 * documents are immutable and share structure). Ids follow §2: a letter prefix and a number; the
 * document's `ids` map holds the last number used per prefix, so an id is never reused, even
 * after a delete (review m1).
 */

/** Maps of entities keyed by id (§4.2). */
export const MAP_KINDS = ["nodes", "bars", "runs", "connections", "parts", "patterns"] as const;
/** Lists of records that carry their own `id` (§4.11, §4.9, §4.12). */
export const LIST_KINDS = ["costs", "checks", "open", "decisions"] as const;

export type MapKind = (typeof MAP_KINDS)[number];
export type ListKind = (typeof LIST_KINDS)[number];
/** `items` holds project items, referred to as `project:<id>` (§4.8). */
export type Kind = MapKind | ListKind | "items";

export const PREFIX_KIND: Readonly<Record<string, MapKind | ListKind>> = {
  n: "nodes",
  b: "bars",
  r: "runs",
  c: "connections",
  p: "parts",
  pt: "patterns",
  K: "costs",
  C: "checks",
  O: "open",
  D: "decisions",
};

export const KIND_PREFIX = Object.fromEntries(
  Object.entries(PREFIX_KIND).map(([p, k]) => [k, p]),
) as Record<MapKind | ListKind, string>;

/** The kind name a person reads: "bar", "connection". */
export const KIND_NOUN: Readonly<Record<Kind, string>> = {
  nodes: "node",
  bars: "bar",
  runs: "run",
  connections: "connection",
  parts: "part",
  patterns: "pattern",
  costs: "cost line",
  checks: "check",
  open: "open item",
  decisions: "decision",
  items: "project item",
};

export const PROJECT_ITEM = "project:";

export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function splitId(id: string): { prefix: string; n: number } | undefined {
  const m = /^([A-Za-z]+)(\d+)$/.exec(id);
  return m ? { prefix: m[1] as string, n: Number(m[2]) } : undefined;
}

export function kindOf(id: string): Kind | undefined {
  if (id.startsWith(PROJECT_ITEM)) return "items";
  const s = splitId(id);
  return s ? PREFIX_KIND[s.prefix] : undefined;
}

function mapOf(doc: RawDoc, key: string): Record<string, unknown> {
  const m = doc[key];
  return isObject(m) ? m : {};
}

function listOf(doc: RawDoc, key: string): unknown[] {
  const l = doc[key];
  return Array.isArray(l) ? l : [];
}

/** An entity's value, or undefined when the document has none by that id. */
export function getEntity(doc: RawDoc, id: string): unknown {
  const kind = kindOf(id);
  if (kind === undefined) return undefined;
  if (kind === "items") {
    const m = mapOf(doc, "items");
    const local = id.slice(PROJECT_ITEM.length);
    return Object.hasOwn(m, local) ? m[local] : undefined;
  }
  if ((LIST_KINDS as readonly string[]).includes(kind)) {
    return listOf(doc, kind).find((r) => isObject(r) && r.id === id);
  }
  const m = mapOf(doc, kind);
  return Object.hasOwn(m, id) ? m[id] : undefined;
}

export function hasEntity(doc: RawDoc, id: string): boolean {
  return getEntity(doc, id) !== undefined;
}

/** The document with a top-level field set, or removed when `value` is undefined. */
export function withField(doc: RawDoc, key: string, value: unknown): RawDoc {
  const out: Record<string, unknown> = { ...doc };
  if (value === undefined) delete out[key];
  else out[key] = value;
  return out;
}

/** The document with an entity created or replaced. */
export function withEntity(doc: RawDoc, id: string, value: unknown): RawDoc {
  const kind = kindOf(id) as Kind;
  if (kind === "items") {
    return withField(doc, "items", {
      ...mapOf(doc, "items"),
      [id.slice(PROJECT_ITEM.length)]: value,
    });
  }
  if ((LIST_KINDS as readonly string[]).includes(kind)) {
    const list = listOf(doc, kind);
    const i = list.findIndex((r) => isObject(r) && r.id === id);
    const rec = isObject(value) ? { id, ...value } : value;
    return withField(doc, kind, i < 0 ? [...list, rec] : list.map((r, j) => (j === i ? rec : r)));
  }
  return withField(doc, kind, { ...mapOf(doc, kind), [id]: value });
}

/**
 * The counter raised to a removed id's number, so it is never given again (§2: "ids are never
 * reused, even after a delete"). A hand-written document may have no counter for it yet.
 */
function retire(doc: RawDoc, id: string): RawDoc {
  const s = splitId(id);
  if (!s) return doc;
  const ids = isObject(doc.ids) ? doc.ids : {};
  const n = typeof ids[s.prefix] === "number" ? (ids[s.prefix] as number) : 0;
  return n >= s.n ? doc : withField(doc, "ids", { ...ids, [s.prefix]: s.n });
}

/** The document without an entity. An emptied map or list stays, empty. */
export function withoutEntity(doc0: RawDoc, id: string): RawDoc {
  const kind = kindOf(id);
  if (kind === undefined) return doc0;
  const doc = retire(doc0, id);
  if (kind === "items") {
    const m = { ...mapOf(doc, "items") };
    delete m[id.slice(PROJECT_ITEM.length)];
    return withField(doc, "items", m);
  }
  if ((LIST_KINDS as readonly string[]).includes(kind)) {
    return withField(
      doc,
      kind,
      listOf(doc, kind).filter((r) => !(isObject(r) && r.id === id)),
    );
  }
  const m = { ...mapOf(doc, kind) };
  delete m[id];
  return withField(doc, kind, m);
}

/** The ids of one kind, in id order. */
export function entityIds(doc: RawDoc, kind: Kind): string[] {
  if (kind === "items") return Object.keys(mapOf(doc, "items")).map((k) => `${PROJECT_ITEM}${k}`);
  if ((LIST_KINDS as readonly string[]).includes(kind)) {
    return listOf(doc, kind)
      .flatMap((r) => (isObject(r) && typeof r.id === "string" ? [r.id] : []))
      .sort(compareIds);
  }
  return Object.keys(mapOf(doc, kind)).sort(compareIds);
}

/** Every entity id of the document, in kind order then id order. */
export function allIds(doc: RawDoc): string[] {
  return [...MAP_KINDS, ...LIST_KINDS, "items" as const].flatMap((k) => entityIds(doc, k));
}

/**
 * The next id for a prefix (§2): one past the larger of the `ids` counter and the highest number
 * in use, so a hand-added entity or a stale counter never causes a clash. Returns the document
 * with its counter moved on.
 */
export function nextId(doc: RawDoc, prefix: string): { id: string; doc: RawDoc } {
  const kind = PREFIX_KIND[prefix] as MapKind | ListKind;
  const ids = isObject(doc.ids) ? doc.ids : {};
  let n = typeof ids[prefix] === "number" ? (ids[prefix] as number) : 0;
  for (const id of entityIds(doc, kind)) {
    const s = splitId(id);
    if (s && s.prefix === prefix && s.n > n) n = s.n;
  }
  const id = `${prefix}${n + 1}`;
  return { id, doc: withField(doc, "ids", { ...ids, [prefix]: n + 1 }) };
}

// ---------------------------------------------------------------------------------------------
// Schemas of one entity

function unwrap(s: z.ZodType): z.ZodType {
  return s instanceof z.ZodOptional ? (s.unwrap() as z.ZodType) : s;
}

/** The Zod schema of one entity of a kind. */
export function entitySchema(kind: Kind): z.ZodType {
  if ((MAP_KINDS as readonly string[]).includes(kind)) {
    return ENTITY_MAPS[kind as MapKind].schema as z.ZodType;
  }
  const field = unwrap(PROJECT_SHAPE[kind as keyof typeof PROJECT_SHAPE] as z.ZodType);
  if (field instanceof z.ZodArray) return field.element as z.ZodType;
  if (field instanceof z.ZodRecord) return field.valueType as z.ZodType;
  return field;
}

/** The JSON Schema of one entity of a kind, for walks over its expressions and references. */
export function entityJsonSchema(kind: Kind): JsonSchema {
  const prop = (projectJsonSchema().properties as Record<string, JsonSchema>)[kind] ?? {};
  const inner = (prop.items ?? prop.additionalProperties) as JsonSchema | undefined;
  return isObject(inner) ? inner : {};
}

/** The Zod schema of a top-level field (`params`, `views`). */
export function fieldSchema(key: keyof typeof PROJECT_SHAPE): z.ZodType {
  return unwrap(PROJECT_SHAPE[key] as z.ZodType);
}

/**
 * RFC 7396 merge patch: objects merge key by key, `null` deletes, anything else replaces. A `set`
 * argument of every `set…` command applies this way.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch;
  const out: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}
