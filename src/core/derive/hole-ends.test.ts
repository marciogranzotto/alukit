import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cutList } from "../cutlist/cutlist.ts";
import { machiningText } from "../cutlist/format.ts";
import type { ItemSource } from "../items.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES } from "../testing.ts";
import { derive } from "./derive.ts";

/**
 * Where a hole a person writes is counted from, and a hole off its piece (review M3;
 * docs/ux/review-fixes-machining-decisions.md). A machining drawing and an extrusion
 * configurator give a hole's place from the end of the piece the shop holds: `from: "a.cut"`
 * counts from end a's cut (its long point, as the cut list does), so the number written is the
 * number the shop reads. A hole whose material is not all on the piece is a `machining` error.
 *
 * The frame: two 40 × 40 posts 1000 apart and a rail between their centre lines, butted on each,
 * so each of the rail's ends is cut back 20 from its design point: end a's cut is 20 along the
 * axis from design point a, end b's 980, and the piece is 960.
 */

let items: ItemSource;
beforeAll(async () => {
  items = (await openProject(join(FIXTURES, "golden-ends", "G01"))).items;
});

const frame = (ops: unknown[], extra: Record<string, unknown> = {}) => ({
  schema: "alukit.project/1",
  defaults: { bar: { item: "test:TS40", opt: { finish: "anodised" } } },
  bars: {
    b1: { a: [0, 0, 0], b: [0, 0, 1000] },
    b2: { a: [1000, 0, 0], b: [1000, 0, 1000] },
    b3: { a: [0, 0, 500], b: [1000, 0, 500], ops },
    ...extra,
  },
  connections: {
    c1: { type: "butt", through: "b1", ends: ["b3.a"] },
    c2: { type: "butt", through: "b2", ends: ["b3.b"] },
  },
});

const hole = (at_mm: number, from?: string, more: Record<string, unknown> = {}) => ({
  op: "hole",
  face: "+y",
  at_mm,
  ...(from ? { from } : {}),
  d_mm: 7,
  ...more,
});

const errors = (doc: unknown) =>
  derive(doc, items)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => [d.code, d.entity, d.message]);

const railLine = (doc: unknown) => {
  const d = derive(doc, items);
  const cl = cutList({ derived: d, items });
  return cl.groups.flatMap((g) => g.lines).find((l) => l.sources.includes("b3"));
};

describe("a hole counted from a cut end (review M3)", () => {
  it("is the cut list's number: from end a's cut and from end b's cut", () => {
    const d = derive(frame([hole(20, "a.cut")]), items);
    expect(d.bars.get("b3")?.lengths.cut).toBe(960);
    // Derive resolves it to its place along the axis from design point a: 20 + 20, and keeps
    // what was written, which its messages name it by (re-check N3).
    expect(d.bars.get("b3")?.ops).toEqual([
      { op: "hole", face: "+y", from: "a", at: 40, d: 7, written: { from: "a.cut", at: 20 } },
    ]);
    expect(railLine(frame([hole(20, "a.cut")]))?.machining).toEqual([
      { op: "hole", face: "+y", from: "a", at_mm: 20, d_mm: 7 },
    ]);
    // 30 from end b's cut is 960 − 30 = 930 from end a's: the same piece turned end for end.
    const fromB = railLine(frame([hole(30, "b.cut")]));
    expect(fromB?.machining).toEqual([{ op: "hole", face: "+y", from: "a", at_mm: 30, d_mm: 7 }]);
    expect(machiningText(fromB?.machining[0] as never)).toBe(
      "Ø7.00 hole 30.00 mm from end a on face +y",
    );
  });

  it("follows its cut when the end is extended, where a hole from the design point does not", () => {
    // A free bar with end a extended 5: its cut is 5 outside design point a.
    const free = (op: unknown) => ({
      schema: "alukit.project/1",
      defaults: { bar: { item: "test:TS40", opt: { finish: "anodised" } } },
      bars: { b3: { a: [0, 0, 0], b: [1000, 0, 0], ends: { a: { extend_mm: 5 } }, ops: [op] } },
    });
    expect(railLine(free(hole(20, "a.cut")))?.machining).toEqual([
      { op: "hole", face: "+y", from: "a", at_mm: 20, d_mm: 7 },
    ]);
    expect(railLine(free(hole(20, "a")))?.machining).toEqual([
      { op: "hole", face: "+y", from: "a", at_mm: 25, d_mm: 7 },
    ]);
  });

  it("is the same piece as the hole written from the design point at the same place", () => {
    // b3's hole 20 from its cut and b4's 40 from its design point: one line of two pieces.
    const b4 = { b4: { a: [0, 0, 600], b: [1000, 0, 600], ops: [hole(40, "a")] } };
    const doc = frame([hole(20, "a.cut")], b4);
    (doc.connections as Record<string, unknown>).c3 = {
      type: "butt",
      through: "b1",
      ends: ["b4.a"],
    };
    (doc.connections as Record<string, unknown>).c4 = {
      type: "butt",
      through: "b2",
      ends: ["b4.b"],
    };
    const line = railLine(doc);
    expect([line?.count, line?.sources]).toEqual([2, ["b3", "b4"]]);
  });
});

describe("a hole off its piece (review M3)", () => {
  it("is an error when it lies past a cut, named from what it counts from", () => {
    // 20 from design point a is 0 from end a's cut: half the Ø7 is off the piece. The hole is
    // named as it is written (re-check N3), the end it reaches past as the cut.
    expect(errors(frame([hole(20)]))).toEqual([
      [
        "machining",
        "b3",
        "the Ø7.00 hole on face +y, 20.00 mm from design point a, reaches 3.50 mm past end a's cut face: off the piece, a shop cannot make it there",
      ],
    ]);
    // A hole 40 outside design point a: the cut list would print it at −60, as the review saw.
    expect(errors(frame([hole(-40)]))[0]?.[2]).toBe(
      "the Ø7.00 hole on face +y, -40.00 mm from design point a, reaches 63.50 mm past end a's cut face: off the piece, a shop cannot make it there",
    );
    // Past end b, counted from end a's cut.
    expect(errors(frame([hole(961, "a.cut")]))[0]?.[2]).toBe(
      "the Ø7.00 hole on face +y, 961.00 mm from end a's cut, reaches 4.50 mm past end b's cut face: off the piece, a shop cannot make it there",
    );
  });

  it("is on the piece when its whole circle is, its edge touching the cut included", () => {
    expect(errors(frame([hole(3.5, "a.cut")]))).toEqual([]);
    expect(errors(frame([hole(3, "a.cut")]))).toHaveLength(1);
    expect(errors(frame([hole(3.5, "b.cut")]))).toEqual([]);
  });

  it("measures its widest radius: a counterbore's mouth, a thread's major diameter", () => {
    const cbore = hole(5, "a.cut", { cbore: { d_mm: 11, depth_mm: 6 } });
    expect(errors(frame([cbore]))[0]?.[2]).toBe(
      "the Ø7.00 hole on face +y, 5.00 mm from end a's cut, reaches 0.50 mm past end a's cut face: off the piece, a shop cannot make it there",
    );
    // (On a groove's centre line it is also the groove's error, which is not this one.)
    const tap = { op: "hole", face: "+y", at_mm: 2.5, from: "a.cut", thread: "M6" };
    expect(errors(frame([tap])).find((e) => String(e[2]).includes("off the piece"))?.[2]).toBe(
      "the tap M6 on face +y, 2.50 mm from end a's cut, reaches 0.50 mm past end a's cut face: off the piece, a shop cannot make it there",
    );
  });

  it("follows a cut at an angle across the face, and through the section", () => {
    // A bar along +X whose end a is cut at 45° by the plane x + y = 0: on face +x (world +Y)
    // the cut reaches x = −20, its long point; on face −x (world −Y) only x = +20.
    const angled = (op: unknown) => ({
      schema: "alukit.project/1",
      defaults: { bar: { item: "test:TS40", opt: { finish: "anodised" } } },
      bars: {
        b3: {
          a: [0, 0, 0],
          b: [1000, 0, 0],
          ends: { a: { plane: { point: [0, 0, 0], normal: [-1, -1, 0] }, cut: "angle" } },
          ops: [op],
        },
      },
    });
    // 10 from the long point is x = −10. Blind 5 deep on face +x it stays inside: its far
    // point is 5/√2 = 3.54 inside the cut plane and its radius reaches 3.5/√2 = 2.47 of that.
    const blind = { op: "hole", face: "+x", at_mm: 10, from: "a.cut", d_mm: 7, depth_mm: 5 };
    expect(errors(angled(blind))).toEqual([]);
    // Through, it comes out of face −x at x = −10, 30 past the cut there along that face:
    // (30 + 3.5) / √2 = 23.69 past the plane.
    const through = { op: "hole", face: "+x", at_mm: 10, from: "a.cut", d_mm: 7 };
    expect(errors(angled(through))[0]?.[2]).toBe(
      "the Ø7.00 hole on face +x, 10.00 mm from end a's cut, reaches 23.69 mm past end a's cut face: off the piece, a shop cannot make it there",
    );
  });
});
