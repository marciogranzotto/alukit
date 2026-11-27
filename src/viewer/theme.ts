import type { MarkerKind } from "./overlay.ts";

/**
 * How the 3D view looks: every colour the viewer draws with, as the app's theme gives it
 * (`viewTheme` in src/ui/theme/tokens.ts, which holds the values; docs/ux/contracts.md). The
 * viewer reads its colours from here and from nothing else; the GLB writer keeps its own palette
 * in src/mesh/style.ts (D-UX-24), so a theme never moves an export's bytes.
 *
 * Colours are sRGB, as three.js takes a hex number: 0xRRGGBB. Owner: S3, which adds fields as
 * its tasks need them (tokens.ts gives each one a value).
 */

export type Hex = number;

export interface ViewLight {
  colour: Hex;
  intensity: number;
}

export interface ViewTheme {
  /** The background, top to bottom: one stop is a flat colour, two a gradient (S3.1). */
  background: readonly [Hex] | readonly [Hex, Hex];
  /** Fog toward the background from `near` to `far` mm from the camera; none when absent. */
  fog?: { colour: Hex; near: number; far: number } | undefined;
  /** The ambient light and the two directional ones: the key light and the fill. */
  lights: { ambient: ViewLight; key: ViewLight; fill: ViewLight };
  /**
   * Bodies: a bar by its finish's tone (src/mesh/style.ts's `finishTone`), a part by its tone
   * (`partTone`), the holes marked on the project's plates, the fasteners of face connections.
   */
  body: {
    anodised: Hex;
    black: Hex;
    steel: Hex;
    part: Hex;
    custom: Hex;
    hole: Hex;
    fastener: Hex;
  };
  /** The opacity of a translucent part: a placeholder, or an item with no box (a marker). */
  translucent: number;
  /** The lines along bodies' sharp edges, and a placeholder's outline. */
  edge: { colour: Hex; opacity: number; placeholder: Hex };
  /** The selection. */
  selection: Hex;
  /** What a hovered body tints toward (S3.2). */
  hover: Hex;
  /** What a tool is building or has picked: its picks, the work plane, the section outline. */
  tool: Hex;
  /** The problem groups' colours, for badges in the view (S3.7). */
  status: { ready: Hex; blocked: Hex; warn: Hex };
  /** The ground grid: its centre lines and the others. */
  grid: { centre: Hex; line: Hex };
  /** The tools' overlay: the snap marker by kind, the axis guides, the line drawn, the preview. */
  overlay: {
    marker: Readonly<Record<MarkerKind, Hex>>;
    axis: { x: Hex; y: Hex; z: Hex };
    line: Hex;
    ghost: Hex;
  };
}
