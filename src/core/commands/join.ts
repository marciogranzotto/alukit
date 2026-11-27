import type { Derived } from "../derive/derive.ts";
import { buttEndAngle } from "../derive/ends.ts";
import { compareIds } from "../ids.ts";
import type { CornerRule } from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import { dist, type V3 } from "../vec.ts";

/**
 * Where bar ends at a point can join with the default butt (design §4.5 "Default connection";
 * E-UX-11, E-UX-12): the one rule `autoConnect` applies and the `unconnected` problem asks before
 * offering its fix, so a fix the problem list offers is one the command accepts.
 *
 * - The ends to join are those at the point that nothing claims: no connection names them, no
 *   butt takes them as its through end, they have no plane of their own. An end whose claim fails
 *   (two providers, an angled end with no cut declared) is still claimed: joining it again would
 *   make another provider.
 * - The bar that runs through is the one passing the point, else the one the corner rule prefers
 *   among those with a free end there, else a vertical, else the lowest id.
 * - When that leaves nothing to butt on it (a brace drawn into a corner whose ends are joined
 *   already), the free ends butt on the corner's own through bar: the bar a butt at the point runs
 *   through. That bar's end there belongs to the corner's butt, so the new butt leaves it alone
 *   (`through_end: "none"`).
 * - A butting end that the through bar's face would cut at an angle, and that declares no cut, is
 *   cut at an angle in the same step: §4.5 keeps an undeclared angled end an error, and the end a
 *   person draws into a face at an angle wants the face's angle.
 */

export interface JoinPlan {
  /** The bar the ends butt on. */
  through: string;
  /** The ends that butt on it (`b13.a`), in id order. */
  ends: string[];
  /** Set when the through bar's end at the point belongs to another butt already. */
  throughEnd?: "none";
  /** The butting ends the through bar cuts at an angle and that declare no cut. */
  angled: string[];
}

export type JoinAnswer = { ok: true; plan: JoinPlan } | { ok: false; why: string };

/** The plan for joining the free bar ends at `P` by the corner rule `prefer`. */
export function planJoin(d: Derived, P: V3, prefer: CornerRule): JoinAnswer {
  const free: string[] = [];
  const met: string[] = [];
  const passing: string[] = [];
  for (const [id, b] of [...d.bars].sort(([x], [y]) => compareIds(x, y))) {
    if (id.includes("@")) continue;
    for (const e of ["a", "b"] as const) {
      const pt = e === "a" ? b.placed.A : b.placed.B;
      if (!pt || dist(pt, P) > TOL.len) continue;
      const ref = `${id}.${e}`;
      met.push(ref);
      if ((d.claims.get(ref) ?? []).length === 0) free.push(ref);
    }
    const A = b.placed.A;
    const t = b.placed.frame.t;
    const s = (P[0] - A[0]) * t[0] + (P[1] - A[1]) * t[1] + (P[2] - A[2]) * t[2];
    const foot: V3 = [A[0] + t[0] * s, A[1] + t[1] * s, A[2] + t[2] * s];
    if (s > TOL.len && s < b.lengths.len - TOL.len && dist(foot, P) <= TOL.len) passing.push(id);
  }
  if (free.length === 0) {
    return {
      ok: false,
      why:
        met.length > 0
          ? "every bar end at that point is joined already"
          : "no bar end meets at that point",
    };
  }

  const atEnds = [...new Set(free.map(barOf))];
  // Along a world axis: the other two components of the bar's direction vanish.
  const along = (axis: 0 | 1 | 2) => (id: string) => {
    const t = d.bars.get(id)?.placed.frame.t as V3;
    return Math.hypot(...t.filter((_, i) => i !== axis)) < TOL.vert;
  };
  const preferred = {
    vertical: undefined,
    first: atEnds[0],
    x: atEnds.find(along(0)),
    y: atEnds.find(along(1)),
  };
  const through = passing[0] ?? preferred[prefer] ?? atEnds.find(along(2)) ?? (atEnds[0] as string);
  const butting = free.filter((e) => barOf(e) !== through);
  if (butting.length > 0) return { ok: true, plan: plan(d, through, butting) };

  // Every other end here is joined: the free ends butt on the corner's through bar (E-UX-12).
  const corner = cornerThrough(d, met);
  const onCorner = corner === undefined ? [] : free.filter((e) => barOf(e) !== corner);
  if (corner === undefined || onCorner.length === 0) {
    return { ok: false, why: `only ${through} meets at that point: nothing butts on it` };
  }
  const own = met.find((e) => barOf(e) === corner);
  return {
    ok: true,
    plan: { ...plan(d, corner, onCorner), ...(own !== undefined ? { throughEnd: "none" } : {}) },
  };
}

function barOf(ref: string): string {
  return ref.split(".")[0] as string;
}

function plan(d: Derived, through: string, ends: string[]): JoinPlan {
  const T = d.bars.get(through)?.placed;
  const angled = ends.filter((ref) => {
    const [bar, e] = ref.split(".") as [string, "a" | "b"];
    if (d.doc.bars[bar]?.ends?.[e]?.cut !== undefined) return false;
    const K = d.bars.get(bar)?.placed;
    const angle = K && T ? buttEndAngle(K, e, T) : undefined;
    // An end parallel to the face is the butt's error, not a cut to declare.
    return angle !== undefined && angle > TOL.ang && angle < 90 - TOL.ang;
  });
  return { through, ends, angled };
}

/**
 * The bar a butt at the point runs through: of the butts that claim an end there (a butting end,
 * or the through bar's own end), the first by id whose `through` is a bar that derives.
 */
function cornerThrough(d: Derived, met: readonly string[]): string | undefined {
  const butts = [...new Set(met.flatMap((ref) => d.claims.get(ref) ?? []))].sort(compareIds);
  for (const id of butts) {
    const c = d.doc.connections[id];
    if (c?.type !== "butt" || typeof c.through !== "string" || c.through.includes(".")) continue;
    if (d.bars.has(c.through)) return c.through;
  }
  return undefined;
}
