import { describe, expect, it } from "vitest";
import { CornerRule } from "../project/schema.ts";
import { arrangeQuery, CORNER_RULES } from "./arrange.ts";
import { arrangeBatch, lostFields, takeOut } from "./batch.ts";

/**
 * The corners' arrangements (S5.5): the batch a rule builds, and what a request names. The
 * answers themselves, against the dry runs of the same batches, are checked where a project is
 * served (src/server/server.test.ts, src/ui/inspector/inspector.test.ts).
 */

describe("the corner rules", () => {
  it("are the schema's, in its order: batch.ts writes them out so the app need not load Zod", () => {
    expect([...CORNER_RULES]).toEqual(CornerRule.options);
  });
});

describe("arrangeBatch", () => {
  const doc = {
    connections: {
      c1: { type: "butt", through: "b1", ends: ["b2.a", "b3.a"], connector: "x:K", qty: 2 },
      c2: { type: "butt", through: "b4", ends: ["b5.b", "b6.a"], label: "kept?" },
      c3: { type: "face", ends: ["b2.a"] },
    },
  };
  const corner = { at: [0, 0, 0] as const, ends: ["b1.a", "b2.a"] };

  it("takes a butt out whole, or only the ends at the corner, and keeps the connector", () => {
    // c1 keeps b3.a, which is elsewhere; the face connection is no butt and stays.
    expect(takeOut(doc, [corner])).toEqual([
      { cmd: "setConnection", args: { id: "c1", set: { ends: ["b3.a"] } } },
    ]);
    expect(arrangeBatch(doc, [corner], "x")).toEqual([
      { cmd: "setConnection", args: { id: "c1", set: { ends: ["b3.a"] } } },
      { cmd: "autoConnect", args: { at: [0, 0, 0], prefer: "x", connector: "x:K", qty: 2 } },
    ]);
  });

  it("names what a butt taken out whole carries that autoConnect does not write", () => {
    const other = { at: [1, 0, 0] as const, ends: ["b5.b", "b6.a"] };
    expect(lostFields(doc, [corner, other])).toEqual([{ id: "c2", fields: ["label"] }]);
  });
});

describe("arrangeQuery", () => {
  it("reads points in mm and rules by name, each rule once, in the order given", () => {
    expect(arrangeQuery(["0,0,900", " 1.5, -2 ,3"], ["y", "x", "y"])).toEqual({
      at: [
        [0, 0, 900],
        [1.5, -2, 3],
      ],
      rules: ["y", "x"],
    });
    expect(arrangeQuery(["0,0,900"], [])).toEqual({ at: [[0, 0, 900]] });
  });

  it("refuses no corner, a point that is not three numbers, and an unknown rule", () => {
    expect(arrangeQuery([], [])).toHaveProperty("error");
    for (const at of ["0,0", "0,0,", "0,0,a", "0,0,0,0", "Infinity,0,0"]) {
      expect(arrangeQuery([at], []), at).toHaveProperty("error");
    }
    expect(arrangeQuery(["0,0,0"], ["diagonal"])).toHaveProperty("error");
  });
});
