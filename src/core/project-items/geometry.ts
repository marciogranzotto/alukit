import { cosDeg, sinDeg } from "../trig.ts";

/**
 * Plane geometry and volumes for project items (design §4.8): a plate's outline, the material a
 * hole removes, and a bent angle's developed length. Plain IEEE arithmetic, so results are the
 * same on every machine within one Node major (§5.2).
 */

export type P2 = readonly [number, number];

/** The polygon's signed area (shoelace): positive when its corners run counter-clockwise. */
export function signedArea(pts: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i] as P2;
    const [x1, y1] = pts[(i + 1) % pts.length] as P2;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** The sign of the turn a → b → c: positive counter-clockwise, 0 collinear. */
function orient(a: P2, b: P2, c: P2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: P2, b: P2, p: P2): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/** Whether segments ab and cd share a point, touching included. */
export function segmentsMeet(a: P2, b: P2, c: P2, d: P2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return true;
  }
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

/**
 * The first pair of edges that meet where they should not (edge i runs from corner i to corner
 * i + 1): non-adjacent edges that touch, or adjacent edges that fold back on each other. Undefined
 * for a simple polygon.
 */
export function selfCrossing(pts: readonly P2[]): [number, number] | undefined {
  const n = pts.length;
  const edge = (i: number): [P2, P2] => [pts[i] as P2, pts[(i + 1) % n] as P2];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [a, b] = edge(i);
      const [c, d] = edge(j);
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // They share a corner; they cross only if they run back along each other.
        const shared = j === i + 1 ? b : a;
        const p = j === i + 1 ? a : b;
        const q = j === i + 1 ? d : c;
        const back =
          orient(p, shared, q) === 0 &&
          (q[0] - shared[0]) * (p[0] - shared[0]) + (q[1] - shared[1]) * (p[1] - shared[1]) > 0;
        if (back) return [i, j];
        continue;
      }
      if (segmentsMeet(a, b, c, d)) return [i, j];
    }
  }
  return undefined;
}

/** Whether a point lies inside the polygon (even-odd rule); a point on an edge may go either way. */
export function insidePolygon(p: P2, pts: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i] as P2;
    const [xj, yj] = pts[j] as P2;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** The distance from a point to a segment. */
export function distToSegment(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The distance from a point to the polygon's boundary. */
export function distToBoundary(p: P2, pts: readonly P2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length; i++) {
    best = Math.min(best, distToSegment(p, pts[i] as P2, pts[(i + 1) % pts.length] as P2));
  }
  return best;
}

/** π d² / 4. */
export function circleArea(d: number): number {
  return (Math.PI * d * d) / 4;
}

/**
 * A countersink's depth from the face: (D − d) / 2 / tan(θ / 2), for a cone of included angle θ
 * from diameter D at the face down to the hole's d.
 */
export function cskDepth(D: number, d: number, angleDeg: number): number {
  return (D - d) / 2 / (sinDeg(angleDeg / 2) / cosDeg(angleDeg / 2));
}

/** The volume of a cone's frustum of height h between diameters D and d: π h (D² + D d + d²) / 12. */
export function frustumVolume(D: number, d: number, h: number): number {
  return (Math.PI * h * (D * D + D * d + d * d)) / 12;
}

/**
 * A 90° bend's allowance: the length of the neutral fibre's arc, BA = θ (R + K T) with θ = π / 2,
 * R the inside radius, T the thickness and K the K-factor (the neutral fibre's distance from the
 * inside surface as a share of T). The convention is Wikipedia's "Bending (metalworking)": BA =
 * A (π / 180) (R + K T) for a bend through A degrees.
 */
export function bendAllowance90(R: number, T: number, K: number): number {
  return (Math.PI / 2) * (R + K * T);
}

/**
 * The developed (flat) length of a 90° bent angle whose legs A and B are each measured to the
 * outside of the other: the two flats, each its leg less the outside setback R + T, plus the
 * bend's allowance. Equal to A + B − BD with the bend deduction BD = 2 (R + T) − BA.
 */
export function developedLength(A: number, B: number, R: number, T: number, K: number): number {
  return A - (R + T) + (B - (R + T)) + bendAllowance90(R, T, K);
}
