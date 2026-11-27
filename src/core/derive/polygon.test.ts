import { describe, expect, it } from "vitest";
import {
  area2,
  convexPieces,
  discArea,
  distanceOutside,
  inPolygon,
  isConvex,
  type P2,
  sharedArea,
  triangulate,
} from "./polygon.ts";

/** An L of area 3: a 2 x 2 square less its top right quarter. */
const L: P2[] = [
  [0, 0],
  [2, 0],
  [2, 1],
  [1, 1],
  [1, 2],
  [0, 2],
];
const square = (x0: number, y0: number, s: number): P2[] => [
  [x0, y0],
  [x0 + s, y0],
  [x0 + s, y0 + s],
  [x0, y0 + s],
];

describe("plane polygons", () => {
  it("takes signed areas and tells a convex polygon from one that is not", () => {
    expect(area2(L)).toBe(3);
    expect(area2([...L].reverse())).toBe(-3);
    expect(isConvex(L)).toBe(false);
    expect(isConvex(square(0, 0, 1))).toBe(true);
  });

  it("cuts an outline into counter-clockwise triangles that cover it, dropping straight runs", () => {
    const tris = triangulate(L);
    expect(tris).toHaveLength(4);
    expect(tris.every((t) => area2(t) > 0)).toBe(true);
    expect(tris.reduce((s, t) => s + area2(t), 0)).toBeCloseTo(3, 12);
    // A square with a vertex halfway along each side is two triangles.
    const eight: P2[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
      [1, 2],
      [0, 2],
      [0, 1],
    ];
    expect(triangulate(eight)).toHaveLength(2);
    expect(convexPieces(L)).toHaveLength(4);
    expect(convexPieces(eight)).toHaveLength(1);
  });

  it("gives the area a polygon shares with another, convex or not, either way round", () => {
    // A unit square centred on the L's inner corner: all but its top right quarter is on the L.
    const s = square(0.5, 0.5, 1);
    expect(sharedArea(s, convexPieces(L))).toBeCloseTo(0.75, 12);
    expect(sharedArea([...s].reverse(), convexPieces([...L].reverse()))).toBeCloseTo(0.75, 12);
    // The L clipped by the square, with the L as the subject: the same.
    expect(sharedArea(L, convexPieces(s))).toBeCloseTo(0.75, 12);
    expect(sharedArea(square(5, 5, 1), convexPieces(L))).toBe(0);
  });

  it("measures a point's distance outside a polygon, 0 inside or on its edge", () => {
    expect(inPolygon([0.5, 0.5], L)).toBe(true);
    expect(inPolygon([1.5, 1.5], L)).toBe(false);
    expect(distanceOutside([0.5, 0.5], L)).toBe(0);
    expect(distanceOutside([1, 1.5], L)).toBe(0);
    expect(distanceOutside([1.5, 1.5], L)).toBeCloseTo(0.5, 12);
    // The L has no corner at (2, 2): the nearest points are (2, 1) and (1, 2).
    expect(distanceOutside([3, 3], L)).toBeCloseTo(Math.sqrt(5), 12);
  });
});

describe("a disc on a polygon", () => {
  it("shares its whole area with a polygon round it, half with a half-plane, and a band's chord", () => {
    const big = square(-10, -10, 20);
    expect(discArea([0, 0], 1, big)).toBeCloseTo(Math.PI, 12);
    expect(discArea([0, 0], 1, [...big].reverse())).toBeCloseTo(Math.PI, 12);
    expect(discArea([0, 0], 1, square(0, -10, 20))).toBeCloseTo(Math.PI / 2, 12);
    // The band |x| ≤ h through a disc of radius r: 2 (h √(r² − h²) + r² asin(h / r)).
    const [r, h] = [6.5, 4.1];
    const band: P2[] = [
      [-h, -10],
      [h, -10],
      [h, 10],
      [-h, 10],
    ];
    const want = 2 * (h * Math.sqrt(r * r - h * h) + r * r * Math.asin(h / r));
    expect(discArea([0, 0], r, band)).toBeCloseTo(want, 10);
    // Off centre, and a disc that misses the polygon.
    expect(discArea([3, 0], 1, square(0, -10, 20))).toBeCloseTo(Math.PI, 12);
    expect(discArea([30, 0], 1, big)).toBeCloseTo(0, 12);
    // A disc on an L's inner corner: three quarters of it.
    expect(discArea([1, 1], 0.5, L)).toBeCloseTo((3 * Math.PI * 0.25) / 4, 12);
  });
});
