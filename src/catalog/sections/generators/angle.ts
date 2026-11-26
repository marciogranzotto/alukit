import { z } from "zod";
import type { Vec2 } from "#core/section-properties.ts";
import { combine, type Part, rect, spandrel } from "../closed-form.ts";
import { arc, dedupe } from "../geometry.ts";
import { box2, type Generator } from "./types.ts";

/**
 * A rolled angle (design §3.5), e.g. EN 10056-1: legs `b_mm` along section x and `a_mm` along
 * y, thickness `t_mm`, root radius `r1_mm` in the inside corner and toe radius `r2_mm` at the
 * inside edge of each leg's tip. About its bounding-box centre, with the heel (the outside
 * corner) at (−b/2, −a/2): datum `heel`.
 */
export const AngleParams = z.strictObject({
  a_mm: z.number().positive().describe("leg along section y"),
  b_mm: z.number().positive().describe("leg along section x"),
  t_mm: z.number().positive(),
  r1_mm: z.number().nonnegative().default(0).describe("root radius"),
  r2_mm: z.number().nonnegative().default(0).describe("toe radius"),
});
export type AngleParams = z.output<typeof AngleParams>;

export const angle: Generator<AngleParams> = {
  name: "angle",
  params: AngleParams,

  problems(p) {
    const out: string[] = [];
    if (p.t_mm >= Math.min(p.a_mm, p.b_mm)) out.push("the thickness is not less than a leg");
    if (p.r2_mm > p.t_mm) out.push("the toe radius is larger than the thickness");
    if (p.r1_mm + p.r2_mm > Math.min(p.a_mm, p.b_mm) - p.t_mm) {
      out.push("the root and toe radii do not fit on a leg's inside face");
    }
    return out;
  },

  generate(p) {
    const { a_mm: a, b_mm: b, t_mm: t, r1_mm: r1, r2_mm: r2 } = p;
    const x0 = -b / 2;
    const y0 = -a / 2;
    const outline: Vec2[] = [
      [x0, y0],
      [b / 2, y0],
      // toe of the horizontal leg
      ...arc(b / 2 - r2, y0 + t - r2, r2, 0, 90),
      // root, concave: clockwise from the horizontal leg's inside face to the vertical leg's
      ...arc(x0 + t + r1, y0 + t + r1, r1, 270, 180),
      // toe of the vertical leg
      ...arc(x0 + t - r2, a / 2 - r2, r2, 0, 90),
      [x0, a / 2],
    ];
    return {
      outline: dedupe(outline),
      holes: [],
      bbox_mm: box2(b, a),
      grooves: [],
      datums: { heel: [x0, y0] },
    };
  },

  closedForm(p) {
    const { a_mm: a, b_mm: b, t_mm: t, r1_mm: r1, r2_mm: r2 } = p;
    const x0 = -b / 2;
    const y0 = -a / 2;
    const parts: [Part, 1 | -1][] = [
      [rect(0, y0 + t / 2, b, t), 1],
      [rect(x0 + t / 2, y0 + t + (a - t) / 2, t, a - t), 1],
    ];
    if (r1 > 0) parts.push([spandrel(x0 + t, y0 + t, r1, 1, 1), 1]);
    if (r2 > 0) {
      parts.push(
        [spandrel(b / 2, y0 + t, r2, -1, -1), -1],
        [spandrel(x0 + t, a / 2, r2, -1, -1), -1],
      );
    }
    return combine(parts);
  },
};
