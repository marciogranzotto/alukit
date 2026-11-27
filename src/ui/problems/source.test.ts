import { afterEach, describe, expect, it } from "vitest";
import type { Problem, ProblemGroup, ProblemsAnswer } from "#core/problems/types.ts";
import { readiness } from "../shell/readiness.ts";
import { model, problems } from "../store.ts";
import { SMALL } from "../testing.ts";
import { problemCounts } from "./source.ts";

/**
 * What the Problems tab's badge and the readiness pill count (docs/ux/review-phase4.md M3, B1):
 * the badge counts the problems by group, as the sheet's summary does, not the order's own
 * warnings; the pill says the order is ready with warnings, never a plain ready, while the order
 * warns.
 */

afterEach(() => {
  problems.value = undefined;
  model.value = undefined;
});

function problem(id: string, group: ProblemGroup, extra: Partial<Problem> = {}): Problem {
  return {
    id,
    code: id,
    group,
    title: `${id} in words`,
    detail: "",
    raw: id,
    targets: [],
    fixes: [],
    from: ["check"],
    ...extra,
  };
}

function answer(list: Problem[], order: ProblemsAnswer["order"]): ProblemsAnswer {
  return {
    schema: "alukit.problems/1",
    rev: SMALL.rev,
    variant: SMALL.variant,
    as_of: "2026-11-27",
    order,
    problems: list,
  };
}

describe("the Problems badge", () => {
  it("counts a warning of the check's, which the order does not count", () => {
    model.value = SMALL;
    problems.value = answer([problem("unconnected", "warning")], {
      status: "READY",
      blocks: 0,
      warnings: 0,
    });
    expect(problemCounts.value).toEqual({ blocks: 0, errors: 0, warnings: 1 });
  });

  it("counts each group the sheet lists, and no notes", () => {
    model.value = SMALL;
    problems.value = answer(
      [
        problem("est-price", "blocks-order", { from: ["order"] }),
        problem("geometry", "error"),
        problem("unconnected", "warning"),
        problem("stale-price", "warning", { from: ["order"] }),
        problem("unconnected~2", "warning"),
        problem("open-item", "note"),
      ],
      { status: "BLOCKED", blocks: 1, warnings: 1 },
    );
    expect(problemCounts.value).toEqual({ blocks: 1, errors: 1, warnings: 3 });
  });
});

describe("the readiness pill", () => {
  it("is ready when the order is ready and nothing warns", () => {
    model.value = SMALL;
    problems.value = answer([], { status: "READY", blocks: 0, warnings: 0 });
    expect(readiness()).toMatchObject({
      status: "READY",
      text: "Ready to order",
      glyph: "ready",
      warnings: [],
    });
  });

  it("is ready with warnings, in the warning's look, saying which, while the order warns", () => {
    model.value = SMALL;
    const unjoined = problem("butt-no-connector", "warning", {
      rule: "no-connector",
      title: "8 butts name no connector: the order buys nothing to join them",
      from: ["check", "order"],
    });
    problems.value = answer([unjoined, problem("unconnected", "warning")], {
      status: "READY",
      blocks: 0,
      warnings: 1,
    });
    const r = readiness();
    expect(r).toMatchObject({
      status: "READY",
      text: "Ready, 1 warning",
      glyph: "warn",
    });
    // Only the order's own warnings: the check's open corner is the Problems tab's.
    expect(r?.warnings).toEqual(["8 butts name no connector: the order buys nothing to join them"]);
  });
});
