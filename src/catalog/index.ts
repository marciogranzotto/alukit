// Catalogs (design §3): schemas, the three-layer merge, linking across catalogs, section
// generators, and the computed-against-published check. No three.js here. Everything except
// fs.ts and open.ts is pure and runs in the browser too.
export {
  type CheckReport,
  checkCatalog,
  computedValues,
  MISMATCH,
  mismatchTolerance,
  type PropertyRow,
  TRACED_AREA,
  TRACED_INERTIA,
} from "./check.ts";
export { type Diagnostic, type Severity, sortDiagnostics } from "./diagnostics.ts";
export { parseJson } from "./json.ts";
export { FILE_SCHEMAS, jsonSchema, SCHEMA_NAMES, type SchemaName } from "./json-schema.ts";
export {
  type BuiltSection,
  buildSection,
  CatalogSet,
  type EntityKind,
  itemRefs,
  linkCatalogs,
  type Resolved,
} from "./link.ts";
export {
  type Acceptance,
  type CatalogSource,
  type Correction,
  type LoadedCatalog,
  type LoadedItem,
  type LoadedSection,
  type LoadResult,
  loadCatalog,
  sameValue,
  splitRef,
} from "./load.ts";
export type { Source } from "./merge.ts";
export { RATINGS, type RatingDef, ratingKeys, ratingsSchema } from "./ratings.ts";
export { reportJson, reportText } from "./report.ts";
export {
  isValuedObject,
  KINDS,
  type Kind,
  num,
  type Prov,
  SRC,
  type Src,
  type Valued,
} from "./schema/common.ts";
export type { GrooveType, Material, System } from "./schema/files.ts";
export { BAR_SHAPES, Item } from "./schema/items.ts";
export { Offer } from "./schema/offers.ts";
export { SectionFile } from "./schema/section.ts";
export { type ClosedForm, combine } from "./sections/closed-form.ts";
export { GENERATORS } from "./sections/generators/index.ts";
