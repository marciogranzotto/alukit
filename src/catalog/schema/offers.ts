import { z } from "zod";
import {
  IsoDate,
  ItemQty,
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

/** Whole bars of one stock length; one offer per length (§3.2). */
export const StockSale = z.strictObject({
  mode: z.literal("stock"),
  length_mm: z.number().positive(),
});

export const Sale = z.discriminatedUnion("mode", [CutSale, StockSale]);

export const Price = z.strictObject({
  regular_minor: z
    .int()
    .nonnegative()
    .describe("the regular price in minor units of the catalog's currency"),
  sale_minor: z.int().nonnegative().nullable().default(null).describe("null when there is no sale"),
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
