import { TOL } from "#core/tolerances.ts";
import type { V3 } from "../../mesh/model.ts";
import type { DryRunEffects, DryRunResult } from "../client/dryrun.ts";
import type { Model } from "../model.ts";

/**
 * The joint preview's words (S5.6, U4): what a drawn bar's dry run says its ends would do, before
 * the click. Auto-connect may cut the new bar short against another, or another against it, and
 * move that bar's cut length (a post typed 800 cut 820); the preview says which, and by how much.
 * Who runs through comes from each `autoConnect`'s plan (its result's `info`: the through bar and
 * the ends that butt on it), the lengths from the dry run's effects. Pure: the draw tool's wiring
 * asks the dry run and shows the words by the end. Owner: S5.
 */

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Whether a point of a stroke can join anything in the drawn model: a bar end within the core's
 * length tolerance, a bar whose design line passes the point between its ends, or (review B3) a
 * bar whose bounding box holds the point, on a face or inside, between its end faces. These are
 * the places `autoConnect` looks (src/core/commands/join.ts, `planJoin` and `liesOn`), pattern
 * copies left out as it leaves them; it also skips an end a connection already claims, and a bar
 * the stroke's line would not cross, so this may say yes where the dry run then joins nothing,
 * never no where it would join. The joint preview asks no dry run for a stroke neither of whose
 * points touches the model (integration-decisions.md): open space, whatever way the end was
 * found, typed and grid ends included.
 */
export function touchesBars(m: Model, p: V3): boolean {
  for (const [id, b] of Object.entries(m.derived.bars)) {
    if (id.includes("@") || !b.a || !b.b) continue;
    if (dist(b.a, p) <= TOL.len || dist(b.b, p) <= TOL.len) return true;
    const d: V3 = [b.b[0] - b.a[0], b.b[1] - b.a[1], b.b[2] - b.a[2]];
    const n = Math.hypot(d[0], d[1], d[2]);
    if (n <= TOL.len) continue;
    if (inBox(b, p)) return true;
    const s = ((p[0] - b.a[0]) * d[0] + (p[1] - b.a[1]) * d[1] + (p[2] - b.a[2]) * d[2]) / n;
    if (s <= TOL.len || s >= n - TOL.len) continue;
    const foot: V3 = [b.a[0] + (d[0] * s) / n, b.a[1] + (d[1] * s) / n, b.a[2] + (d[2] * s) / n];
    if (dist(foot, p) <= TOL.len) return true;
  }
  return false;
}

const dot = (a: readonly number[], b: readonly number[]) =>
  (a[0] as number) * (b[0] as number) +
  (a[1] as number) * (b[1] as number) +
  (a[2] as number) * (b[2] as number);

/**
 * A point on a bar's bounding box or inside it, within the core's tolerance, and not past either
 * end face: where `liesOn` may butt an end on the bar. Read loosely (each bound widened by the
 * tolerance), as this test may say yes where the core says no, never the other way.
 */
function inBox(b: Model["derived"]["bars"][string], p: V3): boolean {
  const { frame, box_mm: box, ends } = b as Partial<typeof b>;
  if (!frame || !box || !ends) return false;
  for (const e of [ends.a, ends.b]) {
    const v: V3 = [p[0] - e.point[0], p[1] - e.point[1], p[2] - e.point[2]];
    if (dot(v, e.normal) > TOL.len) return false;
  }
  const v: V3 = [p[0] - b.a[0], p[1] - b.a[1], p[2] - b.a[2]];
  const lx = dot(v, frame.x);
  const ly = dot(v, frame.y);
  const [[x0, y0], [x1, y1]] = box;
  return lx >= x0 - TOL.len && lx <= x1 + TOL.len && ly >= y0 - TOL.len && ly <= y1 + TOL.len;
}

/** A length as the preview says it: two decimals only when needed. */
const len = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

/** The bar a reference names: `b1` for `b1`, `b1.b`. */
const barOf = (ref: string) => ref.split(".")[0] as string;

export interface JointWords {
  /** By the end: "will butt on b1 · cut 560 · b1 800 → 820". */
  text: string;
  /** What the arrangement does, for telling two rules that give the same one apart. */
  shape: string;
  /** Whether a connection is made at all. */
  joins: boolean;
}

/** One `autoConnect`'s plan, from its result. */
function planOf(r: DryRunResult): { through: string; ends: string[] } | undefined {
  if (r.cmd !== "autoConnect") return undefined;
  const info = r.info as { through?: unknown; ends?: unknown } | undefined;
  if (typeof info?.through !== "string" || !Array.isArray(info.ends)) return undefined;
  return {
    through: info.through,
    ends: info.ends.filter((e): e is string => typeof e === "string"),
  };
}

/** The words for a drawn bar's dry run; `bar` is the new bar's id. */
export function jointWords(
  r: { results: readonly DryRunResult[]; effects: DryRunEffects },
  bar: string,
): JointWords {
  const e = r.effects;
  const plans = r.results.map(planOf).filter((p) => p !== undefined);
  const parts: string[] = [];
  for (const p of plans) {
    const others = [...new Set(p.ends.map(barOf).filter((b) => b !== bar))];
    if (barOf(p.through) === bar) {
      if (others.length > 0) parts.push(`${others.join(", ")} will butt on it`);
    } else if (p.ends.some((x) => barOf(x) === bar)) parts.push(`will butt on ${barOf(p.through)}`);
  }
  const joins = plans.length > 0;
  if (!joins) parts.push("no joint: the ends stay open");
  // The bar the gesture makes or moves: its cut alone; every other bar's cut that moves.
  const cut = e.added[bar] ?? e.cuts[bar]?.[1];
  if (cut !== undefined) parts.push(`cut ${len(cut)}`);
  for (const [id, [was, now]] of Object.entries(e.cuts))
    if (id !== bar) parts.push(`${id} ${len(was)} → ${len(now)}`);
  const shape = JSON.stringify({
    plans: plans.map((p) => [barOf(p.through), [...p.ends].sort()]),
    cuts: Object.entries(e.cuts).sort(),
    added: Object.entries(e.added).sort(),
  });
  return { text: parts.join(" · "), shape, joins };
}
