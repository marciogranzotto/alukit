import type { BarJson } from "./model.ts";

/**
 * How things look: one palette for the viewer and the GLB writer (design §8, §9), as sRGB hex
 * colours. A bar's colour follows its finish: black, another finish (anodised), or none (steel).
 * A part is blue, a project plate or bent angle tan (§4.8), and its holes dark.
 */

export const COLOURS = {
  background: 0x1b1f24,
  anodised: 0xb9c3cd,
  black: 0x3a3f46,
  steel: 0x8d949c,
  part: 0x6fa8dc,
  /** The project's own plates and bent angles: made for this build, not bought. */
  custom: 0xc49a6c,
  hole: 0x101316,
  placeholderEdge: 0xa9cdf0,
  fastener: 0xc9a227,
  edge: 0x15181c,
  selected: 0xff9f1c,
  /** What a tool has picked (a connection's bars): the viewer's only, as the selection is. */
  highlight: 0x38bdf8,
} as const;

/** The opacity of a translucent part: a placeholder, or an item with no box (a marker). */
export const TRANSLUCENT_OPACITY = 0.35;

/** A part's colour: a project shape's, or any other part's. */
export function partColour(p: { shape?: unknown }): number {
  return p.shape ? COLOURS.custom : COLOURS.part;
}

export function barColour(bar: Pick<BarJson, "opt">): number {
  if (bar.opt.finish === "black") return COLOURS.black;
  if (bar.opt.finish !== undefined) return COLOURS.anodised;
  return COLOURS.steel;
}
