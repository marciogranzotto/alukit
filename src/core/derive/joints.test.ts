import { rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkCatalog } from "#catalog/check.ts";
import { openCatalog } from "#catalog/open.ts";
import { ConnectorItem } from "#catalog/schema/items.ts";
import { checkModel } from "../check/check.ts";
import { referrers } from "../commands/refs.ts";
import { rewriteEntity } from "../commands/rewrite.ts";
import { cutList } from "../cutlist/cutlist.ts";
import { machiningText } from "../cutlist/format.ts";
import { catalogItems, type ItemSource } from "../items.ts";
import { openLiveCatalogs, openProject } from "../project/open.ts";
import { editJson, FIXTURES, mergePatch, scratchFixtures } from "../testing.ts";
import { derive } from "./derive.ts";
import { derivedJson } from "./output.ts";

/**
 * The rules of acceptance run 2's gaps (docs/notes/acceptance-gaps-2.md) that G33 and G34 do not
 * pin down on their own: what `held_by` refuses, how it follows a pattern and the edit path, and
 * where positions place end holes and end taps, how they turn with a piece, and what refuses them.
 */

async function project(name: "G31" | "G33" | "G34", patch: unknown = {}) {
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
    // The taps at (0, ±10) are on none of b1's cores (±20, ±20): a machining error each, below.
    expect(errors(d)).toEqual([
      ["machining", "b1"],
      ["machining", "b1"],
    ]);
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
      // (10, 5) and (0, 5) are on none of TS80's cores: a machining error in each bar, below.
      expect(errors(d)).toEqual([
        ["machining", "b2"],
        ["machining", "b3"],
      ]);
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
    // b2's four taps coincide, and at the centre, which is none of TS80's cores: two faults.
    expect(hit.map((x) => [x.severity, x.entity, x.refs])).toEqual([
      ["error", "b1", ["c1"]],
      ["error", "b2", ["c1"]],
      ["error", "b2", ["c1"]],
    ]);
    expect(hit[1]?.message).toMatch(/^the tap M16 in end a at the centre \(c1\) is on no core/);
    expect(hit[2]?.message).toBe(
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

describe("an end tap on its section's cores (§5.5)", () => {
  type D = ReturnType<typeof derive>;
  const machining = (d: D) =>
    d.diagnostics
      .filter((x) => x.code === "machining")
      .map((x) => [x.severity, x.entity, x.refs, x.message]);

  /** The project's items, with one more connector: BUSH-END's, its requirements replaced. */
  function withTapAt(items: ItemSource, id: string, requires: unknown[]): ItemSource {
    const bush = items.item("test-stud:BUSH-END");
    if (!bush.ok) throw new Error(bush.message);
    const item = ConnectorItem.parse({ ...bush.item, requires });
    return { ...items, item: (ref) => (ref === id ? { ok: true, id, item } : items.item(ref)) };
  }

  it("passes G34's taps, each on one of the 80x80's four cores", async () => {
    expect(machining((await project("G34")).d)).toEqual([]);
  });

  it("is a machining error where an 80x80 post's end tap has no position: the centre is no core", async () => {
    // BUSH-END taps M16 in the butting end with no position: at the centre of b2's end a. TS80's
    // cores are at (±20, ±20), each 20√2 = 28.28 from it.
    const { d } = await project("G34", {
      bars: { b3: null },
      connections: { c1: { connector: "test-stud:BUSH-END" }, c2: null },
    });
    expect(errors(d)).toEqual([["machining", "b2"]]);
    expect(machining(d)).toEqual([
      [
        "error",
        "b2",
        ["c1"],
        "the tap M16 in end a at the centre (c1) is on no core of test-stud:TS80; the nearest, 28.28 off: x -20.00, y -20.00; x -20.00, y 20.00; x 20.00, y -20.00; x 20.00, y 20.00 from the centre",
      ],
    ]);
  });

  it("is a machining error where a placed tap misses a 40x80's cores, naming the nearest", async () => {
    // An M8 tap at (10, 10) in a 40x80 post's end: its cores are at (0, ±20); (0, 20) is the
    // nearer, √(10² + 10²) = 14.14 off, and (0, −20) √(10² + 30²) = 31.62.
    const p = await project("G34");
    const items = withTapAt(p.items, "test-stud:TAP-AT", [
      { op: "end-tap", on: "butting", thread: "M8", at_mm: [[10, 10]] },
    ]);
    const raw = mergePatch(p.raw, {
      bars: { b2: { item: "test:TS4080" }, b3: null },
      connections: { c1: { connector: "test-stud:TAP-AT" }, c2: null },
    });
    const d = derive(raw, items);
    expect(errors(d)).toEqual([["machining", "b2"]]);
    expect(machining(d)).toEqual([
      [
        "error",
        "b2",
        ["c1"],
        "the tap M8 in end a at x 10.00, y 10.00 from the centre (c1) is on no core of test:TS4080; the nearest, 14.14 off: x 0.00, y 20.00 from the centre",
      ],
    ]);
    // On a core, the same tap passes.
    const on = withTapAt(p.items, "test-stud:TAP-AT", [
      { op: "end-tap", on: "butting", thread: "M8", at_mm: [[0, -20]] },
    ]);
    expect(machining(derive(raw, on))).toEqual([]);
  });

  it("is a machining error where a tap on a core does not fit it, and an info where it cannot tell", async () => {
    // An M8 on one of TS80's Ø13.7 cores: 13.7 is wider than M8's largest minor diameter, 6.647 +
    // 0.265 = 6.912 (6H), so the thread would be shallow.
    const p = await project("G34");
    const raw = mergePatch(p.raw, {
      bars: { b3: null },
      connections: { c1: { connector: "test-stud:TAP-AT" }, c2: null },
    });
    const at = (thread: string) =>
      derive(
        raw,
        withTapAt(p.items, "test-stud:TAP-AT", [
          { op: "end-tap", on: "butting", thread, at_mm: [[20, 20]] },
        ]),
      );
    expect(errors(at("M8"))).toEqual([["machining", "b2"]]);
    expect(machining(at("M8"))).toEqual([
      [
        "error",
        "b2",
        ["c1"],
        "the tap M8 in end a at x 20.00, y 20.00 from the centre (c1) does not fit the Ø13.70 core of test-stud:TS80 it is on: the core is wider than M8's largest minor diameter, 6.912 (6H), so the thread would be shallow",
      ],
    ]);
    // An M20 there: its tap drill 17.50 would take 3.80 off the core, more than its 2.50 pitch.
    expect(machining(at("M20"))).toEqual([
      [
        "error",
        "b2",
        ["c1"],
        "the tap M20 in end a at x 20.00, y 20.00 from the centre (c1) does not fit the Ø13.70 core of test-stud:TS80 it is on: M20's tap drill, 17.50, would drill it up 3.80, more than one pitch (2.50)",
      ],
    ]);
    // A thread with no tap drill here: on a core, so the place is right; the fit is not judged.
    expect(errors(at("1/2-13 UNC"))).toEqual([]);
    expect(machining(at("1/2-13 UNC"))).toEqual([
      [
        "info",
        "b2",
        ["c1"],
        "the tap 1/2-13 UNC in end a at x 20.00, y 20.00 from the centre (c1) is on the Ø13.70 core of test-stud:TS80; its fit is not checked: AluKit has no tap drill and 6H tolerance for 1/2-13 UNC",
      ],
    ]);
    // The M16 the core is sized for fits it, drilled up 0.30 to its 14.00 tap drill.
    expect(machining(at("M16"))).toEqual([]);
  });

  it("checks a splice's taps in both spliced ends, and a through bar's end taps", async () => {
    // One stud at (10, 5): in b2's end b and b3's end a, each in its own section. TS80's nearest
    // core is (20, 20), √(10² + 15²) = 18.03 off.
    const splice = await project("G34", {
      bars: { b1: null },
      connections: { c1: null, c2: { connector: "test-stud:SPLICE1-X" } },
    });
    expect(machining(splice.d).map((x) => [x[1], x[2], x[3]])).toEqual([
      [
        "b2",
        ["c2"],
        "the tap M16 in end b at x 10.00, y 5.00 from the centre (c2) is on no core of test-stud:TS80; the nearest, 18.03 off: x 20.00, y 20.00 from the centre",
      ],
      [
        "b3",
        ["c2"],
        "the tap M16 in end a at x 10.00, y 5.00 from the centre (c2) is on no core of test-stud:TS80; the nearest, 18.03 off: x 20.00, y 20.00 from the centre",
      ],
    ]);
    // END-2AX taps M8 at (0, ±10) in the through bar's end b, each √(20² + 10²) = 22.36 from the
    // two cores on its side.
    const through = await project("G34", {
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
    expect(machining(through.d).map((x) => [x[1], x[3]])).toEqual([
      [
        "b1",
        "the tap M8 in end b at x 0.00, y -10.00 from the centre (c1) is on no core of test-stud:TS80; the nearest, 22.36 off: x -20.00, y -20.00; x 20.00, y -20.00 from the centre",
      ],
      [
        "b1",
        "the tap M8 in end b at x 0.00, y 10.00 from the centre (c1) is on no core of test-stud:TS80; the nearest, 22.36 off: x -20.00, y 20.00; x 20.00, y 20.00 from the centre",
      ],
    ]);
  });

  it("checks a tapped end hole as a tap, and leaves a drilled one alone", async () => {
    // G31's block b1 is a 40x40 with its core at the centre; the brace's centre line meets its end
    // face 10 off it. A Ø9 hole there passes; an M8 tapped there is 10.00 off the core.
    expect(machining((await project("G31")).d)).toEqual([]);
    const tapped = await project("G31", {
      connections: { c1: { connector: "test-joint:END-AX-T" } },
    });
    expect(machining(tapped.d)).toEqual([
      [
        "error",
        "b1",
        ["c1"],
        "the tap M8 in end b along the axis, at x 10.00, y 0.00 from the centre (c1) is on no core of test:TS40; the nearest, 10.00 off: x 0.00, y 0.00 from the centre",
      ],
    ]);
  });

  it("says, as an info, that a section giving no core positions leaves its taps unchecked", async () => {
    // TS80 without its bores: the section is built, its cores are not known.
    const root = await scratchFixtures();
    try {
      await editJson(join(root, "catalogs", "test-stud", "sections", "TS80.json"), (s) => {
        delete s.params.bores;
      });
      const p = await openProject(join(root, "golden-gen", "G34"));
      const d = derive(p.raw, p.items);
      expect(errors(d)).toEqual([]);
      expect(machining(d)).toEqual([
        [
          "info",
          "b2",
          ["c1", "c2"],
          "test-stud:TS80 gives no core positions: the taps in end a and end b (c1, c2) are not checked against its cores",
        ],
        [
          "info",
          "b3",
          ["c2"],
          "test-stud:TS80 gives no core positions: the taps in end a (c2) are not checked against its cores",
        ],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("an end tap on a Forseti 80x80's cores, the corner holes among them (§3.5, §5.5)", () => {
  // PF40-03B, the 80x80 básico (p. 20): four Ø13.7 (M16) cores at (±20, ±20), an open channel at
  // the centre, and four Ø5 (M6) corner holes 4.5 in from both faces, at (±35.5, ±35.5). PF40-03,
  // the reforçado (p. 21), has the same cores, read from its vector outline.
  let items: ItemSource;
  beforeAll(async () => {
    const live = await openLiveCatalogs(FIXTURES, {
      catalogs: ["forseti", "./catalogs/test", "./catalogs/ref-test", "./catalogs/test-stud"],
    });
    expect(live.diagnostics).toEqual([]);
    const base = catalogItems(live.set);
    const bush = base.item("test-stud:BUSH-END");
    if (!bush.ok) throw new Error(bush.message);
    items = {
      ...base,
      item: (ref) => {
        const m = /^test-stud:TAP_(M\d+)_(-?[\d.]+)_(-?[\d.]+)$/.exec(ref);
        if (!m) return base.item(ref);
        // A connector for Forseti's base 40 that taps the butting end at one place, and does
        // nothing else.
        const item = ConnectorItem.parse({
          ...bush.item,
          fits: ["forseti:s40-c8"],
          mounts: undefined,
          requires: [
            { op: "end-tap", on: "butting", thread: m[1], at_mm: [[Number(m[2]), Number(m[3])]] },
          ],
        });
        return { ok: true, id: ref, item };
      },
    };
  });

  /** b2, an 80x80 post, butts through b1 with a tap at (x, y) in its end a. */
  const post = (section: string, thread: string, x: number, y: number) => {
    const bar = { item: `forseti:${section}`, opt: { finish: "anodised" } };
    return derive(
      {
        schema: "alukit.project/1",
        bars: {
          b1: { ...bar, a: [0, 0, 0], b: [600, 0, 0] },
          b2: { ...bar, a: [300, 0, 0], b: [300, 0, 500] },
        },
        connections: {
          c1: {
            type: "butt",
            through: "b1",
            ends: ["b2.a"],
            connector: `test-stud:TAP_${thread}_${x}_${y}`,
          },
        },
      },
      items,
    );
  };
  const machining = (d: ReturnType<typeof derive>) =>
    d.diagnostics
      .filter((x) => x.code === "machining")
      .map((x) => [x.severity, x.entity, x.message]);

  for (const section of ["PF40-03B", "PF40-03"]) {
    it(`${section}: an M6 in a corner hole passes, and an M16 on a module core`, () => {
      // M6's tap drill, 6 − 1 = 5.00, is the Ø5 hole; M16's, 14.00, drills the Ø13.7 core up 0.30.
      const corner = post(section, "M6", 35.5, -35.5);
      expect(corner.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
      expect(machining(corner)).toEqual([]);
      expect(machining(post(section, "M16", -20, 20))).toEqual([]);
    });

    it(`${section}: an M16 in a corner hole is a machining error: on a core, and not fitting it`, () => {
      // M16's tap drill, 14.00, is 9.00 over the Ø5 hole, more than its 2.00 pitch.
      expect(machining(post(section, "M16", 35.5, -35.5))).toEqual([
        [
          "error",
          "b2",
          `the tap M16 in end a at x 35.50, y -35.50 from the centre (c1) does not fit the Ø5.00 core of forseti:${section} it is on: M16's tap drill, 14.00, would drill it up 9.00, more than one pitch (2.00)`,
        ],
      ]);
    });

    it(`${section}: any tap at the centre is a machining error: it has no core there`, () => {
      for (const thread of ["M6", "M16"]) {
        expect(machining(post(section, thread, 0, 0))).toEqual([
          [
            "error",
            "b2",
            `the tap ${thread} in end a at the centre (c1) is on no core of forseti:${section}; the nearest, 28.28 off: x -20.00, y -20.00; x -20.00, y 20.00; x 20.00, y -20.00; x 20.00, y 20.00 from the centre`,
          ],
        ]);
      }
    });
  }
});
