import type { Vec2 } from "#core/section-properties.ts";
import { cosDeg, sinDeg } from "#core/trig.ts";

/**
 * Arc flattening for generated outlines: a fixed step of `ARC_STEP_DEG`. The error is then
 * relative, the same at every radius: a flattened circle's area is (N/2π)·sin(2π/N) of πr², about
 * 0.0013 % low at N = 720, and its second moment about 0.0025 % low, far inside the 0.1 % the
 * generators are held to. (An absolute chord tolerance would not do: its relative error grows as
 * the radius shrinks.) The step divides 30°, so vertices at multiples of 30° are exact (§5.2).
 */
export const ARC_STEP_DEG = 0.5;

export function arcSegments(sweepDeg: number): number {
  return Math.max(1, Math.ceil(Math.abs(sweepDeg) / ARC_STEP_DEG));
}

/**
 * Points on the arc of radius `r` about (cx, cy) from `a0` to `a1` degrees, both ends included;
 * counter-clockwise when a1 > a0. A zero radius gives the centre alone (a sharp corner).
 */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number): Vec2[] {
  if (r === 0) return [[cx, cy]];
  const n = arcSegments(a1 - a0);
  const pts: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const a = k === n ? a1 : a0 + ((a1 - a0) * k) / n;
    pts.push([cx + r * cosDeg(a), cy + r * sinDeg(a)]);
  }
  return pts;
}

/** A full circle, counter-clockwise, starting at angle 0. */
export function circle(cx: number, cy: number, d: number): Vec2[] {
  return arc(cx, cy, d / 2, 0, 360).slice(0, -1);
}

/** A w × h rectangle about (0, 0) with corner radius r, counter-clockwise. */
export function roundedRect(w: number, h: number, r: number): Vec2[] {
  const x = w / 2 - r;
  const y = h / 2 - r;
  return [
    ...arc(x, -y, r, -90, 0),
    ...arc(x, y, r, 0, 90),
    ...arc(-x, y, r, 90, 180),
    ...arc(-x, -y, r, 180, 270),
  ];
}

/** Drops consecutive duplicate vertices (where an edge has zero length). */
export function dedupe(ring: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}
