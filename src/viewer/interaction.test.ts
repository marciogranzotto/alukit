import { describe, expect, it } from "vitest";
import type { BarJson, V3, ViewSection } from "../mesh/model.ts";
import {
  barCommands,
  endUnder,
  nextAnchor,
  nextRoll,
  parseLength,
  previewPlacement,
  typedEnd,
  writtenPoint,
} from "./draw.ts";
import { findSnap, meetLine, type P2, type Ray, type SnapModel, snapTargets } from "./snap.ts";
import { facePlane, GROUND, gridSnap, onGrid, rayFace, rayPlane } from "./workplane.ts";

/**
 * Snapping, the work plane and the draw gesture (design §8), without a renderer: a front view,
 * looking along +Y at 1 px per mm, puts world (x, z) at screen (x, −z).
 */

const front = {
  project: (p: V3): P2 => [p[0], -p[2]],
  ray: (sx: number, sy: number): Ray => ({ o: [sx, -5000, -sy], d: [0, 1, 0] }),
};
/** The pointer over world point (x, z) of the front view. */
const over = (x: number, z: number) => ({ at: [x, -z] as P2, ray: front.ray(x, -z) });

const SECTION: ViewSection = {
  fidelity: "parametric",
  outline: [
    [-20, -20],
    [20, -20],
    [20, 20],
    [-20, 20],
  ],
  holes: [],
  bbox: [
    [-20, -20],
    [20, 20],
  ],
  grooves: [
    { face: "+x", at_mm: 0 },
    { face: "+y", at_mm: 0 },
    { face: "-x", at_mm: 0 },
    { face: "-y", at_mm: 0 },
  ],
  datums: {},
};

function end(point: V3, normal: V3) {
  return { by: "default", point, normal, move_mm: 0, angle_deg: 0 };
}

/** A 40 mm square bar anchored `-x-y` (shift 20, 20), vertical (frame x = X, y = Y). */
function post(a: V3, h: number): BarJson {
  const b: V3 = [a[0], a[1], a[2] + h];
  return {
    item: "test:TS40",
    opt: {},
    a,
    b,
    len_mm: h,
    cut_mm: h,
    centre_mm: h,
    short_mm: h,
    frame: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
    box_mm: [
      [0, 0],
      [40, 40],
    ],
    ends: { a: end(a, [0, 0, -1]), b: end(b, [0, 0, 1]) },
  };
}

function model(bars: Record<string, BarJson>, nodes: Record<string, V3> = {}): SnapModel {
  return {
    nodes,
    bars,
    display: {
      bars: Object.fromEntries(
        Object.keys(bars).map((id) => [id, { section: "test:TS40", shift: [20, 20] as P2 }]),
      ),
      sections: { "test:TS40": SECTION },
    },
  };
}

const posts = model(
  { b1: post([0, 0, 0], 900), b2: post([1200, 0, 0], 900), "b3@1": post([600, 0, 0], 900) },
  { n1: [300, 0, 0] },
);
const targets = snapTargets(posts);
const snapAt = (x: number, z: number) =>
  findSnap(targets, { ...over(x, z), project: front.project });

describe("snapping (§8)", () => {
  it("snaps to bar ends and nodes, within the point radius", () => {
    expect(snapAt(2, 897)).toMatchObject({
      p: [0, 0, 900],
      ref: { kind: "end", bar: "b1", end: "b" },
      label: "end b1.b",
      kind: "point",
    });
    expect(snapAt(303, 4)?.ref).toEqual({ kind: "node", node: "n1" });
    // A pattern copy's end is a point, written as coordinates.
    expect(snapAt(600, 900)?.ref).toEqual({ kind: "free" });
  });

  it("lands on a bar's design line at a station on the grid along it", () => {
    expect(snapAt(1, 503)).toMatchObject({
      p: [0, 0, 500],
      ref: { kind: "station", bar: "b1", at_mm: 500 },
      kind: "line",
    });
  });

  it("lands on a face's centre line, and on a face centre", () => {
    // Seen from the front, the -y face's centre line is at x = 20 (its groove coincides), in
    // front of the +y face's, which is drawn on it: the nearer one wins.
    expect(snapAt(21, 303)?.ref).toEqual({ kind: "station", bar: "b1", at_mm: 300, face: "-y" });
    expect(snapAt(20, 450)?.ref).toEqual({ kind: "station", bar: "b1", at_mm: 450, face: "-y" });
    // The +x face's centre line is at x = 40, and its centre at half the length.
    expect(snapAt(40, 452)).toMatchObject({
      ref: { kind: "station", bar: "b1", at_mm: 450, face: "+x" },
      kind: "point",
      label: "b1 +x face centre",
    });
  });

  it("names grooves by face and number, by increasing section coordinate (§4.3)", () => {
    const two = model({ b1: post([0, 0, 0], 900) });
    const sec = two.display.sections["test:TS40"] as ViewSection;
    sec.grooves = [
      { face: "+y", at_mm: 10 },
      { face: "+y", at_mm: -10 },
    ];
    const lines = snapTargets(two).lines.filter((l) => l.groove);
    expect(lines.map((l) => [l.groove, l.a])).toEqual([
      ["+y.1", [10, 40, 0]],
      ["+y.2", [30, 40, 0]],
    ]);
  });

  it("finds nothing away from every target", () => {
    expect(snapAt(150, 450)).toBeUndefined();
  });

  it("meets a line where an axis through a point crosses it", () => {
    const m = meetLine([0, 0, 100], [1, 0, 0], { a: [1200, 0, 0], t: [0, 0, 1], len: 900 });
    expect(m).toEqual({ p: [1200, 0, 100], s: 100 });
    expect(meetLine([0, 5, 100], [1, 0, 0], { a: [1200, 0, 0], t: [0, 0, 1], len: 900 })).toBe(
      undefined,
    );
    expect(meetLine([0, 0, 1000], [1, 0, 0], { a: [1200, 0, 0], t: [0, 0, 1], len: 900 })).toBe(
      undefined,
    );
  });
});

describe("the work plane (§8)", () => {
  it("is the ground by default, with a 10 mm grid", () => {
    const hit = rayPlane({ o: [13, 27, 500], d: [0, 0, -1] }, GROUND);
    expect(hit).toEqual([13, 27, 0]);
    expect(onGrid(GROUND, hit as V3)).toEqual([10, 30, 0]);
    expect(gridSnap({ o: [13, 27, 500], d: [0, 0, -1] }, GROUND)).toMatchObject({
      p: [10, 30, 0],
      ref: { kind: "grid" },
      label: "grid (10, 30, 0)",
    });
    expect(rayPlane({ o: [0, 0, 500], d: [0, 0, 1] }, GROUND)).toBeUndefined();
  });

  it("takes a bar's face, found analytically from the ray", () => {
    const b1 = post([0, 0, 0], 900);
    const hit = rayFace({ o: [20, -1000, 450], d: [0, 1, 0] }, b1);
    expect(hit).toEqual({ face: "-y", p: [20, 0, 450], s: 450 });
    expect(rayFace({ o: [80, -1000, 450], d: [0, 1, 0] }, b1)).toBeUndefined();
    // Straight down onto the end: no side face.
    expect(rayFace({ o: [20, 20, 2000], d: [0, 0, -1] }, b1)).toBeUndefined();
    const plane = facePlane(b1, "b1", "-y");
    expect(plane).toMatchObject({ origin: [20, 0, 0], n: [0, -1, 0], u: [0, 0, 1] });
    // v = n × u, so u × v = n.
    expect(plane.v).toEqual([-1, 0, 0]);
  });
});

describe("the draw gesture (§8)", () => {
  const doc = {
    bars: {
      b1: { a: [0, 0, 0], b: [0, 0, "H"] },
      b2: { a: { on: { bar: "b1", at_mm: 100 } }, b: { len_mm: 300, dir: "+x" } },
    },
  };

  it("writes a snapped point as the document would (§4.3)", () => {
    const p: V3 = [0, 0, 900];
    expect(
      writtenPoint({ p, ref: { kind: "node", node: "n4" }, label: "", kind: "point" }, doc),
    ).toBe("n4");
    // Another bar's end as it is written: its params keep it in step.
    const b1b = { p, ref: { kind: "end", bar: "b1", end: "b" }, label: "", kind: "point" } as const;
    expect(writtenPoint(b1b, doc)).toEqual([0, 0, "H"]);
    expect(
      writtenPoint({ p, ref: { kind: "end", bar: "b2", end: "a" }, label: "", kind: "point" }, doc),
    ).toEqual({ on: { bar: "b1", at_mm: 100 } });
    // A free end has no point to share: its coordinates.
    expect(
      writtenPoint(
        {
          p: [300.004, 0, 100],
          ref: { kind: "end", bar: "b2", end: "b" },
          label: "",
          kind: "point",
        },
        doc,
      ),
    ).toEqual([300, 0, 100]);
    expect(
      writtenPoint(
        {
          p,
          ref: { kind: "station", bar: "b1", at_mm: 450, face: "-y" },
          label: "",
          kind: "line",
        },
        doc,
      ),
    ).toEqual({ on: { bar: "b1", at_mm: 450, face: "-y" } });
    expect(
      writtenPoint({ p: [1, 2, 3.456], ref: { kind: "grid" }, label: "", kind: "grid" }, doc),
    ).toEqual([1, 2, 3.46]);
  });

  const start = { p: [0, 0, 0] as V3, written: [0, 0, 0], label: "grid" };
  const opts = (x: number, z: number, extra = {}) => ({
    ...over(x, z),
    project: front.project,
    free: false,
    plane: GROUND,
    doc,
    ...extra,
  });

  it("follows the axis it infers, at a length on the grid", () => {
    expect(endUnder(start, opts(6, 903))).toMatchObject({
      p: [0, 0, 900],
      written: [0, 0, 900],
      how: "axis",
      axis: "z",
      label: "+z 900",
    });
    expect(endUnder(start, opts(-404, 9))).toMatchObject({
      p: [-400, 0, 0],
      axis: "x",
      label: "-x 400",
    });
    // An end written from params keeps them.
    const top = { p: [0, 0, 900] as V3, written: [0, 0, "H"], label: "end b1.b" };
    expect(endUnder(top, opts(1197, 905))?.written).toEqual([1200, 0, "H"]);
  });

  it("closes on a snap point, and meets a snap line where an axis crosses it", () => {
    const p = {
      p: [1200, 0, 900] as V3,
      ref: { kind: "end", bar: "b9", end: "b" },
      label: "end b9.b",
      kind: "point",
    } as const;
    expect(endUnder(start, opts(1200, 900, { snap: p }))).toMatchObject({
      p: [1200, 0, 900],
      how: "snap",
    });
    const from = { p: [0, 0, 100] as V3, written: { on: { bar: "b1", at_mm: 100 } }, label: "" };
    const line = {
      p: [1200, 0, 110] as V3,
      ref: { kind: "station", bar: "b2", at_mm: 110 },
      label: "on b2 at 110",
      kind: "line",
      line: { a: [1200, 0, 0] as V3, t: [0, 0, 1] as V3, len: 900 },
    } as const;
    expect(endUnder(from, opts(1200, 106, { snap: line }))).toMatchObject({
      p: [1200, 0, 100],
      written: { on: { bar: "b2", at_mm: 100 } },
      how: "meet",
      axis: "x",
      label: "on b2 at 100",
    });
  });

  it("with Shift, is free in the work plane through the start", () => {
    const e = endUnder(start, {
      ...opts(0, 0),
      ray: { o: [303, 207, 500], d: [0, 0, -1] },
      free: true,
    });
    expect(e).toMatchObject({ p: [300, 210, 0], written: [300, 210, 0], how: "free" });
  });

  it("takes a typed length along the current direction", () => {
    expect(typedEnd(start, [0, 0, 437], 900)).toMatchObject({
      p: [0, 0, 900],
      written: [0, 0, 900],
      axis: "z",
    });
    const top = { p: [0, 0, 900] as V3, written: [0, 0, "H"], label: "" };
    expect(typedEnd(top, [400, 0, 900], 1200)?.written).toEqual([1200, 0, "H"]);
    expect(typedEnd(start, [0, 0, 0], 900)).toBeUndefined();
    expect(parseLength("900")).toBe(900);
    expect(parseLength("12.5")).toBe(12.5);
    expect(parseLength("0")).toBeUndefined();
    expect(parseLength("9x")).toBeUndefined();
  });

  it("previews the bar where derive places it: the cart's rolled top rail", () => {
    // The cart's b5: a 40x80 rolled 90°, anchored +x+y; derive gives x = +Z, y = −Y and the
    // placed box [[-40, -80], [0, 0]], which is the section's box plus the shift.
    const s = {
      bbox: [
        [-20, -40],
        [20, 40],
      ] as [P2, P2],
      datums: {},
    };
    const p = previewPlacement([0, 0, 900], [1200, 0, 900], 90, s, "+x+y");
    expect(p).toMatchObject({ x: [0, 0, 1], t: [1, 0, 0], len: 1200, shift: [-20, -40] });
    expect(p?.y.map((c) => c + 0)).toEqual([0, -1, 0]);
    expect(nextRoll(270)).toBe(0);
    expect(nextAnchor(["c", "-x-y", "+x-y"], "+x-y")).toBe("c");
  });

  it("makes the gesture one batch: the bar, and autoConnect at each end", () => {
    const a = { p: [0, 0, 100] as V3, written: { on: { bar: "b1", at_mm: 100 } }, label: "" };
    const b = { p: [1200, 0, 100] as V3, written: [1200, 0, 100], label: "" };
    expect(
      barCommands({ item: "test:TS40", a, b, anchor: "-x", roll: 0, autoConnect: true }),
    ).toEqual([
      {
        cmd: "addBar",
        args: {
          item: "test:TS40",
          a: { on: { bar: "b1", at_mm: 100 } },
          b: [1200, 0, 100],
          anchor: "-x",
        },
      },
      { cmd: "autoConnect", args: { at: [0, 0, 100], optional: true } },
      { cmd: "autoConnect", args: { at: [1200, 0, 100], optional: true } },
    ]);
    expect(
      barCommands({ item: "test:TS4080", a: b, b: a, anchor: "c", roll: 90, autoConnect: false }),
    ).toEqual([
      {
        cmd: "addBar",
        args: {
          item: "test:TS4080",
          a: [1200, 0, 100],
          b: { on: { bar: "b1", at_mm: 100 } },
          roll_deg: 90,
        },
      },
    ]);
  });
});
