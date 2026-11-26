import { z } from "zod";
import { CatalogId, IsoDate, LocalId, Prov, Ref, SourceRef, Src, Valued } from "./common.ts";
import { Offer } from "./offers.ts";

/**
 * The files of a catalog folder (design §3.1). Items in catalog.json and in family files are
 * fragments, checked against the full item schema (`Item`) only after the merge; here they are
 * objects keyed by local id.
 */

export const CATALOG_SCHEMA = "alukit.catalog/1";
export const OFFERS_SCHEMA = "alukit.offers/1";
export const FAMILY_SCHEMA = "alukit.family/1";
export const OVERRIDES_SCHEMA = "alukit.overrides/1";

/** Material (§3.3). */
export const Material = z.strictObject({
  name: z.string().min(1).optional(),
  alloy: z.string().min(1).optional(),
  temper: z.string().min(1).optional(),
  E_MPa: Valued.optional(),
  G_MPa: Valued.optional(),
  nu: Valued.optional(),
  density_kg_per_m3: Valued.optional(),
  Rp02_MPa: Valued.optional(),
  Rm_MPa: Valued.optional(),
  alpha_per_K: Valued.optional().describe("thermal expansion"),
  prov: Prov.optional(),
});
export type Material = z.infer<typeof Material>;

/**
 * Groove type (§3.3). The chamber under the lip is `undercut_mm` wide; when it narrows toward the
 * bottom, `taper_from_mm` is the depth where it starts to and `bottom_mm` its width at
 * `depth_mm` (M2a; real slots taper, and a full-width chamber down to the bottom would cross the
 * neighbouring groove's on a 40x40).
 */
export const GrooveType = z
  .strictObject({
    opening_mm: Valued,
    lip_mm: Valued,
    depth_mm: Valued,
    undercut_mm: Valued,
    taper_from_mm: Valued.optional().describe("the depth where the chamber starts to narrow"),
    bottom_mm: Valued.optional().describe("the chamber's width at depth_mm, when it narrows"),
    class: z
      .enum(["standard", "light"])
      .describe("some makers rate T-nuts in standard grooves only"),
    prov: Prov.optional(),
  })
  .refine((g) => (g.taper_from_mm === undefined) === (g.bottom_mm === undefined), {
    message: "taper_from_mm and bottom_mm go together",
    path: ["bottom_mm"],
  });
export type GrooveType = z.infer<typeof GrooveType>;

/** System (§3.3): an interface family that decides what fits. */
export const System = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("tslot"),
    series_mm: z.number().positive().describe("the grid: 20, 30, 40, 45 …"),
    groove: Ref.describe("its groove type"),
    name: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal("rail"),
    family: z.string().min(1).describe('the rail family, e.g. "HG"'),
    size: z.number().positive().describe("the rail size, e.g. 20"),
    name: z.string().min(1).optional(),
  }),
]);
export type System = z.infer<typeof System>;

/** An item fragment: checked field by field after the merge (§3.1). */
export const ItemFragment = z.record(z.string(), z.unknown());

const definitions = {
  materials: z.record(LocalId, Material).optional(),
  grooves: z.record(LocalId, GrooveType).optional(),
  systems: z.record(LocalId, System).optional(),
};

/** catalog.json: the importer's output, regenerated, never edited by hand (layer 1). */
export const CatalogFile = z.strictObject({
  schema: z.literal(CATALOG_SCHEMA),
  id: CatalogId,
  name: z.string().min(1),
  vendor: z.string().min(1).optional().describe("the supplier id offers default to"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .describe("ISO 4217; the currency of every price in offers.json"),
  url: z.string().min(1).optional(),
  prov: Prov.optional().describe("the default for the catalog's definitions"),
  ...definitions,
  items: z.record(LocalId, ItemFragment).optional(),
});
export type CatalogFile = z.infer<typeof CatalogFile>;

/** offers.json: the importer's output (layer 1). */
export const OffersFile = z.strictObject({
  schema: z.literal(OFFERS_SCHEMA),
  offers: z
    .record(LocalId, Offer)
    .describe("keyed by SKU, or by an id of its own when the offer names its `sku`"),
});
export type OffersFile = z.output<typeof OffersFile>;

/**
 * families/<name>.json (layer 2): per-family modelling written by agents and reviewed. A family
 * may add items and fields, never change a field another layer set. `prov` is the default
 * provenance of everything it sets; an item fragment's own `prov` narrows it.
 */
export const FamilyFile = z.strictObject({
  schema: z.literal(FAMILY_SCHEMA),
  family: z.string().min(1),
  prov: Prov,
  review: z
    .strictObject({ by: z.string().min(1), date: IsoDate, note: z.string().optional() })
    .optional()
    .describe("the independent review (§11 step 4)"),
  ...definitions,
  items: z.record(LocalId, ItemFragment).optional(),
});
export type FamilyFile = z.infer<typeof FamilyFile>;

/**
 * A field path: object keys from the item down, joined by "/" (`Ix_mm4`, `ratings/F_N.x`,
 * `core/bore_mm`). Keys never contain "/".
 */
export const FieldPath = z.string().regex(/^[^/\s]+(?:\/[^/\s]+)*$/);

/** Replace a field: `expect` is the value it replaces (null: the field is absent). */
export const ReplaceOverride = z.strictObject({
  item: Ref,
  field: FieldPath,
  expect: z
    .json()
    .describe("the value replaced, compared by number for valued fields; null when absent"),
  value: z.json(),
  why: z.string().min(1),
  src: Src,
  ref: SourceRef.optional(),
  read: IsoDate.optional(),
  by: z.string().min(1).optional(),
});

/** Accept a computed-against-published mismatch (§3.6). */
export const AcceptOverride = z.strictObject({
  item: Ref,
  field: FieldPath,
  accept: z.literal(true),
  why: z.string().min(1),
  by: z.string().min(1).optional(),
});

/** overrides.json (layer 3): corrections and accepted mismatches, each with provenance. */
export const OverridesFile = z.strictObject({
  schema: z.literal(OVERRIDES_SCHEMA),
  overrides: z.array(z.union([AcceptOverride, ReplaceOverride])),
});
export type OverridesFile = z.infer<typeof OverridesFile>;

/**
 * Loose envelopes for loading: the same files with their entries left unchecked, so that one bad
 * item, offer or override is reported on its own and the rest still load. Entries are checked
 * one by one, items after the merge.
 */
const Entries = z.record(LocalId, z.unknown());
export const CatalogEnvelope = CatalogFile.extend({
  materials: Entries.optional(),
  grooves: Entries.optional(),
  systems: Entries.optional(),
  items: Entries.optional(),
});
export const OffersEnvelope = OffersFile.extend({ offers: Entries });
export const FamilyEnvelope = FamilyFile.extend({
  materials: Entries.optional(),
  grooves: Entries.optional(),
  systems: Entries.optional(),
  items: Entries.optional(),
});
export const OverridesEnvelope = OverridesFile.extend({ overrides: z.array(z.unknown()) });
export const Override = z.union([AcceptOverride, ReplaceOverride]);
export type ReplaceOverride = z.infer<typeof ReplaceOverride>;
export type AcceptOverride = z.infer<typeof AcceptOverride>;
