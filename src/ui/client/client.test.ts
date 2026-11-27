import { describe, expect, it } from "vitest";
import { catalogParams } from "./catalog.ts";
import { dryRunOf } from "./dryrun.ts";
import { problemsParams } from "./problems.ts";

/**
 * The clients of S1's endpoints (docs/ux/plan.md §5.3): the requests they make and how they read
 * the answers. The endpoints themselves are tested with the server (src/server/server.test.ts).
 */

describe("the clients", () => {
  it("ask for the catalog list and the problems with their fields in a fixed order", () => {
    expect(catalogParams({ prefer: "bar", q: "40x40", limit: 20 })).toBe(
      "q=40x40&prefer=bar&limit=20",
    );
    expect(catalogParams({ q: "" })).toBe("");
    expect(problemsParams({ asOf: "2026-11-26", variant: "tall" })).toBe(
      "variant=tall&as_of=2026-11-26",
    );
    expect(problemsParams({})).toBe("");
  });

  it("read a dry run's answer: what the step would do, a refusal, or why there is none", () => {
    const effects = {
      cuts: { b1: [1000, 980] as [number, number] },
      added: {},
      removed: [],
      claimed: [],
    };
    expect(
      dryRunOf(200, {
        ok: true,
        rev: 3,
        created: ["c3"],
        diagnostics: { new: [{ severity: "warn", code: "connection", message: "m" }] },
        effects,
      }),
    ).toEqual({
      ok: true,
      value: {
        ok: true,
        rev: 3,
        created: ["c3"],
        diagnostics: [{ severity: "warn", code: "connection", message: "m" }],
        effects,
      },
    });
    const errors = [{ code: "referenced", message: "b1 is referred to by c1" }];
    expect(
      dryRunOf(422, {
        ok: false,
        kind: "refused",
        failed: { index: 0, cmd: "removeEntity", errors },
      }),
    ).toEqual({
      ok: true,
      value: { ok: false, why: "command 1 (removeEntity): b1 is referred to by c1", errors },
    });
    expect(
      dryRunOf(409, { ok: false, kind: "read-only", status: { message: "bad JSON" } }),
    ).toEqual({
      ok: false,
      why: "the project is read-only: bad JSON",
    });
  });
});
