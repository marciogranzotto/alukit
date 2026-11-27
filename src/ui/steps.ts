import { compareIds } from "#core/ids.ts";
import { mm } from "./format.ts";
import type { Model } from "./model.ts";

/**
 * Steps in the person's words (docs/ux/plan.md S2.6, S2.8; D-UX-14): who made a step, what it did,
 * and what it changed between two drawn models. The top bar's Undo, the status bar, the toasts
 * and the outline's "new" marks read these. Pure. Owner: S2.
 *
 * A step's words are the server's (BE-4: every log entry, `rev` event and undo info carries
 * `text`, "add bar b35"); before BE-4 they are the commands' names (`what`, "addBar"), which the
 * server has always sent.
 */

/** Who made a step, by its source (§7.1: `ui`, `cli`, `cli:<name>`, `agent:<name>`, `file`). */
export function who(source: string): string {
  if (source === "ui") return "you";
  if (source === "cli") return "the CLI";
  if (source === "file") return "a hand edit";
  const m = /^(?:cli|agent):(.+)$/.exec(source);
  return m ? (m[1] as string) : source;
}

/** Whether a step is the person's own: made in a tab (`ui`). */
export const isOwn = (source: string) => source === "ui";

/** A step's words: the server's text, else its commands' names. */
export function stepWords(s: { what: string; text?: string | undefined }): string {
  return s.text !== undefined && s.text !== "" ? s.text : s.what;
}

/** "who: what", as the Undo button and the status bar say it. */
export function whoWhat(s: { source: string; what: string; text?: string | undefined }): string {
  return `${who(s.source)}: ${stepWords(s)}`;
}

/** A time since, in a few words: "just now", "40 s ago", "3 min ago", "2 h ago". */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

// ---------------------------------------------------------------------------------------------
// What a step changed

/** The document's entity maps, as the outline lists them. */
const MAPS = ["bars", "runs", "connections", "parts", "patterns", "nodes"] as const;

/** Every entity of a model: written in the document, or derived (pattern copies). */
export function entityIds(m: Model): Set<string> {
  const ids = new Set<string>();
  for (const k of MAPS) {
    const written = m.doc[k];
    if (typeof written === "object" && written !== null)
      for (const id of Object.keys(written)) ids.add(id);
  }
  for (const id of Object.keys(m.derived.bars)) ids.add(id);
  for (const id of Object.keys(m.derived.parts)) ids.add(id);
  return ids;
}

export interface ModelDiff {
  /** Entities in the new model and not in the old. */
  created: string[];
  /** Entities in the old model and not in the new. */
  removed: string[];
  /** Bars in both whose cut length moved: [before, after], mm. */
  cuts: Record<string, [number, number]>;
}

/** What changed between two drawn models (an undefined `before` is an empty project). */
export function diffModels(before: Model | undefined, after: Model): ModelDiff {
  const was = before ? entityIds(before) : new Set<string>();
  const now = entityIds(after);
  const created = [...now].filter((id) => !was.has(id)).sort(compareIds);
  const removed = [...was].filter((id) => !now.has(id)).sort(compareIds);
  const cuts: Record<string, [number, number]> = {};
  if (before) {
    for (const [id, b] of Object.entries(after.derived.bars)) {
      const a = before.derived.bars[id];
      if (a && a.cut_mm !== b.cut_mm) cuts[id] = [a.cut_mm, b.cut_mm];
    }
  }
  return { created, removed, cuts };
}

/** Whether a diff changed anything beyond what the step itself made. */
export function hasConsequences(d: ModelDiff): boolean {
  return d.removed.length > 0 || Object.keys(d.cuts).length > 0;
}

/** A bar's cut in a few words: `b2 580 mm`. */
function cutText(m: Model, id: string): string | undefined {
  const b = m.derived.bars[id];
  return b ? `${id} ${mm(b.cut_mm)} mm` : undefined;
}

/**
 * What a diff changed, as parts of a line: the cut of each bar made ("b2 580.00 mm"), each cut
 * that moved ("b1 800.00 → 820.00 mm"), and what was removed. At most four of each, then a count.
 */
export function changeParts(d: ModelDiff, after: Model): string[] {
  const few = (xs: string[]) =>
    xs.length <= 4 ? xs : [...xs.slice(0, 3), `${xs.length - 3} more`];
  const made = few(
    d.created.flatMap((id) => {
      const t = cutText(after, id);
      return t ? [t] : [];
    }),
  );
  const moved = few(
    Object.entries(d.cuts)
      .sort(([a], [b]) => compareIds(a, b))
      .map(([id, [a, b]]) => `${id} ${mm(a)} → ${mm(b)} mm`),
  );
  const gone = d.removed.length > 0 ? [`removed ${few(d.removed).join(", ")}`] : [];
  return [...made, ...moved, ...gone];
}

/** What a step did, in a line: its words, then what it changed ("add bar b2 · b2 580.00 mm"). */
export function summaryText(
  step: { what: string; text?: string | undefined },
  d: ModelDiff,
  after: Model,
): string {
  return [stepWords(step), ...changeParts(d, after)].join(" · ");
}
