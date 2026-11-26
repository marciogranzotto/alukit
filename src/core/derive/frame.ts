import { TOL } from "../tolerances.ts";
import { cosDeg, reduceDeg, sinDeg } from "../trig.ts";
import { AXIS, angleDeg, cross, dot, norm, scale, sub, unit, type V3 } from "../vec.ts";
import type { Frame } from "./types.ts";

/**
 * A bar's frame and its anchors (design §4.4), as pure functions of plain numbers: derive places
 * bars with them, and the app's draw tool previews the bar it is about to add with the same rule,
 * so the preview is where the bar lands.
 */

/**
 * A bar's frame from its direction `d = B − A`: t along the bar; y is `up` (or world +Z, or +Y
 * for a vertical bar) with its t component removed; x = y × t; then roll about t,
 * counter-clockwise seen from B looking toward A, exact at multiples of 90°.
 */
export function barFrame(
  d: V3,
  up: V3 | undefined,
  rollDeg: number,
): { frame: Frame; vertical: boolean; nearVertical: boolean } | { problem: string } {
  const len = norm(d);
  const t = unit(d);
  if (!t || len < TOL.len) return { problem: "zero-length" };
  const horizontal = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
  const vertical = horizontal < TOL.vert * len;
  const nearVertical = !vertical && horizontal < TOL.nearVert * len;
  let u: V3 = vertical ? AXIS["+y"] : AXIS["+z"];
  if (up) {
    const uu = unit(up);
    if (!uu) return { problem: "up-parallel" };
    const a = angleDeg(uu, t);
    if (a < TOL.ang || a > 180 - TOL.ang) return { problem: "up-parallel" };
    u = uu;
  }
  const y0 = unit(sub(u, scale(t, dot(u, t)))) as V3;
  const x0 = cross(y0, t);
  const r = reduceDeg(rollDeg);
  const c = cosDeg(r);
  const s = sinDeg(r);
  const x: V3 =
    r === 0 ? x0 : [x0[0] * c + y0[0] * s, x0[1] * c + y0[1] * s, x0[2] * c + y0[2] * s];
  const y: V3 =
    r === 0 ? y0 : [y0[0] * c - x0[0] * s, y0[1] * c - x0[1] * s, y0[2] * c - x0[2] * s];
  return { frame: { t, x, y }, vertical, nearVertical };
}

/** The anchor's point in section coordinates (§4.4). */
export function anchorPoint(
  name: string,
  bbox: readonly [readonly [number, number], readonly [number, number]],
  datums: Readonly<Record<string, readonly [number, number]>>,
): readonly [number, number] | undefined {
  const [[x0, y0], [x1, y1]] = bbox;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (name === "c") return [cx, cy];
  const m = /^([+-][xy])([+-][xy])?$/.exec(name);
  if (m) {
    let x = cx;
    let y = cy;
    const parts = [m[1], m[2]].filter((p): p is string => p !== undefined);
    if (parts.length === 2 && parts[0]?.[1] === parts[1]?.[1]) return undefined; // "+x-x"
    for (const p of parts) {
      if (p === "+x") x = x1;
      else if (p === "-x") x = x0;
      else if (p === "+y") y = y1;
      else y = y0;
    }
    return [x, y];
  }
  return datums[name];
}
