import type { Problem, ProblemGroup } from "#core/problems/types.ts";
import { EmptyState } from "../common/EmptyState.tsx";
import { Num } from "../common/Num.tsx";
import { StatusGlyph, StatusMark } from "../common/StatusGlyph.tsx";
import type { Model } from "../model.ts";
import { OpenItemsSection } from "../records/OpenItems.tsx";
import { registerSheet, selectionOnly } from "../sheets/registry.ts";
import { anySelected, type Col, Row, Sheet, SheetBar, SheetTable } from "../tables/common.tsx";
import { resolveTargets } from "../targets.ts";
import { GROUP_LOOK, ProblemList, ProblemRow } from "./ProblemRow.tsx";
import { problemCounts, problemList } from "./source.ts";

/**
 * The Problems sheet (docs/ux/plan.md D-UX-12, S4.8; docs/ux/heuristics-and-first-run.md §5.4):
 * one list of what stands between the project and a sendable order or a sound build, grouped by
 * consequence (blocks the order, errors, warnings, notes), each row in plain words with a Show and
 * its fixes; then the document's checks and its open items, which is where an open item is added
 * and resolved. With nothing to report it says what was checked. ↑ and ↓ move between rows and
 * Enter shows. Owner: S4.
 */

const GROUPS: readonly ProblemGroup[] = ["blocks-order", "error", "warning", "note"];

const HEADINGS: Readonly<Record<ProblemGroup, string>> = {
  "blocks-order": "Blocks the order",
  error: "Errors",
  warning: "Warnings",
  note: "Notes",
};

const CHECK_COLS: readonly Col[] = [
  { id: "id", head: "Check", w: "120px" },
  { id: "text", head: "What it requires" },
  { id: "result", head: "Result", w: "120px" },
  { id: "margin", head: "Margin", w: "120px", align: "right" },
];

function ChecksSection({ m }: { m: Model }) {
  if (m.check.checks.length === 0) return null;
  return (
    <section class="block" data-testid="checks">
      <h4 class="block-head">
        <span class="figure">Checks</span>
        <span class="sub">What the project says it must satisfy</span>
      </h4>
      <SheetTable cols={CHECK_COLS}>
        <tbody>
          {m.check.checks.map((c) => {
            const failed = c.pass === false;
            const word = c.pending
              ? "Pending"
              : c.pass === undefined
                ? (c.problem ?? "?")
                : c.pass
                  ? "Pass"
                  : "Fail";
            const status =
              c.pending || c.pass === undefined
                ? "info"
                : c.pass
                  ? "ready"
                  : c.severity === "error"
                    ? "blocked"
                    : "warn";
            return (
              <Row key={c.id} class={failed ? c.severity : undefined} data-check={c.id}>
                <td>
                  <b>{c.id}</b>
                </td>
                <td>{c.text ?? ""}</td>
                <td>
                  <StatusMark status={status} word={word} size={12} />
                </td>
                <td class="n">{c.margin === undefined ? "" : <Num text={String(c.margin)} />}</td>
              </Row>
            );
          })}
        </tbody>
      </SheetTable>
    </section>
  );
}

function Summary({ counts }: { counts: Record<ProblemGroup, number> }) {
  return (
    <span class="problem-counts" data-testid="problem-counts">
      {GROUPS.map((g) => (
        <span key={g} class={`count ${GROUP_LOOK[g].tone}`} data-group={g}>
          <StatusGlyph status={GROUP_LOOK[g].status} size={12} />
          <b>{counts[g]}</b> {HEADINGS[g].toLowerCase()}
        </span>
      ))}
    </span>
  );
}

export function ProblemsSheet({ m }: { m: Model }) {
  const listed = problemList.value;
  const all = listed?.answer.problems ?? [];
  const keep = (p: Problem) =>
    !selectionOnly.value || anySelected(resolveTargets(m, p.targets).ids);
  const shown = all.filter(keep);
  const counts = Object.fromEntries(
    GROUPS.map((g) => [g, all.filter((p) => p.group === g).length]),
  ) as Record<ProblemGroup, number>;
  const clear = all.length === 0;
  return (
    <Sheet testid="problems">
      <SheetBar>
        <Summary counts={counts} />
      </SheetBar>
      {clear ? (
        <EmptyState
          testid="all-clear"
          title="Every check passes"
          glyph={<StatusGlyph status="ready" size={28} />}
        >
          {Object.keys(m.derived.bars).length} bars, {Object.keys(m.derived.parts).length} parts and{" "}
          {Object.keys((m.doc.connections as object | undefined) ?? {}).length} connections derive
          without an error or a warning at step {m.rev}.
        </EmptyState>
      ) : (
        GROUPS.map((g) => {
          const group = shown.filter((p) => p.group === g);
          if (group.length === 0) return null;
          return (
            <section class="block" key={g} data-group={g}>
              <h4 class="block-head">
                <span class="figure">{HEADINGS[g]}</span>
                <span class="sub">{group.length}</span>
              </h4>
              <ProblemList label={HEADINGS[g]}>
                {group.map((p) => (
                  <ProblemRow key={p.id} p={p} />
                ))}
              </ProblemList>
            </section>
          );
        })
      )}
      <ChecksSection m={m} />
      <OpenItemsSection m={m} />
    </Sheet>
  );
}

/** The rail's badge: what blocks the order, then the warnings, each as a glyph and a number. */
function ProblemsBadge() {
  const { blocks, warnings } = problemCounts.value;
  if (blocks === 0 && warnings === 0) {
    return (
      <span class="badge ok" title="Every check passes">
        <StatusGlyph status="ready" size={12} /> <span class="sr-only">Every check passes</span>
      </span>
    );
  }
  return (
    <span class="badge" title={`${blocks} block the order, ${warnings} warnings`}>
      {blocks > 0 && (
        <span class="badge-n blocked">
          <StatusGlyph status="blocked" size={12} />
          {blocks}
          <span class="sr-only"> block the order</span>
        </span>
      )}
      {warnings > 0 && (
        <span class="badge-n warn">
          <StatusGlyph status="warn" size={12} />
          {warnings}
          <span class="sr-only"> warnings</span>
        </span>
      )}
    </span>
  );
}

registerSheet({
  id: "problems",
  title: "Problems",
  order: 50,
  badge: () => <ProblemsBadge />,
  Body: ProblemsSheet,
});
