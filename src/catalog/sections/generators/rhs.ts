import { z } from "zod";
import { combine, type Part, rect, spandrel } from "../closed-form.ts";
import { roundedRect } from "../geometry.ts";
import { box2, type Generator } from "./types.ts";

/**
 * Rectangular (or square) hollow section with corner radii (design §3.5), e.g. EN 10219 or
 * EN 10210 tube. The outer corners have radius `ro_mm`, the inner `ri_mm`, which defaults to
 * `ro_mm − t_mm` (concentric corners) or 0.
 */
export const RhsParams = z.strictObject({
  b_mm: z.number().positive().describe("width, along section x"),
  h_mm: z.number().positive().describe("height, along section y"),
  t_mm: z.number().positive().describe("wall thickness"),
  ro_mm: z.number().nonnegative().default(0).describe("outer corner radius"),
  ri_mm: z
    .number()
    .nonnegative()
    .optional()
    .describe("inner corner radius; default ro − t, at least 0"),
});
export type RhsParams = z.output<typeof RhsParams>;

function inner(p: RhsParams): number {
  return p.ri_mm ?? Math.max(p.ro_mm - p.t_mm, 0);
}

/** A rounded rectangle as a rectangle less its four corner spandrels. */
function roundedRectParts(w: number, h: number, r: number, sign: 1 | -1): [Part, 1 | -1][] {
  const neg = (sign === 1 ? -1 : 1) as 1 | -1;
  const parts: [Part, 1 | -1][] = [[rect(0, 0, w, h), sign]];
  if (r > 0) {
    parts.push(
      [spandrel(w / 2, h / 2, r, -1, -1), neg],
      [spandrel(-w / 2, h / 2, r, 1, -1), neg],
      [spandrel(-w / 2, -h / 2, r, 1, 1), neg],
      [spandrel(w / 2, -h / 2, r, -1, 1), neg],
    );
  }
  return parts;
}

export const rhs: Generator<RhsParams> = {
  name: "rhs",
  params: RhsParams,

  problems(p) {
    const out: string[] = [];
    const bi = p.b_mm - 2 * p.t_mm;
    const hi = p.h_mm - 2 * p.t_mm;
    if (bi <= 0 || hi <= 0) out.push("the wall is too thick for the size");
    if (p.ro_mm > Math.min(p.b_mm, p.h_mm) / 2)
      out.push("the outer radius is larger than half the size");
    if (bi > 0 && hi > 0 && inner(p) > Math.min(bi, hi) / 2) {
      out.push("the inner radius is larger than half the inner size");
    }
    return out;
  },

  generate(p) {
    return {
      outline: roundedRect(p.b_mm, p.h_mm, p.ro_mm),
      holes: [roundedRect(p.b_mm - 2 * p.t_mm, p.h_mm - 2 * p.t_mm, inner(p))],
      bbox_mm: box2(p.b_mm, p.h_mm),
      grooves: [],
      datums: {},
    };
  },

  closedForm(p) {
    return combine([
      ...roundedRectParts(p.b_mm, p.h_mm, p.ro_mm, 1),
      ...roundedRectParts(p.b_mm - 2 * p.t_mm, p.h_mm - 2 * p.t_mm, inner(p), -1),
    ]);
  },
};
