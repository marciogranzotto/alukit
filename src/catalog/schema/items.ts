import { z } from "zod";
import { ratingsSchema } from "../ratings.ts";
import {
  Bbox3,
  DatumName,
  ItemQty,
  type Kind,
  OptionName,
  OptionValue,
  Prov,
  Quantities,
  Ref,
  SourceRef,
  Thread,
  Valued,
  Vec3,
} from "./common.ts";

/**
 * Items (design §3.2, §3.4): the physical part, whatever sells it. This is the shape of an item
 * after the merge of §3.1; catalog.json and family files each hold fragments of it.
 */

/** The envelope every item carries, whatever its kind (§3.2). */
function envelope<K extends Kind>(kind: K) {
  return {
    kind: z.literal(kind),
    name: z.string().min(1).describe("the vendor's name as published"),
    code: z.string().min(1).optional().describe("the vendor's catalogue code as published"),
    brand: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    docs: z.array(z.strictObject({ ref: SourceRef, note: z.string().optional() })).optional(),
    material: Ref.optional().describe("a material id (§3.3)"),
    mesh: z
      .string()
      .min(1)
      .optional()
      .describe("a GLB for drawing, relative to the catalog folder"),
    options: z
      .record(OptionName, z.array(OptionValue).min(1))
      .optional()
      .describe('named by meaning: { "finish": ["anodised", "black"] }'),
    clone_of: z
      .strictObject({ item: Ref, note: z.string().optional() })
      .optional()
      .describe(
        "the original of a rebadged part, in a reference catalog; its ratings fill this item's (§3.4)",
      ),
    ratings: ratingsSchema(kind).optional(),
    prov: Prov.describe("the item's default provenance, for every bare number it holds"),
  };
}

export const BAR_SHAPES = [
  "tslot",
  "tube",
  "rhs",
  "rod",
  "threaded-rod",
  "flat",
  "angle",
  "channel",
  "beam",
  "rail",
] as const;

/** Anything sold by length (D14): T-slot profile, tube, RHS, rod, flat, angle, rail. */
export const BarItem = z.strictObject({
  ...envelope("bar"),
  shape: z.enum(BAR_SHAPES),
  section: Ref.describe("a section id (§3.5)"),
  system: Ref.optional().describe("T-slot and rail bars: the system that decides what fits"),
  mass_kg_per_m: Valued.optional(),
  area_mm2: Valued.optional().describe("published"),
  Ix_mm4: Valued.optional().describe("published, about section x through the centroid"),
  Iy_mm4: Valued.optional().describe("published, about section y through the centroid"),
  J_mm4: Valued.optional().describe("published torsion constant (later)"),
  Wx_mm3: Valued.optional().describe("published (later)"),
  Wy_mm3: Valued.optional().describe("published (later)"),
  core: z
    .strictObject({
      bore_mm: Valued.optional(),
      tap: Thread.optional().describe("the largest tap the core takes, e.g. M16"),
    })
    .optional(),
  tolerances: z
    .strictObject({
      straightness_mm_per_m: Valued.optional(),
      twist_deg_per_m: Valued.optional(),
      standard: z.string().min(1).optional().describe("e.g. DIN EN 12020-2, ABNT NBR 8116"),
    })
    .optional()
    .describe("later"),
  thread: Thread.optional().describe("threaded rod"),
  rail: z
    .strictObject({
      pitch_mm: Valued,
      E_min_mm: Valued,
      E_max_mm: Valued,
      hole: z.strictObject({
        thread: Thread.optional(),
        d_mm: Valued.optional(),
        cbore_d_mm: Valued.optional(),
        cbore_depth_mm: Valued.optional(),
      }),
    })
    .optional()
    .describe("rails: hole pitch and the end distance range"),
});

/**
 * A part item's named points (design 2.1, §3.2), in its own frame: +z away from the face it mounts
 * on, +x along the bar it mounts on. `mount` lands on a station (§4.7).
 */
const Datums = z
  .record(DatumName, Vec3)
  .describe("named points in the item's own frame; `mount` lands on a station (§4.7)");

/** A carriage declares `run`: the point that sits on the rail's running-face centre line (§3.4). */
const CarriageDatums = Datums.refine((d) => Object.hasOwn(d, "run"), {
  message: "a carriage declares the datum `run` (§3.4)",
});

/**
 * A sleeve cut from bar stock and set in the through bar's bore on the mount hole's axis (design
 * 2.1, §3.4, §4.5). `len_mm` is a length, or `bore`: the through bar's inside depth along the axis.
 */
export const Sleeve = z.strictObject({
  item: Ref.describe("the bar the sleeve is cut from"),
  inside: z.literal("through").describe("the bar whose bore holds it: the through bar"),
  len_mm: z.union([z.literal("bore"), z.number().positive()]),
});

const Hole = z.strictObject({
  at_mm: Vec3.describe("the hole's centre on the mounting plane, in the item's frame"),
  d_mm: Valued,
  slot_mm: Valued.optional().describe("a slotted hole's length"),
  thread: Thread.optional(),
});

/** Brackets, plates, end connectors, cubes, gussets, hinges and splices. */
export const ConnectorItem = z.strictObject({
  ...envelope("connector"),
  subtype: z.enum(["bracket", "plate", "end-connector", "cube", "gusset", "hinge", "splice"]),
  fits: z.array(Ref).min(1).describe("the systems it fits"),
  mass_kg: Valued.optional(),
  bbox_mm: Bbox3.optional(),
  datums: Datums.optional(),
  frame: z
    .strictObject({
      x: Vec3,
      y: Vec3,
      note: z.string().optional(),
    })
    .optional()
    .describe("the connector's own axes in its item frame (z = x × y); the rating directions"),
  mounts: z
    .array(
      z.strictObject({
        plane: z
          .strictObject({ point_mm: Vec3, normal: Vec3 })
          .describe("the face that bears on a bar"),
        holes: z.array(Hole).optional(),
        fasteners: z
          .record(Ref, z.array(z.union([ItemQty, Sleeve])).min(1))
          .optional()
          .describe("the fastener set for each system it fits (review B3); it may list sleeves"),
      }),
    )
    .optional(),
  requires: z
    .array(
      z.strictObject({
        op: z.enum(["end-tap", "access-hole", "through-hole", "counterbore"]),
        on: z.enum(["butting", "through", "each"]).describe("which joined bar is machined"),
        thread: Thread.optional(),
        d_mm: Valued.optional(),
        depth_mm: Valued.optional(),
        from_end_mm: Valued.optional(),
        note: z.string().optional(),
      }),
    )
    .optional()
    .describe("machining on the joined bars"),
  spacer_mm: Valued.optional(),
  body: z.strictObject({ size_mm: Vec3 }).optional().describe("a cube's box"),
  pivot: z
    .strictObject({
      height_mm: Valued,
      end_mm: Valued,
      range_deg: z.tuple([z.number(), z.number()]),
    })
    .optional()
    .describe("hinges"),
  splice: z
    .strictObject({
      parts: z.array(ItemQty).min(1).describe("the stud or plates"),
      tap: Thread.optional().describe("the tap each bar end needs"),
      tap_depth_mm: Valued.optional(),
    })
    .optional(),
});

export const FastenerItem = z.strictObject({
  ...envelope("fastener"),
  subtype: z.enum([
    "screw",
    "bolt",
    "nut",
    "washer",
    "t-nut",
    "hammer-screw",
    "rivet-nut",
    "rivet",
    "insert",
    "pin",
    "stud",
    "anchor",
    "other",
  ]),
  thread: Thread.optional(),
  length_mm: Valued.optional(),
  head: z.string().min(1).optional().describe("the DIN or ISO standard, e.g. ISO 4762"),
  class: z.string().min(1).optional().describe("strength class, e.g. 8.8, A2-70"),
  torque_Nm: Valued.optional(),
  groove: Ref.optional().describe("T-nuts and hammer screws: the groove type"),
  insertion: z.enum(["drop-in", "slide-in"]).optional(),
  fits: z
    .array(Ref)
    .min(1)
    .optional()
    .describe("T-nuts and hammer screws: the systems whose grooves they fit"),
  dims: Quantities.optional().describe(
    "published dimensions under the standard's letters: d1_mm, d2_mm, h_mm, s_mm, m_mm …",
  ),
  mass_kg: Valued.optional(),
  bbox_mm: Bbox3.optional(),
  datums: Datums.optional(),
});

export const CarriageItem = z.strictObject({
  ...envelope("carriage"),
  rail_system: Ref,
  dims: Quantities.optional().describe("published dimensions, keys with unit suffixes"),
  mass_kg: Valued.optional(),
  bbox_mm: Bbox3.optional(),
  datums: CarriageDatums,
});

export const AccessoryItem = z.strictObject({
  ...envelope("accessory"),
  subtype: z.string().min(1).optional().describe("foot, caster, handle, cap, …"),
  fits: z.array(Ref).optional(),
  thread: Thread.optional(),
  dims: Quantities.optional(),
  mass_kg: Valued.optional(),
  bbox_mm: Bbox3.optional(),
  datums: Datums.optional(),
});

/** Sheet stock. Its mass follows from thickness and material; sheet sizes are offers. */
export const PanelItem = z.strictObject({
  ...envelope("panel"),
  thickness_mm: Valued,
});

/** Everything that fits no other kind: orderable, drawn as its box or mesh. */
export const GenericItem = z.strictObject({
  ...envelope("generic"),
  category: z.string().min(1).optional(),
  dims: Quantities.optional(),
  mass_kg: Valued.optional(),
  bbox_mm: Bbox3.optional(),
  datums: Datums.optional(),
});

export const Item = z.discriminatedUnion("kind", [
  BarItem,
  ConnectorItem,
  FastenerItem,
  CarriageItem,
  AccessoryItem,
  PanelItem,
  GenericItem,
]);
export type Item = z.infer<typeof Item>;
export type BarItem = z.infer<typeof BarItem>;
export type ConnectorItem = z.infer<typeof ConnectorItem>;
