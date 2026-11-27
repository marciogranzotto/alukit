/**
 * Plane polygons in a face's own 2D terms: area, clipping, containment, distance and the area two
 * of them share. A face connection's contacts (§4.5) and a butt's seat on its face use them.
 */

export type P2 = readonly [number, number];

/** The signed area: positive when the polygon winds counter-clockwise (the shoelace formula). */
export function area2(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i] as P2;
    const [x1, y1] = poly[(i + 1) % poly.length] as P2;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** The polygon wound counter-clockwise. */
export function ccw(poly: readonly P2[]): P2[] {
  return area2(poly) < 0 ? [...poly].reverse() : [...poly];
}

/**
 * Sutherland–Hodgman: a polygon clipped by a convex counter-clockwise one. The subject may be
 * concave: the result may then carry zero-width bridges along the clipper's edges, which add
 * nothing to its area, so its area is the area the two share.
 */
export function clip(subject: readonly P2[], clipper: readonly P2[]): P2[] {
  let out: P2[] = [...subject];
  for (let i = 0; i < clipper.length && out.length > 0; i++) {
    const [ax, ay] = clipper[i] as P2;
    const [bx, by] = clipper[(i + 1) % clipper.length] as P2;
    const side = ([px, py]: P2) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j] as P2;
      const q = input[(j + 1) % input.length] as P2;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const r = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * r, p[1] + (q[1] - p[1]) * r]);
      }
    }
  }
  return out;
}

const cross3 = (a: P2, b: P2, c: P2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** A counter-clockwise polygon turns left (or goes straight) at every vertex. */
export function isConvex(poly: readonly P2[], eps = 1e-9): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    if (cross3(poly[i] as P2, poly[(i + 1) % n] as P2, poly[(i + 2) % n] as P2) < -eps) {
      return false;
    }
  }
  return true;
}

/**
 * A simple counter-clockwise polygon as triangles, by ear clipping (Meisters 1975): a vertex that
 * turns left and whose triangle holds no other vertex is cut off, until three are left. Only a
 * vertex that turns right can lie in such a triangle when any does, so only those are tried
 * (Eberly, "Triangulation by Ear Clipping"), which keeps a nearly convex outline's cost near
 * n². Vertices on a straight run are dropped first; they add no area.
 */
export function triangulate(poly: readonly P2[], eps = 1e-9): [P2, P2, P2][] {
  let ring = [...poly];
  // Drop vertices with no turn, and repeated ones.
  for (let changed = true; changed && ring.length > 3; ) {
    changed = false;
    for (let i = 0; i < ring.length && ring.length > 3; i++) {
      const n = ring.length;
      const a = ring[(i + n - 1) % n] as P2;
      const b = ring[i] as P2;
      const c = ring[(i + 1) % n] as P2;
      if (Math.abs(cross3(a, b, c)) <= eps) {
        ring.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  const out: [P2, P2, P2][] = [];
  const inside = (p: P2, a: P2, b: P2, c: P2) =>
    cross3(a, b, p) >= -eps && cross3(b, c, p) >= -eps && cross3(c, a, p) >= -eps;
  while (ring.length > 3) {
    const n = ring.length;
    const turn = (i: number) =>
      cross3(ring[(i + n - 1) % n] as P2, ring[i] as P2, ring[(i + 1) % n] as P2);
    const reflex: number[] = [];
    for (let i = 0; i < n; i++) if (turn(i) <= eps) reflex.push(i);
    let cut = -1;
    for (let i = 0; i < n && cut < 0; i++) {
      if (turn(i) <= eps) continue;
      const a = ring[(i + n - 1) % n] as P2;
      const b = ring[i] as P2;
      const c = ring[(i + 1) % n] as P2;
      let free = true;
      for (const j of reflex) {
        if (j === (i + 1) % n || j === (i + n - 1) % n) continue;
        const p = ring[j] as P2;
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        if (inside(p, a, b, c)) {
          free = false;
          break;
        }
      }
      if (free) cut = i;
    }
    // A ring this far from simple has no ear within eps: cut its most convex vertex.
    if (cut < 0) {
      let best = -Infinity;
      for (let i = 0; i < n; i++) {
        const t = cross3(ring[(i + n - 1) % n] as P2, ring[i] as P2, ring[(i + 1) % n] as P2);
        if (t > best) {
          best = t;
          cut = i;
        }
      }
    }
    out.push([ring[(cut + n - 1) % n] as P2, ring[cut] as P2, ring[(cut + 1) % n] as P2]);
    ring = ring.filter((_, k) => k !== cut);
  }
  if (ring.length === 3) out.push([ring[0] as P2, ring[1] as P2, ring[2] as P2]);
  return out;
}

/** A simple polygon as convex counter-clockwise pieces: itself when convex, else its triangles. */
export function convexPieces(poly: readonly P2[]): P2[][] {
  const c = ccw(poly);
  return isConvex(c) ? [c] : triangulate(c);
}

/**
 * The area a simple polygon (any winding) shares with another given as its convex pieces
 * (`convexPieces`): the first clipped by each piece.
 */
export function sharedArea(a: readonly P2[], pieces: readonly (readonly P2[])[]): number {
  const s = ccw(a);
  let sum = 0;
  for (const p of pieces) {
    const r = clip(s, ccw(p));
    if (r.length >= 3) sum += area2(r);
  }
  return Math.max(0, sum);
}

/** A point is inside a simple polygon, or on its edge (within eps): the crossing-number test. */
export function inPolygon(p: P2, poly: readonly P2[], eps = 1e-9): boolean {
  if (distanceToEdges(p, poly) <= eps) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as P2;
    const [xj, yj] = poly[j] as P2;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** A point's distance from a polygon's edges. */
export function distanceToEdges(p: P2, poly: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t =
      l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/** A point's distance from a polygon: 0 inside it. */
export function distanceOutside(p: P2, poly: readonly P2[]): number {
  return inPolygon(p, poly) ? 0 : distanceToEdges(p, poly);
}

/**
 * The area a disc shares with a simple polygon, any winding: the sum over its edges of the signed
 * area the disc shares with the triangle from its centre to the edge, each a triangle where the
 * edge is inside and a sector where it is outside.
 */
export function discArea(c: P2, r: number, poly: readonly P2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as P2;
    const q = poly[(i + 1) % poly.length] as P2;
    sum += discTriangle([p[0] - c[0], p[1] - c[1]], [q[0] - c[0], q[1] - c[1]], r);
  }
  return Math.abs(sum);
}

/** The signed area a disc about the origin shares with the triangle (origin, a, b). */
function discTriangle(a: P2, b: P2, r: number): number {
  const tri = (p: P2, q: P2) => (p[0] * q[1] - p[1] * q[0]) / 2;
  const sector = (p: P2, q: P2) =>
    ((r * r) / 2) * Math.atan2(p[0] * q[1] - p[1] * q[0], p[0] * q[0] + p[1] * q[1]);
  const d: P2 = [b[0] - a[0], b[1] - a[1]];
  const A = d[0] * d[0] + d[1] * d[1];
  if (A === 0) return 0;
  // Where the edge a + t·d crosses the circle, t1 ≤ t2, when it does.
  const B = a[0] * d[0] + a[1] * d[1];
  const C = a[0] * a[0] + a[1] * a[1] - r * r;
  const disc = B * B - A * C;
  if (disc <= 0) return sector(a, b);
  const s = Math.sqrt(disc);
  const t1 = (-B - s) / A;
  const t2 = (-B + s) / A;
  if (t1 >= 1 || t2 <= 0) return sector(a, b);
  const at = (t: number): P2 => [a[0] + t * d[0], a[1] + t * d[1]];
  const p1 = t1 > 0 ? at(t1) : a;
  const p2 = t2 < 1 ? at(t2) : b;
  return (t1 > 0 ? sector(a, p1) : 0) + tri(p1, p2) + (t2 < 1 ? sector(p2, b) : 0);
}

/**
 * The convex hull of points, counter-clockwise, collinear points dropped: Andrew's monotone chain
 * (A. M. Andrew, "Another efficient algorithm for convex hulls in two dimensions", 1979).
 */
export function convexHull(points: readonly P2[]): P2[] {
  const ps = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (ps.length < 3) return ps;
  const cross = (o: P2, a: P2, b: P2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (seq: readonly P2[]): P2[] => {
    const out: P2[] = [];
    for (const p of seq) {
      while (out.length >= 2 && cross(out.at(-2) as P2, out.at(-1) as P2, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(ps), ...half([...ps].reverse())];
}
