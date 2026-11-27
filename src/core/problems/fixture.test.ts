import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES, readJson } from "../testing.ts";
import type { Problem, ProblemGroup, ProblemsAnswer } from "./types.ts";

/**
 * tests/fixtures/ux/problems-cart.json is the cart's problem model, made by hand before the
 * module that makes it (BE-3, S1.6), for the UI streams to build against. It is a transcription of
 * what `alukit check --json` and `alukit order --json` say of the cart, so it must stay one: each
 * diagnostic and each order reason is one problem, with the CLI's message as its `raw`, in the
 * group its severity or action gives. When the cart's derive or order changes, transcribe it again.
 */

const MAIN = fileURLToPath(new URL("../../cli/main.ts", import.meta.url));
const CART = join(FIXTURES, "cart");
const AS_OF = "2026-11-26";

function cli(args: string[]): unknown {
  const r = spawnSync(process.execPath, [MAIN, ...args], { encoding: "utf8" });
  return JSON.parse(r.stdout);
}

interface Diagnostic {
  severity: "error" | "warn" | "info";
  code: string;
  entity?: string;
  message: string;
}

interface Order {
  status: "READY" | "BLOCKED";
  suppliers: {
    supplier: string | null;
    reasons: { rule: string; action: "block" | "warn"; message: string }[];
  }[];
}

const fixture = readJson(join(FIXTURES, "ux", "problems-cart.json")) as ProblemsAnswer;
const check = cli(["check", CART, "--json"]) as { diagnostics: Diagnostic[] };
const order = cli(["order", CART, "--format", "json", "--as-of", AS_OF]) as Order;
const doc = readJson(join(CART, "alukit.json")) as { open: { id: string; blocks?: string }[] };

const SEVERITY_GROUP: Readonly<Record<Diagnostic["severity"], ProblemGroup>> = {
  error: "error",
  warn: "warning",
  info: "note",
};
const GROUPS: readonly ProblemGroup[] = ["blocks-order", "error", "warning", "note"];

describe("the cart's hand-made problem model", () => {
  it("is alukit.problems/1 of the cart as written, at the order's date", () => {
    expect(fixture).toMatchObject({ schema: "alukit.problems/1", rev: 0, variant: null });
    expect(fixture.as_of).toBe(AS_OF);
    const ids = fixture.problems.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // By group, most serious first.
    const order = fixture.problems.map((p) => GROUPS.indexOf(p.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("holds each of the check's diagnostics once, in its severity's group, as the CLI words it", () => {
    for (const d of check.diagnostics) {
      const found = fixture.problems.filter((p) => p.from.includes("check") && p.raw === d.message);
      expect(found, d.message).toHaveLength(1);
      const p = found[0] as Problem;
      expect([p.code, p.group]).toEqual([d.code, SEVERITY_GROUP[d.severity]]);
      if (d.entity) expect(p.targets).toContain(d.entity.split(".")[0]);
    }
    expect(fixture.problems.filter((p) => p.from.includes("check"))).toHaveLength(
      check.diagnostics.length,
    );
  });

  it("holds each of the order's reasons once, by its rule and supplier, blocking or warning", () => {
    const reasons = order.suppliers.flatMap((s) => s.reasons.map((r) => ({ ...r, s: s.supplier })));
    for (const r of reasons) {
      const found = fixture.problems.filter(
        (p) => p.from.includes("order") && p.raw === r.message && p.suppliers?.includes(r.s),
      );
      expect(found, r.message).toHaveLength(1);
      const p = found[0] as Problem;
      expect([p.rule, p.group]).toEqual([
        r.rule,
        r.action === "block" ? "blocks-order" : "warning",
      ]);
    }
    expect(fixture.problems.filter((p) => p.from.includes("order"))).toHaveLength(reasons.length);
    const blocks = reasons.filter((r) => r.action === "block").length;
    expect(fixture.order).toEqual({
      status: order.status,
      blocks,
      warnings: reasons.length - blocks,
    });
    expect(fixture.problems.filter((p) => p.group === "blocks-order")).toHaveLength(blocks);
  });

  it("merges each open item that holds the order with its reason, and offers to resolve it", () => {
    for (const o of doc.open.filter((x) => x.blocks === "order")) {
      const p = fixture.problems.find((x) => x.from.includes("open") && x.targets.includes(o.id));
      expect(p, o.id).toMatchObject({ code: "open-item", from: ["order", "open"] });
      expect(p?.fixes).toContainEqual(
        expect.objectContaining({ kind: "resolve-open", open: o.id }),
      );
    }
  });
});
