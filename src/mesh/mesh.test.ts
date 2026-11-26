import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type BufferAttribute, Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import { ProjectHost } from "../server/host.ts";
import { viewModel } from "../server/view.ts";
import {
  angledGeometry,
  barCorners,
  barMapper,
  sectionEdges,
  sectionGeometry,
  squareEnds,
  squareMatrix,
} from "./bars.ts";
import type { BarJson, MeshInput, ViewSection } from "./model.ts";
import { simplifyRing } from "./outline.ts";

/**
 * Meshes from the view model (design §8): unit extrusions per section, square bars under one
 * matrix, angled ends exact on their planes, sharp edges only, and display outlines by RDP.
 */

let root: string;
const models: Record<string, MeshInput> = {};
beforeAll(async () => {
  root = await scratchFixtures();
  for (const p of ["cart", "golden-ends/G27"]) {
    const h = await ProjectHost.open({ dir: join(root, p), watch: false });
    const m = viewModel(h.snapshot());
    const d = m.derived as { bars: MeshInput["bars"]; parts: MeshInput["parts"] };
    models[p] = { bars: d.bars, parts: d.parts, display: m.display };
    await h.close();
  }
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const rect = (w: number, h: number): ViewSection => ({
  fidelity: "box",
  outline: [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ],
  holes: [],
  bbox: [
    [-w / 2, -h / 2],
    [w / 2, h / 2],
  ],
});

function positions(a: BufferAttribute | { array: ArrayLike<number> }): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < a.array.length; i += 3) {
    out.push([a.array[i] as number, a.array[i + 1] as number, a.array[i + 2] as number]);
  }
  return out;
}

describe("display outlines (§3.5)", () => {
  it("drop points within 0.05 mm of the line and keep the corners", () => {
    const ring: [number, number][] = [];
    for (let x = 0; x < 40; x += 0.5) ring.push([x, 0.01 * Math.sin(x)]);
    ring.push([40, 0], [40, 20], [0, 20]);
    expect(simplifyRing(ring)).toEqual([
      [0, 0],
      [40, 0],
      [40, 20],
      [0, 20],
    ]);
    // A flattened circle keeps enough points to stay within the tolerance.
    const circle: [number, number][] = [];
    for (let i = 0; i < 720; i++) {
      const a = (i * Math.PI) / 360;
      circle.push([10 * Math.cos(a), 10 * Math.sin(a)]);
    }
    const s = simplifyRing(circle);
    expect(s.length).toBeLessThan(80);
    expect(s.length).toBeGreaterThan(16);
    // The sagitta of each kept chord is within 0.05 mm: 10 (1 − cos(θ/2)) ≤ 0.05.
    for (let i = 0; i < s.length; i++) {
      const p = s[i] as [number, number];
      const q = s[(i + 1) % s.length] as [number, number];
      const half = Math.hypot(p[0] - q[0], p[1] - q[1]) / 2;
      expect(10 - Math.sqrt(100 - half * half)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });
});

describe("bar meshes (§8)", () => {
  it("extrude a section's display outline once, z from 0 to 1, with its sharp edges", () => {
    const g = sectionGeometry(rect(40, 20));
    g.computeBoundingBox();
    expect(g.boundingBox?.min.toArray()).toEqual([-20, -10, 0]);
    expect(g.boundingBox?.max.toArray()).toEqual([20, 10, 1]);
    // A box has 12 edges: four round each end, four along it.
    expect(sectionEdges(g).length / 6).toBe(12);
    const tslot = models.cart?.display.sections["test:TS40"] as ViewSection;
    expect(tslot.holes).toHaveLength(1);
    expect(sectionGeometry(tslot).getAttribute("position").count).toBeGreaterThan(100);
  });

  it("place a square bar with one matrix that agrees with the exact map", () => {
    const m = models.cart as MeshInput;
    for (const [id, bar] of Object.entries(m.bars)) {
      if (!squareEnds(bar)) continue;
      const view = m.display.bars[id];
      if (!view) throw new Error(id);
      const M = squareMatrix(bar, view);
      const map = barMapper(bar, view);
      for (const [x, y, z] of [
        [-20, -20, 0],
        [20, 5, 1],
        [3, -7, 1],
      ] as const) {
        const a = new Vector3(x, y, z).applyMatrix4(M).toArray();
        const b = map(x, y, z);
        for (let k = 0; k < 3; k++) expect(a[k], `${id}`).toBeCloseTo(b[k] as number, 6);
      }
      // The body's length along the axis is the cut length.
      const corners = barCorners(bar, m.display.sections[view.section] as ViewSection, view);
      const t = bar.frame.z;
      const s = corners.map((c) => c[0] * t[0] + c[1] * t[1] + c[2] * t[2]);
      expect(Math.max(...s) - Math.min(...s), id).toBeCloseTo(bar.cut_mm, 1);
    }
  });

  it("put every vertex of an angled end on its plane (G27's shoe, cut square to the strut)", () => {
    const m = models["golden-ends/G27"] as MeshInput;
    const bar = m.bars.b2 as BarJson;
    expect(squareEnds(bar)).toBe(false);
    const view = m.display.bars.b2;
    if (!view) throw new Error("b2");
    const g = angledGeometry(
      sectionGeometry(m.display.sections[view.section] as ViewSection),
      bar,
      view,
    );
    const { point, normal } = bar.ends.b;
    let onPlane = 0;
    let lowest = Number.POSITIVE_INFINITY;
    for (const p of positions(g.getAttribute("position") as BufferAttribute)) {
      const d =
        (p[0] - point[0]) * normal[0] +
        (p[1] - point[1]) * normal[1] +
        (p[2] - point[2]) * normal[2];
      if (Math.abs(d) < 1e-3) onPlane++;
      expect(d).toBeLessThan(1e-3);
      lowest = Math.min(lowest, p[2]);
    }
    expect(onPlane).toBeGreaterThan(0);
    // End a stands on the beam's top face, z = 20 (G27).
    expect(lowest).toBeCloseTo(20, 2);
    // The long and short points, 75 and 45 above the beam (G27), are the prism's extremes.
    const zs = barCorners(bar, m.display.sections[view.section] as ViewSection, view).map(
      (c) => c[2],
    );
    expect(Math.max(...zs)).toBeCloseTo(20 + 75, 1);
  });
});
