import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { derive } from "../derive/derive.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { idRanges, select } from "../query.ts";
import { FIXTURES, readJson } from "../testing.ts";
import { checkModel } from "./check.ts";
import { modelOutputs, outputAccessors } from "./outputs.ts";

/** `checkModel` (design §4.9, §5.5) and query selection (§7.3) on the fixtures. */

function load(dir: string, edit?: (doc: Record<string, unknown>) => void) {
  const raw = structuredClone(readJson(join(dir, "alukit.json"))) as Record<string, unknown>;
  edit?.(raw);
  const items = lockItems(LockFile.parse(readJson(join(dir, "alukit.lock.json"))));
  return { raw, derived: derive(raw, items), items };
}

const cart = join(FIXTURES, "cart");
const g01 = join(FIXTURES, "golden-ends", "G01");
const g26 = join(FIXTURES, "golden-gen", "G26");

/** `checkModel` with the outputs' accessors, as `alukit check`, `do` and `order` call it. */
function checkWithOutputs(input: ReturnType<typeof load>) {
  return checkModel({
    ...input,
    accessors: outputAccessors(modelOutputs(input.derived, input.items)),
  });
}

describe("project checks", () => {
  it("reads lengths, points, distances, the model box and tag counts", () => {
    const r = checkModel(
      load(cart, (d) => {
        d.nodes = { n1: [0, 0, 0], n2: [300, 400, 0] };
        d.checks = [
          { id: "C1", value: "len(r1)", op: "==", limit: "W" },
          { id: "C2", value: "dist(n1, n2)", op: "==", limit: "500" },
          { id: "C3", value: "pos(n2).y", op: "==", limit: "400" },
          { id: "C4", value: "cut(b1)", op: "<", limit: "len(b1)" },
          { id: "C5", value: "count(tag:post)", op: "==", limit: "4" },
          { id: "C6", expr: "bbox().z > H and sec(b1).width_mm == 40" },
        ];
      }),
    );
    expect(r.checks.map((c) => [c.id, c.pass])).toEqual([
      ["C1", true],
      ["C2", true],
      ["C3", true],
      ["C4", true],
      ["C5", true],
      ["C6", true],
    ]);
    expect(r.diagnostics.filter((d) => d.code.startsWith("check"))).toEqual([]);
  });

  it("reports a record it cannot read, an unknown id and a value that is not a condition", () => {
    const r = checkModel(
      load(g01, (d) => {
        d.checks = [
          { value: "1", op: "=<", limit: "2" },
          { id: "C2", value: "len(b9)", op: "<=", limit: "1" },
          { id: "C3", expr: "len(b1)" },
          { id: "C4", value: "mass()", op: "<=", limit: "10", severity: "warn" },
        ];
      }),
    );
    expect(r.diagnostics.map((d) => [d.severity, d.code, d.entity])).toEqual([
      ["error", "check", "C2"],
      ["error", "check", "C3"],
      ["error", "check", "checks[0]"],
      ["info", "check-pending", "C4"],
    ]);
    expect(r.diagnostics[0]?.message).toContain("no bar b9 that derives");
  });
});

describe("mass() and cost(): the bill of materials and the priced order (§4.9)", () => {
  it("reads the BOM's total mass and the order's low, likely and high totals", () => {
    const bomMass = (readJson(join(cart, "expected-bom.json")) as { mass_kg: number }).mass_kg;
    const total = (
      readJson(join(g26, "expected.json")) as {
        expect: {
          order: { total: { low_minor: number; likely_minor: number; high_minor: number } };
        };
      }
    ).expect.order.total;
    const withMass = checkWithOutputs(
      load(cart, (d) => {
        d.checks = [{ id: "C1", value: "mass()", op: "==", limit: String(bomMass) }];
      }),
    );
    expect(withMass.checks.map((c) => [c.id, c.value, c.pass])).toEqual([["C1", bomMass, true]]);
    const r = checkWithOutputs(
      load(g26, (d) => {
        d.checks = [
          { id: "C1", value: "cost()", op: "<=", limit: "300" },
          { id: "C2", value: "cost(low)", op: "==", limit: String(total.low_minor / 100) },
          { id: "C3", value: "cost(likely)", op: "==", limit: "cost()" },
          { id: "C4", value: "cost(high)", op: "<=", limit: "300", severity: "warn" },
        ];
      }),
    );
    expect(r.checks.map((c) => [c.id, c.value, c.pass])).toEqual([
      ["C1", total.likely_minor / 100, true],
      ["C2", total.low_minor / 100, true],
      ["C3", total.likely_minor / 100, true],
      ["C4", total.high_minor / 100, false],
    ]);
    expect(r.diagnostics.map((d) => [d.severity, d.code, d.entity])).toEqual([
      ["warn", "check", "C4"],
    ]);
  });

  it("cannot be evaluated on a total that leaves something out, nor with a bad argument", () => {
    // The cart's order has lines no offer prices (its unsourced group).
    const r = checkWithOutputs(
      load(cart, (d) => {
        d.checks = [
          { id: "C1", value: "cost()", op: "<=", limit: "1000000" },
          { id: "C2", value: "cost(worst)", op: "<=", limit: "1" },
          { id: "C3", value: "mass(b1)", op: "<=", limit: "1" },
        ];
      }),
    );
    expect(r.checks.map((c) => [c.id, c.pass, c.problem])).toEqual([
      ["C1", undefined, expect.stringMatching(/^cost\(\): \d+ order lines? ha(s|ve) no price$/)],
      ["C2", undefined, "cost takes nothing, or one of low, likely and high: cost(high)"],
      ["C3", undefined, "mass takes no arguments"],
    ]);
    // A cost line in a currency with no rate is left out of the total.
    const noRate = checkWithOutputs(
      load(g26, (d) => {
        d.costs = [
          {
            id: "K1",
            label: "freight",
            kind: "freight",
            low_minor: 1,
            likely_minor: 1,
            high_minor: 1,
            currency: "USD",
          },
        ];
        d.checks = [{ id: "C1", value: "cost()", op: "<=", limit: "1000" }];
      }),
    );
    expect(noRate.checks[0]?.problem).toBe("cost(): no exchange rate into BRL for K1");
    // An item with no mass is left out of the BOM's total (no fixture has one: the BOM says so).
    const input = load(g26, (d) => {
      d.checks = [{ id: "C1", value: "mass()", op: "<=", limit: "100" }];
    });
    const real = modelOutputs(input.derived, input.items);
    const gap = checkModel({
      ...input,
      accessors: outputAccessors({
        ...real,
        bom: () => ({ ...real.bom(), mass_unknown: ["test:PANEL-PC4"] }),
      }),
    });
    expect(gap.checks[0]?.problem).toBe("mass(): 1 item has no mass (test:PANEL-PC4)");
    expect(gap.diagnostics.map((d) => [d.severity, d.code, d.entity])).toEqual([
      ["error", "check", "C1"],
    ]);
  });
});

describe("unconnected ends", () => {
  it("leaves an end a butt bears on, and warns where ends meet with no connection", () => {
    expect(checkModel(load(cart)).diagnostics.filter((d) => d.code === "unconnected")).toEqual([]);
    const loose = checkModel(load(g01, (d) => delete d.connections));
    expect(loose.diagnostics).toMatchObject([
      { severity: "warn", code: "unconnected", entity: "b1.b", refs: ["b1.b", "b2.a"] },
    ]);
  });
});

describe("query selection", () => {
  const doc = readJson(join(cart, "alukit.json")) as Record<string, unknown>;
  it("selects by kind name, singular or plural, and relation in both directions", () => {
    expect(select(doc, "run")).toEqual({ ok: true, ids: ["r1", "r2"] });
    expect(select(doc, "bars of c9")).toEqual({ ok: true, ids: ["b11", "b12"] });
    expect(select(doc, "connections of b31")).toEqual({ ok: true, ids: ["c32", "c33"] });
    expect(select(doc, "bars of n1")).toMatchObject({ ok: false });
    expect(select(doc, "item:")).toMatchObject({ ok: false });
  });

  it("compresses ids into ranges", () => {
    expect(idRanges(["b3", "b1", "b2", "b5", "b6", "c1", "pt1"])).toBe("b1–b3, b5, b6, c1, pt1");
  });
});
