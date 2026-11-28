import { describe, expect, it } from "vitest";
import type { BarJson, PartJson, V3, ViewPart, ViewSection } from "../mesh/model.ts";
import {
  barCommands,
  endUnder,
  nextAnchor,
  nextRoll,
  previewPlacement,
  typedEnd,
  writtenPoint,
} from "./draw.ts";
import {
  findSnap,
  meetLine,
  type P2,
  partPoints,
  type Ray,
  type SnapModel,
  snapTargets,
} from "./snap.ts";
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

describe("snapping to parts (§8, §4.8)", () => {
  /** A part placed with its frame turned a quarter about Z: local x is world +Y. */
  const turned = (origin: V3): PartJson => ({
    item: "project:x",
    kind: "plate",
    opt: {},
    frame: { x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] },
    origin,
    point: origin,
  });
  const local = (view: ViewPart) => partPoints(view).map((p) => [p.name, p.local]);

  it("offers a box's datums, its origin and its six face centres", () => {
    const box: ViewPart = {
      box: [
        [-60, -45, 0],
        [60, 45, 110],
      ],
      translucent: true,
      placeholder: true,
      datums: { top: [0, 0, 110] },
    };
    expect(local(box)).toEqual([
      ["datum top", [0, 0, 110]],
      ["origin", [0, 0, 0]],
      ["+x face centre", [60, 0, 55]],
      ["-x face centre", [-60, 0, 55]],
      ["+y face centre", [0, 45, 55]],
      ["-y face centre", [0, -45, 55]],
      ["+z face centre", [0, 0, 110]],
      ["-z face centre", [0, 0, 0]],
    ]);
    // A datum at the origin stands for it.
    expect(local({ translucent: false, datums: { mount: [0, 0, 0] } })).toEqual([
      ["datum mount", [0, 0, 0]],
    ]);
  });

  it("puts a plate's face centres at its outline's centroid, and only on the plate", () => {
    const plate = (outline: P2[]): ViewPart => ({
      translucent: false,
      shape: { kind: "plate", thickness: 8, outline, holes: [] },
    });
    expect(
      local(
        plate([
          [0, 0],
          [100, 0],
          [100, 60],
          [0, 60],
        ]),
      ),
    ).toEqual([
      ["origin", [0, 0, 0]],
      ["front face centre", [50, 30, 8]],
      ["back face centre", [50, 30, 0]],
    ]);
    // A thin L: its centroid falls in the notch, off the plate, so no face centre.
    const l = plate([
      [0, 0],
      [100, 0],
      [100, 5],
      [5, 5],
      [5, 100],
      [0, 100],
    ]);
    expect(local(l)).toEqual([["origin", [0, 0, 0]]]);
  });

  it("puts a bent angle's face centres on the middle of each leg's flat", () => {
    const angle: ViewPart = {
      translucent: false,
      shape: { kind: "bent-angle", thickness: 3, legs: [40, 30], length: 50, radius: 3, holes: [] },
    };
    // Each flat runs from R + T = 6 to the leg's length: leg a's middle at y = 23, leg b's at z = 18.
    expect(local(angle)).toEqual([
      ["origin", [0, 0, 0]],
      ["leg a outside centre", [25, 23, 0]],
      ["leg a inside centre", [25, 23, 3]],
      ["leg b outside centre", [25, 0, 18]],
      ["leg b inside centre", [25, 3, 18]],
    ]);
  });

  it("places them by the part's frame and writes them as coordinates", () => {
    const m: SnapModel = {
      nodes: {},
      bars: {},
      parts: {
        p8: turned([900, 580, 128]),
        p2: { item: "x", kind: "part", opt: {}, unplaced: true },
      },
      display: {
        bars: {},
        sections: {},
        parts: {
          p8: {
            box: [
              [-60, -45, 0],
              [60, 45, 110],
            ],
            translucent: true,
          },
        },
      },
    };
    const t = snapTargets(m);
    expect(t.points.every((p) => p.ref.kind === "part" && p.ref.part === "p8")).toBe(true);
    const plusX = t.points.find((p) => p.label === "p8 +x face centre");
    // Local +x is world +Y: 60 along it from the origin, 55 up.
    expect(plusX?.p).toEqual([900, 640, 183]);
    const top = findSnap(t, { ...over(900, 238), project: front.project });
    expect(top).toMatchObject({ ref: { kind: "part", part: "p8" }, label: "p8 +z face centre" });
    expect(writtenPoint(top as NonNullable<typeof top>, {})).toEqual([900, 580, 238]);
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

  it("keeps a face's world direction for the person, at the station it meets (re-check N7)", () => {
    const from = { p: [0, 0, 560] as V3, written: [0, 0, 560], label: "b3 +x face at 560" };
    const face = {
      p: [960, 0, 566] as V3,
      ref: { kind: "station", bar: "b4", at_mm: 566, face: "-x" },
      label: "b4 -x face at 566",
      tip: "b4 -x face (world -X) at 566",
      kind: "line",
      line: { a: [960, 0, 0] as V3, t: [0, 0, 1] as V3, len: 750 },
    } as const;
    // Met by the axis through the start: the machine's label and the person's both at 560.
    expect(endUnder(from, opts(960, 566, { snap: face }))).toMatchObject({
      how: "meet",
      label: "b4 -x face at 560",
      tip: "b4 -x face (world -X) at 560",
    });
    const point = { ...face, kind: "point" } as const;
    expect(endUnder(from, opts(960, 566, { snap: point }))).toMatchObject({
      how: "snap",
      label: "b4 -x face at 566",
      tip: "b4 -x face (world -X) at 566",
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
    expect(typedEnd(start, [0, 0, 437], 0)).toBeUndefined();
  });

  it("writes a typed expression into the coordinate along the axis, so its params drive it", () => {
    // From an inline point: the coordinate is the start's plus the expression.
    const top = { p: [0, 0, 900] as V3, written: [0, 0, "H"], label: "" };
    expect(typedEnd(top, [400, 0, 900], 620, "W / 2 + 20")?.written).toEqual([
      "W / 2 + 20",
      0,
      "H",
    ]);
    expect(typedEnd(top, [0, 0, 400], 620, "W / 2 + 20")?.written).toEqual([
      0,
      0,
      "H - (W / 2 + 20)",
    ]);
    // From a node: the coordinates it stands at, the expression added along the axis.
    const node = { p: [100, 0, 0] as V3, written: "n1", label: "" };
    expect(typedEnd(node, [100, 0, 50], 600, "W")?.written).toEqual([100, 0, "W"]);
    expect(typedEnd(node, [500, 0, 0], 600, "W")?.written).toEqual(["100 + W", 0, 0]);
    // A negative length goes the other way; a plain number stays a number.
    expect(typedEnd(start, [0, 0, 437], -300)).toMatchObject({ p: [0, 0, -300] });
    expect(typedEnd(start, [0, 0, 437], -300)?.written).toEqual([0, 0, -300]);
    // Off the axes, the end is written as the coordinates it comes to.
    expect(typedEnd(start, [300, 400, 0], 500, "W")?.written).toEqual([300, 400, 0]);
  });

  it("keeps to an axis locked with the arrow keys, level with a point under the pointer", () => {
    const S = { p: [0, 0, 0] as V3, written: [0, 0, 0], label: "" };
    // The pointer is up and to the right: unlocked, the line would rise along Z.
    const base = {
      ...over(503, 900),
      project: front.project,
      free: false,
      plane: GROUND,
      doc: {},
    };
    expect(endUnder(S, base)).toMatchObject({ axis: "z" });
    expect(endUnder(S, { ...base, lock: "x" })).toMatchObject({
      p: [500, 0, 0],
      written: [500, 0, 0],
      axis: "x",
      how: "axis",
    });
    const snap = {
      p: [730, 200, 650] as V3,
      kind: "point" as const,
      label: "end b1.b",
      ref: { kind: "end" as const, bar: "b1", end: "b" as const },
    };
    expect(endUnder(S, { ...base, lock: "x", snap })).toMatchObject({
      p: [730, 0, 0],
      label: "+x 730 level with end b1.b",
    });
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
