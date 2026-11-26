/**
 * The display outline of a section (design §3.5): each ring simplified with
 * [Ramer–Douglas–Peucker](https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm)
 * at 0.05 mm. Drawing only; properties always use the exact outline (review m11). Pure, with no
 * three.js, so the server sends display outlines and the viewer and the GLB writer share them.
 */

export type P2 = readonly [number, number];

/** §3.5: the tolerance for display outlines. */
export const DISPLAY_TOL_MM = 0.05;

/** Distance from p to the segment a–b. */
function segmentDistance(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** RDP on an open polyline from `pts[i]` to `pts[j]`, both kept; marks the points kept. */
function simplifyRange(pts: readonly P2[], i: number, j: number, tol: number, keep: boolean[]) {
  // An explicit stack: a finely flattened arc has thousands of points, too deep for recursion.
  const stack: [number, number][] = [[i, j]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    let worst = -1;
    let at = -1;
    for (let k = a + 1; k < b; k++) {
      const d = segmentDistance(pts[k] as P2, pts[a] as P2, pts[b] as P2);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at !== -1 && worst > tol) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
}

/**
 * A closed ring simplified: the ring is split at its first point and the point farthest from it,
 * and each half simplified, so the result does not depend on a seam the source happened to pick
 * more than RDP itself does. A ring with fewer than four points, or one RDP would reduce below a
 * triangle, is returned as it is.
 */
export function simplifyRing(ring: readonly P2[], tol = DISPLAY_TOL_MM): P2[] {
  const pts =
    ring.length > 1 && samePoint(ring[0] as P2, ring[ring.length - 1] as P2)
      ? ring.slice(0, -1)
      : [...ring];
  if (pts.length < 4) return pts.map((p) => [p[0], p[1]] as P2);
  const first = pts[0] as P2;
  let far = 0;
  let farD = -1;
  pts.forEach((p, k) => {
    const d = Math.hypot(p[0] - first[0], p[1] - first[1]);
    if (d > farD) {
      farD = d;
      far = k;
    }
  });
  const closed = [...pts, first];
  const keep = closed.map(() => false);
  keep[0] = true;
  keep[far] = true;
  keep[closed.length - 1] = true;
  simplifyRange(closed, 0, far, tol, keep);
  simplifyRange(closed, far, closed.length - 1, tol, keep);
  const out = pts.filter((_, k) => keep[k]).map((p) => [p[0], p[1]] as P2);
  return out.length >= 3 ? out : pts.map((p) => [p[0], p[1]] as P2);
}

function samePoint(a: P2, b: P2): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
