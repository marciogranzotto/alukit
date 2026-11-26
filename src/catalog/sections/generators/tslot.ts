import { z } from "zod";
import type { Vec2 } from "#core/section-properties.ts";
import { Face, Ref } from "../../schema/common.ts";
import { combine, disc, type Part, rect, triangle } from "../closed-form.ts";
import { circle } from "../geometry.ts";
import { box2, type GeneratedGroove, type Generator, type GrooveDims } from "./types.ts";

/**
 * A T-slot profile as a box less its slots (design §3.5): the overall box, one slot per groove (the
 * opening through the lip, then the wider chamber, which may narrow toward the bottom), and the
 * core bores. It is an envelope, not the real section: real profiles have cavities this does not
 * model, so a `tslot` section is drawn and cut from, and its `props_ok` is false.
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

/** The depth where the full-width chamber ends: where it starts to narrow, or the bottom. */
function chamberEnd(d: GrooveDims): number {
  return d.taper_from_mm ?? d.depth_mm;
}

/** A groove's half-widths along its centre line, as [depth, half-width] corners from the face. */
function profile(d: GrooveDims): [number, number][] {
  const o = d.opening_mm / 2;
  const u = d.undercut_mm / 2;
  const bottom = (d.bottom_mm ?? d.undercut_mm) / 2;
  const pts: [number, number][] = [
    [0, o],
    [d.lip_mm, o],
    [d.lip_mm, u],
    [chamberEnd(d), u],
  ];
  if (d.taper_from_mm !== undefined) pts.push([d.depth_mm, bottom]);
  return pts;
}

/**
 * The convex pieces of one slot in section coordinates: the mouth, the full-width chamber, and
 * the narrowing bottom when there is one.
 */
function slotPieces(g: GeneratedGroove, d: GrooveDims, w: number, h: number): Vec2[][] {
  const f = faceFrame(g.face, w, h);
  // `along` in section coordinates: the face's tangent axis, signed by the walk.
  const s = f.sign * g.at_mm;
  const pt = (along: number, depth: number): Vec2 => [
    f.c[0] + f.t[0] * (s + along) + f.n[0] * depth,
    f.c[1] + f.t[1] * (s + along) + f.n[1] * depth,
  ];
  const quad = (d0: number, w0: number, d1: number, w1: number): Vec2[] => [
    pt(-w0, d0),
    pt(w0, d0),
    pt(w1, d1),
    pt(-w1, d1),
  ];
  const o = d.opening_mm / 2;
  const u = d.undercut_mm / 2;
  const pieces = [quad(0, o, d.lip_mm, o), quad(d.lip_mm, u, chamberEnd(d), u)];
  if (d.taper_from_mm !== undefined) {
    pieces.push(quad(d.taper_from_mm, u, d.depth_mm, (d.bottom_mm as number) / 2));
  }
  return pieces;
}

/** Projects a polygon onto an axis: [min, max]. */
function project(poly: readonly Vec2[], ax: Vec2): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const [x, y] of poly) {
    const v = x * ax[0] + y * ax[1];
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

/**
 * Whether two convex polygons overlap with positive area (the separating axis theorem; pieces
 * that only touch do not overlap).
 */
export function convexOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Vec2;
      const q = poly[(i + 1) % poly.length] as Vec2;
      const ax: Vec2 = [q[1] - p[1], p[0] - q[0]];
      if (ax[0] === 0 && ax[1] === 0) continue;
      const [a0, a1] = project(a, ax);
      const [b0, b1] = project(b, ax);
      const eps = 1e-9 * Math.max(1, Math.abs(a0), Math.abs(a1), Math.abs(b0), Math.abs(b1));
      if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
    }
  }
  return true;
}

/** A polygon's closed-form parts: a quad as a rectangle plus its two side triangles. */
function quadParts(q: readonly Vec2[]): Part[] {
  const [p0, p1, p2, p3] = q as [Vec2, Vec2, Vec2, Vec2];
  return [triangle(p0, p1, p2), triangle(p0, p2, p3)];
}

export const tslot: Generator<TslotParams> = {
  name: "tslot",
  params: TslotParams,

  problems(p, ctx) {
    const out: string[] = [];
    const grooves = grooveList(p);
    const pieces: { what: string; poly: Vec2[] }[] = [];
    grooves.forEach((g, i) => {
      const d = ctx.groove(g.type as string);
      if (!d) {
        out.push(`groove ${i}: unknown groove type "${g.type}"`);
        return;
      }
      if (d.undercut_mm < d.opening_mm)
        out.push(`groove type "${g.type}": undercut narrower than the opening`);
      if (d.depth_mm <= d.lip_mm) out.push(`groove type "${g.type}": depth not beyond the lip`);
      if ((d.taper_from_mm === undefined) !== (d.bottom_mm === undefined))
        out.push(`groove type "${g.type}": taper_from_mm and bottom_mm go together`);
      if (d.taper_from_mm !== undefined && d.bottom_mm !== undefined) {
        if (!(d.taper_from_mm > d.lip_mm && d.taper_from_mm < d.depth_mm))
          out.push(`groove type "${g.type}": taper_from_mm not between the lip and the depth`);
        if (!(d.bottom_mm > 0 && d.bottom_mm <= d.undercut_mm))
          out.push(`groove type "${g.type}": bottom_mm not within the undercut`);
      }
      const f = faceFrame(g.face, p.w_mm, p.h_mm);
      if (Math.abs(g.at_mm) + d.undercut_mm / 2 >= f.half) {
        out.push(`groove ${i} on ${g.face} at ${g.at_mm} mm runs off the face`);
      }
      for (const poly of slotPieces(g, d, p.w_mm, p.h_mm))
        pieces.push({ what: `groove ${i}`, poly });
    });
    (p.bores ?? []).forEach((b, i) => {
      const [x, y] = b.at_mm;
      const r = b.d_mm / 2;
      if (Math.abs(x) + r >= p.w_mm / 2 || Math.abs(y) + r >= p.h_mm / 2) {
        out.push(`bore ${i} runs outside the profile`);
      }
      // The bore's square: conservative, as the closed form removes the disc independently.
      pieces.push({
        what: `bore ${i}`,
        poly: [
          [x - r, y - r],
          [x + r, y - r],
          [x + r, y + r],
          [x - r, y + r],
        ],
      });
    });
    // Slots and bores must not overlap: the closed form removes their areas independently.
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i] as { what: string; poly: Vec2[] };
        const b = pieces[j] as { what: string; poly: Vec2[] };
        if (a.what !== b.what && convexOverlap(a.poly, b.poly))
          out.push(`${a.what} overlaps ${b.what}`);
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
        const prof = profile(d);
        // Down the near side of the slot, then back up the far side.
        for (const [depth, half] of prof) outline.push(pt(s - half, depth));
        for (const [depth, half] of [...prof].reverse()) outline.push(pt(s + half, depth));
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
      for (const piece of slotPieces(g, d, p.w_mm, p.h_mm))
        for (const part of quadParts(piece)) parts.push([part, -1]);
    }
    for (const b of p.bores ?? []) parts.push([disc(b.at_mm[0], b.at_mm[1], b.d_mm), -1]);
    return combine(parts);
  },
};
