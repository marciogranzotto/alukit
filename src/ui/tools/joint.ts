import type { DryRunEffects, DryRunResult } from "../client/dryrun.ts";

/**
 * The joint preview's words (S5.6, U4): what a drawn bar's dry run says its ends would do, before
 * the click. Auto-connect may cut the new bar short against another, or another against it, and
 * move that bar's cut length (a post typed 800 cut 820); the preview says which, and by how much.
 * Who runs through comes from each `autoConnect`'s plan (its result's `info`: the through bar and
 * the ends that butt on it), the lengths from the dry run's effects. Pure: the draw tool's wiring
 * asks the dry run and shows the words by the end. Owner: S5.
 */

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
  const cut = e.added[bar];
  if (cut !== undefined) parts.push(`cut ${len(cut)}`);
  for (const [id, [was, now]] of Object.entries(e.cuts))
    parts.push(`${id} ${len(was)} → ${len(now)}`);
  const shape = JSON.stringify({
    plans: plans.map((p) => [barOf(p.through), [...p.ends].sort()]),
    cuts: Object.entries(e.cuts).sort(),
    added: Object.entries(e.added).sort(),
  });
  return { text: parts.join(" · "), shape, joins };
}
