import { z } from "zod";
import { type CanonicalSpec, canonicalText } from "../canonical.ts";
import type { JsonSchema, PathKey } from "../schema-walk.ts";
import { ProjectDoc } from "./schema.ts";

/**
 * The canonical form of `alukit.json` (design §2). Keys follow the Zod schema's order (§4.2,
 * with draft 2.1's `runs` and `price_bands`); maps keyed by id, and params, follow id order.
 *
 * Layout: the document is one key per line; each map of entities or records is one entry per
 * line, so a diff shows one line per entity changed (`variants.list` too); everything else sits
 * on one line.
 */

let schema: JsonSchema | undefined;

/** The document's JSON Schema (§7.4), generated once. */
export function projectJsonSchema(): JsonSchema {
  schema ??= z.toJSONSchema(ProjectDoc, { io: "input" }) as JsonSchema;
  return schema;
}

/** Top-level fields written one entry per line. */
const EXPANDED = new Set([
  "defaults",
  "params",
  "nodes",
  "bars",
  "runs",
  "connections",
  "parts",
  "patterns",
  "items",
  "costs",
  "price_bands",
  "order",
  "order_rules",
  "fx",
  "variants",
  "checks",
  "open",
  "decisions",
  "views",
]);

/** Top-level lists of records with ids (`K1`, `C1`, `O1`, `D1`), kept in id order. */
const ID_LISTS = new Set(["costs", "checks", "open", "decisions"]);

/** Keys whose array value is a point in mm (§4.3, §4.7, views). */
const POINT_KEYS = new Set(["a", "b", "at", "pos", "point", "target"]);

/**
 * A number's output quantum (§2) from where it sits: the unit suffix of the nearest key, or a
 * point's coordinate. Dimensionless numbers (normals, directions, counts, params) have none.
 */
export function projectQuantum(path: readonly PathKey[]): number | undefined {
  let k = path.length - 1;
  while (k >= 0 && typeof path[k] === "number") k--;
  const key = path[k];
  if (typeof key !== "string") return undefined;
  if (key.endsWith("_mm") || key.endsWith("_deg")) return 100;
  if (key.endsWith("_kg")) return 1000;
  if (typeof path[path.length - 1] === "number" && k === path.length - 2) {
    if (POINT_KEYS.has(key)) return 100;
    if (path.length === 3 && path[0] === "nodes") return 100;
    // A project item's named datum, `datums.mount` (§4.8).
    if (path[k - 1] === "datums") return 100;
  }
  // A plate's outline, a list of [x, y] points in mm (§4.8).
  if (key === "outline" && k === path.length - 3 && typeof path[k + 1] === "number") return 100;
  return undefined;
}

export const PROJECT_CANONICAL: CanonicalSpec = {
  get schema() {
    return projectJsonSchema();
  },
  expand: (path) =>
    path.length === 0 ||
    (path.length === 1 && EXPANDED.has(path[0] as string)) ||
    (path.length === 2 && path[0] === "variants" && path[1] === "list"),
  quantum: projectQuantum,
  idList: (path) => path.length === 1 && ID_LISTS.has(path[0] as string),
};

/** The canonical text of a project document. */
export function projectText(doc: unknown): string {
  return canonicalText(doc, PROJECT_CANONICAL);
}
