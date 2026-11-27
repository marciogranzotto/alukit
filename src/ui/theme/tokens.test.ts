import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOUR_TOKENS, COLOURS } from "./tokens.ts";

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
});
