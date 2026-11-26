import type { Vec2 } from "#core/section-properties.ts";

/**
 * Closed-form section properties, composed from primitives with known exact formulas: the
 * rectangle, the disc and the fillet spandrel (the corner region between a square and its
 * inscribed quarter circle). These are the test oracle for the generators: they share no code
 * with the polygon integration in src/core, so an error in either shows up as a mismatch.
 */

/** A primitive's area, centroid, and second moments about its own centroid. */
export interface Part {
  readonly A: number;
  readonly cx: number;
  readonly cy: number;
  readonly Ixc: number;
  readonly Iyc: number;
  readonly Ixyc: number;
}

export interface ClosedForm {
  area_mm2: number;
  centroid_mm: Vec2;
  /** About axes through the centroid, parallel to section x and y. */
  Ix_mm4: number;
  Iy_mm4: number;
  Ixy_mm4: number;
}

export function rect(cx: number, cy: number, w: number, h: number): Part {
  return { A: w * h, cx, cy, Ixc: (w * h ** 3) / 12, Iyc: (h * w ** 3) / 12, Ixyc: 0 };
}

export function disc(cx: number, cy: number, d: number): Part {
  const I = (Math.PI * d ** 4) / 64;
  return { A: (Math.PI * d * d) / 4, cx, cy, Ixc: I, Iyc: I, Ixyc: 0 };
}

/**
 * The spandrel of a fillet of radius r: the part of the square of side r at corner (x, y) that
 * lies outside the quarter circle touching the square's two far sides. `sx`, `sy` (±1) give the
 * direction the square extends from the corner. A rounded convex corner removes one; a root
 * fillet in a concave corner adds one.
 *
 * With the corner at the origin and the square in +x, +y (standard results, e.g. Roark):
 * A = (1 − π/4) r², centroid at r (10 − 3π) / (12 − 3π) on each axis, second moment about each
 * edge (1 − 5π/16) r⁴, product of area about the edges (19/24 − π/4) r⁴.
 */
export function spandrel(x: number, y: number, r: number, sx: 1 | -1, sy: 1 | -1): Part {
  const A = (1 - Math.PI / 4) * r * r;
  const c = (r * (10 - 3 * Math.PI)) / (12 - 3 * Math.PI);
  const Iedge = (1 - (5 * Math.PI) / 16) * r ** 4;
  const IxyEdge = (19 / 24 - Math.PI / 4) * r ** 4;
  const Ic = Iedge - A * c * c;
  const Ixyc = IxyEdge - A * c * c;
  return { A, cx: x + sx * c, cy: y + sy * c, Ixc: Ic, Iyc: Ic, Ixyc: sx * sy * Ixyc };
}

/** Adds (+1) and removes (−1) parts; the result is about the composite centroid. */
export function combine(parts: readonly (readonly [Part, 1 | -1])[]): ClosedForm {
  let A = 0;
  let Sx = 0;
  let Sy = 0;
  for (const [p, s] of parts) {
    A += s * p.A;
    Sx += s * p.A * p.cx;
    Sy += s * p.A * p.cy;
  }
  const cx = Sx / A;
  const cy = Sy / A;
  let Ix = 0;
  let Iy = 0;
  let Ixy = 0;
  for (const [p, s] of parts) {
    Ix += s * (p.Ixc + p.A * (p.cy - cy) ** 2);
    Iy += s * (p.Iyc + p.A * (p.cx - cx) ** 2);
    Ixy += s * (p.Ixyc + p.A * (p.cx - cx) * (p.cy - cy));
  }
  return { area_mm2: A, centroid_mm: [cx, cy], Ix_mm4: Ix, Iy_mm4: Iy, Ixy_mm4: Ixy };
}
