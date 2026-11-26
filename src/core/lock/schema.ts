import { z } from "zod";
import { CatalogId } from "#catalog/schema/common.ts";
import { GrooveType, Material, System } from "#catalog/schema/files.ts";
import { Item } from "#catalog/schema/items.ts";
import { Offer } from "#catalog/schema/offers.ts";
import { SectionFile } from "#catalog/schema/section.ts";
import { type CanonicalSpec, canonicalText } from "../canonical.ts";
import type { JsonSchema } from "../schema-walk.ts";

/**
 * The lock file, `alukit.lock.json` (design §4.13): the resolved catalog data a project uses, so
 * derive reads it and never the live catalogs (call 11). It is a frozen slice of the linked
 * catalogs: each item the document resolves, in any variant, as merged and linked (clones'
 * ratings and rails' factory end distances filled), with its offers and its section, and the
 * shared definitions they name (§3.3: materials, groove types, systems). Every entry carries the
 * content hash of its value, and every catalog the hash of its loaded content, so a check can
 * tell cheaply when the lock is behind.
 *
 * Entries are keyed by full id: `<catalog>:<local>` (offers by `<catalog>:<sku>`). References
 * inside an entry stay as their catalog wrote them, relative to that catalog.
 */

export const LOCK_SCHEMA = "alukit.lock/1";
export const LOCK_FILE = "alukit.lock.json";

const Hash = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/)
  .describe("sha256 of the value, as compact JSON with sorted keys");

const FullId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._+-]*$/)
  .describe('"<catalog>:<id>"');

export const LockCatalog = z.strictObject({
  hash: Hash.describe("sha256 of the catalog's loaded content when it was locked"),
  name: z.string(),
  vendor: z.string().optional(),
  currency: z.string().optional(),
});

export const LockFile = z.strictObject({
  schema: z.literal(LOCK_SCHEMA),
  catalogs: z.record(CatalogId, LockCatalog),
  items: z.record(FullId, z.strictObject({ hash: Hash, item: Item })),
  offers: z.record(FullId, z.strictObject({ hash: Hash, offer: Offer })),
  sections: z.record(FullId, z.strictObject({ hash: Hash, section: SectionFile })),
  materials: z.record(FullId, z.strictObject({ hash: Hash, material: Material })),
  grooves: z.record(FullId, z.strictObject({ hash: Hash, groove: GrooveType })),
  systems: z.record(FullId, z.strictObject({ hash: Hash, system: System })),
});
export type Lock = z.infer<typeof LockFile>;
export type LockCatalog = z.infer<typeof LockCatalog>;

/** The entry maps, in file order, and the key each entry holds its value under. */
export const LOCK_KINDS = [
  ["items", "item"],
  ["offers", "offer"],
  ["sections", "section"],
  ["materials", "material"],
  ["grooves", "groove"],
  ["systems", "system"],
] as const;
export type LockKind = (typeof LOCK_KINDS)[number][0];

export function emptyLock(): Lock {
  return {
    schema: LOCK_SCHEMA,
    catalogs: {},
    items: {},
    offers: {},
    sections: {},
    materials: {},
    grooves: {},
    systems: {},
  };
}

let schema: JsonSchema | undefined;

export function lockJsonSchema(): JsonSchema {
  schema ??= z.toJSONSchema(LockFile, { io: "input" }) as JsonSchema;
  return schema;
}

/** Canonical form (§2, §4.13): one catalog and one entry per line; values as catalogs write them. */
export const LOCK_CANONICAL: CanonicalSpec = {
  get schema() {
    return lockJsonSchema();
  },
  expand: (path) => path.length <= 1,
  quantum: () => undefined,
  idList: () => false,
};

export function lockText(lock: Lock): string {
  return canonicalText(lock, LOCK_CANONICAL);
}
