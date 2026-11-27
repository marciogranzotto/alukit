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
 * The 3D view's own colours, which no stylesheet uses: bodies by finish, edges, the grid, the
 * lights, the tools' overlay. Today's values, as the viewer drew them before the tokens.
 */
const VIEW_DARK = {
  body: {
    anodised: 0xb9c3cd,
    black: 0x3a3f46,
    steel: 0x8d949c,
    part: 0x6fa8dc,
    custom: 0xc49a6c,
    hole: 0x101316,
    fastener: 0xc9a227,
  },
  translucent: 0.35,
  edge: { colour: 0x15181c, opacity: 0.6, placeholder: 0xa9cdf0 },
  /** What hover tints toward (S3.2, C's pale amber); nothing hovers today. */
  hover: 0xffd29a,
  grid: { centre: 0x59636e, line: 0x2c3238 },
  lights: {
    ambient: { colour: 0xffffff, intensity: 0.9 },
    key: { colour: 0xffffff, intensity: 1.8 },
    fill: { colour: 0xffffff, intensity: 0.6 },
  },
  overlay: {
    marker: { point: 0x4ade80, line: 0x38bdf8, grid: 0x9aa4ae, free: 0xe5e7eb, pick: 0xff9f1c },
    axis: { x: 0xef4444, y: 0x22c55e, z: 0x3b82f6 },
    line: 0xffffff,
    ghost: 0xffb454,
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
  },
  edge: { colour: 0x20262d, opacity: 0.6, placeholder: 0x2f6aa8 },
  grid: { centre: 0x8b95a0, line: 0xc9d0d8 },
  overlay: {
    marker: { point: 0x15803d, line: 0x0b7f9a, grid: 0x59636e, free: 0x3a424c, pick: 0xc2640a },
    axis: { x: 0xdc2626, y: 0x16a34a, z: 0x2563eb },
    line: 0x1a1f26,
    ghost: 0xc2640a,
  },
} as const;

/** The 3D view's background, top to bottom (visual-design.md §1): a gradient in each theme. */
const BACKGROUND: Readonly<Record<Theme, readonly [number, number]>> = {
  dark: [0x2b3038, 0x1c2026],
  light: [0xeef1f4, 0xd3d9df],
};

/** What the 3D view draws with in a theme. The selection, tool and status colours are tokens. */
export function viewTheme(t: Theme): ViewTheme {
  const c = COLOURS[t];
  const v = t === "dark" ? VIEW_DARK : VIEW_LIGHT;
  return {
    background: BACKGROUND[t],
    lights: v.lights,
    body: v.body,
    translucent: v.translucent,
    edge: v.edge,
    selection: c.sel,
    hover: v.hover,
    tool: c.tool,
    status: { ready: c.ready, blocked: c.blocked, warn: c.warn },
    grid: v.grid,
    overlay: v.overlay,
  };
}

/**
 * The colour of each catalog item the model uses, for colouring the view by item and the tables'
 * swatches (S4.3: hues by count, avoiding the selection's amber and the tool's cyan). Today
 * nothing is coloured by item: the map is empty.
 */
export function itemSwatches(_m: Model): ReadonlyMap<string, number> {
  return new Map();
}
