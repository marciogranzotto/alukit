import { idList } from "../commands/words.ts";
import type { Derived } from "../derive/derive.ts";
import { compareIds } from "../ids.ts";

/**
 * Butts that name no connector (docs/ux/review-phase4.md B1). A butt's connector is its own,
 * else the project's `defaults.butt.connector` (derive's rule, `hardware.ts`); when neither
 * names one, the joint derives (the cuts are right), but nothing is bought or machined to hold
 * the ends, and the cut list and the order say nothing of it. The check notes it
 * (`butt-no-connector`) and the order rule `no-connector` judges it (warn by default), in the same
 * words, so `alukit check`, `alukit order` and `alukit problems` say one thing.
 *
 * A butt is left out when something else holds its ends: another butt's through-fastener
 * (`held_by`, acceptance gap A9), or a body it bears on, which is counted with it (§4.5). So is a
 * butt whose every member is context (gap X11): the context's own joint, which buys nothing.
 */

/** The document's butts that name no connector, with no project default, in id order. */
export function unjoinedButts(derived: Derived): string[] {
  const doc = derived.doc;
  if (doc.defaults.butt?.connector !== undefined) return [];
  const butts: string[] = [];
  for (const [id, c] of Object.entries(doc.connections)) {
    if (c.type !== "butt" || c.connector !== undefined || c.held_by !== undefined) continue;
    if (typeof c.through !== "string") continue;
    if (derived.context.has(id)) continue;
    butts.push(id);
  }
  return butts.sort(compareIds);
}

/**
 * The systems of the bars some butts join, through bar and butting bars, in id order: what a
 * connector for all of them must fit.
 */
export function buttSystems(derived: Derived, butts: readonly string[]): string[] {
  const systems = new Set<string>();
  for (const id of butts) {
    const c = derived.doc.connections[id];
    if (c?.type !== "butt") continue;
    for (const ref of [...(typeof c.through === "string" ? [c.through] : []), ...c.ends]) {
      const sys = derived.bars.get(ref.replace(/\.[ab]$/, ""))?.placed.item.system;
      if (sys !== undefined) systems.add(sys);
    }
  }
  return [...systems].sort(compareIds);
}

/**
 * The words the check and the order rule print: which butts, that neither they nor the project
 * name a connector, and what follows. The check notes each butt on its own (`[butt]`), so a step
 * that adds one adds its note and resolves none; the order rule names them all in one reason.
 */
export function unjoinedMessage(butts: readonly string[]): string {
  const one = butts.length === 1;
  return `${one ? `${butts[0]} names` : `${butts.length} butts name`} no connector, and the project names no default butt connector: the order buys nothing to join ${one ? "its ends" : `them (${idList(butts)})`}`;
}
