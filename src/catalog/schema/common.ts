import { z } from "zod";
import { SUFFIXED_KEY } from "#core/units.ts";

/**
 * Building blocks shared by every catalog file (design §2, §3). No transforms anywhere: the JSON
 * Schema export (`io: "input"`, §7.4) throws on them, and values stay as their source prints them.
 */

/** Where a number came from (design §2): read from a source, measured, estimated, computed. */
export const SRC = ["src", "meas", "est", "calc"] as const;
export const Src = z
  .enum(SRC)
  .describe("src = read from a source, meas = measured, est = estimated, calc = computed");
export type Src = z.infer<typeof Src>;

export const IsoDate = z.iso.date().describe("the date it was read, YYYY-MM-DD");

/** A source reference: "pdf:<file>#p16", "url:<address>", or free text naming the source. */
export const SourceRef = z
  .string()
  .min(1)
  .describe('a source: "pdf:<file>#p<page>", "url:<address>", or a description');

/** A default provenance: an item's, a family file's, a section's. */
export const Prov = z.strictObject({
  src: Src,
  ref: SourceRef.optional(),
  read: IsoDate.optional(),
  note: z.string().optional(),
});
export type Prov = z.infer<typeof Prov>;

/**
 * A valued field (design §2): a bare number inherits its item's default provenance; the object
 * form adds per-field provenance and, for estimates, a low/high range.
 */
export const ValuedObject = z
  .strictObject({
    v: z.number(),
    src: Src.optional(),
    ref: SourceRef.optional(),
    read: IsoDate.optional(),
    note: z.string().optional(),
    low: z.number().optional(),
    high: z.number().optional(),
  })
  .refine((o) => (o.low === undefined || o.low <= o.v) && (o.high === undefined || o.v <= o.high), {
    message: "a range must satisfy low <= v <= high",
  });
export const Valued = z.union([z.number(), ValuedObject]);
export type Valued = z.infer<typeof Valued>;

/** The number of a valued field. */
export function num(x: Valued): number {
  return typeof x === "number" ? x : x.v;
}

/** True for the object form of a valued field: a plain object with a numeric `v`. */
export function isValuedObject(x: unknown): x is z.infer<typeof ValuedObject> {
  return (
    typeof x === "object" &&
    x !== null &&
    !Array.isArray(x) &&
    typeof (x as { v?: unknown }).v === "number"
  );
}

/**
 * A catalog id (design §3.1): lower case, digits and hyphens. `project` is reserved for a
 * project's own items (§4.8).
 */
export const CATALOG_ID = /^(?!project$)[a-z][a-z0-9-]*$/;
export const CatalogId = z
  .string()
  .regex(CATALOG_ID)
  .describe("a catalog id: lower case, digits and hyphens");

/**
 * A local id inside a catalog: an item code, a SKU, a section, material, groove type or system.
 * No whitespace, colon or slash, and never integer-like, so a JS engine never reorders it as an
 * object key (design §2, review M4).
 */
export const LOCAL_ID = /^(?!(?:0|[1-9][0-9]*)$)[A-Za-z0-9][A-Za-z0-9._+-]*$/;
export const LocalId = z
  .string()
  .regex(LOCAL_ID)
  .describe("a local id: letters, digits and . _ + -, never integer-like");

/**
 * A reference to a catalog entity: `<catalog>:<local id>`, or a bare local id that resolves in
 * the referring catalog (design §3.1).
 */
export const REF = new RegExp(
  // Its own lookahead: CATALOG_ID's `(?!project$)` would not refuse "project:" mid-string.
  `^(?:(?!project:)[a-z][a-z0-9-]*:)?${LOCAL_ID.source.slice(1, -1)}$`,
);
export const Ref = z
  .string()
  .regex(REF)
  .describe('"<catalog>:<id>", or "<id>" in the same catalog');

/** An option name (`finish`, `hand`) and its values (`anodised`, `black`, `left`). */
export const OptionName = z.string().regex(/^[a-z][a-z0-9_-]*$/);
export const OptionValue = z.string().min(1);

export const Vec2 = z.tuple([z.number(), z.number()]);
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** A bounding box in an item's own frame: [[xmin, ymin, zmin], [xmax, ymax, zmax]]. */
export const Bbox3 = z
  .tuple([Vec3, Vec3])
  .refine(([a, b]) => a[0] <= b[0] && a[1] <= b[1] && a[2] <= b[2], {
    message: "a box needs min <= max",
  });

/** A thread designation as published: "M8", "M10x1.25", "TR8x8", '3/8"'. */
export const Thread = z.string().min(1);

/** A face of a section, in section-local terms (design §4.3). */
export const Face = z.enum(["+x", "-x", "+y", "-y"]);
export type Face = z.infer<typeof Face>;

/** An open map of quantities whose keys must end in a known unit suffix (design §2). */
export const Quantities = z.record(z.string().regex(SUFFIXED_KEY), Valued);

/** A count of parts: `{ "item", "qty" }`. */
export const ItemQty = z.strictObject({
  item: Ref,
  qty: z.int().min(1),
  options: z.record(OptionName, OptionValue).optional(),
});

/** Item kinds (design §3.4). */
export const KINDS = [
  "bar",
  "connector",
  "fastener",
  "carriage",
  "accessory",
  "panel",
  "generic",
] as const;
export type Kind = (typeof KINDS)[number];
