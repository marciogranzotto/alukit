import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOURS as EXPORT } from "../../mesh/style.ts";
import { contrast, failures, PAIRS } from "./contrast.ts";
import { COLOUR_TOKENS, COLOURS, viewTheme } from "./tokens.ts";

/**
 * The tokens as numbers (tokens.ts) and as CSS (src/ui/styles/tokens.css) are one set of values,
 * and every name §5.3 fixes is defined in both (docs/ux/plan.md §5.3).
 */

const CSS = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

/** A rule's custom properties, `--name: value;`, from the first block the selector opens. */
function block(selector: string): Map<string, string> {
  const at = CSS.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector} block`);
  const body = CSS.slice(at, CSS.indexOf("}", at)).replace(/\/\*[\s\S]*?\*\//g, "");
  return new Map(
    [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

const hex = (css: string | undefined) => {
  if (css === undefined || !/^#[0-9a-f]{6}$/i.test(css)) throw new Error(`not a #rrggbb: ${css}`);
  return Number.parseInt(css.slice(1), 16);
};

describe("tokens", () => {
  it("holds every colour token §5.3 names, in the CSS and as numbers, with the same values", () => {
    const root = block(":root");
    for (const name of COLOUR_TOKENS) expect(hex(root.get(name)), name).toBe(COLOURS.dark[name]);
  });

  it("gives light the light block's values, and dark's for the rest", () => {
    const root = block(":root");
    const light = block(':root[data-theme="light"]');
    for (const name of COLOUR_TOKENS) {
      expect(COLOURS.light[name], name).toBe(hex(light.get(name) ?? root.get(name)));
    }
  });

  it("defines the type, spacing, radius, elevation, row and focus tokens §5.3 names", () => {
    const root = block(":root");
    const names = [
      "font-sans",
      "font-mono",
      ...["display", "title", "figure", "body", "small"].flatMap((s) => [`fs-${s}`, `lh-${s}`]),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `sp-${n}`),
      "radius-control",
      "radius-card",
      "shadow-float",
      ...["cut", "order", "table", "compact"].map((r) => `row-h-${r}`),
      "focus-ring",
    ];
    for (const n of names) expect(root.has(n), n).toBe(true);
  });

  it("resolves every contrast pair to a #rrggbb token in both themes", () => {
    const root = block(":root");
    const light = block(':root[data-theme="light"]');
    for (const p of PAIRS) {
      for (const t of [p.fg, ...p.on]) {
        expect(root.has(t), t).toBe(true);
        hex(light.get(t) ?? root.get(t));
      }
    }
  });

  // WCAG 2.2 AA: 4.5:1 for text, 3:1 for graphics and a control's border (1.4.3, 1.4.11). The
  // pairs are contrast.ts's PAIRS; the same list runs on the running app in theme.spec.
  for (const theme of ["dark", "light"] as const) {
    it(`holds every text and status pair at its contrast ratio in the ${theme} theme`, () => {
      const root = block(":root");
      const light = block(':root[data-theme="light"]');
      const value = (t: string) => {
        const v = (theme === "light" ? light.get(t) : undefined) ?? root.get(t);
        hex(v);
        return v as string;
      };
      expect(failures(value)).toEqual([]);
      // The headline ratios the decisions note lists.
      expect(contrast(value("text-1"), value("bg-panel"))).toBeGreaterThan(12);
    });
  }

  it("draws the 3D view's selection, tool and status from the tokens, and its ground as a gradient", () => {
    for (const theme of ["dark", "light"] as const) {
      const t = viewTheme(theme);
      const c = COLOURS[theme];
      expect([t.selection, t.tool]).toEqual([c.sel, c.tool]);
      expect(t.status).toEqual({ ready: c.ready, blocked: c.blocked, warn: c.warn });
      expect(t.background).toHaveLength(2);
    }
    // The export keeps its own palette (D-UX-24); the dark view's bodies are still its.
    const t = viewTheme("dark");
    expect(t.body).toEqual({
      anodised: EXPORT.anodised,
      black: EXPORT.black,
      steel: EXPORT.steel,
      part: EXPORT.part,
      custom: EXPORT.custom,
      hole: EXPORT.hole,
      fastener: EXPORT.fastener,
    });
    expect(t.edge).toMatchObject({ colour: EXPORT.edge, placeholder: EXPORT.placeholderEdge });
  });
});

// The rule (§5.3): no colour literal outside the tokens. A `#rrggbb` string or a 0xRRGGBB number
// in a stylesheet or a module of src/ui or src/viewer is a colour the theme cannot change.
describe("no colour literal outside the tokens", () => {
  const ROOT = new URL("../..", import.meta.url).pathname;
  const ALLOWED = new Set(["ui/styles/tokens.css", "ui/theme/tokens.ts", "ui/theme/contrast.ts"]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(css|tsx?)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path);
    }
  };
  walk(join(ROOT, "ui"));
  walk(join(ROOT, "viewer"));

  it("finds the sources to search", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("has none in a stylesheet or a UI module", () => {
    const found: string[] = [];
    for (const f of files) {
      const rel = relative(ROOT, f);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(
        /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|(?<![\w])0x[0-9a-fA-F]{6}\b/g,
      )) {
        // The viewer's own 0xRRGGBB are S3's to move into ViewTheme (src/viewer/theme.ts).
        if (rel.startsWith("viewer/") && m[0].startsWith("0x")) continue;
        found.push(`${rel}: ${m[0]}`);
      }
    }
    expect(found).toEqual([]);
  });
});
