import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawDoc, State } from "../commands/types.ts";
import { derive } from "../derive/derive.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { openLiveCatalogs } from "../project/open.ts";
import { CornerRule } from "../project/schema.ts";
import { FIXTURES, readJson } from "../testing.ts";
import { type Arrangements, arrange, arrangeQuery, CORNER_RULES } from "./arrange.ts";
import { arrangeBatch, jointBatch, lostFields, takeOut } from "./batch.ts";

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

  it("takes a corner's miter or splice out whole, as it takes its butts (E1.4)", () => {
    const joined = {
      connections: {
        c1: { type: "miter", ends: ["b1.a", "b2.a"], gap_mm: 1 },
        c2: { type: "splice", ends: ["b7.b", "b8.a"] },
        c3: { type: "pivot", base: { bar: "b9", at_mm: 1 }, ends: ["b1.a"] },
      },
    };
    // The pivot is a hinge, not the corner's joint: it stays.
    expect(takeOut(joined, [corner])).toEqual([{ cmd: "removeEntity", args: { id: "c1" } }]);
    expect(lostFields(joined, [corner])).toEqual([{ id: "c1", fields: ["gap_mm"] }]);
    expect(jointBatch(doc, [corner], "miter")).toEqual([
      { cmd: "setConnection", args: { id: "c1", set: { ends: ["b3.a"] } } },
      { cmd: "addConnection", args: { type: "miter", ends: ["b1.a", "b2.a"] } },
    ]);
  });
});

describe("a corner's miter and splice (E1.4)", () => {
  const ENV = { today: "2026-11-27" };

  async function arrangeAt(dir: string, at: [number, number, number][], doc?: RawDoc) {
    const raw = (doc ?? readJson(join(dir, "alukit.json"))) as RawDoc;
    const state: State = {
      doc: raw,
      lock: LockFile.parse(readJson(join(dir, "alukit.lock.json"))),
    };
    return arrange({
      state,
      derived: derive(raw, lockItems(state.lock)),
      at,
      env: ENV,
      open: async (catalogs) => (await openLiveCatalogs(dir, { catalogs })).set,
    });
  }
  const joint = (a: Arrangements, kind: string) => a.joints.find((j) => j.kind === kind);

  it("mitres a ground rectangle's corner of one section: the butting rail reaches the corner", async () => {
    // G01: b1 along x to (1000, 0, 0), b2 along y from it, both 40 × 40 on their centre lines; c1
    // butts b2 through b1, which covers it. Mitred, b2's end runs to the corner's outside, 20 mm
    // past the point instead of 20 short of it: 580 → 620. b1's long point stays at x = 1020.
    const a = await arrangeAt(join(FIXTURES, "golden-ends", "G01"), [[1000, 0, 0]]);
    expect(joint(a, "miter")).toEqual({
      kind: "miter",
      ok: true,
      commands: [
        { cmd: "removeEntity", args: { id: "c1" } },
        { cmd: "addConnection", args: { type: "miter", ends: ["b1.b", "b2.a"] } },
      ],
      plans: [{ at: [1000, 0, 0], ends: ["b1.b", "b2.a"] }],
      effects: { cuts: { b2: [580, 620] }, added: {}, removed: ["c1"], claimed: [], parts: {} },
    });
    expect(joint(a, "splice")).toEqual({
      kind: "splice",
      ok: false,
      // Derive's words: it judges each joint, the arrangement repeats no rule of its own.
      why: "c2: b1 and b2 are not collinear (90.00°)",
    });
    // The corner rules are answered as before.
    expect(a.rules.map((r) => [r.rule, r.ok])).toEqual(CORNER_RULES.map((r) => [r, true]));
  });

  it("splices a collinear pair of one item, and refuses to mitre it", async () => {
    const dir = join(FIXTURES, "golden-ends", "G01");
    const g01 = readJson(join(dir, "alukit.json")) as RawDoc;
    const pair = {
      ...g01,
      bars: { b1: { a: [0, 0, 0], b: [500, 0, 0] }, b2: { a: [500, 0, 0], b: [1000, 0, 0] } },
      connections: {},
    };
    const a = await arrangeAt(dir, [[500, 0, 0]], pair);
    // Each end is cut square at its design point, as it was: no cut moves.
    expect(joint(a, "splice")).toEqual({
      kind: "splice",
      ok: true,
      commands: [{ cmd: "addConnection", args: { type: "splice", ends: ["b1.b", "b2.a"] } }],
      plans: [{ at: [500, 0, 0], ends: ["b1.b", "b2.a"] }],
      effects: { cuts: {}, added: {}, removed: [], claimed: ["b1.b", "b2.a"], parts: {} },
    });
    expect(joint(a, "miter")).toEqual({
      kind: "miter",
      ok: false,
      why: "c1: the two bars are parallel: use a splice",
    });
  });

  it("refuses a joint derive refuses, with its words, and one of more than two ends", async () => {
    // G10's bars are 40 × 40 and 40 × 80: no miter joins two sections.
    const g10 = await arrangeAt(join(FIXTURES, "golden-ends", "G10"), [[1000, 0, 0]]);
    expect(joint(g10, "miter")).toEqual({
      kind: "miter",
      ok: false,
      why: "c2: a miter joins one section: b1 is test:TS40, b2 is test:TS4080",
    });
    // A box frame's corner: a post's end and two rails'.
    const frame = await arrangeAt(join(FIXTURES, "brace"), [[0, 0, 0]]);
    for (const kind of ["miter", "splice"]) {
      expect(joint(frame, kind)).toEqual({
        kind,
        ok: false,
        why: `a ${kind} joins two bar ends: 3 meet at (0, 0, 0)`,
      });
    }
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
      joints: [],
    });
    expect(arrangeQuery(["0,0,900"], [])).toEqual({ at: [[0, 0, 900]] });
    // A miter or a splice is named as a rule is; naming any, the answer holds only those named.
    expect(arrangeQuery(["0,0,900"], ["splice", "x", "miter"])).toEqual({
      at: [[0, 0, 900]],
      rules: ["x"],
      joints: ["splice", "miter"],
    });
  });

  it("refuses no corner, a point that is not three numbers, and an unknown rule", () => {
    expect(arrangeQuery([], [])).toHaveProperty("error");
    for (const at of ["0,0", "0,0,", "0,0,a", "0,0,0,0", "Infinity,0,0"]) {
      expect(arrangeQuery([at], []), at).toHaveProperty("error");
    }
    expect(arrangeQuery(["0,0,0"], ["diagonal"])).toHaveProperty("error");
  });
});
