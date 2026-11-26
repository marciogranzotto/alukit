import type { BarJson } from "./model.ts";

/**
 * How things look: one palette for the viewer and the GLB writer (design §8, §9), as sRGB hex
 * colours. A bar's colour follows its finish: black, another finish (anodised), or none (steel).
 */

export const COLOURS = {
  background: 0x1b1f24,
  anodised: 0xb9c3cd,
  black: 0x3a3f46,
  steel: 0x8d949c,
  part: 0x6fa8dc,
  fastener: 0xc9a227,
  edge: 0x15181c,
  selected: 0xff9f1c,
} as const;

/** The opacity of a translucent part: a placeholder, or an item with no box (a marker). */
export const TRANSLUCENT_OPACITY = 0.35;

export function barColour(bar: Pick<BarJson, "opt">): number {
  if (bar.opt.finish === "black") return COLOURS.black;
  if (bar.opt.finish !== undefined) return COLOURS.anodised;
  return COLOURS.steel;
}
