import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { referrers } from "../commands/refs.ts";
import { rewriteEntity } from "../commands/rewrite.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES, mergePatch } from "../testing.ts";
import { derive } from "./derive.ts";
import { chamberWidth } from "./hardware.ts";

/**
 * The joint gaps the alternative frame's acceptance found, part 2 (docs/notes/x1-x3-f2ab.md),
 * beyond what their golden cases pin down: the words, the refusals and the edge cases.
 */

async function project(name: string, patch: unknown = {}) {
  const p = await openProject(join(FIXTURES, "golden-gen", name));
  const raw = mergePatch(p.raw, patch);
  return { raw, items: p.items, d: derive(raw, p.items) };
}

const said = (d: ReturnType<typeof derive>, code: string, severity?: string) =>
  d.diagnostics
    .filter((x) => x.code === code && (severity === undefined || x.severity === severity))
    .map((x) => [x.severity, x.entity, x.message]);

describe("a butt's stack (X2)", () => {
  const of = async (patch: unknown, code: string) =>
    said((await project("G41", patch)).d, code, "error");

  it("refuses a spacer with a stack, once, and a connector's own spacer", async () => {
    expect(await of({ connections: { c1: { spacer_mm: 8 } } }, "connection")).toEqual([
      [
        "error",
        "c1",
        "stack: give spacer_mm or a stack, not both: the stack's bars are the spacer",
      ],
    ]);
  });

  it("says how a stack bar fails to lie on the one before", async () => {
    expect(await of({ bars: { b3: { a: [260, 0, 26], b: [340, 0, 26] } } }, "connection")).toEqual([
      [
        "error",
        "c1",
        "stack: stack[0] b3 does not lie on b1's face +y: its face -y is 2.00 mm off it along its normal",
      ],
    ]);
    // Tilted 4.3°, its faces are not square to the rail's face where the post crosses it.
    const tilted = await of({ bars: { b3: { a: [260, 0, 24], b: [340, 0, 30] } } }, "connection");
    expect(tilted).toEqual([
      [
        "error",
        "c1",
        "stack: stack[0] b3 does not lie flat on b1's face +y: its faces are not square to the face's normal where b2's centre line crosses it",
      ],
    ]);
    expect(await of({ connections: { c1: { stack: ["b1"] } } }, "connection")).toEqual([
      [
        "error",
        "c1",
        "stack: stack[0] b1 is the through bar, a butting bar or already in the stack",
      ],
    ]);
  });

  it("drills no stack bar the hole misses, and says so", async () => {
    expect(await of({ bars: { b3: { a: [400, 0, 24], b: [480, 0, 24] } } }, "connection")).toEqual([
      [
        "error",
        "c1",
        "connector requires[1]: the Ø9.00 hole in b1 meets the stack's b3 off its face +y: no place for its hole",
      ],
    ]);
  });

  it("names the stack bar a screw does not hold, and why", async () => {
    const tube = await of(
      {
        bars: {
          b2: { a: [300, 0, 80] },
          b3: { item: "test-x:TUBE-60x3", a: [260, 0, 50], b: [340, 0, 50] },
        },
      },
      "fit",
    );
    expect(tube).toEqual([
      [
        "error",
        "c1",
        "test-x:J1: the stack's b3 is held only by a screw through it into the butting end, and none holds it: b3 is hollow, and a screw through both its walls needs a sleeve in its bore",
      ],
    ]);
    const hole = await of({ connections: { c1: { connector: "test-x:J1-HOLE" } } }, "fit");
    expect(hole).toEqual([
      [
        "error",
        "c1",
        "test-x:J1-HOLE: the stack's b3 is held only by a screw through it into the butting end, and none holds it: its hole in b1 is at no place where it taps the butting end, so no screw into the butting end passes it",
      ],
    ]);
  });

  it("drills the stack for a screw into the through bar's end taps, at their clearance", async () => {
    const { d } = await project("G41", {
      bars: {
        b2: { item: "test:TS40", a: [608, 0, 0], b: [1200, 0, 0] },
        b3: { a: [604, 0, -40], b: [604, 0, 40], up: "+x" },
      },
      connections: { c1: { through: "b1.b", connector: "test-stud:END-2AX" } },
    });
    // Two Ø9 holes for its through-holes at x ∓10, and two Ø9 (M8's medium clearance) for its
    // end taps at y ∓10: across the plate, and along it from its a at z = -40.
    expect(d.bars.get("b3")?.ops).toEqual([
      { op: "hole", face: "+y", from: "a", at: 40, across: 10, d: 9, by: "c1" },
      { op: "hole", face: "+y", from: "a", at: 40, across: -10, d: 9, by: "c1" },
      { op: "hole", face: "+y", from: "a", at: 30, d: 9, by: "c1" },
      { op: "hole", face: "+y", from: "a", at: 50, d: 9, by: "c1" },
    ]);
  });

  it("copies a stack with its pattern", async () => {
    const { d } = await project("G41", {
      patterns: {
        pt1: { template: ["b2", "b3", "c1"], along: "b1", pitch_mm: 200, count: 2 },
      },
    });
    expect(said(d, "connection")).toEqual([]);
    expect(d.bars.get("b3@1")?.ops).toEqual([
      { op: "hole", face: "+y", from: "a", at: 40, d: 9, by: "c1@1" },
    ]);
    expect(d.butts.get("c1@1")?.ends[0]?.on).toBe("b3@1 +y");
  });

  it("is a reference the edits see and rewrite", async () => {
    const { raw } = await project("G41");
    const doc = raw as Record<string, unknown>;
    expect(referrers(doc, "b3")).toEqual([
      { from: "c1", field: "stack/0", to: "b3", how: "whole" },
    ]);
    const c1 = (doc.connections as Record<string, unknown>).c1;
    const moved = rewriteEntity("connections", "c1", c1, { id: (x) => (x === "b3" ? "b9" : x) });
    expect((moved as { stack: string[] }).stack).toEqual(["b9"]);
  });
});

describe("a butt connector's screw heads (F2b)", () => {
  const of = async (patch: unknown, code = "fit") => said((await project("G43", patch)).d, code);
  const conn = (c: string) => ({ connections: { c1: { connector: `test-x:${c}` } } });

  it("says where a head under the lips fails, with the numbers", async () => {
    expect(await of({})).toEqual([
      [
        "warn",
        "c1",
        "the head of test-x:SCR-M8x20 into b2.a's tap, Ø13.00, bears on 45.9 % of its seat on the lips of b1's face +y, less than 50 %",
      ],
    ]);
    expect(await of(conn("J1-SEAT"))).toEqual([
      [
        "error",
        "c1",
        "the head of test-x:SCR-M8x20 into b2.a's tap (k 8.00) on the T-nut seat test-x:TNUT-SEAT (k 5.50) under the lips of b1's face +y (2.20) reaches 15.70 into the groove, 3.45 past its depth (12.25)",
      ],
    ]);
    expect(await of(conn("J1-SLOT-WIDE"))).toEqual([
      [
        "error",
        "c1",
        "the head of test-x:SCR-M8x20-WIDE into b2.a's tap, Ø16.00, is wider than the chamber under the lips of b1's face +y where it reaches, 10.20 deep (14.50)",
      ],
    ]);
    const off = (y: number) => ({ bars: { b2: { a: [300, y, 20], b: [300, y, 520] } } });
    expect(await of(off(3))).toEqual([
      [
        "error",
        "c1",
        "the screw test-x:SCR-M8x20 into b2.a's tap sits 3.00 off the centre of the groove of b1's face +y, so its M8 shank does not pass the 8.20 opening",
      ],
    ]);
    expect(await of(off(10))).toEqual([
      [
        "error",
        "c1",
        "the screw test-x:SCR-M8x20 into b2.a's tap has no way through b1: the connector drills no hole in it there, and no groove of its face +y lies under the joint for the head",
      ],
    ]);
  });

  it("reads the chamber's taper where the head reaches", () => {
    const g = { face: "+y" as const, at_mm: 0, depth_mm: 12.25, undercut_mm: 14.5 };
    expect(chamberWidth(g, 10.2)).toBe(14.5);
    // Narrowing from 14.5 at 6 deep to 10 at 12.25: at 10.20, 14.5 - 4.5 × 4.2 / 6.25.
    const tapered = { ...g, taper_from_mm: 6, bottom_mm: 10 };
    expect(chamberWidth(tapered, 10.2)).toBeCloseTo(11.476, 9);
    expect(chamberWidth(tapered, 5)).toBe(14.5);
    expect(chamberWidth(tapered, 20)).toBe(10);
    expect(chamberWidth({ face: "+y", at_mm: 0 }, 5)).toBeUndefined();
  });

  it("names a screw whose head it cannot size, once, and checks nothing of it", async () => {
    const { d } = await project("G43", conn("J1-BARE"));
    expect(d.butts.get("c1")?.heads).toBeUndefined();
    expect(said(d, "fit")).toEqual([
      [
        "info",
        "c1",
        "test-x:SCR-M8x50-BARE gives no bearing diameter (dw_mm, dk_mm or s_mm), so its head's seat in a butt is not checked: c1",
      ],
    ]);
  });
});

describe("a plain bar held by a screw in a drilled hole (X3)", () => {
  const fitOf = async (patch: unknown) => said((await project("G40", patch)).d, "fit");
  const base =
    "fits test:s40-c8; b1 is test-x:BLOCK-80, of no system, and no fastener set of the connector sets a sleeve in it, nor does a screw through it hold it";

  it("holds the block, and says which condition a wrong connector fails", async () => {
    expect(await fitOf({})).toEqual([]);
    const conn = (c: string) => ({ connections: { c1: { connector: `test-x:${c}` } } });
    expect(await fitOf(conn("J1-BLIND"))).toEqual([
      [
        "error",
        "c1",
        `test-x:J1-BLIND ${base}: its hole in b1 is blind, so no head bears on b1's far side`,
      ],
    ]);
    expect(await fitOf(conn("J1-HOLE"))).toEqual([
      [
        "error",
        "c1",
        `test-x:J1-HOLE ${base}: its hole in b1 is at no place where it taps the butting end, so no screw into the butting end passes it`,
      ],
    ]);
    expect(await fitOf(conn("J1-PILOT"))).toEqual([
      [
        "error",
        "c1",
        `test-x:J1-PILOT ${base}: no screw or bolt of its fastener sets passes its Ø6.00 hole in b1 (test-x:SCR-M8x100, Ø8.00)`,
      ],
    ]);
    expect(await fitOf(conn("J1-STUD"))).toEqual([
      [
        "error",
        "c1",
        `test-x:J1-STUD ${base}: its fastener sets hold no screw or bolt to pass its Ø9.00 hole in b1`,
      ],
    ]);
  });

  it("does not hold a hollow bar, whose walls a sleeve must keep apart", async () => {
    const rhs = await fitOf({
      bars: { b1: { item: "test-stud:RHS-200x100x4.75", a: [0, 0, -60], b: [200, 0, -60] } },
    });
    expect(rhs).toEqual([
      [
        "error",
        "c1",
        "test-x:J1 fits test:s40-c8; b1 is test-stud:RHS-200x100x4.75, of no system, and no fastener set of the connector sets a sleeve in it, nor does a screw through it hold it: b1 is hollow, and a screw through both its walls needs a sleeve in its bore",
      ],
    ]);
  });
});

describe("a blind fastener (X1)", () => {
  it("says which stations grip outside its maker's range", async () => {
    const { d } = await project("G39", {
      bars: { b2: { item: "test-x:FB-120x25", a: [100, 0, 112.5], b: [350, 0, 112.5] } },
    });
    expect(said(d, "fit")).toEqual([
      [
        "error",
        "c1",
        "stations 1, 2: test-x:BLIND-M8 would grip 29.75 mm of material here, and its maker states 3.00 to 22.00 mm",
      ],
    ]);
  });

  it("refuses a fastener that states no hole, rather than drill an ISO 273 clearance", async () => {
    const { d } = await project("G39", { connections: { c1: { fastener: "test-x:BLIND-M8-NH" } } });
    expect(said(d, "face")).toEqual([
      [
        "error",
        "c1",
        "a blind fastening drills the hole its fastener's maker states, and test-x:BLIND-M8-NH gives none (hole_mm)",
      ],
    ]);
  });

  it("drills only a tube's near wall, and counts that wall's depth in the grip", async () => {
    // A 12 mm plate on a 60 x 3 tube: the axis through the tube's centre passes its near wall,
    // 3 deep, so the grip is 15 and the tube takes one Ø14 hole, 3 deep.
    const { d } = await project("G39", {
      bars: {
        b1: { item: "test-x:TUBE-60x3" },
        b2: { a: [100, 0, 36], b: [350, 0, 36] },
      },
      connections: { c1: { stations: { at_mm: [50] } } },
    });
    const f = d.fastenings.get("c1");
    expect(f?.stations.map((s) => s.grip)).toEqual([15]);
    expect(d.bars.get("b1")?.ops).toEqual([
      { op: "hole", face: "+y", from: "a", at: 150, d: 14, depth: 3, by: "c1" },
    ]);
  });

  it("refuses a sleeve in the bore it grips in, and a fastener cut from bar stock", async () => {
    const sleeve = await project("G39", {
      connections: {
        c1: { stack: [{ item: "test-x:TUBE-60x3", inside: "b1", len_mm: "bore" }] },
      },
    });
    expect(said(sleeve.d, "face")).toEqual([
      [
        "error",
        "c1",
        "a blind fastener grips inside its last layer b1: no sleeve can sit in its bore",
      ],
    ]);
    const rod = await project("G39", {
      connections: { c1: { fastener: { bar: "test:M10-ROD", len_mm: 40 } } },
    });
    expect(said(rod.d, "face")).toEqual([
      [
        "error",
        "c1",
        "a blind fastening's fastener is a catalog fastener whose maker states its hole; test:M10-ROD is cut from bar stock",
      ],
    ]);
  });
});
