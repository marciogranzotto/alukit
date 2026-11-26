import { z } from "zod";
import { combine, disc } from "../closed-form.ts";
import { circle } from "../geometry.ts";
import { box2, type Generator } from "./types.ts";

/** Round sections (design §3.5): solid bar, tube, and threaded rod. */

export const RodParams = z.strictObject({ d_mm: z.number().positive() });
export type RodParams = z.infer<typeof RodParams>;

export const rod: Generator<RodParams> = {
  name: "rod",
  params: RodParams,
  problems: () => [],
  generate: (p) => ({
    outline: circle(0, 0, p.d_mm),
    holes: [],
    bbox_mm: box2(p.d_mm, p.d_mm),
    grooves: [],
    datums: {},
  }),
  closedForm: (p) => combine([[disc(0, 0, p.d_mm), 1]]),
};

export const TubeParams = z.strictObject({
  d_mm: z.number().positive().describe("outside diameter"),
  t_mm: z.number().positive().describe("wall thickness"),
});
export type TubeParams = z.infer<typeof TubeParams>;

export const tube: Generator<TubeParams> = {
  name: "tube",
  params: TubeParams,
  problems: (p) => (2 * p.t_mm >= p.d_mm ? ["the wall is too thick for the diameter"] : []),
  generate: (p) => ({
    outline: circle(0, 0, p.d_mm),
    holes: [circle(0, 0, p.d_mm - 2 * p.t_mm)],
    bbox_mm: box2(p.d_mm, p.d_mm),
    grooves: [],
    datums: {},
  }),
  closedForm: (p) =>
    combine([
      [disc(0, 0, p.d_mm), 1],
      [disc(0, 0, p.d_mm - 2 * p.t_mm), -1],
    ]),
};

/**
 * ISO 898-1's stress-area diameter: As = π/4 × ((d2 + d3) / 2)², with d2 = d − 0.649519 P and
 * d3 = d − 1.226869 P, so (d2 + d3) / 2 = d − 0.938194 P.
 */
export function stressDiameter(d: number, pitch: number): number {
  return d - 0.938194 * pitch;
}

export const ThreadedRodParams = z.strictObject({
  d_mm: z.number().positive().describe("nominal diameter, for drawing"),
  pitch_mm: z.number().positive().describe("thread pitch; the stress area gives the properties"),
});
export type ThreadedRodParams = z.infer<typeof ThreadedRodParams>;

/**
 * A threaded rod: drawn at its nominal diameter, with properties from the circle of its stress
 * area (design §3.5).
 */
export const threadedRod: Generator<ThreadedRodParams> = {
  name: "threaded-rod",
  params: ThreadedRodParams,
  problems: (p) =>
    stressDiameter(p.d_mm, p.pitch_mm) <= 0 ? ["the pitch is too coarse for the diameter"] : [],
  generate: (p) => ({
    outline: circle(0, 0, p.d_mm),
    holes: [],
    props: { outline: circle(0, 0, stressDiameter(p.d_mm, p.pitch_mm)), holes: [] },
    bbox_mm: box2(p.d_mm, p.d_mm),
    grooves: [],
    datums: {},
  }),
  closedForm: (p) => combine([[disc(0, 0, stressDiameter(p.d_mm, p.pitch_mm)), 1]]),
};
