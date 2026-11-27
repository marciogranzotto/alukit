import { z } from "zod";
import { ratingsSchema } from "../ratings.ts";
import {
  Bbox3,
  DatumName,
  ItemQty,
  type Kind,
  num,
  OptionName,
  OptionValue,
  Prov,
  Quantities,
  Ref,
  SourceRef,
  Thread,
  Valued,
  Vec2,
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

/** What a joint recipe (a connector with no body) cannot have: the fields that describe a body. */
const BODY_FIELDS = ["mass_kg", "bbox_mm", "datums", "body", "mesh", "dims"] as const;

/**
 * Positions in the joint's plane (acceptance gap A8): `[x, y]` in the section of the bar the
 * connector sits on (a butting bar, a spliced bar), from its box centre, as the cut list states an
 * end tap's or an end hole's place. One op, or one splice tap, at each. A hole in the butting
 * bar's side stands over its position, `from_end_mm` in from the end (after the round-3
 * acceptance, X7).
 */
const Positions = z
  .array(Vec2)
  .min(1)
  .describe(
    "[x, y] in the section of the bar the connector sits on, from its box centre; one op at each",
  );

const Requirement = z.strictObject({
  op: z.enum(["end-tap", "access-hole", "through-hole", "counterbore"]),
  on: z.enum(["butting", "through", "each"]).describe("which joined bar is machined"),
  thread: Thread.optional(),
  d_mm: Valued.optional(),
  depth_mm: Valued.optional(),
  from_end_mm: Valued.optional(),
  at_mm: Positions.optional(),
  at_holes: z
    .int()
    .min(0)
    .optional()
    .describe("one op at each hole of this mount (its index), at the hole's x and y"),
  note: z.string().optional(),
});

/**
 * Brackets, plates, end connectors, cubes, gussets, hinges and splices. A **joint recipe**
 * (`recipe: true`; acceptance gap A2) is a connector with no body of its own: studs in tapped
 * cores, a screw into a core, a bush and a sleeve. Its fastener sets, sleeves, splice parts and
 * `requires` machining are generated and billed as any connector's; the recipe itself is not
 * bought, weighs nothing and is never placed, so it has none of the fields that describe a body,
 * and no offer sells it.
 */
export const ConnectorItem = z
  .strictObject({
    ...envelope("connector"),
    subtype: z.enum(["bracket", "plate", "end-connector", "cube", "gusset", "hinge", "splice"]),
    fits: z.array(Ref).min(1).describe("the systems it fits"),
    recipe: z
      .literal(true)
      .optional()
      .describe(
        "a joint recipe: no body of its own; its fasteners and machining are billed, the recipe is not",
      ),
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
            .describe(
              "the fastener set for each system it fits, used once per hole of the mount (review B3); it may list sleeves",
            ),
        }),
      )
      .optional(),
    requires: z.array(Requirement).optional().describe("machining on the joined bars"),
    dims: Quantities.optional().describe(
      "published dimensions under the standard's letters. A connector whose dims give a head (dk_mm or dw_mm) has a head of its own, a quick connector's pin's, seated in the through bar as a butt screw's head is: k_mm its height, rf_mm the radius of a domed top, d_mm the shank under it (after the round-3 acceptance, X8)",
    ),
    spacer_mm: Valued.optional(),
    overhang_mm: Valued.optional().describe(
      "how far a butting end face may reach past the face it bears on before a connection warning (after acceptance run 4)",
    ),
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
        at_mm: Positions.optional().describe(
          "each stud's core, [x, y] in the spliced bars' section from its box centre: one tap at each, in both ends",
        ),
      })
      .optional(),
  })
  .superRefine((c, ctx) => {
    if (c.recipe === true) {
      for (const f of BODY_FIELDS) {
        if (c[f] !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: [f],
            message: `a joint recipe has no body of its own, so no ${f}`,
          });
        }
      }
    }
    c.requires?.forEach((r, i) => {
      requirementIssues(c, r, i, ctx);
    });
    if (c.splice?.at_mm && !c.splice.tap) {
      ctx.addIssue({
        code: "custom",
        path: ["splice", "at_mm"],
        message: "positions place the splice's taps: give its tap",
      });
    }
  });

/**
 * A requirement's positions (acceptance gap A8). They lie in the joint's plane: they place an end
 * tap, a hole in the through bar, and, after the round-3 acceptance (X7), a hole in the butting
 * bar's side over the core or tap it serves, `from_end_mm` in from the end. `at_holes` names a
 * mount with holes whose plane is the joint's: square to the connector's z, so each hole's x and y
 * are its place.
 */
function requirementIssues(
  c: { mounts?: { plane: { normal: readonly number[] }; holes?: unknown[] }[] },
  r: z.infer<typeof Requirement>,
  i: number,
  ctx: z.RefinementCtx,
): void {
  const path = ["requires", i];
  if (r.at_mm && r.at_holes !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "at_holes"],
      message: "give at_mm or at_holes, not both",
    });
  }
  if (r.at_holes === undefined) return;
  const m = c.mounts?.[r.at_holes];
  if (!m?.holes || m.holes.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "at_holes"],
      message: m ? `mounts[${r.at_holes}] has no holes` : `no mounts[${r.at_holes}]`,
    });
    return;
  }
  const [nx = 0, ny = 0, nz = 0] = m.plane.normal;
  if (nx !== 0 || ny !== 0 || nz === 0) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "at_holes"],
      message: `mounts[${r.at_holes}]'s plane is not square to the connector's z, so its holes' x and y are no place in the joint's plane`,
    });
  }
}

export const FastenerItem = z
  .strictObject({
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
    standard: Prov.extend({
      id: Ref.describe("a `standards` entry, e.g. std:ISO4762"),
    })
      .optional()
      .describe(
        "the standard it is made to, and how that is known (src: its maker names it; est: inferred, e.g. from its type): linking fills each dimension it does not state from that standard's row for its thread (after the alternative frame's acceptance)",
      ),
    hole_mm: Valued.optional().describe(
      "a blind fastener's hole, as its maker states it: a blind fastening drills it in every layer it passes (after the alternative frame's acceptance)",
    ),
    grip_min_mm: Valued.optional().describe(
      "the least thickness of material a blind fastener grips, as its maker states it: a blind fastening's grip must not be less",
    ),
    grip_max_mm: Valued.optional().describe(
      "the greatest thickness of material a blind fastener grips, as its maker states it: a blind fastening's grip must not be more",
    ),
    mass_kg: Valued.optional(),
    bbox_mm: Bbox3.optional(),
    datums: Datums.optional(),
  })
  .refine(
    (f) =>
      f.grip_min_mm === undefined ||
      f.grip_max_mm === undefined ||
      num(f.grip_min_mm) <= num(f.grip_max_mm),
    { message: "a grip range needs grip_min_mm <= grip_max_mm", path: ["grip_max_mm"] },
  );

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
export type FastenerItem = z.infer<typeof FastenerItem>;
