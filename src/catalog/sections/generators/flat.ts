import { z } from "zod";
import type { Ring } from "#core/section-properties.ts";
import { combine, rect } from "../closed-form.ts";
import { box2, type Generator } from "./types.ts";

/** Flat bar (design §3.5): width along section x, thickness along y. */
export const FlatParams = z.strictObject({
  b_mm: z.number().positive().describe("width, along section x"),
  t_mm: z.number().positive().describe("thickness, along section y"),
});
export type FlatParams = z.infer<typeof FlatParams>;

export function rectRing(w: number, h: number): Ring {
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
}

export const flat: Generator<FlatParams> = {
  name: "flat",
  params: FlatParams,
  problems: () => [],
  generate: (p) => ({
    outline: rectRing(p.b_mm, p.t_mm),
    holes: [],
    bbox_mm: box2(p.b_mm, p.t_mm),
    grooves: [],
    datums: {},
  }),
  closedForm: (p) => combine([[rect(0, 0, p.b_mm, p.t_mm), 1]]),
};

/**
 * A rail's envelope from its published width and height (design §3.5): drawn as a box, bottom
 * centre `mount`, top centre `top` (the running face). Its properties are an envelope's, so a
 * rail section is declared with `props_ok: false` unless its maker publishes them.
 */
export const RailParams = z.strictObject({
  w_mm: z.number().positive().describe("rail width, along section x"),
  h_mm: z.number().positive().describe("rail height, along section y"),
});
export type RailParams = z.infer<typeof RailParams>;

export const rail: Generator<RailParams> = {
  name: "rail",
  params: RailParams,
  problems: () => [],
  generate: (p) => ({
    outline: rectRing(p.w_mm, p.h_mm),
    holes: [],
    bbox_mm: box2(p.w_mm, p.h_mm),
    grooves: [],
    datums: { mount: [0, -p.h_mm / 2], top: [0, p.h_mm / 2] },
  }),
  closedForm: (p) => combine([[rect(0, 0, p.w_mm, p.h_mm), 1]]),
};
