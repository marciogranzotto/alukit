import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cutList } from "../cutlist/cutlist.ts";
import { machiningText } from "../cutlist/format.ts";
import { serviceName } from "../order/lines.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES, mergePatch } from "../testing.ts";
import { derive } from "./derive.ts";
import { derivedJson } from "./output.ts";

/**
 * The joint geometry the fourth acceptance run found missing (docs/notes/f2-joint-geometry.md)
 * beyond what G35–G37 pin down: the words and the refusals.
 */

type Name = "G31" | "G34" | "G35" | "G36" | "G37" | "G17" | "G05";

async function project(name: Name, patch: unknown = {}) {
  const set = name === "G17" || name === "G05" ? "golden-ends" : "golden-gen";
  const p = await openProject(join(FIXTURES, set, name));
  const raw = mergePatch(p.raw, patch);
  return { raw, items: p.items, d: derive(raw, p.items) };
}

const said = (d: ReturnType<typeof derive>, code: string, severity?: string) =>
  d.diagnostics
    .filter((x) => x.code === code && (severity === undefined || x.severity === severity))
    .map((x) => [x.severity, x.entity, x.message]);

/** Part 1's errors: the blocks here also overhang their ends, part 2's warnings. */
const errs = (d: ReturnType<typeof derive>) => said(d, "connection", "error");

describe("an end hole follows its fastener's axis (part 1)", () => {
  it("says where a screw into the butting bar's core leaves the block it passes", async () => {
    const { d } = await project("G35");
    // b2's core at (0, 20) meets b1's end face at x 30.18; along b2 the screw drifts 2/15 per
    // mm and crosses b1's side x = 40 (9.82 further) 73.67 mm in. Its Ø9's wall, 4.5 · √229/15 =
    // 4.54 off its axis across the tilt, gets there (40 - 4.54 - 30.18) · 15/2 = 39.62 mm in.
    expect(errs(d)).toEqual([
      [
        "error",
        "c1",
        "connector requires[1]: the screw into b2.b's tap at (0.00, 20.00) enters b1's end b 7.59° off square and leaves b1 by its face +x 73.67 mm in from end b, its Ø9.00 hole's wall from 39.62 mm in, before it reaches end a: there is no place for its hole",
      ],
    ]);
  });

  it("says where a hole's wall breaks out of the block, along it or from a depth", async () => {
    // G31 with a spacer of 8: the brace's centre line meets the spacer 16 off the block's centre
    // line; the Ø9 hole along the block's axis stands 16 + 4.5 = 20.5 from it, past its side.
    const parallel = await project("G31", { connections: { c1: { spacer_mm: 8 } } });
    expect(errs(parallel.d)).toEqual([
      [
        "error",
        "c1",
        "connector requires[0]: the Ø9.00 hole in b1's end b at x 16.00, y 0.00 from the centre breaks out of its face +x along its whole length, by 0.50 mm",
      ],
    ]);
    // G35 with b2 4 below the block's centre line: the screw at (0, 20) enters at -4 + 20.18 =
    // 16.18 and exits end a at 16.18 + 21.33 = 37.51, inside the side at 40, but its Ø9's wall,
    // 4.5 · √229/15 = 4.54 across the tilt, passes it from (40 - 4.54 - 16.18) · 15/2 = 144.62 mm
    // in, by up to 37.51 + 4.54 - 40 = 2.05.
    const tilted = await project("G35", {
      bars: { b2: { a: [1660, -204, 0], b: [160, -4, 0] } },
    });
    expect(errs(tilted.d)).toEqual([
      [
        "error",
        "c1",
        "connector requires[1]: the Ø9.00 hole in b1's end b at x 16.18, y 0.00 from the centre, 7.59° off square, breaks out of its face +x from 144.62 mm in from end b, by up to 2.05 mm",
      ],
    ]);
    expect(tilted.d.bars.get("b1")?.ops.length).toBe(2);
  });

  it("writes the exit point and the angle in derive --json, and words them on the cut list and the order", async () => {
    const { d, items } = await project("G35");
    const bars = derivedJson(d).bars as Record<string, { ops: Record<string, unknown>[] }>;
    expect(bars.b1?.ops).toEqual([
      {
        op: "end-hole",
        from: "b",
        off_mm: [-10.18, 0],
        exit_mm: [11.16, 0],
        angle_deg: 7.59,
        d_mm: 9,
        by: "c1",
      },
    ]);
    const g = cutList({ derived: d, items }).groups.find((x) => x.item === "test-stud:TS80");
    const m = g?.lines[0]?.machining[0];
    expect(m && machiningText(m)).toBe(
      "Ø9.00 hole in end a at x 10.18, y 0.00 from the centre, 7.59° off square, exiting end b at x -11.16, y 0.00, through",
    );
    expect(m && serviceName(m)).toBe("hole Ø9.00 into an end, 7.59° off square, through");
  });

  it("groups a block with its turn end for end, the exit turning with it", async () => {
    // G35 20 lower, and a second block b3 300 along +Y and turned end for end, with b2 moved
    // along with it as b4, bearing on b3's end a: in b3's frame (local x = -Y) its holes are b1's
    // turned, so the two blocks are one piece, one line of two.
    const { d, items } = await project("G35", {
      bars: {
        b2: { a: [1660, -210, 0], b: [160, -10, 0] },
        b3: { item: "test-stud:TS80", a: [160, 300, 0], b: [0, 300, 0] },
        b4: {
          item: "test:TS4080",
          a: [1660, 90, 0],
          b: [160, 290, 0],
          roll_deg: 90,
          ends: { b: { cut: "angle" } },
        },
      },
      connections: {
        c2: { type: "butt", through: "b3.a", ends: ["b4.b"], connector: "test-seat:J2" },
      },
    });
    expect(errs(d)).toEqual([]);
    const g = cutList({ derived: d, items }).groups.find((x) => x.item === "test-stud:TS80");
    expect(g?.lines.map((l) => [l.count, l.sources])).toEqual([[2, ["b1", "b3"]]]);
  });

  it("refuses a hole in a bar's side for a screw that meets the face at an angle", async () => {
    // G34's post tilted: from (300, 0, 0) to (400, 0, 500), 11.31° off b1's face +y. J4's screws
    // run along it into its four cores; a side hole is drilled square to its face.
    const { d } = await project("G34", {
      bars: { b2: { b: [400, 0, 500], ends: { a: { cut: "angle" } } }, b3: null },
      connections: { c2: null },
    });
    expect(errs(d)).toEqual([
      [
        "error",
        "c1",
        "connector requires[1]: the screws into b2.a's taps at (-20.00, -20.00), (20.00, -20.00), (-20.00, 20.00), (20.00, 20.00) run 11.31° off square to b1's face +y; a hole in a bar's side is drilled square to its face, so none of them can be made",
      ],
    ]);
    expect(d.bars.get("b1")?.ops).toEqual([]);
    // The same post 15 short of b1's end b: the lines at its cores y = -20 (toward +X) meet b1's
    // top past its end, x 585 + 19.61 + 43.92 · 0.2 = 613.40; the two others are on it, at an
    // angle. Two errors: the misses, then the angle.
    const near = await project("G34", {
      bars: { b2: { a: [585, 0, 0], b: [685, 0, 500], ends: { a: { cut: "angle" } } }, b3: null },
      connections: { c2: null },
    });
    expect(errs(near.d).map((x) => x[2])).toEqual([
      "connector requires[1]: 2 positions at b2.a meet b1 off its face: (-20.00, -20.00), (20.00, -20.00)",
      "connector requires[1]: the screws into b2.a's taps at (-20.00, 20.00), (20.00, 20.00) run 11.31° off square to b1's face +y; a hole in a bar's side is drilled square to its face, so none of them can be made",
    ]);
  });
});

describe("a butt's end face sits on its face (part 2)", () => {
  it("warns of an overhang past the face, with how far, how much and the threshold", async () => {
    const across = await project("G36", { bars: { b2: { a: [300, 10, 0], b: [300, 10, 500] } } });
    expect(said(across.d, "connection")).toEqual([
      [
        "warn",
        "c1",
        "b2.a's end face overhangs b1's face +y by 10.00 mm: 400.00 of its 1600.00 mm² (25.0 %) bear on nothing",
      ],
    ]);
    const ov5 = await project("G36", {
      defaults: { butt: { overhang_mm: 10 } },
      bars: { b2: { a: [300, 10, 0], b: [300, 10, 500] } },
      connections: { c1: { connector: "test-seat:OV5" } },
    });
    expect(said(ov5.d, "connection").map((x) => x[2])).toEqual([
      "b2.a's end face overhangs b1's face +y by 10.00 mm: 400.00 of its 1600.00 mm² (25.0 %) bear on nothing, more than the 5.00 mm test-seat:OV5 allows",
    ]);
  });

  it("is an error where the end goes into the through bar beyond the face", async () => {
    const { d } = await project("G36", {
      bars: { b2: { b: [800, 0, 500], ends: { a: { cut: "angle", extend_mm: 2 } } } },
    });
    expect(said(d, "connection")).toEqual([
      ["error", "c1", "b2.a goes 1.41 mm into b1 beyond its face +y: the two bars overlap"],
    ]);
  });

  it("measures an end face on a block's end: G35's 40x80, and G17's brace", async () => {
    // G35's b2 is 80 wide in plan at 7.59° to b1's end face: 80 · √229/15 = 80.71 long on it,
    // centred 10 off b1's centre line, so it reaches 10 + 40.35 = 50.35, past b1's side at 40.
    const g35 = await project("G35", { bars: { b2: { a: [1660, -210, 0], b: [160, -10, 0] } } });
    const seat = g35.d.butts.get("c1")?.ends[0];
    expect(seat && [seat.on, Math.round(seat.overhang * 100) / 100]).toEqual(["b1.b", 10.35]);
    // G17's brace, 40 wide at 36.87° to the block's end face, is 40 / 0.8 = 50 wide on it: it
    // overhangs the 40 x 40 end by 5 on both sides, 2 · 5 · 40 = 400 of its 2000 mm². With the
    // block's end extended 20 the brace's centre line meets it 20 · 0.75 = 15 off centre: 20 past
    // one side, 20 · 40 = 800. Neither goes into the block: the brace's end is cut on its face.
    const r = (x: number) => Math.round(x * 100) / 100;
    for (const [patch, over, out] of [
      [{}, 5, 400],
      [{ bars: { b1: { ends: { b: { extend_mm: 20 } } } } }, 20, 800],
    ] as const) {
      const g17 = await project("G17", patch);
      const e = g17.d.butts.get("c1")?.ends[0];
      expect(e && [e.on, r(e.overhang), r(e.overhang_area), r(e.area), r(e.overlap)]).toEqual([
        "b1.b",
        over,
        out,
        2000,
        0,
      ]);
      expect(said(g17.d, "connection", "error")).toEqual([]);
    }
  });

  it("measures an end on a body's box face, and writes the seats in derive --json", async () => {
    // G5's three bars into a 40 mm cube: each end face is the cube's face, flush.
    const { d } = await project("G05");
    expect(d.butts.get("c1")?.ends.map((e) => [e.end, e.on, e.overhang, e.overlap])).toEqual([
      ["b1.a", "test-geo:CUBE-40 +x", 0, 0],
      ["b2.a", "test-geo:CUBE-40 +y", 0, 0],
      ["b3.a", "test-geo:CUBE-40 +z", 0, 0],
    ]);
    const g36 = await project("G36", { bars: { b2: { a: [300, 10, 0], b: [300, 10, 500] } } });
    expect(derivedJson(g36.d).butts).toEqual({
      c1: {
        ends: [
          {
            end: "b2.a",
            on: "b1 +y",
            area_mm2: 1600,
            overhang_mm: 10,
            overhang_mm2: 400,
            overlap_mm: 0,
          },
        ],
      },
    });
  });
});

describe("a screw head seats on material (part 3)", () => {
  const fits = (d: ReturnType<typeof derive>) => said(d, "fit");

  it("warns of a head on the lips, with the fraction, and errs on one wholly over the opening", async () => {
    const { d } = await project("G37");
    expect(fits(d)).toEqual([
      [
        "warn",
        "c1",
        "station 1: the head of test-seat:SHCS-M8x50, Ø13.00, bears on 45.9 % of its seat on b1's face +y, less than 50 %",
      ],
    ]);
    const m4 = await project("G37", { connections: { c1: { fastener: "test-seat:SHCS-M4x50" } } });
    expect(fits(m4.d)).toEqual([
      [
        "error",
        "c1",
        "station 1: the head of test-seat:SHCS-M4x50, Ø7.00, bears on nothing of b1's face +y: its seat lies wholly over an opening or off the face",
      ],
    ]);
  });

  it("names the nut and the washers, the first under the head and the next under the nut", async () => {
    const two = {
      bars: { b2: { item: "test:TS40", a: [0, 0, -40], b: [400, 0, -40] } },
      connections: {
        c1: {
          fastening: "bolt",
          fastener: "test-seat:HEX-M8x90",
          stack: ["test-seat:N8"],
          stations: { at_mm: [100, 300] },
        },
      },
    };
    const bolted = await project("G37", two);
    expect(fits(bolted.d).map((x) => x[2])).toEqual([
      "stations 1, 2: the head of test-seat:HEX-M8x90, Ø13.00, bears on 45.9 % of its seat on b1's face +y, less than 50 %",
      "stations 1, 2: the nut test-seat:N8, Ø13.00, bears on 45.9 % of its seat on b2's face -y, less than 50 %",
    ]);
    // One washer goes under the head; the nut still bears on the lips alone.
    const one = await project("G37", {
      ...two,
      connections: { c1: { ...two.connections.c1, stack: ["test-seat:W8", "test-seat:N8"] } },
    });
    expect(fits(one.d).map((x) => x[2])).toEqual([
      "stations 1, 2: the nut test-seat:N8, Ø13.00, bears on 45.9 % of its seat on b2's face -y, less than 50 %",
    ]);
    const seats = derivedJson(one.d).fastenings as Record<
      string,
      { stations: { seats: unknown[] }[] }
    >;
    expect(seats.c1?.stations[0]?.seats).toEqual([
      {
        side: "head",
        item: "test-seat:W8",
        on: "b1 +y",
        d_in_mm: 9,
        d_out_mm: 16,
        bearing_pct: 53.74,
      },
      {
        side: "nut",
        item: "test-seat:N8",
        on: "b2 -y",
        d_in_mm: 9,
        d_out_mm: 13,
        bearing_pct: 45.87,
      },
    ]);
  });

  it("counts a head hanging off the face's end as off its material", async () => {
    // On the 50 x 10 flat bar, 3 from its end: the annulus 4.5..6.5 loses the segments past the
    // end, ρ² acos(3/ρ) − 3 √(ρ² − 9) for each radius, of its 22π.
    const { d } = await project("G37", {
      bars: { b1: { item: "test-geo:FB-50x10" }, b2: { a: [0, 0, -10], b: [400, 0, -10] } },
      connections: { c1: { stations: { at_mm: [3] } } },
    });
    const cut = (r: number) => r * r * Math.acos(3 / r) - 3 * Math.sqrt(r * r - 9);
    const want = 1 - (cut(6.5) - cut(4.5)) / (Math.PI * (6.5 ** 2 - 4.5 ** 2));
    const seat = d.fastenings.get("c1")?.stations[0]?.seats[0];
    expect(seat?.bearing).toBeCloseTo(want, 9);
    expect(Math.round(want * 1000) / 10).toBe(68.4);
    expect(fits(d)).toEqual([]);
  });

  it("does not check a part that gives no bearing diameter, and says so", async () => {
    const { d } = await project("G37", {
      connections: { c1: { fastener: "test-seat:SCR-M8x50" } },
    });
    expect(fits(d)).toEqual([
      [
        "info",
        "c1",
        "test-seat:SCR-M8x50 gives no bearing diameter (dw_mm, dk_mm or s_mm), so its seats are not checked: c1",
      ],
    ]);
    expect(d.fastenings.get("c1")?.stations[0]?.seats).toEqual([]);
  });
});
