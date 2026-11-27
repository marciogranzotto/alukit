import type { BarJson } from "./model.ts";

/**
 * How things look in the GLB (design §9), as sRGB hex colours: the export's palette, which stays
 * as it is whatever the app's theme (D-UX-24), so `alukit export glb` and the app's export keep
 * their bytes. The viewer draws with the theme's colours instead (src/viewer/theme.ts, valued in
 * src/ui/theme/tokens.ts); both colour bodies by the same tones, which this file decides.
 * A bar's tone follows its finish: black, another finish (anodised), or none (steel). A part is
 * blue, a project plate or bent angle tan (§4.8), and its holes dark. Context (X11), bar or part,
 * is a neutral grey, translucent.
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
  /** Context (X11): a wall, a floor, a bench the frame stands beside; drawn, not built. */
  context: 0xa7adb4,
  fastener: 0xc9a227,
  edge: 0x15181c,
  selected: 0xff9f1c,
  /** What a tool has picked (a connection's bars): the viewer's only, as the selection is. */
  highlight: 0x38bdf8,
} as const;

/**
 * The opacity of a translucent body: a placeholder, an item with no box (a marker), or context
 * (X11).
 */
export const TRANSLUCENT_OPACITY = 0.35;

/** A bar's tone, by its finish: black, another finish (anodised), or none (steel). */
export type FinishTone = "anodised" | "black" | "steel";

export function finishTone(bar: Pick<BarJson, "opt">): FinishTone {
  if (bar.opt.finish === "black") return "black";
  if (bar.opt.finish !== undefined) return "anodised";
  return "steel";
}

/**
 * A part's tone: context (X11), whatever it is; else one of the project's own shapes (custom), or
 * any other part.
 */
export type PartTone = "context" | "custom" | "part";

export function partTone(p: { shape?: unknown; context?: boolean }): PartTone {
  return p.context ? "context" : p.shape ? "custom" : "part";
}

/** A part's colour: context's, a project shape's, or any other part's. */
export function partColour(p: { shape?: unknown; context?: boolean }): number {
  return COLOURS[partTone(p)];
}

/** A bar's colour: context's (X11), else its finish's. */
export function barColour(bar: Pick<BarJson, "opt" | "context">): number {
  return bar.context ? COLOURS.context : COLOURS[finishTone(bar)];
}
