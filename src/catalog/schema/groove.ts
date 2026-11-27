import { z } from "zod";
import { num, Valued } from "./common.ts";

/**
 * A section's own groove geometry (design §3.3, §3.5; after the round-4 acceptance, F9). A groove
 * type is an interface: what fits it (a T-nut's `groove`, a system's) and the dimensions measured
 * on the one profile the catalog names as its source. Profiles of one groove type still differ:
 * one series' 40x80 has a deeper lip than its 40x40. A section states the dimensions of its own
 * grooves, each with its source (printed on its drawing, measured on its outline, or read off a
 * raster image, an estimate with its range), and they replace its groove type's for every groove
 * of the section. `unread` names the dimensions its own drawing does not give reliably: no
 * judgement that rests on the profile's own groove (a head's room and bearing under the lips)
 * borrows another profile's value for them; the drawn envelope still takes the type's.
 */

/** The dimensions a groove has, in the order a groove type lists them. */
export const GROOVE_DIMS = [
  "opening_mm",
  "lip_mm",
  "depth_mm",
  "undercut_mm",
  "taper_from_mm",
  "bottom_mm",
  "hook_mm",
  "wall_mm",
] as const;
export type GrooveDim = (typeof GROOVE_DIMS)[number];

export const GrooveGeometry = z
  .strictObject({
    opening_mm: Valued.optional(),
    lip_mm: Valued.optional(),
    depth_mm: Valued.optional(),
    undercut_mm: Valued.optional(),
    taper_from_mm: Valued.optional(),
    bottom_mm: Valued.optional(),
    hook_mm: Valued.optional().describe(
      "the width over the lips' hooks: the lip's underside, which a head under the lips bears on, runs from the opening out to it, and beyond it the chamber rises toward the face",
    ),
    wall_mm: Valued.optional().describe(
      "the face wall's thickness beyond the hook: the depth the chamber rises to there",
    ),
    unread: z
      .array(z.enum(GROOVE_DIMS))
      .min(1)
      .optional()
      .describe("the dimensions this section's drawing does not give reliably"),
    note: z.string().optional(),
  })
  .superRefine((g, ctx) => {
    for (const d of g.unread ?? []) {
      if (g[d] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["unread"],
          message: `${d} is given and unread at once`,
        });
      }
    }
  });
export type GrooveGeometry = z.infer<typeof GrooveGeometry>;

/** A section's own groove dimensions, as numbers, with what its drawing does not give. */
export interface OwnGroove {
  values: Partial<Record<GrooveDim, number>>;
  unread: readonly GrooveDim[];
  note?: string;
}

/**
 * A groove's dimensions: its type's, with the section's own over them. The hook (`hook_mm` with
 * `wall_mm`) is part of the lip's shape: own geometry that gives the lip and neither gives a hook
 * nor leaves it unread says the lip has none, so the type's hook does not carry over.
 */
export function mergeGroove<T extends Partial<Record<GrooveDim, number>>>(
  type: T,
  own: OwnGroove | undefined,
): T {
  if (!own) return type;
  const out: Partial<Record<GrooveDim, number>> = { ...type, ...own.values };
  const hookless =
    own.values.lip_mm !== undefined &&
    own.values.hook_mm === undefined &&
    !own.unread.includes("hook_mm") &&
    !own.unread.includes("wall_mm");
  if (hookless) {
    delete out.hook_mm;
    delete out.wall_mm;
  }
  return out as T;
}

export function ownGroove(g: GrooveGeometry | undefined): OwnGroove | undefined {
  if (!g) return undefined;
  const values: Partial<Record<GrooveDim, number>> = {};
  for (const d of GROOVE_DIMS) {
    const v = g[d];
    if (v !== undefined) values[d] = num(v);
  }
  return { values, unread: g.unread ?? [], ...(g.note ? { note: g.note } : {}) };
}
