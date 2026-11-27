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
