import { computed } from "@preact/signals";
import type { Problem, ProblemGroup, ProblemsAnswer } from "#core/problems/types.ts";
import type { Diagnostic, Model } from "../model.ts";
import { model, problems } from "../store.ts";

/**
 * Where the Problems sheet and its badge read the problems from (docs/ux/plan.md §5.3): the
 * drawn revision's `alukit.problems/1` answer, which S2.6 fills into `store.problems` once the
 * server serves it (BE-3, S1.6). Until that answer is there, the problems are the check's
 * diagnostics: errors, warnings and notes, each with its entity, and no order blockers (the Order
 * sheet reads those from the order itself) and no fixes. `fromCheck` is that stopgap; it goes when
 * `problems` is always filled (docs/ux/s4-decisions.md). Owner: S4.
 */

const GROUP: Readonly<Record<Diagnostic["severity"], ProblemGroup>> = {
  error: "error",
  warn: "warning",
  info: "note",
};

/** The check's diagnostics as problems, in the check's order. */
export function fromCheck(m: Model): ProblemsAnswer {
  const list: Problem[] = m.check.diagnostics.map((d) => ({
    id: `${d.code}/${d.entity ?? ""}/${d.field ?? ""}/${d.message}`,
    code: d.code,
    group: GROUP[d.severity],
    title: d.message,
    detail: "",
    raw: d.message,
    targets: d.entity ? [d.entity.split(".")[0] as string] : [],
    ...(d.field !== undefined ? { field: d.field } : {}),
    fixes: [],
    from: ["check"],
  }));
  const count = (g: ProblemGroup) => list.filter((p) => p.group === g).length;
  return {
    schema: "alukit.problems/1",
    rev: m.rev,
    variant: m.variant,
    as_of: "",
    order: { status: "EMPTY", blocks: count("error"), warnings: count("warning") },
    problems: list,
  };
}

/** The problems of the drawn revision, from the server's answer when it has one. */
export const problemList = computed<{ answer: ProblemsAnswer; served: boolean } | undefined>(() => {
  const m = model.value;
  const served = problems.value;
  // The server's answer counts only for the revision drawn: a stale one waits for its successor.
  if (served !== undefined && (m === undefined || served.rev === m.rev)) {
    return { answer: served, served: true };
  }
  return m ? { answer: fromCheck(m), served: false } : undefined;
});

/**
 * What the rail's badge counts: the problems by group, as the sheet's summary counts them, so the
 * badge and the list agree (docs/ux/review-phase4.md M3). Notes are not counted. The order's own
 * warnings (`order.warnings`, its rules that warn) are the Order tab's and the readiness pill's.
 */
export const problemCounts = computed(() => {
  const list = problemList.value?.answer.problems ?? [];
  const count = (g: ProblemGroup) => list.filter((p) => p.group === g).length;
  return { blocks: count("blocks-order"), errors: count("error"), warnings: count("warning") };
});
