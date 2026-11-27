import { beforeAll, describe, expect, it } from "vitest";
import { catalogItems, type ItemSource } from "../items.ts";
import { openLiveCatalogs } from "../project/open.ts";
import { FIXTURES } from "../testing.ts";
import { type Derived, derive } from "./derive.ts";

/**
 * Face contacts on a section's real outline (gap A3, design §4.5): a layer may bear on any face
 * of its section's outer boundary, an angle's or a channel's inner faces among them, and the
 * fastener's walk, grip and holes follow the faces it really passes. The built-in `std` angle and
 * Forseti's exact 40x40 make the gap's reproduction; `test-open` holds a synthetic channel. Every
 * expected value is worked by hand in the comments (G29 pins the same numbers with an independent
 * script).
 */

let items: ItemSource;
beforeAll(async () => {
  const raw = {
    catalogs: [
      "std",
      "forseti",
      "./catalogs/test",
      "./catalogs/ref-test",
      "./catalogs/test-geo",
      "./catalogs/test-open",
    ],
  };
  const live = await openLiveCatalogs(FIXTURES, raw);
  expect(live.diagnostics).toEqual([]);
  items = catalogItems(live.set);
});

function run(doc: Record<string, unknown>): Derived {
  return derive({ schema: "alukit.project/1", ...doc }, items);
}

const errors = (d: Derived) =>
  d.diagnostics.filter((x) => x.severity === "error").map((x) => [x.code, x.entity, x.message]);
const r2 = (x: number) => Math.round(x * 100) / 100;
const station = (d: Derived, id = "c1", k = 0) => {
  const s = d.fastenings.get(id)?.stations[k];
  return (
    s && {
      point: s.point.map(r2),
      grip: r2(s.grip),
      layers: s.layers.map((l) => [l.id, r2(l.from), r2(l.to)]),
    }
  );
};
const holes = (d: Derived, id: string) =>
  (d.bars.get(id)?.ops ?? []).flatMap((o) =>
    o.op === "hole" && o.by
      ? [
          {
            face: o.face,
            at: r2(o.at),
            ...(o.across !== undefined ? { across: r2(o.across) } : {}),
            ...(o.d !== undefined ? { d: o.d } : {}),
            ...(o.depth !== undefined ? { depth: r2(o.depth) } : {}),
          },
        ]
      : [],
  );

// The angle along +X with its heel on the design line: local x = world +Y, local y = world +Z
// (§4.4), so its upright leg stands at y 0..6.35 and its inner face is the plane y = 6.35, from
// the root fillet's end (z = 6.35 + 9.525) to the toe radius (z = 76.2 − 4.76). Its four
// bounding faces are y = 0, y = 76.2, z = 0 and z = 76.2: the inner face is none of them.
const angle = { item: "std:L-76.2x6.35", a: [0, 0, 0], b: [300, 0, 0], anchor: "heel" };
const block = (y: number) => ({
  item: "forseti:PF40-01",
  opt: { finish: "anodised" },
  a: [0, y, 50],
  b: [300, y, 50],
});
const bolt = (stations: Record<string, unknown> = { at_mm: [100] }) => ({
  type: "face",
  bars: ["b1", "b2"],
  fastening: "bolt",
  fastener: "std:ISO4017-M12x140-8.8",
  stations,
});

describe("an angle's inner leg face (gap A3's reproduction)", () => {
  it("takes a block as a layer, and the bolt passes the leg and the block", () => {
    const d = run({ bars: { b1: angle, b2: block(26.35) }, connections: { c1: bolt() } });
    expect(errors(d)).toEqual([]);
    const f = d.fastenings.get("c1");
    // The leg's inner face is the section's +x-facing face at section x = −38.1 + 6.35; the
    // block's world −Y face is its local −x face.
    expect(f?.contacts).toEqual([{ faces: ["+x@-31.75", "-x"], gap: 0 }]);
    // The station: 100 along, on the inner face's plane at the box's centre height (z = 38.1).
    // The bolt runs +Y: the leg 6.35 (y 0..6.35), then the block 40 (y 6.35..46.35).
    expect(station(d)).toEqual({
      point: [100, 6.35, 38.1],
      grip: 46.35,
      layers: [
        ["b1", 0, 6.35],
        ["b2", 6.35, 46.35],
      ],
    });
    // Clearance Ø13.5 (ISO 273 medium, M12) in each, from the face the bolt enters by: the leg's
    // outer face (the bounding −x face, centred at z = 38.1) and the block's −x face (centred at
    // z = 50, so 11.9 below its centre line).
    expect(holes(d, "b1")).toEqual([{ face: "-x", at: 100, d: 13.5 }]);
    expect(holes(d, "b2")).toEqual([{ face: "-x", at: 100, across: -11.9, d: 13.5 }]);
  });

  it("puts the station where across_mm says on the inner face, and refuses one off it", () => {
    const at = (across: number) =>
      run({
        bars: { b1: angle, b2: block(26.35) },
        connections: { c1: bolt({ at_mm: [100], across_mm: [across] }) },
      });
    // 11.9 up: the block's centre, z = 50.
    expect(station(at(11.9))?.point).toEqual([100, 6.35, 50]);
    // 25 down is z = 13.1, inside the root fillet (the face starts at z = 15.875).
    expect(errors(at(-25)).map(([code, entity]) => [code, entity])).toEqual([["face", "c1"]]);
  });

  it("refuses a block 0.1 mm off the face, and takes it with that gap declared", () => {
    const off = { bars: { b1: angle, b2: block(26.45) } };
    const d = run({ ...off, connections: { c1: bolt() } });
    expect(errors(d)).toEqual([
      [
        "face",
        "c1",
        "b1 and b2 are not in contact: no faces of theirs are antiparallel, coplanar and overlapping",
      ],
    ]);
    const g = run({ ...off, connections: { c1: { ...bolt(), gaps_mm: [0.1] } } });
    expect(errors(g)).toEqual([]);
    expect(station(g)?.grip).toBe(46.45);
  });
});

describe("an angle's outer leg face", () => {
  it("was in contact already; the bolt now passes the leg, not the angle's whole box", () => {
    const d = run({ bars: { b1: angle, b2: block(-20) }, connections: { c1: bolt() } });
    expect(errors(d)).toEqual([]);
    expect(d.fastenings.get("c1")?.contacts).toEqual([{ faces: ["-x", "+x"], gap: 0 }]);
    // The bolt runs −Y from the leg's inner face (y 6.35) through the leg and the block. The
    // angle's bounding box is 76.2 deep along Y, but at z = 38.1 only the leg is there: before
    // gap A3 was closed the grip counted the box, 76.2 + 40 = 116.20.
    expect(station(d)).toEqual({
      point: [100, 0, 38.1],
      grip: 46.35,
      layers: [
        ["b1", 0, 6.35],
        ["b2", 6.35, 46.35],
      ],
    });
    // The leg's hole is listed from its outer face, the bounding face at the hole's end.
    expect(holes(d, "b1")).toEqual([{ face: "-x", at: 100, d: 13.5 }]);
  });
});

describe("a channel's inner flange face", () => {
  // The channel along +X, centred: local x = world +Y (y −25..25), local y = world +Z
  // (z −50..50); its web is at y −25..−19 and its flanges at z −50..−42 and 42..50. A 40x40
  // rests on the bottom flange's inner face (z = −42), centred at y = 3.
  const doc = {
    bars: {
      b1: { item: "test-open:C-100x50x6x8", a: [0, 0, 0], b: [300, 0, 0] },
      b2: { item: "test:TS40", opt: { finish: "anodised" }, a: [0, 3, -22], b: [300, 3, -22] },
    },
    connections: { c1: bolt({ at_mm: [100], across_mm: [3] }) },
  };

  it("takes the block as a layer, and drills only the bottom flange", () => {
    const d = run(doc);
    expect(errors(d)).toEqual([]);
    expect(d.fastenings.get("c1")?.contacts).toEqual([{ faces: ["+y@-42.00", "-y"], gap: 0 }]);
    // The bolt runs +Z at y = 3: the flange 8 (z −50..−42), the block 40 (z −42..−2).
    expect(station(d)).toEqual({
      point: [100, 3, -42],
      grip: 48,
      layers: [
        ["b1", 0, 8],
        ["b2", 8, 48],
      ],
    });
    // Drilled from the flange's outer face; the top flange stands on the same line, so the hole
    // is 8 deep, not through the section.
    expect(holes(d, "b1")).toEqual([{ face: "-y", at: 100, across: 3, d: 13.5, depth: 8 }]);
    expect(holes(d, "b2")).toEqual([{ face: "-y", at: 100, d: 13.5 }]);
  });
});

describe("a T-slot's grooved face is its bounding plane", () => {
  // Forseti's exact 40x40: every face has a groove (opening 8) and two 2 mm marks 0.19 deep at
  // 11..13 from the centre. A 50x10 flat on its +y face (z = 20), bolted through both.
  const doc = (across: number[]) => ({
    bars: {
      b1: { item: "forseti:PF40-01", opt: { finish: "anodised" }, a: [0, 0, 0], b: [300, 0, 0] },
      b2: { item: "test-geo:FB-50x10", a: [0, 0, 20], b: [300, 0, 20], anchor: "-y" },
    },
    connections: {
      c1: {
        type: "face",
        bars: ["b1", "b2"],
        fastening: "bolt",
        fastener: "std:ISO4017-M12x140-8.8",
        stations: { at_mm: [100], across_mm: across },
      },
    },
  });

  it("bears on the face across its groove and its marks: the profile counts its whole 40", () => {
    const d = run(doc([0, 12]));
    expect(errors(d)).toEqual([]);
    expect(d.fastenings.get("c1")?.contacts).toEqual([{ faces: ["+y", "-y"], gap: 0 }]);
    // At the groove (0) and over a mark (12, world −Y): 40 + 10 either way.
    expect(d.fastenings.get("c1")?.stations.map((s) => r2(s.grip))).toEqual([50, 50]);
  });
});
