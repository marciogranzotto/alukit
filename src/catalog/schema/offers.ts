import { z } from "zod";
import {
  IsoDate,
  ItemQty,
  LocalId,
  Minor,
  OptionName,
  OptionValue,
  Ref,
  SourceRef,
  Src,
  Valued,
} from "./common.ts";

/**
 * Offers (design §3.2): how an item is sold. Keyed by SKU in offers.json. The BOM counts items;
 * the order list chooses offers (§5.4).
 */

/** The supplier cuts each piece to length (§3.2, §5.3). */
export const CutSale = z.strictObject({
  mode: z.literal("cut"),
  min_mm: z.number().positive(),
  max_mm: z.number().positive(),
  tol_mm: z.number().nonnegative().describe("± length tolerance"),
  res_mm: z.number().positive().describe("order resolution"),
  step_mm: z.number().positive().describe("price step"),
  min_bill_mm: z.number().positive().optional(),
  bill: z.enum(["piece", "line"]).optional().describe("what min_bill_mm applies to"),
});

/**
 * Whole bars of one stock length; one offer per length (§3.2). A rail's stock offer may state
 * `factory_E_mm` (design 2.1, §3.2, §4.7): the end distance at both ends of the stock length as
 * the maker drills it. Omitted, it is the centred layout's, computed and tagged `est`
 * (`factoryE` in rails.ts).
 */
export const StockSale = z.strictObject({
  mode: z.literal("stock"),
  length_mm: z.number().positive(),
  factory_E_mm: Valued.optional().describe(
    "rails: the end distance at both ends as the maker drills the stock length",
  ),
});

export const Sale = z.discriminatedUnion("mode", [CutSale, StockSale]);

export const Price = z.strictObject({
  regular_minor: Minor.describe(
    "the regular price in minor units of the catalog's currency; with low and high, a quoted range",
  ),
  sale_minor: Minor.nullable()
    .default(null)
    .describe("null when there is no sale; with low and high, a quoted range"),
  per: z
    .enum(["unit", "m", "bar"])
    .describe("what the price is for: one offer unit, a metre, a whole bar"),
  read: IsoDate,
  src: Src,
  ref: SourceRef.optional(),
});

export const Offer = z
  .strictObject({
    item: Ref.describe("the item sold; a full id may name another catalog's item"),
    sku: LocalId.optional().describe(
      "the SKU to order, when it differs from the offer's key: one SKU sold in several stock lengths",
    ),
    supplier: z.string().min(1).optional().describe("defaults to the catalog's vendor"),
    options: z
      .record(OptionName, OptionValue)
      .optional()
      .describe("the option values this SKU sells"),
    pack: z.int().min(1).optional().describe("units of the item per offer; 1 when absent"),
    kit: z
      .array(ItemQty)
      .min(1)
      .optional()
      .describe("contents; the first entry is the kit's main item"),
    sale: Sale.optional().describe("bars only"),
    price: Price,
    in_stock: z.boolean().optional().describe("as read"),
    url: z.string().min(1).optional(),
    ship_mass_kg: Valued.optional().describe("the shop's shipping weight; never the BOM's mass"),
  })
  .refine((o) => o.pack === undefined || o.kit === undefined, {
    message: "an offer is a pack or a kit, not both",
    path: ["kit"],
  });
export type Offer = z.output<typeof Offer>;
