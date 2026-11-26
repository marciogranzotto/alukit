import { TOL } from "./tolerances.ts";
import { atan2Deg } from "./trig.ts";

/**
 * Section properties of polygons with holes (design §3.6), by the
 * [polygon formulas](https://en.wikipedia.org/wiki/Second_moment_of_area#Any_polygon): Green's
 * theorem over each ring's edges. Pure: no three.js, no I/O, sums in a fixed order (§5.2).
 *
 * Coordinates are section-local mm: x along the width, y along the height. Rings are implicitly
 * closed (a repeated closing vertex adds a zero-length edge, which contributes nothing) and may
 * wind either way: an outline always adds area and a hole always removes it.
 */

export type Vec2 = readonly [number, number];
export type Ring = readonly Vec2[];

/** One solid piece: an outline and the holes inside it. */
export interface Region {
  readonly outline: Ring;
  readonly holes: readonly Ring[];
}

export interface SectionProperties {
  area_mm2: number;
  /** The centroid in section coordinates. */
  centroid_mm: Vec2;
  /** Second moments about axes through the centroid, parallel to section x and y. */
  Ix_mm4: number;
  Iy_mm4: number;
  /** Product of area, ∫xy dA, about the centroid. */
  Ixy_mm4: number;
  /** Principal second moments, I1 ≥ I2. */
  I1_mm4: number;
  I2_mm4: number;
  /**
   * The angle of the I1 axis from section x, counter-clockwise, in (-90, 90]. 0 when the section
   * is isotropic (Ix = Iy and Ixy = 0 within `tol.snap`), where every axis is principal.
   */
  principal_deg: number;
  /** Elastic section moduli to the extreme fibre: Ix / max|y − cy|, Iy / max|x − cx|. */
  Wx_mm3: number;
  Wy_mm3: number;
  /** Bounding box of the outlines: [min, max]. */
  bbox_mm: readonly [Vec2, Vec2];
}

interface RingSums {
  /** Signed area. */
  a: number;
  /** ∫x dA, ∫y dA. */
  sx: number;
  sy: number;
  /** ∫x² dA, ∫y² dA, ∫xy dA. */
  sxx: number;
  syy: number;
  sxy: number;
}

/** Green's-theorem sums over one ring, with coordinates taken relative to (ox, oy). */
function ringSums(ring: Ring, ox: number, oy: number): RingSums {
  let a = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    const x0 = p[0] - ox;
    const y0 = p[1] - oy;
    const x1 = q[0] - ox;
    const y1 = q[1] - oy;
    const c = x0 * y1 - x1 * y0;
    a += c;
    sx += (x0 + x1) * c;
    sy += (y0 + y1) * c;
    sxx += (x0 * x0 + x0 * x1 + x1 * x1) * c;
    syy += (y0 * y0 + y0 * y1 + y1 * y1) * c;
    sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
  }
  return { a: a / 2, sx: sx / 6, sy: sy / 6, sxx: sxx / 12, syy: syy / 12, sxy: sxy / 24 };
}

/** The signed area of a ring: positive when it winds counter-clockwise. */
export function ringArea(ring: Ring): number {
  return ringSums(ring, 0, 0).a;
}

function checkRing(ring: Ring, what: string): void {
  if (ring.length < 3) throw new RangeError(`${what} has ${ring.length} vertices; a ring needs 3`);
  for (const p of ring) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new RangeError(`${what} has a non-finite vertex`);
    }
  }
}

/**
 * Area, centroid, Ix, Iy and Ixy about the centroid, principal axes and elastic moduli.
 * Throws a RangeError on a ring with fewer than 3 vertices, a non-finite coordinate, or a net
 * area that is not positive; callers validate sections first and report those as diagnostics.
 */
export function sectionProperties(regions: readonly Region[]): SectionProperties {
  if (regions.length === 0) throw new RangeError("a section needs at least one region");
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  regions.forEach((r, i) => {
    checkRing(r.outline, `region ${i} outline`);
    r.holes.forEach((h, j) => {
      checkRing(h, `region ${i} hole ${j}`);
    });
    for (const [x, y] of r.outline) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });

  // Sum about the bounding-box centre rather than the origin: an outline far from the origin
  // would otherwise lose digits to cancellation in the parallel-axis step.
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  let A = 0;
  let Sx = 0;
  let Sy = 0;
  let Sxx = 0;
  let Syy = 0;
  let Sxy = 0;
  const add = (s: RingSums, sign: number): void => {
    A += sign * s.a;
    Sx += sign * s.sx;
    Sy += sign * s.sy;
    Sxx += sign * s.sxx;
    Syy += sign * s.syy;
    Sxy += sign * s.sxy;
  };
  for (const r of regions) {
    const o = ringSums(r.outline, ox, oy);
    add(o, o.a < 0 ? -1 : 1);
    for (const h of r.holes) {
      const s = ringSums(h, ox, oy);
      add(s, s.a < 0 ? 1 : -1);
    }
  }
  if (!(A > 0)) throw new RangeError(`the section's net area is ${A} mm²; it must be positive`);

  const cxr = Sx / A;
  const cyr = Sy / A;
  const Ix = Syy - A * cyr * cyr;
  const Iy = Sxx - A * cxr * cxr;
  const Ixy = Sxy - A * cxr * cyr;
  const cx = ox + cxr;
  const cy = oy + cyr;

  const mean = (Ix + Iy) / 2;
  const half = (Ix - Iy) / 2;
  const R = Math.sqrt(half * half + Ixy * Ixy);
  const isotropic = R <= TOL.snap * (Ix + Iy);
  // tan 2θ = −2 Ixy / (Ix − Iy); θ is the axis of the larger moment.
  const principal = isotropic ? 0 : atan2Deg(-2 * Ixy, Ix - Iy) / 2;

  let cMaxY = 0;
  let cMaxX = 0;
  for (const r of regions) {
    for (const [x, y] of r.outline) {
      cMaxX = Math.max(cMaxX, Math.abs(x - cx));
      cMaxY = Math.max(cMaxY, Math.abs(y - cy));
    }
  }

  return {
    area_mm2: A,
    centroid_mm: [cx, cy],
    Ix_mm4: Ix,
    Iy_mm4: Iy,
    Ixy_mm4: Ixy,
    I1_mm4: mean + R,
    I2_mm4: mean - R,
    principal_deg: principal === 0 ? 0 : principal,
    Wx_mm3: Ix / cMaxY,
    Wy_mm3: Iy / cMaxX,
    bbox_mm: [
      [minX, minY],
      [maxX, maxY],
    ],
  };
}
