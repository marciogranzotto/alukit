import type { MarkerKind } from "./overlay.ts";

/**
 * How the 3D view looks: every colour the viewer draws with, as the app's theme gives it
 * (`viewTheme` in src/ui/theme/tokens.ts, which holds the values; docs/ux/contracts.md). The
 * viewer reads its colours from here and from nothing else; the GLB writer keeps its own palette
 * in src/mesh/style.ts (D-UX-24), so a theme never moves an export's bytes.
 *
 * Colours are sRGB, as three.js takes a hex number: 0xRRGGBB. Owner: S3, which adds fields as
 * its tasks need them (tokens.ts gives each one a value). The look follows C's rendering spec
 * (docs/ux/visual-design.md §5).
 */

export type Hex = number;

export interface ViewLight {
  colour: Hex;
  intensity: number;
}

export interface ViewTheme {
  /** The background, top to bottom: one stop is a flat colour, two a vertical gradient. */
  background: readonly [Hex] | readonly [Hex, Hex];
  /**
   * Depth fog toward `colour`, linear: it starts `near` model radii beyond the camera's target
   * (negative: before it) and is whole `far` radii further on. None when absent.
   */
  fog?: { colour: Hex; near: number; far: number } | undefined;
  /**
   * The lights: a sky light (a hemisphere: tops lit in `colour`, undersides in `ground`), a key
   * light that rides with the camera, above and to the left of the eye, and a low ambient.
   */
  lights: {
    ambient: ViewLight;
    key: ViewLight;
    sky: ViewLight & { ground: Hex };
  };
  /**
   * Bodies: a bar by its finish's tone (src/mesh/style.ts's `finishTone`), a part by its tone
   * (`partTone`), the holes marked on the project's plates, the fasteners of face connections,
   * and `neutral`, an item's colour when the view is coloured by item and it has no swatch.
   */
  body: {
    anodised: Hex;
    black: Hex;
    steel: Hex;
    part: Hex;
    custom: Hex;
    hole: Hex;
    fastener: Hex;
    neutral: Hex;
  };
  /** A bar's cut faces (its ends), as factors on its side colour: a shade brighter, like sawn metal. */
  cut: readonly [number, number, number];
  /** The opacity of a translucent part: a placeholder, or an item with no box (a marker). */
  translucent: number;
  /**
   * The lines along bodies' edges. `colour` on a light body, `onDark` on a dark one (a black
   * profile), so a silhouette shows against the body and the background alike. Outline edges
   * (ends, silhouettes) at `outline` opacity; detail edges (slot lips, chambers) fade in with
   * zoom up to `detail` in perspective, and stay at `opacity` in orthographic views. A
   * placeholder's outline; a selected body's outline, and the x-ray of its hidden part.
   */
  edge: {
    colour: Hex;
    onDark: Hex;
    opacity: number;
    outline: number;
    detail: number;
    placeholder: Hex;
    selected: Hex;
    xray: number;
  };
  /** The selection. */
  selection: Hex;
  /** What a hovered body tints toward. */
  hover: Hex;
  /** What a tool is building or has picked: its picks, the preview, the work plane, the section outline. */
  tool: Hex;
  /** Status colours: joint markers (joined, open, failed) and problem badges (warn, blocked). */
  status: { ready: Hex; blocked: Hex; warn: Hex };
  /**
   * The ground grid: 100 mm lines, metre lines, and the world X and Y axes across it (at
   * `axisOpacity`).
   */
  grid: { line: Hex; major: Hex; axis: { x: Hex; y: Hex }; axisOpacity: number };
  /**
   * The tools' overlay: the snap marker by kind, the dark ring round every marker, the axis
   * guides (and the orientation gizmo's axes), the line drawn, the preview bar.
   */
  overlay: {
    marker: Readonly<Record<MarkerKind, Hex>>;
    ring: Hex;
    axis: { x: Hex; y: Hex; z: Hex };
    line: Hex;
    ghost: Hex;
  };
}
