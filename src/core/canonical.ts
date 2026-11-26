import { compareIds } from "./ids.ts";
import { snapInt } from "./quantum.ts";
import {
  branchFor,
  itemSchema,
  type JsonSchema,
  type PathKey,
  propertyOrder,
  propertySchema,
} from "./schema-walk.ts";

/**
 * Canonical form (design §2, review m13 and M4): UTF-8, LF, two-space indent, a final newline;
 * keys in schema order; maps sorted by id order; entity maps one entity per line; numbers in
 * ECMAScript's shortest round-trip form, never -0. The server and the CLI always write it, and
 * `alukit fmt` rewrites a file into it. It never changes what a document means: only key order,
 * line layout, the order of id-keyed maps and lists, and float noise in numbers that carry a
 * quantum (below).
 *
 * Numbers. A number in a field with an output quantum (§2: lengths 0.01 mm, angles 0.01°, mass
 * 0.001 kg) is snapped to that grid when it lies within `tol.snap` of it, as §5.2 snaps before
 * rounding: 1199.9999999999998 is written 1200, 0.30000000000000004 is 0.3, and 12.345 stays.
 * Commands that compute a number quantise it fully (commands/numbers.ts).
 */

export interface CanonicalSpec {
  schema: JsonSchema;
  /** True when the object or array at `path` is written one entry per line. */
  expand(path: readonly PathKey[]): boolean;
  /** Quanta per unit for a number at `path` (100 for 0.01), or undefined for none. */
  quantum(path: readonly PathKey[]): number | undefined;
  /** True when the list at `path` holds records with ids, kept in id order. */
  idList(path: readonly PathKey[]): boolean;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** `x` on the quantum's grid when within tol.snap of it; -0 becomes 0. */
export function snapToQuantum(x: number, perUnit: number | undefined): number {
  if (perUnit === undefined) return x === 0 ? 0 : x;
  const n = snapInt(x * perUnit);
  const out = Number.isInteger(n) ? n / perUnit : x;
  return out === 0 ? 0 : out;
}

/** The value in canonical order: keys reordered, id lists sorted, numbers snapped. */
export function canonicalValue(value: unknown, spec: CanonicalSpec): unknown {
  return order(value, spec.schema, spec, []);
}

function order(value: unknown, schema: JsonSchema, spec: CanonicalSpec, path: PathKey[]): unknown {
  if (typeof value === "number") return snapToQuantum(value, spec.quantum(path));
  if (Array.isArray(value)) {
    const b = branchFor(schema, value);
    let out = value.map((v, i) => order(v, itemSchema(b, i), spec, [...path, i]));
    if (spec.idList(path) && out.every((r) => isObject(r) && typeof r.id === "string")) {
      out = [...out].sort((x, y) => compareIds((x as { id: string }).id, (y as { id: string }).id));
    }
    return out;
  }
  if (!isObject(value)) return value;
  const b = branchFor(schema, value);
  const declared = propertyOrder(b).filter((k) => Object.hasOwn(value, k));
  const known = new Set(declared);
  const rest = Object.keys(value)
    .filter((k) => !known.has(k))
    .sort(compareIds);
  const out: Record<string, unknown> = {};
  for (const k of [...declared, ...rest]) {
    out[k] = order(value[k], propertySchema(b, k), spec, [...path, k]);
  }
  return out;
}

/** One value on one line: `{ "a": 1, "b": [1, 2] }`, `[]`, `{}`. */
export function inlineJson(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.map(inlineJson).join(", ")}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

function print(value: unknown, spec: CanonicalSpec, path: PathKey[], indent: string): string {
  const empty = Array.isArray(value)
    ? value.length === 0
    : isObject(value) && Object.keys(value).length === 0;
  if (empty || !(Array.isArray(value) || isObject(value)) || !spec.expand(path)) {
    return inlineJson(value);
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const lines = value.map((v, i) => `${inner}${print(v, spec, [...path, i], inner)}`);
    return `[\n${lines.join(",\n")}\n${indent}]`;
  }
  const lines = Object.entries(value).map(
    ([k, v]) => `${inner}${JSON.stringify(k)}: ${print(v, spec, [...path, k], inner)}`,
  );
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** The canonical text of a value: ordered, laid out, with a final newline. */
export function canonicalText(value: unknown, spec: CanonicalSpec): string {
  return `${print(canonicalValue(value, spec), spec, [], "")}\n`;
}
