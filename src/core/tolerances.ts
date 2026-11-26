/**
 * Tolerances (design §2): fixed in code, the same everywhere.
 */
export const TOL = {
  /** mm: coincident points, a point on a line, coplanar faces, a line crossing an edge. */
  len: 0.01,
  /** degrees: parallel, perpendicular (a square cut), collinear. */
  ang: 0.001,
  /** Relative to a bar's length: a bar is vertical when its horizontal run is below this. */
  vert: 1e-6,
  /** Relative to a bar's length: warn about a near-vertical bar without an explicit `up`. */
  nearVert: 1e-2,
  /** Relative: snap before floor, ceil, round, output quantising, and check comparisons. */
  snap: 1e-9,
} as const;
