import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCatalog } from "#catalog/check.ts";
import { openCatalog } from "#catalog/open.ts";
import { ConnectorItem } from "#catalog/schema/items.ts";
import { checkModel } from "../check/check.ts";
import { referrers } from "../commands/refs.ts";
import { rewriteEntity } from "../commands/rewrite.ts";
import { cutList } from "../cutlist/cutlist.ts";
import { machiningText } from "../cutlist/format.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES, mergePatch } from "../testing.ts";
import { derive } from "./derive.ts";
import { derivedJson } from "./output.ts";

/**
 * The rules of acceptance run 2's gaps (docs/notes/acceptance-gaps-2.md) that G33 and G34 do not
 * pin down on their own: what `held_by` refuses, how it follows a pattern and the edit path, and
 * where positions place end holes and end taps, how they turn with a piece, and what refuses them.
 */

async function project(name: "G33" | "G34", patch: unknown = {}) {
  const p = await openProject(join(FIXTURES, "golden-gen", name));
  const raw = mergePatch(p.raw, patch);
  return { raw, items: p.items, d: derive(raw, p.items) };
}

const errors = (d: ReturnType<typeof derive>) =>
  d.diagnostics.filter((x) => x.severity === "error").map((x) => [x.code, x.entity]);

describe("a butt held by another butt's through-fastener (§3.4, acceptance gap A9)", () => {
  it("refuses a held_by that names no butt that can hold it", async () => {
    // c9 does not exist; c2 cannot hold itself.
    expect(errors((await project("G33", { connections: { c2: { held_by: "c9" } } })).d)).toEqual([
      ["ref", "c2"],
    ]);
    const self = await project("G33", { connections: { c2: { held_by: "c2" } } });
    expect(errors(self.d)).toEqual([["connection", "c2"]]);
    // A chain: b4 butts into b1 from -Y at x = 200, held by c2, which is itself held by c1.
    const chain = await project("G33", {
      bars: { b4: { item: "test-stud:TS40C", a: [200, -600, 0], b: [200, 0, 0] } },
      connections: {
        c3: {
          type: "butt",
          through: "b1",
          ends: ["b4.b"],
          connector: "test-stud:BUSH-END",
          held_by: "c2",
        },
      },
    });
    expect(errors(chain.d)).toEqual([["connection", "c3"]]);
    expect(chain.d.diagnostics.find((x) => x.entity === "c3")?.message).toBe(
      "held_by: c2 is itself held by c1; name the butt whose connector passes the through-fastener",
    );
  });

  it("refuses a holder of another type, and one whose end already holds another", async () => {
    // G34's splice cannot hold the post's butt.
    const splice = await project("G34", { connections: { c1: { held_by: "c2" } } });
    expect(errors(splice.d)).toEqual([["connection", "c1"]]);
    // A second 40x40 b4 coaxial with b3, also from -Y, also held by c1: b2.a holds b3.b already.
    const twice = await project("G33", {
      bars: { b4: { item: "test-stud:TS40C", a: [500, -1200, 0], b: [500, -600, 0] } },
      connections: {
        c3: {
          type: "butt",
          through: "b1",
          ends: ["b4.b"],
          connector: "test-stud:BUSH-END",
          held_by: "c1",
        },
      },
    });
    // b4.b does not reach b1 (b3 is between), but it is coaxial with b2.a on the far side.
    const msg = twice.d.diagnostics.find((x) => x.entity === "c3" && x.code === "connection");
    expect(msg?.message).toBe(
      "held_by: b2.a's through-fastener already holds b3.b (c2); it holds one end",
    );
  });

  it("says which way the held end misses the holder's centre line", async () => {
    const off = await project("G33", { bars: { b3: { a: [520, -600, 0], b: [520, 0, 0] } } });
    expect(off.d.diagnostics.find((x) => x.entity === "c2")?.message).toBe(
      "held_by: b3.b is not coaxial with c1's end: its centre line is 20.00 off b2.a's",
    );
  });

  it("follows a pattern: each copy is held by its own copy of the holder", async () => {
    // The joint copied once along b1, 200 further on: two studs, two sleeves, no error.
    const { d } = await project("G33", {
      patterns: {
        pt1: { template: ["b2", "b3", "c1", "c2"], along: "b1", pitch_mm: 200, count: 2 },
      },
    });
    expect(errors(d)).toEqual([]);
    const studs = d.hardware.filter((h) => h.item === "test-stud:STUD-M8x140");
    expect(studs.reduce((s, h) => s + h.qty, 0)).toBe(2);
    expect(d.pieces.filter((p) => p.item === "test-stud:TUBE-16x3").length).toBe(2);
    expect(d.bars.get("b1")?.ops.map((o) => (o.op === "hole" ? o.at : undefined))).toEqual([
      500, 700,
    ]);
  });

  it("is a reference the edit path keeps and rewrites", async () => {
    const { raw } = await project("G33");
    expect(referrers(raw as Record<string, unknown>, "c1")).toEqual([
      { from: "c2", field: "held_by", to: "c1", how: "whole" },
    ]);
    const spec = (raw as { connections: Record<string, unknown> }).connections.c2;
    const moved = rewriteEntity("connections", "c2", spec, {
      id: (x) => (x === "c1" ? "c7" : x),
    }) as { held_by: string };
    expect(moved.held_by).toBe("c7");
  });
});

describe("a connector's machining at positions (§3.4, §5.3, acceptance gap A8)", () => {
  const j4 = {
    kind: "connector",
    subtype: "end-connector",
    name: "J",
    prov: { src: "est" },
    fits: ["s40-c8"],
    recipe: true,
    mounts: [
      {
        plane: { point_mm: [0, 0, 0], normal: [0, 0, -1] },
        holes: [{ at_mm: [20, 20, 0], d_mm: 9 }],
      },
    ],
  };
  const issues = (requires: unknown[], extra: Record<string, unknown> = {}) => {
    const r = ConnectorItem.safeParse({ ...j4, ...extra, requires });
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it("takes positions in the joint's plane only, from a mount square to the connector's z", () => {
    expect(issues([{ op: "end-tap", on: "butting", thread: "M8", at_holes: 0 }])).toEqual([]);
    expect(
      issues([{ op: "end-tap", on: "butting", thread: "M8", at_holes: 0, at_mm: [[0, 0]] }]),
    ).toEqual(["give at_mm or at_holes, not both"]);
    expect(issues([{ op: "access-hole", on: "butting", d_mm: 7, at_mm: [[0, 0]] }])).toEqual([
      "positions lie in the joint's plane; a access-hole on the butting bar's side stands from_end_mm in from its end and takes none",
    ]);
    expect(issues([{ op: "through-hole", on: "through", d_mm: 9, at_holes: 1 }])).toEqual([
      "no mounts[1]",
    ]);
    const tilted = {
      mounts: [{ ...j4.mounts[0], plane: { point_mm: [0, 0, 0], normal: [1, 0, 0] } }],
    };
    expect(issues([{ op: "through-hole", on: "through", d_mm: 9, at_holes: 0 }], tilted)).toEqual([
      "mounts[0]'s plane is not square to the connector's z, so its holes' x and y are no place in the joint's plane",
    ]);
    const splice = ConnectorItem.safeParse({
      ...j4,
      subtype: "splice",
      splice: { parts: [{ item: "STUD", qty: 1 }], at_mm: [[0, 0]] },
    });
    expect(splice.success).toBe(false);
  });

  it("places end holes and end taps in a through bar's end at the butting bar's positions", async () => {
    // b4 runs along -X onto b1's end b (x = 600): local x = -Y, y = +Z. Its positions (∓10, 0)
    // are world y = ±10, b1's local x (+Y) ±10; (0, ±10) stay ±10 in y.
    const { d } = await project("G34", {
      bars: {
        b2: null,
        b3: null,
        b4: { item: "test-stud:TS40C", a: [1600, 0, 0], b: [600, 0, 0] },
      },
      connections: {
        c1: { through: "b1.b", ends: ["b4.b"], connector: "test-stud:END-2AX" },
        c2: null,
      },
    });
    expect(errors(d)).toEqual([]);
    expect(d.bars.get("b1")?.ops).toEqual([
      { op: "end-hole", from: "b", off: [10, 0], d: 9, by: "c1" },
      { op: "end-hole", from: "b", off: [-10, 0], d: 9, by: "c1" },
      { op: "end-tap", from: "b", off: [0, -10], thread: "M8", by: "c1" },
      { op: "end-tap", from: "b", off: [0, 10], thread: "M8", by: "c1" },
    ]);
  });

  it("turns an end tap's x with the piece, as an end hole's", async () => {
    // Without b1, the posts b2 and b3 are both 500, spliced with one stud: b2's tap is in its end
    // b, b3's in its end a, each at the item's position in its own section.
    const lines = async (connector: string) => {
      const { d, items } = await project("G34", {
        bars: { b1: null },
        connections: { c1: null, c2: { connector } },
      });
      expect(errors(d)).toEqual([]);
      const g = cutList({ derived: d, items }).groups.find((x) => x.item === "test-stud:TS80");
      return g?.lines.map((l) => [l.count, l.sources, l.machining.map(machiningText)]);
    };
    // At (10, 5): turned end for end, b2's tap is in end a at x -10, not b3's (10, 5).
    expect(await lines("test-stud:SPLICE1-X")).toEqual([
      [1, ["b2"], ["tap M16 in end a, at x -10.00, y 5.00 from the centre"]],
      [1, ["b3"], ["tap M16 in end a, at x 10.00, y 5.00 from the centre"]],
    ]);
    // At (0, 5), on the turning axis: one piece.
    expect(await lines("test-stud:SPLICE1-Y")).toEqual([
      [2, ["b2", "b3"], ["tap M16 in end a, at x 0.00, y 5.00 from the centre"]],
    ]);
  });

  it("writes an end tap's offset in derive --json", async () => {
    const { d } = await project("G34");
    const bars = derivedJson(d).bars as Record<string, { ops: Record<string, unknown>[] }>;
    expect(bars.b3?.ops[0]).toEqual({
      op: "end-tap",
      from: "a",
      off_mm: [-20, -20],
      thread: "M16",
      by: "c2",
    });
  });

  it("is flagged by check where ops coincide, and by catalog check where studs have no cores", async () => {
    const { raw, d, items } = await project("G34", {
      connections: { c1: { connector: "test-stud:J4-STACKED" } },
    });
    const out = checkModel({ raw, derived: d, items });
    const hit = out.diagnostics.filter((x) => x.code === "machining");
    expect(hit.map((x) => [x.severity, x.entity, x.refs])).toEqual([
      ["error", "b1", ["c1"]],
      ["error", "b2", ["c1"]],
    ]);
    expect(hit[1]?.message).toBe(
      "the tap M16 in end a at the centre is made 4 times at one place (c1): give each its own position, or make it once",
    );

    const root = join(FIXTURES, "catalogs");
    const opened = await openCatalog(join(root, "test-stud"), { cwd: root });
    const report = checkCatalog(opened.set, "test-stud", opened.diagnostics);
    expect(
      report.diagnostics
        .filter((x) => x.code === "splice-taps")
        .map((x) => [x.severity, x.entity, x.message]),
    ).toEqual([
      [
        "warn",
        "test-stud:SPLICE4-C",
        "4 studs and no positions: their taps coincide at the centre; give each stud's core in at_mm",
      ],
    ]);
  });
});
