import { describe, expect, it } from "vitest";
import { COLOURS as EXPORT } from "../mesh/style.ts";
import { viewTheme } from "../ui/theme/tokens.ts";
import { contrast, edgeColour, luminance, mix } from "./look.ts";

/**
 * The 3D view's colours (C §5.1, §5.2), as numbers: what the rendering spec asks of them, in
 * both themes. The export keeps its own palette (D-UX-24): glb.test.ts holds its bytes.
 */

describe("the view's theme", () => {
  for (const t of ["dark", "light"] as const) {
    const v = viewTheme(t);

    it(`${t}: a black profile's silhouette stands 3:1 or more off the background`, () => {
      // Its edges, or the body itself: on the dark background the edges carry it (C §2.1, 3).
      const edge = edgeColour(v, v.body.black);
      expect(edge).toBe(v.edge.onDark);
      for (const bg of v.background) {
        const best = Math.max(contrast(edge, bg), contrast(v.body.black, bg));
        expect(best).toBeGreaterThanOrEqual(3);
      }
      if (t === "dark") {
        for (const bg of v.background) expect(contrast(edge, bg)).toBeGreaterThanOrEqual(3);
        // And off the black body itself, so the outline shows on both sides of it.
        expect(contrast(edge, v.body.black)).toBeGreaterThanOrEqual(2);
      }
    });

    it(`${t}: a light body's edges are mid-tone, off the body`, () => {
      expect(edgeColour(v, v.body.anodised)).toBe(v.edge.colour);
      expect(contrast(v.edge.colour, v.body.anodised)).toBeGreaterThanOrEqual(2);
    });

    it(`${t}: the fog lies between the background's stops`, () => {
      const [top, bottom] = v.background;
      const f = v.fog?.colour as number;
      const [lo, hi] = [luminance(top), luminance(bottom ?? top)].sort((a, b) => a - b) as [
        number,
        number,
      ];
      expect(luminance(f)).toBeGreaterThanOrEqual(lo);
      expect(luminance(f)).toBeLessThanOrEqual(hi);
    });
  }

  it("leaves the export's palette as it was (D-UX-24)", () => {
    expect(EXPORT).toMatchObject({
      background: 0x1b1f24,
      anodised: 0xb9c3cd,
      black: 0x3a3f46,
      steel: 0x8d949c,
      edge: 0x15181c,
    });
  });

  it("mixes in sRGB", () => {
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mix(0xc4cbd2, 0xffa133, 0)).toBe(0xc4cbd2);
    expect(mix(0xc4cbd2, 0xffa133, 1)).toBe(0xffa133);
  });
});
