import type { ViewTheme } from "../../viewer/theme.ts";
import type { Model } from "../model.ts";

/**
 * The design tokens as numbers, for three.js (docs/ux/plan.md §5.3; docs/ux/contracts.md): the
 * colour tokens of src/ui/styles/tokens.css, the same values (a unit test holds them equal), and
 * the 3D view's own colours, from which `viewTheme` makes what the viewer draws with. Owner: S4,
 * which changes values, never names. Until S4.11 there is one theme: light has dark's values,
 * as tokens.css's light block is empty.
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
  "bg-app": 0x1b1f24,
  "bg-panel": 0x22272e,
  "bg-raised": 0x2a3038,
  "bg-well": 0x1b1f24,
  line: 0x373e47,
  "line-strong": 0x373e47,
  "text-1": 0xc9d1d9,
  "text-2": 0x8b949e,
  "text-3": 0x8b949e,
  sel: 0xff9f1c,
  "sel-text": 0xffd7a1,
  "sel-ink": 0x201304,
  act: 0x6cb6ff,
  "act-fill": 0x22272e,
  tool: 0x38bdf8,
  ready: 0x57ab5a,
  blocked: 0xf47067,
  warn: 0xe0b341,
  info: 0x6cb6ff,
};

/** Each theme's colour tokens, as numbers. */
export const COLOURS: Readonly<Record<Theme, Readonly<Record<ColourToken, number>>>> = {
  dark: DARK,
  light: DARK,
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

/** What the 3D view draws with in a theme. */
export function viewTheme(t: Theme): ViewTheme {
  const c = COLOURS[t];
  return {
    background: [c["bg-app"]],
    lights: VIEW_DARK.lights,
    body: VIEW_DARK.body,
    translucent: VIEW_DARK.translucent,
    edge: VIEW_DARK.edge,
    selection: c.sel,
    hover: VIEW_DARK.hover,
    tool: c.tool,
    status: { ready: c.ready, blocked: c.blocked, warn: c.warn },
    grid: VIEW_DARK.grid,
    overlay: VIEW_DARK.overlay,
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
