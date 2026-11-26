import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { derive } from "../derive/derive.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { idRanges, select } from "../query.ts";
import { FIXTURES, readJson } from "../testing.ts";
import { checkModel } from "./check.ts";

/** `checkModel` (design §4.9, §5.5) and query selection (§7.3) on the fixtures. */

function load(dir: string, edit?: (doc: Record<string, unknown>) => void) {
  const raw = structuredClone(readJson(join(dir, "alukit.json"))) as Record<string, unknown>;
  edit?.(raw);
  const items = lockItems(LockFile.parse(readJson(join(dir, "alukit.lock.json"))));
  return { raw, derived: derive(raw, items), items };
}

const cart = join(FIXTURES, "cart");
const g01 = join(FIXTURES, "golden-ends", "G01");

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
    expect(select(doc, "run")).toEqual({ ok: true, ids: ["r1"] });
    expect(select(doc, "bars of c9")).toEqual({ ok: true, ids: ["b11", "b12"] });
    expect(select(doc, "connections of b31")).toEqual({ ok: true, ids: ["c32", "c33"] });
    expect(select(doc, "bars of n1")).toMatchObject({ ok: false });
    expect(select(doc, "item:")).toMatchObject({ ok: false });
  });

  it("compresses ids into ranges", () => {
    expect(idRanges(["b3", "b1", "b2", "b5", "b6", "c1", "pt1"])).toBe("b1–b3, b5, b6, c1, pt1");
  });
});
