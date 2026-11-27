/**
 * WCAG 2.2 contrast (1.4.3 text 4.5:1, 1.4.11 graphics and a control's boundary 3:1), and the
 * list of every pair of tokens the stylesheets set as text or as a mark on a background. A unit
 * test (tokens.test.ts) holds the list on the tokens' CSS in both themes, and theme.spec holds it
 * on the running app's computed values. Owner: S4.
 */

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** The relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** The contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A computed colour, `rgb(r, g, b)` or `rgb(r g b)`, as `#rrggbb`. */
export function rgbToHex(css: string): string | undefined {
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(css);
  if (m === null) return undefined;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}

export interface Pair {
  /** The token drawn. */
  fg: string;
  /** The tokens it sits on. */
  on: readonly string[];
  /** The least ratio: 4.5 for text, 3 for large text, graphics and a control's border. */
  min: 3 | 4.5;
  /** What it is, for the failure message and the decisions note. */
  use: string;
}

const SURFACES = ["bg-app", "bg-panel", "bg-raised", "bg-well"] as const;
const WASHES = ["sel-wash", "blocked-wash", "warn-wash", "ready-wash", "info-wash"] as const;

/** Every text and status pair, by the token it is drawn in. */
export const PAIRS: readonly Pair[] = [
  { fg: "text-1", on: [...SURFACES, ...WASHES], min: 4.5, use: "values, names" },
  { fg: "text-2", on: [...SURFACES, ...WASHES], min: 4.5, use: "labels, column heads" },
  {
    fg: "text-3",
    on: [...SURFACES, "sel-wash"],
    min: 4.5,
    use: "units, dimmed decimals, hints",
  },
  { fg: "sel-text", on: [...SURFACES, "sel-wash"], min: 4.5, use: "the selection as text" },
  { fg: "sel-ink", on: ["sel"], min: 4.5, use: "text on a selection fill" },
  { fg: "act", on: SURFACES, min: 4.5, use: "links, primary actions" },
  { fg: "act-ink", on: ["act-fill"], min: 4.5, use: "text on a primary button" },
  {
    fg: "mark-active-text",
    on: ["bg-app", "bg-panel", "bg-raised"],
    min: 4.5,
    use: "the active tab and tool",
  },
  { fg: "tool", on: ["bg-panel"], min: 4.5, use: "what a tool is building, as text" },
  {
    fg: "tool",
    on: ["bg-app", "bg-raised", "bg-well"],
    min: 3,
    use: "what a tool is building, as a mark",
  },
  { fg: "ready", on: [...SURFACES, "ready-wash"], min: 4.5, use: "READY, checks pass" },
  { fg: "blocked", on: [...SURFACES, "blocked-wash"], min: 4.5, use: "BLOCKED, errors" },
  { fg: "warn", on: [...SURFACES, "warn-wash"], min: 4.5, use: "warnings, estimates" },
  { fg: "info", on: [...SURFACES, "info-wash"], min: 4.5, use: "notes" },
  {
    fg: "status-ink",
    on: ["ready", "blocked", "warn", "info"],
    min: 4.5,
    use: "a count on a status fill",
  },
  { fg: "blocked-ink", on: ["blocked-wash"], min: 4.5, use: "the read-only banner" },
  { fg: "blocked-ink-2", on: ["blocked-wash"], min: 4.5, use: "the banner's hint" },
  {
    fg: "line-strong",
    on: ["bg-panel", "bg-well", "bg-raised"],
    min: 3,
    use: "a control's border",
  },
  { fg: "act", on: ["bg-panel", "bg-app", "bg-raised"], min: 3, use: "the focus ring" },
];

export interface Failure {
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  use: string;
}

/** The pairs below their least ratio, given each token's `#rrggbb`. */
export function failures(value: (token: string) => string): Failure[] {
  const out: Failure[] = [];
  for (const p of PAIRS) {
    for (const bg of p.on) {
      const ratio = contrast(value(p.fg), value(bg));
      if (ratio < p.min) out.push({ fg: p.fg, bg, ratio, min: p.min, use: p.use });
    }
  }
  return out;
}
