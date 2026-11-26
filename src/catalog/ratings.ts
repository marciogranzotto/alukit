import { z } from "zod";
import { type Kind, Quantities, Ref, Valued } from "./schema/common.ts";

/**
 * The ratings vocabulary (design §3.4, review m7, m16). Every item has a `ratings` bag whose keys
 * come only from this table; an unknown key, or a key that does not apply to the item's kind, is
 * a schema error, so the data stays typed. Keys marked `later` are read by v2 and v3 (D5), but
 * the schema has them from day one.
 *
 * A key's unit is the suffix of its name (§2), before any axis qualifier: `F_N.x` is in N along
 * the connector frame's x. `unit` repeats it so a test can hold the two together; "1" is a
 * dimensionless number, "-" a value that is not a number.
 */
export interface RatingDef {
  readonly unit: string;
  readonly meaning: string;
  readonly kinds: readonly Kind[];
  readonly schema: z.ZodType;
  readonly later: boolean;
}

/** `"not published"`, stated explicitly, where a rating is known to be absent. */
export const NotPublished = z.literal("not published");

const Stiffness = z
  .array(
    z.strictObject({
      pair: z.tuple([Ref, Ref]).describe("the two systems joined, e.g. two T-slot systems"),
      k: z.strictObject({
        x_N_per_mm: Valued.optional(),
        y_N_per_mm: Valued.optional(),
        z_N_per_mm: Valued.optional(),
        rx_Nmm_per_rad: Valued.optional(),
        ry_Nmm_per_rad: Valued.optional(),
        rz_Nmm_per_rad: Valued.optional(),
      }),
    }),
  )
  .describe(
    "joint stiffness per pair of profiles joined and per degree of freedom, in the connector frame",
  );

const Curve = z
  .array(z.tuple([z.number(), z.number()]))
  .describe("force against stroke: [[stroke_mm, force_N], ...]");

function def(
  unit: string,
  meaning: string,
  kinds: readonly Kind[],
  schema: z.ZodType,
  later = true,
): RatingDef {
  return { unit, meaning, kinds, schema, later };
}

const FASTENED: readonly Kind[] = ["connector", "fastener"];

export const RATINGS: Readonly<Record<string, RatingDef>> = {
  "F_N.x": def("N", "permissible force along the connector frame's x", FASTENED, Valued),
  "F_N.y": def("N", "permissible force along the connector frame's y", FASTENED, Valued),
  "F_N.z": def("N", "permissible force along the connector frame's z", FASTENED, Valued),
  "M_Nmm.x": def("Nmm", "permissible moment about the connector frame's x", FASTENED, Valued),
  "M_Nmm.y": def("Nmm", "permissible moment about the connector frame's y", FASTENED, Valued),
  "M_Nmm.z": def("Nmm", "permissible moment about the connector frame's z", FASTENED, Valued),
  safety_factor: def("1", "the safety factor the permissible values include", FASTENED, Valued),
  preload_N: def("N", "assembly preload", FASTENED, Valued),
  K: def("1", "nut factor: torque = K × d × preload", FASTENED, Valued),
  slip_N: def("N", "slip capacity of the joint", FASTENED, Valued),
  stiffness: def("-", "joint stiffness per pair of systems joined", ["connector"], Stiffness),
  C_N: def("N", "dynamic load rating", ["carriage", "generic"], Valued),
  C0_N: def("N", "static load rating", ["carriage", "generic"], Valued),
  C_basis_km: def(
    "km",
    "the travel C is rated for (50 or 100; makers differ)",
    ["carriage"],
    Valued,
  ),
  MR_Nm: def("Nm", "static moment rating, roll", ["carriage"], Valued),
  MP_Nm: def("Nm", "static moment rating, pitch", ["carriage"], Valued),
  MY_Nm: def("Nm", "static moment rating, yaw", ["carriage"], Valued),
  seal_N: def("N", "seal resistance per end seal (a maximum)", ["carriage"], Valued),
  mu: def("1", "friction coefficient", ["carriage"], Valued),
  preload_class: def(
    "-",
    "preload class as published (Z0, ZA, …)",
    ["carriage"],
    z.string().min(1),
  ),
  load_N: def(
    "N",
    'load capacity, or "not published" stated explicitly',
    ["accessory"],
    z.union([Valued, NotPublished]),
    false,
  ),
  "damper.energy_J": def("J", "energy absorbed per stroke", ["generic", "accessory"], Valued),
  "damper.force_max_N": def("N", "maximum force", ["generic", "accessory"], Valued),
  "damper.stroke_mm": def("mm", "stroke", ["generic", "accessory"], Valued),
  "damper.curve": def("-", "force against stroke", ["generic", "accessory"], Curve),
  "drive.pulley_F_N": def("N", "permissible belt force at the pulley", ["generic"], Valued),
  "drive.skip_F_N": def("N", "belt force at which the belt skips", ["generic"], Valued),
  "gearbox.radial_N": def("N", "the gearbox's permissible radial load", ["generic"], Valued),
  "anchor.eta": def(
    "-",
    "characteristic values from the anchor's ETA, keyed with unit suffixes (N_Rk_kN, …)",
    ["fastener"],
    Quantities,
  ),
};

/** The ratings keys a kind may carry, in table order. */
export function ratingKeys(kind: Kind): string[] {
  return Object.entries(RATINGS)
    .filter(([, d]) => d.kinds.includes(kind))
    .map(([k]) => k);
}

/** The strict `ratings` object for one kind: only the keys that apply to it. */
export function ratingsSchema(kind: Kind): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const key of ratingKeys(kind)) {
    shape[key] = (RATINGS[key] as RatingDef).schema
      .optional()
      .describe((RATINGS[key] as RatingDef).meaning);
  }
  return z.strictObject(shape);
}
