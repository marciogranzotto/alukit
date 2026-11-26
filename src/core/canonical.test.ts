import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalText } from "./canonical.ts";
import { LOCK_CANONICAL } from "./lock/schema.ts";
import { projectText } from "./project/canonical.ts";
import { FIXTURES, fixtureProjects } from "./testing.ts";

describe("canonical form (design §2)", () => {
  it("holds for every fixture document and lock", () => {
    for (const dir of fixtureProjects()) {
      const doc = readFileSync(join(dir, "alukit.json"), "utf8");
      expect(projectText(JSON.parse(doc)), dir).toBe(doc);
      const lock = readFileSync(join(dir, "alukit.lock.json"), "utf8");
      expect(canonicalText(JSON.parse(lock), LOCK_CANONICAL), dir).toBe(lock);
    }
  });

  it("orders keys by the schema, maps by id order, one entity per line", () => {
    const text = projectText({
      bars: {
        b10: { tags: ["x"], b: [1, 0, 0], a: [0, 0, 0] },
        b2: { roll_deg: 90, item: "test:TS40", a: "n1", b: "n2" },
      },
      ids: { pt: 1, b: 10, n: 2 },
      nodes: { n2: [1, 0, 0], n1: [0, 0, 0] },
      params: { W: 1, H: 2, Hb: 3 },
      schema: "alukit.project/1",
    });
    expect(text).toBe(
      [
        "{",
        '  "schema": "alukit.project/1",',
        '  "ids": { "b": 10, "n": 2, "pt": 1 },',
        '  "params": {',
        '    "H": 2,',
        '    "Hb": 3,',
        '    "W": 1',
        "  },",
        '  "nodes": {',
        '    "n1": [0, 0, 0],',
        '    "n2": [1, 0, 0]',
        "  },",
        '  "bars": {',
        '    "b2": { "item": "test:TS40", "a": "n1", "b": "n2", "roll_deg": 90 },',
        '    "b10": { "a": [0, 0, 0], "b": [1, 0, 0], "tags": ["x"] }',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("picks the union branch by its discriminator for key order", () => {
    const text = projectText({
      schema: "alukit.project/1",
      connections: {
        c1: { ends: ["b2.a"], through: "b1", type: "butt", spacer_mm: 8 },
        c2: {
          connector: "x:Y",
          ends: ["b3.a"],
          axis: "along",
          base: { at_mm: 5, bar: "b1" },
          type: "pivot",
        },
      },
    });
    expect(text).toContain(
      '"c1": { "type": "butt", "through": "b1", "ends": ["b2.a"], "spacer_mm": 8 }',
    );
    expect(text).toContain(
      '"c2": { "type": "pivot", "base": { "bar": "b1", "at_mm": 5 }, "axis": "along", "ends": ["b3.a"], "connector": "x:Y" }',
    );
  });

  it("snaps float noise on quantised fields only, never -0", () => {
    const text = projectText({
      schema: "alukit.project/1",
      nodes: { n1: [1199.9999999999998, 0.1 + 0.2, -0] },
      bars: {
        b1: {
          a: "n1",
          b: { len_mm: 12.345, dir: [0.1 + 0.2, 0, 1] },
          roll_deg: 89.99999999999999,
          off_mm: [0.30000000000000004, -0],
        },
      },
      params: { k: 0.30000000000000004 },
    });
    expect(text).toContain('"n1": [1200, 0.3, 0]');
    // A direction is dimensionless: no quantum, so it is written as it is.
    expect(text).toContain('"b": { "len_mm": 12.345, "dir": [0.30000000000000004, 0, 1] }');
    expect(text).toContain('"roll_deg": 90');
    expect(text).toContain('"off_mm": [0.3, 0]');
    expect(text).toContain('"k": 0.30000000000000004');
  });

  it("snaps a project item's outline, hole positions and datums to 0.01 mm (M6)", () => {
    const noise = 0.1 + 0.2;
    const text = projectText({
      schema: "alukit.project/1",
      items: {
        p: {
          kind: "plate",
          name: "P",
          material: "x:steel",
          thickness_mm: 5.000000000000001,
          outline: [
            [0, 0],
            [100.00000000000001, noise],
            [100, 60],
          ],
          holes: [{ at: [20.000000000000004, noise], d_mm: 6.6000000000000005 }],
          datums: { mount: [noise, 0, 0] },
          k_factor: noise,
        },
      },
    });
    expect(text).toContain('"thickness_mm": 5');
    expect(text).toContain('"outline": [[0, 0], [100, 0.3], [100, 60]]');
    expect(text).toContain('"holes": [{ "at": [20, 0.3], "d_mm": 6.6 }]');
    expect(text).toContain('"datums": { "mount": [0.3, 0, 0] }');
    // A K-factor is dimensionless: written as it is.
    expect(text).toContain(`"k_factor": ${noise}`);
  });

  it("keeps id lists in id order and unknown keys after known ones", () => {
    const text = projectText({
      schema: "alukit.project/1",
      checks: [
        { id: "C10", value: "1", op: "<=", limit: "2" },
        { id: "C2", value: "1", op: "<=", limit: "2" },
      ],
      bars: { b1: { zeta: 1, a: "n1", alpha: 2, b: "n2" } },
    });
    expect(text.indexOf('"C2"')).toBeLessThan(text.indexOf('"C10"'));
    expect(text).toContain('"b1": { "a": "n1", "b": "n2", "alpha": 2, "zeta": 1 }');
  });

  it("is idempotent", () => {
    const doc = JSON.parse(readFileSync(join(FIXTURES, "cart", "alukit.json"), "utf8"));
    const once = projectText(doc);
    expect(projectText(JSON.parse(once))).toBe(once);
  });
});
