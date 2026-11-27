import { computed, signal } from "@preact/signals";
import { compareIds } from "#core/ids.ts";
import type { Model } from "../model.ts";
import {
  changeParts,
  diffModels,
  hasConsequences,
  isOwn,
  stepWords,
  summaryText,
  who,
} from "../steps.ts";
import { type HeardStep, heard, model, notice } from "../store.ts";
import { viewer } from "../viewport/viewer.ts";

/**
 * Presence and the step summary (docs/ux/plan.md S2.8, A F8, B §5.2): every step another source
 * makes (an agent, the CLI, a hand edit, another tab's undo) gets a toast naming who and what,
 * with Show and Undo it; the person's own step gets one when it changed more than it made (a cut
 * that moved, an entity removed), so auto-connect's 800 → 820 is said out loud (U4, F1). The
 * entities a step made or changed flash in the scene, and the outline marks another source's new
 * entities "new · claude" until the person's next step. Owner: S2.
 *
 * What changed is the difference between the two drawn models (steps.ts), so it is what the
 * person sees; when several steps land between two drawings, each step's words are listed and
 * the difference is told once.
 */

/** A step told in a toast. */
export interface StepToast {
  key: number;
  /** The newest revision it tells. */
  rev: number;
  source: string;
  own: boolean;
  /** Who: `claude`, `you`. */
  who: string;
  /** What, in a line: the step's words, then what it made and moved. */
  text: string;
  /** What it made and changed, for Show. */
  ids: string[];
  /** When it was told, ms since the epoch. */
  at: number;
}

/** How long a step's toast stays: the person's own a short while, another source's longer. */
export const TOAST_MS = { own: 5000, other: 9000, info: 5000 } as const;

export const stepToasts = signal<readonly StepToast[]>([]);
let toastKeys = 0;

export function dismissStepToast(key: number): void {
  stepToasts.value = stepToasts.value.filter((t) => t.key !== key);
}

function pushStepToast(t: Omit<StepToast, "key" | "at">): void {
  const key = ++toastKeys;
  // Three at most: the oldest goes first.
  stepToasts.value = [...stepToasts.value.slice(-2), { ...t, key, at: Date.now() }];
  setTimeout(() => dismissStepToast(key), t.own ? TOAST_MS.own : TOAST_MS.other);
}

/** Another source's new entities, by id, with who made them; cleared by the person's next step. */
export const marks = signal<ReadonlyMap<string, string>>(new Map());

/** The other sources heard in the last two minutes, newest first, with when. */
export const presence = computed(() => {
  const now = Date.now();
  const seen = new Map<string, number>();
  for (const s of heard.value) {
    if (isOwn(s.source) || now - s.at > 120_000) continue;
    seen.set(s.source, Math.max(seen.get(s.source) ?? 0, s.at));
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([source, at]) => ({ source, at }));
});

/** Tells the steps heard between two drawn models. */
function tellSteps(steps: readonly HeardStep[], before: Model, after: Model): void {
  const d = diffModels(before, after);
  const changed = [...d.created, ...Object.keys(d.cuts)].sort(compareIds);
  const last = steps[steps.length - 1] as HeardStep;
  const sources = new Set(steps.map((s) => s.source));
  const own = sources.size === 1 && isOwn(last.source);

  if (own) {
    // The person's own step: marks of others' steps are read now; a refusal toast is old news.
    marks.value = new Map();
    if (notice.peek()?.error) notice.value = undefined;
    if (hasConsequences(d)) {
      pushStepToast({
        rev: last.rev,
        source: last.source,
        own,
        who: "you",
        text: summaryText(last, d, after),
        ids: changed,
      });
    }
  } else {
    const words =
      steps.length === 1
        ? summaryText(last, d, after)
        : [...steps.map((s) => `${who(s.source)}: ${stepWords(s)}`), ...changeParts(d, after)].join(
            " · ",
          );
    const by = sources.size === 1 ? who(last.source) : [...sources].map(who).join(", ");
    pushStepToast({
      rev: last.rev,
      source: last.source,
      own: false,
      who: by,
      text: words,
      ids: changed,
    });
    const next = new Map(marks.value);
    for (const id of d.created) next.set(id, by);
    for (const id of d.removed) next.delete(id);
    marks.value = next;
  }
  if (changed.length > 0) viewer.peek()?.pulse(new Set(changed));
}

/**
 * Follows the drawn models and tells each step between two of them; returns the undo. A change
 * of variant is no step, and the first model drawn has nothing before it to compare with.
 */
export function wirePresence(): () => void {
  let before: Model | undefined;
  return model.subscribe((m) => {
    if (!m) return;
    const was = before;
    before = m;
    if (!was || was.variant !== m.variant || m.rev <= was.rev) return;
    const steps = heard.peek().filter((s) => s.rev > was.rev && s.rev <= m.rev);
    if (steps.length > 0) tellSteps(steps, was, m);
  });
}
