import type { ViewTheme } from "../../viewer/theme.ts";
import type { Model } from "../model.ts";

/**
 * The design tokens as numbers, for three.js (docs/ux/plan.md §5.3; docs/ux/contracts.md): the
 * colour tokens of src/ui/styles/tokens.css, the same values (a unit test holds them equal), and
 * the 3D view's own colours, from which `viewTheme` makes what the viewer draws with. Owner: S4,
 * which changes values, never names.
 */

export type Theme = "dark" | "light";

/** The colour tokens §5.3 names, as tokens.css writes them (without the leading `--`). */
export const COLOUR_TOKENS = [
  "bg-app",
  "bg-panel",
  "bg-raised",
  "bg-well",
  "line",
  "line-strong",
  "text-1",
  "text-2",
  "text-3",
  "sel",
  "sel-text",
  "sel-ink",
  "act",
  "act-fill",
  "tool",
  "ready",
  "blocked",
  "warn",
  "info",
] as const;
export type ColourToken = (typeof COLOUR_TOKENS)[number];

const DARK: Readonly<Record<ColourToken, number>> = {
  "bg-app": 0x181b20,
  "bg-panel": 0x1f2329,
  "bg-raised": 0x272c33,
  "bg-well": 0x14171b,
  line: 0x343a42,
  "line-strong": 0x6b7682,
  "text-1": 0xe8ecf0,
  "text-2": 0xaeb7c1,
  "text-3": 0x969fab,
  sel: 0xffa133,
  "sel-text": 0xffa133,
  "sel-ink": 0x201304,
  act: 0x74b4ff,
  "act-fill": 0x2e6bc6,
  tool: 0x3cc8e6,
  ready: 0x4fcb8d,
  blocked: 0xff7a6e,
  warn: 0xebc84a,
  info: 0x8db8f2,
};

const LIGHT: Readonly<Record<ColourToken, number>> = {
  "bg-app": 0xedf0f3,
  "bg-panel": 0xffffff,
  "bg-raised": 0xf3f5f8,
  "bg-well": 0xffffff,
  line: 0xdadfe5,
  "line-strong": 0x7a8591,
  "text-1": 0x1a1f26,
  "text-2": 0x48515c,
  "text-3": 0x626c77,
  sel: 0xe08417,
  "sel-text": 0x9a4f00,
  "sel-ink": 0x201304,
  act: 0x1f63c6,
  "act-fill": 0x1f63c6,
  tool: 0x0b7f9a,
  ready: 0x1b7a4b,
  blocked: 0xc2362b,
  warn: 0x8a6200,
  info: 0x2a62b5,
};

/** Each theme's colour tokens, as numbers. */
export const COLOURS: Readonly<Record<Theme, Readonly<Record<ColourToken, number>>>> = {
  dark: DARK,
  light: LIGHT,
};

/**
 * The 3D view's own colours, which no stylesheet uses: bodies by finish, cut faces, edges, the
 * fog, the grid, the lights, the tools' overlay. The dark theme's are C's rendering spec
 * (docs/ux/visual-design.md §5.1 to §5.3), valued by S3 with the rendering that uses them; the
 * export keeps its own palette (src/mesh/style.ts, D-UX-24). The selection, tool, status and
 * marker-text colours are tokens (`viewTheme`).
 */
const VIEW_DARK = {
  body: {
    anodised: 0xc4cbd2,
    black: 0x4a5058,
    steel: 0x9aa1a8,
    part: 0x7f9fc2,
    custom: 0xc9a27a,
    hole: 0x15181c,
    fastener: 0xc9a227,
    neutral: 0x9aa1a8,
    context: 0xa9b0b8,
  },
  cut: [1.12, 1.1, 1.04],
  translucent: 0.35,
  fog: { colour: 0x23272e, near: -0.6, far: 4 },
  edge: {
    colour: 0x5b6570,
    onDark: 0x9aa3ad,
    opacity: 0.6,
    outline: 0.85,
    detail: 0.5,
    placeholder: 0xa9cdf0,
    selected: 0x8a4a00,
    xray: 0.45,
  },
  /** What hover tints toward (S3.2, C's pale amber). */
  hover: 0xffd29a,
  grid: { line: 0x2c3138, major: 0x3a414a, axis: { x: 0xc8574f, y: 0x5d9a5b }, axisOpacity: 0.7 },
  lights: {
    ambient: { colour: 0xffffff, intensity: 0.25 },
    key: { colour: 0xffffff, intensity: 1.7 },
    sky: { colour: 0xf2f5f8, ground: 0x4a4540, intensity: 1.9 },
  },
  overlay: {
    marker: { point: 0x4ade80, face: 0x4ade80, datum: 0x4ade80 },
    ring: 0x15181c,
    axis: { x: 0xef4444, y: 0x22c55e, z: 0x3b82f6 },
    line: 0xffffff,
  },
} as const;

/**
 * The light theme's view colours (visual-design.md §5.1, §4.1): the ground is light, so bodies,
 * edges, the grid and the overlay's lines are darker than the dark theme's. Bodies keep the
 * finish tones' order (black darkest, anodised lightest).
 */
const VIEW_LIGHT = {
  ...VIEW_DARK,
  body: {
    anodised: 0xa3adb8,
    black: 0x2e333a,
    steel: 0x6f7780,
    part: 0x4a86c5,
    custom: 0xa9773f,
    hole: 0x30353b,
    fastener: 0xa8841a,
    neutral: 0x6f7780,
    context: 0x7d858e,
  },
  fog: { colour: 0xe2e6ea, near: -0.6, far: 4 },
  edge: { ...VIEW_DARK.edge, colour: 0x20262d, placeholder: 0x2f6aa8 },
  grid: { line: 0xc9d0d8, major: 0xadb5be, axis: { x: 0xc8574f, y: 0x5d9a5b }, axisOpacity: 0.7 },
  lights: {
    ambient: { colour: 0xffffff, intensity: 0.3 },
    key: { colour: 0xffffff, intensity: 1.5 },
    sky: { colour: 0xffffff, ground: 0x6b665f, intensity: 1.7 },
  },
  overlay: {
    marker: { point: 0x15803d, face: 0x15803d, datum: 0x15803d },
    ring: 0x15181c,
    axis: { x: 0xdc2626, y: 0x16a34a, z: 0x2563eb },
    line: 0x1a1f26,
  },
} as const;

/** The 3D view's background, top to bottom (visual-design.md §1): a gradient in each theme. */
const BACKGROUND: Readonly<Record<Theme, readonly [number, number]>> = {
  dark: [0x2b3038, 0x1c2026],
  light: [0xeef1f4, 0xd3d9df],
};

/**
 * What the 3D view draws with in a theme. The selection, tool and status colours are tokens; so
 * are the snap markers of a line, a pick and the preview bar (the tool's cyan: amber is the
 * selection's alone, U42), and of the grid and a free point (text colours).
 */
export function viewTheme(t: Theme): ViewTheme {
  const c = COLOURS[t];
  const v = t === "dark" ? VIEW_DARK : VIEW_LIGHT;
  return {
    background: BACKGROUND[t],
    fog: v.fog,
    lights: v.lights,
    body: v.body,
    cut: v.cut,
    translucent: v.translucent,
    edge: v.edge,
    selection: c.sel,
    hover: v.hover,
    tool: c.tool,
    status: { ready: c.ready, blocked: c.blocked, warn: c.warn },
    grid: v.grid,
    overlay: {
      marker: {
        ...v.overlay.marker,
        line: c.tool,
        grid: c["text-3"],
        free: c["text-1"],
        pick: c.tool,
      },
      ring: v.overlay.ring,
      axis: v.overlay.axis,
      line: v.overlay.line,
      ghost: c.tool,
    },
  };
}

/**
 * The colour of each catalog item the model uses, for colouring the view by item and the tables'
 * swatches (S4.3: hues by count, bars first, avoiding the selection's amber and the tool's cyan), as
 * 0xRRGGBB for the theme given (dark when absent). Items are the BOM's, so a bar's item and a
 * part's are one map.
 */
export function itemSwatches(m: Model, t: Theme = "dark"): ReadonlyMap<string, number> {
  // Profiles first (the frame's bars are what the colours tell apart), then by how many are used.
  const uses = new Map<string, { bar: boolean; n: number }>();
  for (const g of m.bom.groups) {
    for (const l of g.lines) {
      const u = uses.get(l.item) ?? { bar: g.kind === "bar", n: 0 };
      u.n += l.qty;
      uses.set(l.item, u);
    }
  }
  const ranked = [...uses].sort(
    (a, b) =>
      Number(b[1].bar) - Number(a[1].bar) ||
      b[1].n - a[1].n ||
      (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const dim = t === "dark" ? 1 : LIGHT_SWATCH_SCALE;
  return new Map(
    ranked.map(([item], i) => [item, scale(ITEM_HUES[i] ?? ITEM_NEUTRAL, dim)] as const),
  );
}

/**
 * The item palette (visual-design.md §4.1), most used first: none in the selection's amber or the
 * tool's cyan. Hues are assigned by count, so the commonest items get the clearest hues; every item
 * past the eighth shares the neutral. The light theme draws the same hues darker.
 */
const ITEM_HUES = [0x86aee0, 0x93c47d, 0xe08f8f, 0xb39dda, 0xd8cf72, 0x6fc2b0, 0xe39ac7, 0xa9b46a];
const ITEM_NEUTRAL = 0x9aa1a8;
const LIGHT_SWATCH_SCALE = 0.55;

function scale(rgb: number, k: number): number {
  const c = (shift: number) => Math.round(((rgb >> shift) & 255) * k);
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** A swatch's colour as CSS, for a style attribute. */
export function swatchCss(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, "0")}`;
}
