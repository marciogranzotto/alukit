import { z } from "zod";
import { CatalogFile, FamilyFile, OffersFile, OverridesFile } from "./schema/files.ts";
import { Item } from "./schema/items.ts";
import { SectionFile } from "./schema/section.ts";

/**
 * JSON Schemas for agents and editors (design §7.4), generated from the Zod schemas with
 * `io: "input"`, so fields with defaults are optional for a writer. Zod leaves refinements out of
 * the export, so rules that span fields or files live in `alukit catalog check`.
 *
 * catalog.json and family files hold item *fragments*: each item is complete only after the
 * merge (§3.1), so their `items` are open objects here, and `item` is the schema of a merged item.
 */
export const FILE_SCHEMAS = {
  catalog: CatalogFile,
  offers: OffersFile,
  section: SectionFile,
  family: FamilyFile,
  overrides: OverridesFile,
  item: Item,
} as const;

export type SchemaName = keyof typeof FILE_SCHEMAS;

export const SCHEMA_NAMES = Object.keys(FILE_SCHEMAS) as SchemaName[];

export function jsonSchema(name: SchemaName): Record<string, unknown> {
  const schema = z.toJSONSchema(FILE_SCHEMAS[name], { io: "input" }) as Record<string, unknown>;
  return { ...schema, title: `alukit ${name}` };
}
