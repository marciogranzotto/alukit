import { compareIds } from "../ids.ts";
import type { Face } from "../project/schema.ts";
import { QUANTUM, quantize } from "../quantum.ts";
import { threadDiameter } from "../threads.ts";
import { TOL } from "../tolerances.ts";
import { addScaled, dot, norm, scale, sub, type V3 } from "../vec.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar, HoleOp } from "./derive.ts";
import { holePlace } from "./duplicates.ts";
import { holeCentre } from "./fastenings.ts";

/**
 * Holes off their piece (review M3; §4.4, as §4.8 has it for a plate): a hole in a bar's side
 * whose material is not all between the bar's two end faces is a `machining` error on the bar,
 * one a shop cannot make there. The hole is a cylinder along the face's inward normal, through
 * the section or `depth` deep; its widest radius is its counterbore's or countersink's mouth at
 * the face, else its drill, a thread's major diameter. For each end face (a point and an
 * outward normal n), the farthest the cylinder reaches past it is, at each end of the axis, the
 * distance of the axis point beyond the plane plus the radius times the part of n across the
 * axis; an end cut square has none along it. Written holes and generated ones alike, on a
 * context bar too (it is drilled in place, but on the bar); a pattern copy's bar is its
 * template's, which reports.
 */
export function holesOnPiece(ctx: Ctx, bars: ReadonlyMap<string, DerivedBar>): void {
  for (const id of [...bars.keys()].sort(compareIds)) {
    const b = bars.get(id) as DerivedBar;
    if (b.placed.copy) continue;
    for (const o of b.ops) {
      if (o.op !== "hole") continue;
      const off = farthest(b, o);
      if (!off || off.reach <= TOL.len) continue;
      // Placed in its own reference (re-check N3), as every message about a hole is.
      const [at, from] = holePlace(b, o);
      const what = o.thread ? `tap ${o.thread}` : `Ø${o.d === undefined ? "?" : mm(o.d)} hole`;
      ctx.d.error(
        "machining",
        id,
        `the ${what} on face ${o.face}${o.by ? ` (${o.by})` : ""}, ${mm(at)} mm from ${from}, reaches ${mm(off.reach)} mm past end ${off.end}'s cut face: off the piece, a shop cannot make it there`,
        o.by ? { refs: [o.by] } : {},
      );
    }
  }
}

const mm = (x: number) => {
  const v = quantize(x, QUANTUM.len_mm);
  return (v === 0 ? 0 : v).toFixed(2);
};

/** The face's outward normal in world terms. */
export function faceNormal(b: DerivedBar, face: Face): V3 {
  const axis = face[1] === "x" ? b.placed.frame.x : b.placed.frame.y;
  return face[0] === "+" ? axis : scale(axis, -1);
}

/** How far the hole reaches past each end face, the worse of the two. */
function farthest(b: DerivedBar, o: HoleOp): { end: "a" | "b"; reach: number } | undefined {
  const drill = o.d ?? (o.thread ? threadDiameter(o.thread) : undefined);
  if (drill === undefined) return undefined;
  const f = faceNormal(b, o.face);
  const box = b.placed.box;
  const through = o.face[1] === "x" ? box.x1 - box.x0 : box.y1 - box.y0;
  const X0 = holeCentre(b, o);
  const X1 = addScaled(X0, f, -(o.depth ?? through));
  // Each circle the hole cuts: its axis point and radius.
  const circles: [V3, number][] = [
    [X0, drill / 2],
    [X1, drill / 2],
  ];
  if (o.csk) circles.push([X0, o.csk.d / 2]);
  if (o.cbore) {
    circles.push([X0, o.cbore.d / 2], [addScaled(X0, f, -o.cbore.depth), o.cbore.d / 2]);
  }
  let worst: { end: "a" | "b"; reach: number } | undefined;
  for (const end of ["a", "b"] as const) {
    const { point, normal: n } = b.ends[end];
    const across = norm(sub(n, scale(f, dot(n, f))));
    for (const [X, r] of circles) {
      const reach = dot(n, sub(X, point)) + r * across;
      if (!worst || reach > worst.reach) worst = { end, reach };
    }
  }
  return worst;
}
