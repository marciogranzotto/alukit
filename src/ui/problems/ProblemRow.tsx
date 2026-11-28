import type { Problem, ProblemGroup } from "#core/problems/types.ts";
import { EntityChips } from "../common/EntityChip.tsx";
import { type Status, StatusGlyph } from "../common/StatusGlyph.tsx";
import { hover, show } from "../focus.ts";
import { model } from "../store.ts";
import { resolveTargets } from "../targets.ts";
import { FixControls } from "./Fixes.tsx";

/**
 * One problem (`alukit.problems/1`, src/core/problems/types.ts) as a row of a diagnostics list
 * (docs/ux/heuristics-and-first-run.md §5.4): its status as a glyph and a word, its title in
 * plain words and what follows from it, its code (small, for parity with the CLI), the entities it
 * is about as chips, a Show that selects and frames them, and its fixes. The Problems sheet lists
 * them grouped by consequence; the order's to-resolve rows reuse them (`compact`). Owner: S4.
 */

/**
 * A group's status glyph, its short word (S0's `word`, as the CLI's severities read), its label
 * in plain words and the diagnostics list's class for it (its colour).
 */
export const GROUP_LOOK: Readonly<
  Record<ProblemGroup, { status: Status; word: string; label: string; tone: string }>
> = {
  "blocks-order": { status: "blocked", word: "block", label: "Blocks the order", tone: "error" },
  error: { status: "blocked", word: "error", label: "Error", tone: "error" },
  warning: { status: "warn", word: "warn", label: "Warning", tone: "warn" },
  note: { status: "info", word: "info", label: "Note", tone: "info" },
};

/** The order rules and check codes in plain words, for a compact row's lead. */
export const RULE_WORDS: Readonly<Record<string, string>> = {
  "open-item": "Open item",
  "missing-price": "No price",
  "est-price": "Estimated price",
  "stale-price": "Stale price",
  placeholder: "Placeholder",
  "check-error": "Check error",
  "out-of-stock": "Out of stock",
  "option-not-sold": "Option not sold",
  "no-connector": "No connector",
  unconnected: "Open end",
};

export function ProblemRow({
  p,
  compact = false,
  inCallout = false,
}: {
  p: Problem;
  compact?: boolean;
  /**
   * In Show's callout (review m7): no Show inside Show, and the diagnostic's own words (its
   * measurement: "b18.b overhangs b9 by 30.00") under the title when they say more.
   */
  inCallout?: boolean;
}) {
  const m = model.value;
  const look = GROUP_LOOK[p.group];
  const ids = m ? resolveTargets(m, p.targets).ids : [];
  // The rule in words leads a compact row only for an open item, whose message starts "O2: …"; the
  // others' messages already name what is wrong.
  const lead = (p.rule ?? p.code) === "open-item" ? RULE_WORDS["open-item"] : undefined;
  return (
    <li
      class={compact ? "problem compact" : "problem"}
      data-problem={p.id}
      data-group={p.group}
      // Roving focus: the list moves it with the arrow keys (ProblemList).
      tabIndex={-1}
      onMouseEnter={() => {
        if (ids.length > 0) hover.value = { ids, from: "row" };
      }}
      onMouseLeave={() => {
        if (hover.peek()?.from === "row") hover.value = undefined;
      }}
    >
      <span class="problem-glyph">
        <StatusGlyph status={look.status} />
        <span class="sr-only">{look.label}: </span>
      </span>
      <div class="problem-main">
        <div class="problem-title">
          {compact && lead && <b class="problem-lead">{lead} </b>}
          {p.title}
        </div>
        {!compact && p.detail && <div class="problem-detail">{p.detail}</div>}
        {inCallout && p.raw && p.raw !== p.title && (
          <div class="problem-detail" data-testid="callout-detail">
            {p.raw}
          </div>
        )}
        <div class="problem-meta">
          <span class="code" title={p.raw}>
            {p.code}
          </span>
          {p.suppliers && p.suppliers.length > 0 && (
            <span class="sub">
              {" "}
              · holds {p.suppliers.map((s) => s ?? "the unsourced lines").join(", ")}
            </span>
          )}
          {ids.length > 0 && <EntityChips ids={ids} />}
        </div>
      </div>
      <FixControls p={p}>
        {p.targets.length > 0 && !inCallout && (
          <button
            type="button"
            class="btn"
            data-testid="show"
            title="Select what it is about and frame it in the view"
            onClick={() =>
              show({
                refs: p.targets,
                problem: p.id,
                ...(p.field !== undefined ? { field: p.field } : {}),
              })
            }
          >
            Show
          </button>
        )}
      </FixControls>
    </li>
  );
}

/**
 * A list of problems with the keyboard on it: ↑ and ↓ move between rows, Enter on a row shows
 * what it is about. The rows hold the buttons, which take Enter themselves.
 */
export function ProblemList({
  children,
  label,
}: {
  children: preact.ComponentChildren;
  label: string;
}) {
  return (
    <ul
      class="problems"
      aria-label={label}
      onKeyDown={(e) => {
        const li = (e.target as HTMLElement).closest("li.problem") as HTMLElement | null;
        if (li === null) return;
        const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(":scope > li.problem")];
        const at = rows.indexOf(li);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const next = rows[at + (e.key === "ArrowDown" ? 1 : -1)];
          if (next) {
            e.preventDefault();
            next.focus();
          }
        } else if (e.key === "Enter" && e.target === li) {
          e.preventDefault();
          li.querySelector<HTMLElement>('[data-testid="show"]')?.click();
        }
      }}
    >
      {children}
    </ul>
  );
}
