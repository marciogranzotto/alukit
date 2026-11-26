import { z } from "zod";
import type { Vec2 } from "#core/section-properties.ts";
import { Face, Ref } from "../../schema/common.ts";
import { combine, disc, type Part, rect } from "../closed-form.ts";
import { circle } from "../geometry.ts";
import { box2, type GeneratedGroove, type Generator, type GrooveDims } from "./types.ts";

/**
 * A T-slot profile as a box less its slots (design §3.5): the overall box, one T-shaped slot per
 * groove (the opening through the lip, then the wider undercut chamber down to the slot depth),
 * and the core bores. It is an envelope, not the real section: real profiles have cavities this
 * does not model, so a `tslot` section is drawn and cut from, and its `props_ok` is false.
 *
 * The groove's dimensions come from its groove type in the catalog (§3.3), so a correction to a
 * groove is made once.
 */
export const TslotParams = z.strictObject({
  w_mm: z.number().positive().describe("overall width, along section x"),
  h_mm: z.number().positive().describe("overall height, along section y"),
  groove: Ref.describe("the groove type of every groove that names none"),
  grooves: z
    .array(
      z.strictObject({
        face: Face,
        at_mm: z.number().describe("the groove's centre along the face, in section coordinates"),
        type: Ref.optional(),
      }),
    )
    .min(1)
    .optional()
    .describe("default: one groove centred on each face"),
  bores: z
    .array(
      z.strictObject({ at_mm: z.tuple([z.number(), z.number()]), d_mm: z.number().positive() }),
    )
    .optional()
    .describe("core bores: centre and diameter"),
});
export type TslotParams = z.infer<typeof TslotParams>;

/** A face's frame for a counter-clockwise walk: its centre, walk direction and inward normal. */
interface FaceFrame {
  c: Vec2;
  t: Vec2;
  n: Vec2;
  half: number;
  /** +1 when the walk runs along increasing section coordinate. */
  sign: 1 | -1;
}

function faceFrame(face: GeneratedGroove["face"], w: number, h: number): FaceFrame {
  switch (face) {
    case "-y":
      return { c: [0, -h / 2], t: [1, 0], n: [0, 1], half: w / 2, sign: 1 };
    case "+x":
      return { c: [w / 2, 0], t: [0, 1], n: [-1, 0], half: h / 2, sign: 1 };
    case "+y":
      return { c: [0, h / 2], t: [-1, 0], n: [0, -1], half: w / 2, sign: -1 };
    case "-x":
      return { c: [-w / 2, 0], t: [0, -1], n: [1, 0], half: h / 2, sign: -1 };
  }
}

const WALK: readonly GeneratedGroove["face"][] = ["-y", "+x", "+y", "-x"];

function grooveList(p: TslotParams): GeneratedGroove[] {
  const list: TslotParams["grooves"] & object =
    p.grooves ?? WALK.map((face) => ({ face, at_mm: 0 }));
  return list.map((g) => ({
    face: g.face,
    at_mm: g.at_mm,
    type: g.type ?? p.groove,
  }));
}

/** The two rectangles of one slot, as [centre x, centre y, width, height]. */
function slotRects(g: GeneratedGroove, d: GrooveDims, w: number, h: number) {
  const f = faceFrame(g.face, w, h);
  const along = f.t[0] !== 0 ? "x" : "y";
  const place = (depth0: number, depth1: number, width: number) => {
    const mid = (depth0 + depth1) / 2;
    const cx = f.c[0] + f.n[0] * mid + (along === "x" ? g.at_mm : 0);
    const cy = f.c[1] + f.n[1] * mid + (along === "y" ? g.at_mm : 0);
    const thick = depth1 - depth0;
    return along === "x" ? ([cx, cy, width, thick] as const) : ([cx, cy, thick, width] as const);
  };
  return [place(0, d.lip_mm, d.opening_mm), place(d.lip_mm, d.depth_mm, d.undercut_mm)] as const;
}

export const tslot: Generator<TslotParams> = {
  name: "tslot",
  params: TslotParams,

  problems(p, ctx) {
    const out: string[] = [];
    const grooves = grooveList(p);
    const rects: { what: string; r: readonly [number, number, number, number] }[] = [];
    grooves.forEach((g, i) => {
      const d = ctx.groove(g.type as string);
      if (!d) {
        out.push(`groove ${i}: unknown groove type "${g.type}"`);
        return;
      }
      if (d.undercut_mm < d.opening_mm)
        out.push(`groove type "${g.type}": undercut narrower than the opening`);
      if (d.depth_mm <= d.lip_mm) out.push(`groove type "${g.type}": depth not beyond the lip`);
      const f = faceFrame(g.face, p.w_mm, p.h_mm);
      if (Math.abs(g.at_mm) + d.undercut_mm / 2 >= f.half) {
        out.push(`groove ${i} on ${g.face} at ${g.at_mm} mm runs off the face`);
      }
      for (const r of slotRects(g, d, p.w_mm, p.h_mm)) rects.push({ what: `groove ${i}`, r });
    });
    (p.bores ?? []).forEach((b, i) => {
      const [x, y] = b.at_mm;
      if (Math.abs(x) + b.d_mm / 2 >= p.w_mm / 2 || Math.abs(y) + b.d_mm / 2 >= p.h_mm / 2) {
        out.push(`bore ${i} runs outside the profile`);
      }
      rects.push({ what: `bore ${i}`, r: [x, y, b.d_mm, b.d_mm] });
    });
    // Slots and bores must not overlap: the closed form removes their areas independently.
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]?.r as readonly number[];
        const b = rects[j]?.r as readonly number[];
        const ox =
          Math.abs((a[0] as number) - (b[0] as number)) < ((a[2] as number) + (b[2] as number)) / 2;
        const oy =
          Math.abs((a[1] as number) - (b[1] as number)) < ((a[3] as number) + (b[3] as number)) / 2;
        if (ox && oy && rects[i]?.what !== rects[j]?.what) {
          out.push(`${rects[i]?.what} overlaps ${rects[j]?.what}`);
        }
      }
    }
    return [...new Set(out)];
  },

  generate(p, ctx) {
    const { w_mm: w, h_mm: h } = p;
    const grooves = grooveList(p);
    const outline: Vec2[] = [];
    const corner: Record<string, Vec2> = {
      "-y": [-w / 2, -h / 2],
      "+x": [w / 2, -h / 2],
      "+y": [w / 2, h / 2],
      "-x": [-w / 2, h / 2],
    };
    for (const face of WALK) {
      outline.push(corner[face] as Vec2);
      const f = faceFrame(face, w, h);
      const on = grooves
        .filter((g) => g.face === face)
        .map((g) => ({ g, s: f.sign * g.at_mm }))
        .sort((a, b) => a.s - b.s);
      for (const { g, s } of on) {
        const d = ctx.groove(g.type as string) as GrooveDims;
        const pt = (along: number, depth: number): Vec2 => [
          f.c[0] + f.t[0] * along + f.n[0] * depth,
          f.c[1] + f.t[1] * along + f.n[1] * depth,
        ];
        const o = d.opening_mm / 2;
        const u = d.undercut_mm / 2;
        outline.push(
          pt(s - o, 0),
          pt(s - o, d.lip_mm),
          pt(s - u, d.lip_mm),
          pt(s - u, d.depth_mm),
          pt(s + u, d.depth_mm),
          pt(s + u, d.lip_mm),
          pt(s + o, d.lip_mm),
          pt(s + o, 0),
        );
      }
    }
    return {
      outline,
      holes: (p.bores ?? []).map((b) => circle(b.at_mm[0], b.at_mm[1], b.d_mm)),
      bbox_mm: box2(w, h),
      grooves,
      datums: {},
    };
  },

  closedForm(p, ctx) {
    const parts: [Part, 1 | -1][] = [[rect(0, 0, p.w_mm, p.h_mm), 1]];
    for (const g of grooveList(p)) {
      const d = ctx.groove(g.type as string) as GrooveDims;
      for (const [cx, cy, sw, sh] of slotRects(g, d, p.w_mm, p.h_mm))
        parts.push([rect(cx, cy, sw, sh), -1]);
    }
    for (const b of p.bores ?? []) parts.push([disc(b.at_mm[0], b.at_mm[1], b.d_mm), -1]);
    return combine(parts);
  },
};
