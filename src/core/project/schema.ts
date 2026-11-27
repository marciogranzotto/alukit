import { z } from "zod";
import { Bbox3, DatumName, LOCAL_ID, Minor, Valued, Vec3 } from "#catalog/schema/common.ts";

/**
 * The project document, `alukit.json` (design §4.2–§4.12), as Zod schemas. M3a reads params,
 * nodes, bars, runs, connections and patterns, and the cut-list settings; the fields later
 * milestones fill in (parts, project items, costs, price bands, variants, checks, open items,
 * decisions, views) are accepted with their outline, so a document written for them parses now.
 *
 * No transforms: the JSON Schema export (`io: "input"`, §7.4) throws on them. Rules that span
 * entities (a reference resolves, one provider per end) live in derive's diagnostics.
 */

export const PROJECT_SCHEMA = "alukit.project/1";

// ---------------------------------------------------------------------------------------------
// Ids (design §2): a letter prefix and a number. Pattern copies (`b30@2`) are derived and never
// written in a document.

export const NodeId = z
  .string()
  .regex(/^n\d+$/)
  .describe("a node: n<number>");
export const BarId = z
  .string()
  .regex(/^b\d+$/)
  .describe("a bar: b<number>");
export const RunId = z
  .string()
  .regex(/^r\d+$/)
  .describe("a run: r<number>");
export const ConnId = z
  .string()
  .regex(/^c\d+$/)
  .describe("a connection: c<number>");
export const PartId = z
  .string()
  .regex(/^p\d+$/)
  .describe("a part: p<number>");
export const PatternId = z
  .string()
  .regex(/^pt\d+$/)
  .describe("a pattern: pt<number>");
export const EndRef = z
  .string()
  .regex(/^b\d+\.[ab]$/)
  .describe('a bar end: "b7.a" or "b7.b"');

/** A catalog item, always with its catalog: `<catalog>:<code>`, or `project:<id>` (§4.8). */
export const ItemRef = z
  .string()
  .regex(/^[a-z][a-z0-9-]*:(?!(?:0|[1-9][0-9]*)$)[A-Za-z0-9][A-Za-z0-9._+-]*$/)
  .describe('a catalog item: "<catalog>:<code>"');

/** A param name: an identifier that is not a word of the expression language. */
export const ParamName = z
  .string()
  .regex(/^(?!(?:and|or|not|if|pi)$)[A-Za-z_][A-Za-z0-9_]*$/)
  .describe("a param name: an identifier");

/** A number, or an expression over params (§4.9). */
export const Expr = z.union([z.number(), z.string().min(1)]);
export type Expr = z.infer<typeof Expr>;

export const Vec2Expr = z.tuple([Expr, Expr]);
export const Vec3Expr = z.tuple([Expr, Expr, Expr]);

export const Face = z.enum(["+x", "-x", "+y", "-y"]).describe("a face of the placed section");
export type Face = z.infer<typeof Face>;

/** A groove: its face and its number on that face, by increasing section coordinate. */
export const GrooveName = z
  .string()
  .regex(/^[+-][xy]\.[1-9]\d*$/)
  .describe('a groove: "+y.1", numbered by increasing section coordinate');

export const AxisName = z.enum(["+x", "-x", "+y", "-y", "+z", "-z"]);

/** An anchor (§4.4): `c`, a face midpoint, a corner, or a section datum. */
export const Anchor = z
  .string()
  .regex(/^(?:c|[+-][xy]|[+-]x[+-]y|[+-]y[+-]x|[a-z][a-z0-9_-]*)$/)
  .describe('"c", a face "+x", a corner "-x-y", or a section datum "mount"');

const Common = {
  label: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  only_in: z.array(z.string().min(1)).optional().describe("variants that include it (§4.10)"),
  not_in: z.array(z.string().min(1)).optional().describe("variants that exclude it (§4.10)"),
};

/** Where `at_mm` counts from: a design point, or (parts only) a cut end's long point. */
export const From = z.enum(["a", "b", "a.cut", "b.cut"]);

/** A station (§4.3): a position along a bar or a run, on a face or groove, offset. */
export const Station = z
  .strictObject({
    bar: z.union([BarId, RunId]).describe("a bar or a run"),
    at_mm: Expr,
    from: From.optional(),
    face: Face.optional(),
    groove: GrooveName.optional(),
    off_mm: Vec2Expr.optional().describe("[u, v]: across the face, along its outward normal"),
  })
  .refine((s) => s.face === undefined || s.groove === undefined, {
    message: "a station is on a face or in a groove, not both",
  });
export type Station = z.infer<typeof Station>;

/** A point (§4.3): a node, an inline point, a point on a bar, or a pivot's point. */
export const Point = z.union([
  NodeId,
  Vec3Expr,
  z.strictObject({ on: Station }),
  z.strictObject({ pivot: ConnId }),
]);
export type Point = z.infer<typeof Point>;

/** End `b` only: a free end at a length along an axis or a vector (§4.3). */
export const FreeEnd = z.strictObject({
  len_mm: Expr,
  dir: z.union([AxisName, Vec3Expr]),
  from: z.literal("a.cut").optional().describe("count the length from end a's cut (G21)"),
});
export type FreeEnd = z.infer<typeof FreeEnd>;

/** A world pose (§4.7): rotations about world X, then Y, then Z. */
export const Pose = z.strictObject({ pos: Vec3Expr, rot_deg: Vec3Expr.optional() });
export type Pose = z.infer<typeof Pose>;

/** Tells a pose from a point where either may stand (a butt's body). */
export function isPose(x: Point | Pose): x is Pose {
  return typeof x === "object" && !Array.isArray(x) && "pos" in x;
}

/**
 * An explicit end plane (§4.5). The normal is a vector, or a bar whose axis it takes: a plane
 * square to that bar, such as a shoe mitred square to a strut (G27).
 */
export const Plane = z.union([
  z.strictObject({
    point: Point,
    normal: z.union([Vec3Expr, BarId]).describe("a vector, or a bar: square to its axis"),
  }),
  z.strictObject({ face: z.strictObject({ bar: BarId, face: Face }) }),
  z.strictObject({ of: EndRef }),
]);
export type Plane = z.infer<typeof Plane>;

export const EndSpec = z.strictObject({
  plane: Plane.optional(),
  cut: z.enum(["angle", "square"]).optional(),
  extend_mm: Expr.optional().describe("along the axis; positive is outward (longer)"),
});
export type EndSpec = z.infer<typeof EndSpec>;

/** Hole fields (§4.8). */
const HoleFields = {
  d_mm: Expr.optional(),
  thread: z.string().min(1).optional(),
  depth_mm: Expr.optional().describe("absent: through the whole section"),
  csk: z.strictObject({ d_mm: Expr, angle_deg: Expr }).optional(),
  cbore: z.strictObject({ d_mm: Expr, depth_mm: Expr }).optional(),
};

/** Machining a person adds (§4.4). */
export const Op = z
  .strictObject({
    op: z.literal("hole"),
    face: Face,
    at_mm: Expr,
    from: z.enum(["a", "b"]).optional(),
    ...HoleFields,
  })
  .refine((o) => (o.d_mm === undefined) !== (o.thread === undefined), {
    message: "a hole has d_mm or thread",
  });
export type Op = z.infer<typeof Op>;

/** A rail's hole layout (§4.7). */
export const RailHoles = z.union([
  z.strictObject({ factory: z.enum(["a", "b"]), stock_mm: z.number().positive().optional() }),
  z.strictObject({ drilled: z.literal(true) }),
  z.strictObject({ E_a_mm: Expr }),
  z.strictObject({ E_b_mm: Expr }),
]);

export const Bar = z.strictObject({
  item: ItemRef.optional().describe("a bar item; defaults.bar.item when absent"),
  opt: z.record(z.string(), z.string()).optional().describe("option values: { finish: black }"),
  a: Point,
  b: z.union([Point, FreeEnd]),
  anchor: Anchor.optional(),
  off_mm: Vec2Expr.optional().describe("[dx, dy] along the section's own x and y"),
  roll_deg: Expr.optional(),
  up: z.union([AxisName, Vec3Expr]).optional(),
  ends: z.strictObject({ a: EndSpec.optional(), b: EndSpec.optional() }).optional(),
  ops: z.array(Op).optional(),
  holes: RailHoles.optional().describe("rails: the hole layout"),
  ...Common,
});
export type Bar = z.infer<typeof Bar>;

export const Node = z.union([
  Vec3Expr,
  z.strictObject({ at: Vec3Expr, ...Common }),
  z.strictObject({ on: Station, ...Common }),
  z.strictObject({ pivot: ConnId, ...Common }),
]);
export type Node = z.infer<typeof Node>;

export const Run = z.union([
  z.array(BarId).min(2),
  z.strictObject({ bars: z.array(BarId).min(2), ...Common }),
]);
export type Run = z.infer<typeof Run>;

const ConnCommon = {
  connector: ItemRef.optional(),
  qty: z.int().min(1).optional(),
  ...Common,
};

export const ThroughEnd = z.union([
  z.enum(["cover", "node", "none"]),
  z.strictObject({ end: z.enum(["a", "b"]), mode: z.enum(["cover", "node"]) }),
]);

export const Butt = z.strictObject({
  type: z.literal("butt"),
  through: z
    .union([BarId, EndRef, z.strictObject({ body: ItemRef, at: z.union([Point, Pose]) })])
    .describe("a bar, a bar's end, or a body at a point or pose"),
  ends: z.array(EndRef).min(1),
  spacer_mm: Expr.optional().describe("along the through face's outward normal"),
  stack: z
    .array(BarId)
    .min(1)
    .optional()
    .describe(
      "bars between the face the butt bears on and the butting ends, from that face out (an end plate, a packer): each lies on the one before, the ends bear on the last, and the connector's screws pass each, drilled as the through bar is",
    ),
  through_end: ThroughEnd.optional(),
  held_by: ConnId.optional().describe(
    "a butt through the same bar whose through-fastener holds these ends too: c<number>",
  ),
  ...ConnCommon,
});

export const Miter = z.strictObject({
  type: z.literal("miter"),
  ends: z.tuple([EndRef, EndRef]),
  ...ConnCommon,
});

export const Splice = z.strictObject({
  type: z.literal("splice"),
  ends: z.tuple([EndRef, EndRef]),
  gap_mm: Expr.optional(),
  ...ConnCommon,
});

export const Pivot = z.strictObject({
  type: z.literal("pivot"),
  base: Station,
  axis: z.enum(["along", "across"]).describe("the hinge axis, along or across the base bar"),
  ends: z.array(EndRef).min(1),
  connector: ItemRef.describe("a connector with pivot geometry"),
  qty: z.int().min(1).optional(),
  ...Common,
});

/** A rail-hole selection (§4.7). */
export const RailHolesSel = z.strictObject({
  along: z.union([BarId, RunId]),
  every: z.int().min(1).optional(),
  plus: z.array(z.enum(["first", "last", "joint"])).optional(),
});
export type RailHolesSel = z.infer<typeof RailHolesSel>;

/**
 * A stack entry (§4.5): hardware from head to nut, or a sleeve cut from bar stock. A wall or a
 * layer the sleeve passes is drilled to clear it: ISO 273 medium for a shank of its outside
 * diameter, or that diameter plus `clearance_mm` (acceptance gap A7).
 */
export const StackEntry = z.union([
  ItemRef,
  z.strictObject({ item: ItemRef, qty: z.int().min(1).optional() }),
  z.strictObject({
    item: ItemRef,
    inside: z.union([BarId, RunId]),
    walls: z
      .literal("both")
      .optional()
      .describe(
        "both: the sleeve runs from the nut-side wall's outer face, so bore + 2t passes both walls; absent: from its inner face, in the bore",
      ),
    len_mm: Expr,
    clearance_mm: Expr.optional().describe(
      "the holes the sleeve passes: its outside diameter plus this; absent: ISO 273 medium for a shank of that diameter",
    ),
  }),
]);
export type StackEntry = z.infer<typeof StackEntry>;

export const FaceConn = z.strictObject({
  type: z.literal("face"),
  bars: z
    .array(z.union([BarId, RunId, PartId]))
    .min(2)
    .describe("layers, head to nut"),
  gaps_mm: z.array(Expr).optional(),
  faces: z.array(z.tuple([Face, Face])).optional(),
  fastening: z
    .enum(["none", "bolt", "tnut", "screw", "blind"])
    .describe(
      "none: resting; bolt: through every layer; tnut: into the last layer's groove; screw: tapped into the last layer; blind: a blind fastener, gripping inside the last layer's bore (its near wall drilled only) or behind it",
    ),
  fastener: z
    .union([ItemRef, z.strictObject({ bar: ItemRef, len_mm: Expr })])
    .optional()
    .describe("a catalog fastener, or a piece cut from bar stock"),
  stack: z.array(StackEntry).optional(),
  stations: z
    .strictObject({
      at_mm: z.array(Expr).optional(),
      across_mm: z.array(Expr).optional(),
      rail_holes: z.union([z.literal(true), RailHolesSel]).optional(),
      pattern: PatternId.optional(),
    })
    .optional(),
  tap_depth_mm: Expr.optional(),
  ...ConnCommon,
});

export const Connection = z.discriminatedUnion("type", [Butt, Miter, Splice, Pivot, FaceConn]);
export type Connection = z.infer<typeof Connection>;
export type ButtConn = z.infer<typeof Butt>;
export type MiterConn = z.infer<typeof Miter>;
export type SpliceConn = z.infer<typeof Splice>;
export type PivotConn = z.infer<typeof Pivot>;
export type FaceConnT = z.infer<typeof FaceConn>;

export const Part = z.union([
  z.strictObject({
    item: ItemRef,
    opt: z.record(z.string(), z.string()).optional(),
    on: Station,
    roll_deg: Expr.optional(),
    ...Common,
  }),
  z.strictObject({
    item: ItemRef,
    opt: z.record(z.string(), z.string()).optional(),
    at: Pose,
    ...Common,
  }),
  z.strictObject({
    item: ItemRef,
    opt: z.record(z.string(), z.string()).optional(),
    qty: Expr,
    unplaced: z.literal(true),
    why: z.string().min(1),
    ...Common,
  }),
]);
export type Part = z.infer<typeof Part>;

export const Pattern = z.strictObject({
  template: z.array(z.union([NodeId, BarId, ConnId, PartId])).min(1),
  along: z.union([BarId, RunId, z.strictObject({ dir: Vec3Expr })]),
  pitch_mm: Expr.optional(),
  count: z.int().min(1).optional(),
  offsets_mm: z.array(Expr).min(1).optional().describe("instead of pitch_mm and count"),
  skip: z.array(z.int().min(1)).optional().describe("copy numbers k to leave out"),
  rail_holes: z.union([z.literal(true), RailHolesSel]).optional(),
  ...Common,
});
export type Pattern = z.infer<typeof Pattern>;

/** A param: an expression, a number, or a valued field whose `v` may be an expression. */
export const Param = z.union([
  z.number(),
  z.string().min(1),
  z.strictObject({
    v: Expr,
    src: z.enum(["src", "meas", "est", "calc"]).optional(),
    ref: z.string().optional(),
    read: z.iso.date().optional(),
    note: z.string().optional(),
    low: z.number().optional(),
    high: z.number().optional(),
  }),
]);
export type Param = z.infer<typeof Param>;

/** A variant's name (§4.10), as `only_in`, `not_in` and `--variant` name it. */
export const VariantName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .describe("a variant: letters, digits, '.', '_' and '-'");

/**
 * A variant (§4.10): the params it overrides and the items it swaps. Entities scope themselves to
 * variants with `only_in` and `not_in`.
 */
export const Variant = z.strictObject({
  label: z.string().optional(),
  params: z.record(ParamName, Param).optional().describe("params it overrides, or adds"),
  swap: z
    .record(ItemRef, ItemRef)
    .optional()
    .describe('items it replaces: { "<item>": "<the item it becomes>" }'),
});
export type Variant = z.infer<typeof Variant>;

export const Variants = z.strictObject({
  default: VariantName.optional().describe("the variant derived when none is named"),
  list: z.record(VariantName, Variant),
});
export type Variants = z.infer<typeof Variants>;

/** Cut-list settings (§5.3): saw kerf per cut and trim at each stock bar end. */
export const Cutting = z.strictObject({
  kerf_mm: z.number().nonnegative().optional(),
  trim_mm: z.number().nonnegative().optional(),
});

/**
 * Which bar runs through at a corner the draw tool closes (§4.5, D-UX-9): `vertical`, today's
 * rule, a vertical else the lowest id; `x` or `y`, the bar along that world axis; `first`, the
 * lowest id. A bar passing through the point always wins first.
 */
export const CornerRule = z.enum(["vertical", "x", "y", "first"]);
export type CornerRule = z.infer<typeof CornerRule>;

export const Defaults = z.strictObject({
  bar: z
    .strictObject({
      item: ItemRef.optional(),
      opt: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  butt: z
    .strictObject({
      connector: ItemRef.optional(),
      qty: z.int().min(1).optional(),
      overhang_mm: z
        .number()
        .nonnegative()
        .optional()
        .describe(
          "how far a butting end face may reach past the face it bears on before a connection warning, where its connector gives none",
        ),
    })
    .optional(),
  cutting: Cutting.optional(),
  corner: CornerRule.optional().describe(
    "which bar runs through where autoConnect names none: vertical (the default), x, y or first",
  ),
});
export type Defaults = z.infer<typeof Defaults>;

/** An order choice per item (§5.4), and the cut-list mode override (§5.3). */
export const OrderChoice = z.strictObject({
  offer: z.string().min(1).optional().describe("a SKU"),
  sale: z.enum(["cut", "stock"]).optional().describe("override the cut-list mode"),
  kerf_mm: z.number().nonnegative().optional(),
  trim_mm: z.number().nonnegative().optional(),
});
export type OrderChoice = z.infer<typeof OrderChoice>;

const Loose = z.record(z.string(), z.unknown());

/** A supplier id, as offers name it (§3.2). */
export const SupplierId = z.string().min(1);

// ---------------------------------------------------------------------------------------------
// Project items (§4.8): plates, bent angles, generic items and placeholders that exist only in
// this project, referred to as `project:<id>`. They are item data like a catalog's, so their
// numbers are numbers, not expressions (M6). Bars and connectors of a project's own go in a
// project-local catalog (§4.8, P18).

/** A project item's id, a catalog local id: the document names it `project:<id>`. */
export const ProjectItemId = z
  .string()
  .regex(LOCAL_ID)
  .describe("a project item's id: letters, digits and . _ + -; named as project:<id>");

/** A catalog material, always with its catalog: `<catalog>:<id>` (§3.3). */
export const MaterialRef = z
  .string()
  .regex(/^(?!project:)[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._+-]*$/)
  .describe('a catalog material: "<catalog>:<id>"');

const Positive = z.number().positive();

/**
 * A hole feature (§4.8, review B2): through, blind, threaded, countersunk or counterbored. `at`
 * is its centre on the part's face: on a plate, [x, y] in the outline's coordinates; on a bent
 * angle's leg, [x along the angle's length, distance from the heel's outside face].
 */
export const HoleFeature = z
  .strictObject({
    at: z.tuple([z.number(), z.number()]),
    d_mm: Positive.optional().describe(
      "the drill; on a threaded hole its tap drill (absent: major diameter minus pitch)",
    ),
    thread: z.string().min(1).optional().describe('a tapped hole: "M6", "M10x1.25"'),
    depth_mm: Positive.optional().describe("a blind hole's or a thread's depth; absent: through"),
    csk: z
      .strictObject({ d_mm: Positive, angle_deg: z.number().gt(0).lt(180) })
      .optional()
      .describe("a countersink: its diameter at the face and its included angle"),
    cbore: z
      .strictObject({ d_mm: Positive, depth_mm: Positive })
      .optional()
      .describe("a counterbore: its diameter and depth"),
    face: z
      .enum(["front", "back"])
      .optional()
      .describe(
        "the face it is drilled from (a countersink's, a counterbore's, a blind hole's): front, a plate's face away from the face it mounts on, or a leg's inside face (the default); back, the other",
      ),
  })
  .refine((h) => h.d_mm !== undefined || h.thread !== undefined, {
    message: "a hole has d_mm or thread",
  })
  .refine((h) => h.csk === undefined || h.cbore === undefined, {
    message: "a hole is countersunk or counterbored, not both",
  })
  .refine((h) => h.thread === undefined || (h.csk === undefined && h.cbore === undefined), {
    message: "a countersink or a counterbore goes on a clearance hole, not a threaded one",
  });
export type HoleFeature = z.infer<typeof HoleFeature>;

const ItemDatums = z
  .record(DatumName, Vec3)
  .optional()
  .describe("named points in the item's own frame; `mount` lands on a station (§4.7)");

/** Who makes or sells it, and its price per unit in the project's currency. */
function supply(who: string) {
  return {
    supplier: SupplierId.optional().describe(who),
    price_minor: Minor.optional().describe(
      "per unit, in the project's currency: a number is an estimate; a valued field may give src, ref, read and a range",
    ),
  };
}

/** A custom plate (§4.8): an outline cut from sheet, with holes. +z is away from its mount face. */
export const PlateItem = z.strictObject({
  kind: z.literal("plate"),
  name: z.string().min(1),
  material: MaterialRef,
  thickness_mm: Positive,
  outline: z
    .array(z.tuple([z.number(), z.number()]))
    .min(3)
    .describe(
      "[x, y] corners in mm, in order around the plate; the plate lies from z = 0 to its thickness",
    ),
  holes: z.array(HoleFeature).optional(),
  datums: ItemDatums,
  ...supply("a fabricator; absent: local (made in-house)"),
  note: z.string().optional(),
});

/**
 * A bent angle (§4.8): sheet bent once through 90°. Leg a lies on its mount face (z = 0 to the
 * thickness, along +y), leg b stands up from the heel (y = 0 to the thickness, along +z); x runs
 * along its length. Each leg is measured to the outside of the other.
 */
export const BentAngleItem = z.strictObject({
  kind: z.literal("bent-angle"),
  name: z.string().min(1),
  material: MaterialRef,
  thickness_mm: Positive,
  length_mm: Positive.describe("along the bend"),
  legs_mm: z
    .tuple([Positive, Positive])
    .describe("leg a and leg b, each measured to the outside of the other"),
  bend_radius_mm: z.number().nonnegative().describe("the inside radius"),
  k_factor: z
    .number()
    .gt(0)
    .max(0.5)
    .describe(
      "where the neutral fibre lies, as a share of the thickness from the inside: the shop's",
    ),
  holes: z
    .strictObject({ a: z.array(HoleFeature).optional(), b: z.array(HoleFeature).optional() })
    .optional()
    .describe("holes in each leg"),
  datums: ItemDatums,
  ...supply("a fabricator; absent: local (made in-house)"),
  note: z.string().optional(),
});

/** An item no catalog holds, bought as a unit (§3.4's `generic`, §4.8). */
export const ProjectGenericItem = z.strictObject({
  kind: z.literal("generic"),
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  brand: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  material: MaterialRef.optional(),
  bbox_mm: Bbox3.optional(),
  datums: ItemDatums,
  mass_kg: Valued.optional().describe("a number is an estimate"),
  ...supply("who sells it; absent: unsourced"),
  note: z.string().optional(),
});

/**
 * A placeholder (§4.8): a body not chosen yet, drawn as its box. Other bars may bear on it as a
 * butt's body (§4.5, gap G-B). It blocks its own order line (§5.5).
 */
export const PlaceholderItem = z.strictObject({
  kind: z.literal("placeholder"),
  name: z.string().min(1),
  bbox_mm: Bbox3.describe("its box in its own frame"),
  datums: ItemDatums,
  mass_kg: Valued.optional().describe("a number is an estimate"),
  ...supply("who will sell it; absent: unsourced"),
  note: z.string().optional(),
});

export const ProjectItem = z.discriminatedUnion("kind", [
  PlateItem,
  BentAngleItem,
  ProjectGenericItem,
  PlaceholderItem,
]);
export type ProjectItem = z.infer<typeof ProjectItem>;
export type PlateItem = z.infer<typeof PlateItem>;
export type BentAngleItem = z.infer<typeof BentAngleItem>;
export type PlaceholderItem = z.infer<typeof PlaceholderItem>;
export type ProjectGenericItem = z.infer<typeof ProjectGenericItem>;

/** Project item kinds (§4.8), in the order outputs list them after §3.4's kinds. */
export const PROJECT_KINDS = ["plate", "bent-angle", "placeholder"] as const;

// ---------------------------------------------------------------------------------------------
// Costs, price bands, exchange rates, open items and the order rules (§4.11, §4.12, §5.5).

const SrcEnum = z.enum(["src", "meas", "est", "calc"]);

/** Provenance fields (§2), as cost lines and bands carry them. */
const ProvFields = {
  src: SrcEnum.optional().describe("absent: est"),
  ref: z.string().min(1).optional(),
  read: z.iso.date().optional(),
  note: z.string().optional(),
};

export const CostId = z
  .string()
  .regex(/^K\d+$/)
  .describe("a cost line: K<number>");
export const OpenId = z
  .string()
  .regex(/^O\d+$/)
  .describe("an open item: O<number>");

export const CostKind = z.enum([
  "machining",
  "fabrication",
  "labour",
  "freight",
  "lifting",
  "contingency",
  "other",
]);

/** The bars of one supplier, whose generated machining a cost line covers (§4.11). */
const ServicesOn = z.strictObject({ supplier: SupplierId });

/**
 * What a cost line prices as a whole (§4.11): the machining a supplier sells on its own bars
 * (`supplier` with `services: true`), the machining generated on bars bought from a supplier,
 * whoever does it (`services_on`: one supplier's bars, or a list, for one job on several
 * suppliers' bars; acceptance gap A6), or the BOM lines of some items.
 */
export const Covers = z
  .strictObject({
    supplier: SupplierId.optional(),
    services: z.literal(true).optional(),
    services_on: z
      .union([
        ServicesOn,
        z
          .array(ServicesOn)
          .min(1)
          .refine((l) => new Set(l.map((s) => s.supplier)).size === l.length, {
            message: "services_on names each supplier once",
          }),
      ])
      .optional()
      .describe("{ supplier }, or a list of them: the machining on those suppliers' bars"),
    items: z.array(ItemRef).min(1).optional(),
  })
  .refine((c) => (c.supplier === undefined) === (c.services === undefined), {
    message: '"services": true and "supplier" go together',
  })
  .refine((c) => c.services !== undefined || c.services_on !== undefined || c.items, {
    message: "covers names services, services_on or items",
  });
export type Covers = z.infer<typeof Covers>;

/** The suppliers whose bars' machining a cover names, in the order written. */
export function servicesOnSuppliers(c: Covers): string[] {
  if (c.services_on === undefined) return [];
  return (Array.isArray(c.services_on) ? c.services_on : [c.services_on]).map((s) => s.supplier);
}

const MinorInt = z.int().nonnegative();

/*
 * A cost line's fields in the design's order (§4.11): id, label, kind, supplier, the amounts,
 * provenance, blocks, then what it covers, then the variants it belongs to. The canonical form
 * (§2) writes keys in the order the schema declares them, so this order is the file's.
 */
const CostHead = {
  id: CostId,
  label: z.string().min(1),
};
const CostSupplier = { supplier: SupplierId.optional() };
const CostTail = {
  ...ProvFields,
  blocks: z.literal("order").nullable().optional().describe('"order": hold its supplier\'s order'),
};
/** A cost line's variants (§4.10; acceptance gap A5), as an entity's: written last. */
const CostScope = {
  only_in: Common.only_in,
  not_in: Common.not_in,
};

/** A cost line that is not a part (§4.11): low, likely and high in minor units. */
export const CostAmounts = z
  .strictObject({
    ...CostHead,
    kind: CostKind,
    ...CostSupplier,
    low_minor: MinorInt,
    likely_minor: MinorInt,
    high_minor: MinorInt,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional()
      .describe("absent: the project's"),
    ...CostTail,
    covers: Covers.optional(),
    ...CostScope,
  })
  .refine((c) => c.low_minor <= c.likely_minor && c.likely_minor <= c.high_minor, {
    message: "a cost line needs low_minor <= likely_minor <= high_minor",
  });

/** A contingency as a share of the subtotal: its pct applies to each of low, likely and high. */
export const CostPct = z.strictObject({
  ...CostHead,
  kind: z.literal("contingency"),
  ...CostSupplier,
  pct: z.number().nonnegative(),
  of: z.literal("subtotal"),
  ...CostTail,
  ...CostScope,
});

export const CostLine = z.union([CostPct, CostAmounts]);
export type CostLine = z.infer<typeof CostLine>;

/** Item kinds (§3.4), which a price band may select by. */
export const ItemKind = z.enum([
  "bar",
  "connector",
  "fastener",
  "carriage",
  "accessory",
  "panel",
  "generic",
]);

/**
 * A price band (§4.11, draft 2.1): a catalog-priced line's low and high as percentages of its
 * likely price, selected by item, supplier or kind.
 */
export const PriceBand = z
  .strictObject({
    item: ItemRef.optional(),
    supplier: SupplierId.optional(),
    kind: ItemKind.optional(),
    low_pct: z.number().min(-100).max(0),
    high_pct: z.number().nonnegative(),
    ...ProvFields,
    why: z.string().optional(),
  })
  .refine((b) => b.item !== undefined || b.supplier !== undefined || b.kind !== undefined, {
    message: "a price band selects by item, supplier or kind",
  });
export type PriceBand = z.infer<typeof PriceBand>;

/** An exchange rate (§4.11): units of the project's currency per unit of another, dated. */
export const Rate = z.union([
  z.number().positive(),
  z.strictObject({
    v: z.number().positive(),
    src: SrcEnum.optional(),
    ref: z.string().min(1).optional(),
    read: z.iso.date().optional(),
    note: z.string().optional(),
  }),
]);
export const Fx = z.record(z.string().regex(/^[A-Z]{3}$/), Rate);

/** An open item (§4.12): `blocks: "order"` holds the order of its scope's suppliers, or all. */
export const OpenItem = z.strictObject({
  id: OpenId,
  text: z.string().min(1),
  blocks: z.literal("order").nullable().optional(),
  scope: z
    .array(z.string().min(1))
    .optional()
    .describe('entity ids, or "supplier:<id>"; absent or empty: the whole order'),
});
export type OpenItem = z.infer<typeof OpenItem>;

/** The order rules (§5.5), in the design's table order. */
export const ORDER_RULES = [
  "check-error",
  "open-item",
  "placeholder",
  "missing-price",
  "est-price",
  "out-of-stock",
  "option-not-sold",
  "stale-price",
] as const;
export type OrderRule = (typeof ORDER_RULES)[number];
export const RuleAction = z.enum(["block", "warn", "off"]);
export type RuleAction = z.infer<typeof RuleAction>;
export const OrderRules = z.partialRecord(z.enum(ORDER_RULES), RuleAction);

/** Top-level keys in schema order (design §4.2, with draft 2.1's `runs` and `price_bands`). */
export const PROJECT_SHAPE = {
  schema: z.literal(PROJECT_SCHEMA),
  name: z.string().optional(),
  catalogs: z.array(z.string().min(1)).optional().describe("built-in ids or folder paths"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  price_basis: z.enum(["regular", "sale", "lowest"]).optional(),
  fx: Fx.optional(),
  ids: z.record(z.string(), z.int().nonnegative()).optional(),
  defaults: Defaults.optional(),
  params: z.record(ParamName, Param).optional(),
  nodes: z.record(NodeId, Node).optional(),
  bars: z.record(BarId, Bar).optional(),
  runs: z.record(RunId, Run).optional(),
  connections: z.record(ConnId, Connection).optional(),
  parts: z.record(PartId, Part).optional(),
  patterns: z.record(PatternId, Pattern).optional(),
  items: z.record(ProjectItemId, ProjectItem).optional().describe("project items (§4.8)"),
  costs: z.array(CostLine).optional(),
  price_bands: z.array(PriceBand).optional(),
  order: z.record(ItemRef, OrderChoice).optional(),
  order_rules: OrderRules.optional(),
  variants: Variants.optional(),
  checks: z.array(Loose).optional(),
  open: z.array(OpenItem).optional(),
  decisions: z.array(Loose).optional(),
  views: Loose.optional(),
} as const;

export const ProjectDoc = z.strictObject(PROJECT_SHAPE);
export type ProjectDoc = z.infer<typeof ProjectDoc>;

/** The entity maps, each validated entity by entity so one bad entity drops only itself. */
export const ENTITY_MAPS = {
  nodes: { id: NodeId, schema: Node },
  bars: { id: BarId, schema: Bar },
  runs: { id: RunId, schema: Run },
  connections: { id: ConnId, schema: Connection },
  parts: { id: PartId, schema: Part },
  patterns: { id: PatternId, schema: Pattern },
} as const;

/** The lists validated entry by entry, likewise; `id` names an entry's id field, if it has one. */
export const ENTITY_LISTS = {
  costs: { schema: CostLine, id: "id" },
  price_bands: { schema: PriceBand, id: undefined },
  open: { schema: OpenItem, id: "id" },
} as const;
