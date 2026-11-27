import type { Derived } from "../derive/derive.ts";
import { compareIds } from "../ids.ts";
import { QUANTUM, quantize } from "../quantum.ts";
import type { CommandResult } from "./apply.ts";

/**
 * What a step would do to what is derived (BE-2, D-UX-11): the answer of a dry run, which
 * applies a batch and derives it but writes, logs and broadcasts nothing. The joint preview,
 * the corner arrangements, Delete's cascade list and the box frame's numbers read it, so the
 * rule of §4.5 stays in one place, the core, and the browser never derives.
 */
export interface DryEffects {
  /** Each bar whose cut length would move: [before, after], mm. */
  cuts: Record<string, [number, number]>;
  /** Each bar the step would add, with its cut length, mm. */
  added: Record<string, number>;
  /**
   * Each part the step would add (*2.3*, E1.6), as derived: its item, and where it lands, the bar
   * and the distance from that bar's design point A for a part on a station, and its origin; or
   * the quantity of a part counted, not placed. Mirror, array and explode add parts as they add
   * bars, and a preview reads them here.
   */
  parts: Record<string, PartEffect>;
  /** The entities the step would remove, a cascade's included. */
  removed: string[];
  /** The bar ends a connection of the step would claim (`b1.b`), the new bars' included. */
  claimed: string[];
}

/** A part a step adds, as derived (`DryEffects.parts`). */
export type PartEffect =
  | { item: string; bar?: string; s_mm?: number; origin: [number, number, number] }
  | { item: string; qty: number };

const mm = (x: number) => quantize(x, QUANTUM.len_mm);

/** The effects of going from `before` to `after` by a batch with these results. */
export function effectsOf(
  before: Derived,
  after: Derived,
  results: readonly CommandResult[],
): DryEffects {
  const cuts: Record<string, [number, number]> = {};
  const added: Record<string, number> = {};
  const claimed: string[] = [];
  for (const [id, b] of [...after.bars].sort(([x], [y]) => compareIds(x, y))) {
    const was = before.bars.get(id);
    const cut = mm(b.lengths.cut);
    if (!was) added[id] = cut;
    else if (mm(was.lengths.cut) !== cut) cuts[id] = [mm(was.lengths.cut), cut];
    for (const e of ["a", "b"] as const) {
      if (b.ends[e].by !== "default" && (!was || was.ends[e].by === "default")) {
        claimed.push(`${id}.${e}`);
      }
    }
  }
  const parts: Record<string, PartEffect> = {};
  for (const [id, p] of [...after.parts].sort(([x], [y]) => compareIds(x, y))) {
    if (before.parts.has(id)) continue;
    parts[id] = p.placed
      ? {
          item: p.item,
          ...(p.bar !== undefined ? { bar: p.bar } : {}),
          ...(p.s !== undefined ? { s_mm: mm(p.s) } : {}),
          origin: p.origin.map(mm) as [number, number, number],
        }
      : { item: p.item, qty: p.qty };
  }
  const removed = [...new Set(results.flatMap((r) => r.removed))].sort(compareIds);
  return { cuts, added, parts, removed, claimed };
}
