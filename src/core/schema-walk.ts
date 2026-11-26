/**
 * Walking a JSON value beside its JSON Schema (design §7.4: the schemas are exported from Zod
 * with `io: "input"`). The canonical writer reads key order from it (§2), and the lock collects
 * item references from it (§4.13), so both follow the Zod schemas without restating them.
 *
 * Zod inlines its export (no `$defs` for these schemas), writes unions as `anyOf` or `oneOf`,
 * records as `propertyNames` plus `additionalProperties`, and tuples as `prefixItems`. A value
 * matches the first branch it fits; a value that fits none is walked with an empty schema, which
 * only sorts keys.
 */

export type JsonSchema = Readonly<Record<string, unknown>>;

const EMPTY: JsonSchema = {};

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function asSchema(x: unknown): JsonSchema {
  return isObject(x) ? x : EMPTY;
}

/** A union's branches, flattened (`anyOf` inside `oneOf` and so on); the schema itself otherwise. */
export function branches(schema: JsonSchema): JsonSchema[] {
  const alts = (schema.anyOf ?? schema.oneOf) as unknown[] | undefined;
  if (!Array.isArray(alts)) return [schema];
  return alts.flatMap((a) => branches(asSchema(a)));
}

function typeOf(x: unknown): string {
  if (x === null) return "null";
  if (Array.isArray(x)) return "array";
  if (typeof x === "number") return Number.isInteger(x) ? "integer" : "number";
  return typeof x;
}

function typeFits(schema: JsonSchema, value: unknown): boolean {
  const t = schema.type;
  if (t === undefined) return true;
  const actual = typeOf(value);
  const allowed = Array.isArray(t) ? (t as string[]) : [t as string];
  return allowed.some((a) => a === actual || (a === "number" && actual === "integer"));
}

const patternCache = new Map<string, RegExp>();
function pattern(src: string): RegExp {
  let re = patternCache.get(src);
  if (!re) {
    re = new RegExp(src);
    patternCache.set(src, re);
  }
  return re;
}

/** A shallow fit: type, const, enum, a string's pattern, an object's keys. Enough to pick a branch. */
export function fits(schema: JsonSchema, value: unknown): boolean {
  if (!typeFits(schema, value)) return false;
  if ("const" in schema && schema.const !== value) return false;
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) return false;
  if (typeof value === "string" && typeof schema.pattern === "string") {
    if (!pattern(schema.pattern).test(value)) return false;
  }
  if (Array.isArray(value)) {
    const prefix = schema.prefixItems;
    if (Array.isArray(prefix)) {
      if (schema.items === false && value.length > prefix.length) return false;
      if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    }
    return true;
  }
  if (isObject(value)) {
    const props = asSchema(schema.properties);
    const extra = schema.additionalProperties;
    for (const [k, v] of Object.entries(value)) {
      if (Object.hasOwn(props, k)) {
        const p = asSchema(props[k]);
        // A discriminator decides the branch: `{ "type": "butt" }` is not a miter.
        if ("const" in p && p.const !== v) return false;
        continue;
      }
      if (extra === false) return false;
    }
    for (const k of (schema.required as string[] | undefined) ?? []) {
      if (!Object.hasOwn(value, k)) return false;
    }
  }
  return true;
}

/**
 * The branch of `schema` that `value` fits. When none fits (a hand edit with an unknown or a
 * missing key), an object takes the branch of its type that declares most of its keys and
 * contradicts none of its discriminators, so its known keys still come in schema order; anything
 * else gets an empty schema.
 */
export function branchFor(schema: JsonSchema, value: unknown): JsonSchema {
  const all = branches(schema);
  for (const b of all) if (fits(b, value)) return b;
  if (!isObject(value)) return EMPTY;
  let best: JsonSchema = EMPTY;
  let score = 0;
  for (const b of all) {
    if (!typeFits(b, value)) continue;
    const props = asSchema(b.properties);
    let s = 0;
    let contradicts = false;
    for (const [k, v] of Object.entries(value)) {
      if (!Object.hasOwn(props, k)) continue;
      const p = asSchema(props[k]);
      if ("const" in p && p.const !== v) contradicts = true;
      s++;
    }
    if (!contradicts && s > score) {
      best = b;
      score = s;
    }
  }
  return best;
}

/** The schema of an object's key: a named property, or the record's value schema. */
export function propertySchema(objectSchema: JsonSchema, key: string): JsonSchema {
  const props = asSchema(objectSchema.properties);
  if (Object.hasOwn(props, key)) return asSchema(props[key]);
  return asSchema(objectSchema.additionalProperties);
}

/** The schema of an array's element `i`: a tuple's item, or the list's item schema. */
export function itemSchema(arraySchema: JsonSchema, i: number): JsonSchema {
  const prefix = arraySchema.prefixItems;
  if (Array.isArray(prefix) && i < prefix.length) return asSchema(prefix[i]);
  return asSchema(arraySchema.items);
}

/** The declared property names, in schema order. */
export function propertyOrder(objectSchema: JsonSchema): string[] {
  return Object.keys(asSchema(objectSchema.properties));
}

/** The schema of a record's keys, when the object is a record. */
export function keySchema(objectSchema: JsonSchema): JsonSchema | undefined {
  return isObject(objectSchema.propertyNames) ? objectSchema.propertyNames : undefined;
}

export type PathKey = string | number;

/**
 * True for an expression's schema (§4.9): a value that may be a number or a free string. Labels,
 * ids and names are strings only, or carry a pattern.
 */
export function isExprSchema(schema: JsonSchema): boolean {
  const bs = branches(schema);
  return (
    bs.some((b) => b.type === "number") &&
    bs.some((b) => b.type === "string" && b.pattern === undefined && b.enum === undefined)
  );
}

/** Visits every string in `value` that sits where its schema takes an expression. */
export function visitExprs(
  value: unknown,
  schema: JsonSchema,
  visit: (src: string, path: readonly PathKey[]) => void,
  path: PathKey[] = [],
): void {
  if (typeof value === "string") {
    if (isExprSchema(schema)) visit(value, path);
    return;
  }
  const b = branchFor(schema, value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      visitExprs(v, itemSchema(b, i), visit, [...path, i]);
    });
    return;
  }
  if (!isObject(value)) return;
  for (const [k, v] of Object.entries(value)) {
    visitExprs(v, propertySchema(b, k), visit, [...path, k]);
  }
}

/**
 * Visits every string in `value` whose schema carries the regular expression `source`, and
 * every record key whose key schema does. `visit` gets the string and its path.
 */
export function stringsWithPattern(
  value: unknown,
  schema: JsonSchema,
  source: string,
  visit: (s: string, path: readonly PathKey[]) => void,
  path: PathKey[] = [],
): void {
  const b = branchFor(schema, value);
  if (typeof value === "string") {
    if (b.pattern === source) visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      stringsWithPattern(v, itemSchema(b, i), source, visit, [...path, i]);
    });
    return;
  }
  if (!isObject(value)) return;
  const ks = keySchema(b);
  for (const [k, v] of Object.entries(value)) {
    if (ks?.pattern === source) visit(k, [...path, k]);
    stringsWithPattern(v, propertySchema(b, k), source, visit, [...path, k]);
  }
}
