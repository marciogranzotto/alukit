import { z } from "zod";
import { GENERATORS } from "../sections/generators/index.ts";
import { DatumName, Face, IsoDate, LocalId, Ref, SourceRef, Vec2 } from "./common.ts";

/**
 * A section file, `sections/<id>.json` (design §3.5): one section, in mm, about its nominal
 * centre, local x along the width and y along the height.
 */

export const SECTION_SCHEMA = "alukit.section/1";

/** A closed ring of at least 3 vertices; the closing edge is implicit. */
export const RingSchema = z.array(Vec2).min(3);

export const Box2 = z
  .tuple([Vec2, Vec2])
  .refine(([a, b]) => a[0] < b[0] && a[1] < b[1], { message: "a box needs min < max" });

export const GrooveAt = z.strictObject({
  face: Face,
  at_mm: z.number().describe("the groove's centre along the face, in section coordinates"),
  type: Ref.describe("a groove type (§3.3)"),
});

export { DatumName };

const common = {
  schema: z.literal(SECTION_SCHEMA),
  id: LocalId,
  from: z
    .strictObject({
      ref: SourceRef,
      method: z.enum(["vector", "raster", "cad", "generator", "table", "hand"]),
      scale: z
        .string()
        .min(1)
        .optional()
        .describe('how the drawing was scaled, e.g. "width 40 mm"'),
      read: IsoDate.optional(),
      note: z.string().optional(),
    })
    .optional()
    .describe("where the section came from"),
  note: z.string().optional(),
};

/** Shapes drawn from a source: a vector outline (`exact`) or a raster trace (`traced`). */
export const DrawnSection = z.strictObject({
  ...common,
  fidelity: z.enum(["exact", "traced"]),
  props_ok: z
    .boolean()
    .describe("whether computed properties may stand in for missing published ones"),
  outline: RingSchema,
  holes: z.array(RingSchema).optional(),
  bbox_mm: Box2.describe("the nominal box, which cut lengths use (§3.5)"),
  grooves: z.array(GrooveAt).optional(),
  datums: z.record(DatumName, Vec2).optional(),
});

/** One parametric variant per generator, each with its own params. */
const parametric = Object.entries(GENERATORS).map(([name, g]) =>
  z.strictObject({
    ...common,
    fidelity: z.literal("parametric"),
    props_ok: z.boolean().describe("true for steel shapes; false for a T-slot envelope"),
    generator: z.literal(name),
    params: g.params,
  }),
);
export const ParametricSection = z.discriminatedUnion(
  "generator",
  parametric as unknown as [(typeof parametric)[number], ...(typeof parametric)[number][]],
);

/** The bounding box only: drawn as a box; no computed properties. */
export const BoxSection = z.strictObject({
  ...common,
  fidelity: z.literal("box"),
  props_ok: z.literal(false),
  bbox_mm: Box2,
  grooves: z.array(GrooveAt).optional(),
  datums: z.record(DatumName, Vec2).optional(),
});

export const SectionFile = z.discriminatedUnion("fidelity", [
  DrawnSection,
  ParametricSection,
  BoxSection,
]);
export type SectionFile = z.output<typeof SectionFile>;
