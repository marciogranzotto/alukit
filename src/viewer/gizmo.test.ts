import { describe, expect, it } from "vitest";
import type { V3 } from "../mesh/model.ts";
import {
  GIZMO_PX,
  type GizmoPart,
  type GizmoView,
  gizmoDrag,
  gizmoFootprint,
  gizmoPartAt,
  handleAt,
  mmPerPx,
} from "./gizmo.ts";
import type { P2, Ray } from "./snap.ts";

/**
 * The gizmo's geometry (editing audit E0.6), without a renderer: which part is under the
 * pointer, and what a drag on one comes to. A top view, looking down -Z at 1 px per mm, puts
 * world (x, y) at screen (x, -y).
 */

const ALL: readonly GizmoPart[] = [
  "move-x",
  "move-y",
  "move-z",
  "ring-x",
  "ring-y",
  "ring-z",
  "plane-xy",
  "plane-xz",
  "plane-yz",
];
const project = (p: V3): P2 => [p[0], -p[1]];
const rayAt = (s: P2): Ray => ({ o: [s[0], -s[1], 5000], d: [0, 0, -1] });
const view = (s: P2): GizmoView => ({ at: s, ray: rayAt(s), project, mmPerPx: 1 });
const spec = { at: [0, 0, 0] as V3, parts: ALL };
/** A ring's radius at 1 mm a pixel: 0.78 of an arrow's length. */
const R = 0.78 * GIZMO_PX;
const onRing = (deg: number): P2 => [
  R * Math.cos((deg * Math.PI) / 180),
  -R * Math.sin((deg * Math.PI) / 180),
];

describe("gizmoPartAt", () => {
  it("a pointer on the Z ring, between the arrows, hits the ring; off it, nothing", () => {
    expect(gizmoPartAt(spec, view(onRing(45)))).toBe("ring-z");
    expect(gizmoPartAt(spec, view(onRing(200)))).toBe("ring-z");
    const off: P2 = [onRing(45)[0] + 20, onRing(45)[1] - 20];
    expect(gizmoPartAt(spec, view(off))).toBeUndefined();
    // Only what the spec shows is hit.
    expect(gizmoPartAt({ ...spec, parts: ["move-x"] }, view(onRing(45)))).toBeUndefined();
  });

  it("an arrow wins near its shaft, a plane's square inside it", () => {
    expect(gizmoPartAt(spec, view([60, 3]))).toBe("move-x");
    expect(gizmoPartAt(spec, view([2, -60]))).toBe("move-y");
    expect(gizmoPartAt(spec, view([0.3 * GIZMO_PX, -0.3 * GIZMO_PX]))).toBe("plane-xy");
  });
});

describe("gizmoDrag", () => {
  it("along an arrow, the pointer read on its axis; round a ring, the angle turned", () => {
    expect(gizmoDrag("move-x", [0, 0, 0], rayAt([10, -20]), rayAt([60, -40])).delta).toEqual([
      50, 0, 0,
    ]);
    const turn = gizmoDrag("ring-z", [0, 0, 0], rayAt(onRing(0)), rayAt(onRing(90)));
    expect(turn.angle).toBeCloseTo(90, 9);
    expect(gizmoDrag("ring-z", [0, 0, 0], rayAt(onRing(30)), rayAt(onRing(0))).angle).toBeCloseTo(
      -30,
      9,
    );
    expect(gizmoDrag("plane-xy", [0, 0, 0], rayAt([10, -10]), rayAt([25, -40])).delta).toEqual([
      15, 30, 0,
    ]);
  });
});

describe("sizes and handles", () => {
  it("millimetres per pixel: the zoom's inverse in orthographic, by distance in perspective", () => {
    expect(mmPerPx({ perspective: false, zoom: 4 }, [0, 0, 0], 800)).toBe(0.25);
    const far = {
      perspective: true as const,
      eye: [0, 0, 1000] as V3,
      forward: [0, 0, -1] as V3,
      fovDeg: 90,
    };
    // 90°: the view is 2 × 1000 mm tall at 1000 mm away, over 800 px.
    expect(mmPerPx(far, [0, 0, 0], 800)).toBeCloseTo(2.5, 9);
    expect(mmPerPx(far, [0, 0, 500], 800)).toBeCloseTo(1.25, 9);
  });

  it("a handle within grabbing distance is grabbed, the nearest first", () => {
    const handles = [
      { key: "a", at: [0, 0, 0] as V3 },
      { key: "b", at: [20, 0, 0] as V3 },
    ];
    expect(handleAt(handles, [8, 0], project)).toBe("a");
    expect(handleAt(handles, [12, 0], project)).toBe("b");
    expect(handleAt(handles, [10, 30], project)).toBeUndefined();
  });
});

describe("gizmoFootprint: where on the screen a press is the gizmo's (E2: labels keep clear)", () => {
  it("axes: the square round every arrow's tip and ring, and the reach of a press", () => {
    // From the top at 1 mm a pixel: ±96 along X and Y, and Z seen end on, padded by 8.
    const r = 96 + 8;
    expect(gizmoFootprint(spec, project, 1)).toEqual([{ left: -r, top: -r, right: r, bottom: r }]);
    // Half the zoom, the same 96 px: its size is the screen's.
    expect(gizmoFootprint({ at: [100, 0, 0], parts: ALL }, project, 2)).toEqual([
      { left: 100 - 2 * 96 - 8, top: -2 * 96 - 8, right: 100 + 2 * 96 + 8, bottom: 2 * 96 + 8 },
    ]);
  });

  it("handles: a square round each, as far as a press grabs it", () => {
    const handles = {
      handles: [
        { key: "a", at: [0, 0, 0] as V3 },
        { key: "b", at: [300, 0, 0] as V3 },
      ],
    };
    expect(gizmoFootprint(handles, project, 1)).toEqual([
      { left: -12, top: -12, right: 12, bottom: 12 },
      { left: 288, top: -12, right: 312, bottom: 12 },
    ]);
  });
});
