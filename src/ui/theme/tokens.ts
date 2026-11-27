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
 * The 3D view's own colours, which no stylesheet uses: the background and its fog, the lights,
 * bodies by finish, edges, the grid, the tools' overlay. C's rendering spec
 * (docs/ux/visual-design.md §5.1 to §5.3), valued by S3 with its rendering; the export keeps its
 * own palette (src/mesh/style.ts, D-UX-24). The light block is C's light viewport, for S4.11's
 * switch.
 */
const BODY = {
  anodised: 0xc4cbd2,
  black: 0x4a5058,
  steel: 0x9aa1a8,
  part: 0x7f9fc2,
  custom: 0xc9a27a,
  hole: 0x15181c,
  fastener: 0xc9a227,
  neutral: 0x9aa1a8,
} as const;

const VIEW = {
  dark: {
    background: [0x2b3038, 0x1c2026],
    fog: { colour: 0x23272e, near: -0.6, far: 4 },
    lights: {
      ambient: { colour: 0xffffff, intensity: 0.25 },
      key: { colour: 0xffffff, intensity: 1.7 },
      sky: { colour: 0xf2f5f8, ground: 0x4a4540, intensity: 1.9 },
    },
    edge: { colour: 0x5b6570, onDark: 0x9aa3ad, placeholder: 0xa9cdf0, selected: 0x8a4a00 },
    grid: { line: 0x2c3138, major: 0x3a414a, axis: { x: 0xc8574f, y: 0x5d9a5b } },
    overlay: { ring: 0x15181c, line: 0xffffff },
  },
  light: {
    background: [0xeef1f4, 0xd3d9df],
    fog: { colour: 0xe2e6ea, near: -0.6, far: 4 },
    lights: {
      ambient: { colour: 0xffffff, intensity: 0.3 },
      key: { colour: 0xffffff, intensity: 1.5 },
      sky: { colour: 0xffffff, ground: 0x6b665f, intensity: 1.7 },
    },
    edge: { colour: 0x2a3037, onDark: 0x9aa3ad, placeholder: 0x2a62b5, selected: 0x8a4a00 },
    grid: { line: 0xd9dee3, major: 0xc2c9d0, axis: { x: 0xc8574f, y: 0x5d9a5b } },
    overlay: { ring: 0x15181c, line: 0x1a1f26 },
  },
} as const;

/** What the 3D view draws with in a theme. */
export function viewTheme(t: Theme): ViewTheme {
  const c = COLOURS[t];
  const v = VIEW[t];
  return {
    background: v.background,
    fog: v.fog,
    lights: v.lights,
    body: BODY,
    cut: [1.12, 1.1, 1.04],
    translucent: 0.35,
    edge: { ...v.edge, opacity: 0.6, outline: 0.85, detail: 0.5, xray: 0.45 },
    selection: c.sel,
    hover: 0xffd29a,
    tool: c.tool,
    status: { ready: c.ready, blocked: c.blocked, warn: c.warn },
    grid: { ...v.grid, axisOpacity: 0.7 },
    overlay: {
      marker: {
        point: 0x4ade80,
        face: 0x4ade80,
        datum: 0x4ade80,
        line: c.tool,
        grid: c["text-3"],
        free: c["text-1"],
        pick: c.tool,
      },
      ring: v.overlay.ring,
      axis: { x: 0xef4444, y: 0x22c55e, z: 0x3b82f6 },
      line: v.overlay.line,
      ghost: c.tool,
    },
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
