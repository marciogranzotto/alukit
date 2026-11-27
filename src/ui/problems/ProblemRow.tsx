import type { Problem, ProblemGroup } from "#core/problems/types.ts";
import { EntityChips } from "../common/EntityChip.tsx";
import { model } from "../store.ts";
import { resolveTargets } from "../targets.ts";

/**
 * One problem (`alukit.problems/1`, src/core/problems/types.ts), as a row of a diagnostics list:
 * its group's word, its code, the chips of the entities it is about, and its title. The Problems
 * sheet lists them, and the order's to-resolve rows reuse them. Minimal: S4.8 adds Show, the
 * fixes, the keys and a compact form (S3.6's callout). Owner: S4.
 */

/** A group's word and the diagnostics list's class for it (its colour). */
export const GROUP_LOOK: Readonly<Record<ProblemGroup, { word: string; tone: string }>> = {
  "blocks-order": { word: "block", tone: "error" },
  error: { word: "error", tone: "error" },
  warning: { word: "warn", tone: "warn" },
  note: { word: "info", tone: "info" },
};

export function ProblemRow({ p }: { p: Problem }) {
  const m = model.value;
  const look = GROUP_LOOK[p.group];
  const ids = m ? resolveTargets(m, p.targets).ids : [];
  return (
    <li class={look.tone} data-problem={p.id}>
      <span class="sev">{look.word}</span> <span class="code">{p.code}</span>{" "}
      {ids.length > 0 && <EntityChips ids={ids} />} {p.title}
    </li>
  );
}
