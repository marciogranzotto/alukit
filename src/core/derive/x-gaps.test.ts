import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openProject } from "../project/open.ts";
import { FIXTURES, mergePatch } from "../testing.ts";
import { derive } from "./derive.ts";

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
