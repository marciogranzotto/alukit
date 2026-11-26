import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box3, type Mesh, type Object3D } from "three";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { derive } from "#core/derive/derive.ts";
import { derivedJson } from "#core/derive/output.ts";
import { openProject } from "#core/project/open.ts";
import { FIXTURES } from "#core/testing.ts";
import { capture } from "../cli/testing.ts";
import { barCorners } from "../mesh/bars.ts";
import { meshDisplay } from "../mesh/display.ts";
import type { BarJson, MeshInput, ViewSection } from "../mesh/model.ts";
import { boxMesh, rodMesh } from "../mesh/solids.ts";
import { writeGlb } from "./glb.ts";

/**
 * The GLB writer (design §9): two exports of the cart are the same bytes, and three's own
 * `GLTFLoader` reads the file in Node with the expected node names, extras, stamp and placement:
 * Y up, in metres, at the root.
 */

const CART = join(FIXTURES, "cart");

function load(bytes: Uint8Array): Promise<GLTF> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer as ArrayBuffer, "", resolve, reject);
  });
}

let first: Uint8Array;
let second: Uint8Array;
let gltf: GLTF;
let input: MeshInput;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "alukit-glb-"));
  for (const name of ["a.glb", "b.glb"]) {
    const r = await capture(["export", "glb", CART, "-o", join(dir, name), "--frozen"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  }
  first = new Uint8Array(readFileSync(join(dir, "a.glb")));
  second = new Uint8Array(readFileSync(join(dir, "b.glb")));
  gltf = await load(first);
  const project = await openProject(CART);
  const derived = derive(project.raw, project.items);
  const json = derivedJson(derived) as unknown as Pick<MeshInput, "bars" | "parts">;
  input = { bars: json.bars, parts: json.parts, display: meshDisplay(derived, project.items) };
});

/** Every node under the root, by its name as written. */
function byName(): Map<string, Object3D> {
  const root = gltf.scene.children[0] as Object3D;
  return new Map(root.children.map((c) => [c.userData.name as string, c]));
}

describe("the GLB writer (§9)", () => {
  it("writes the same bytes twice", () => {
    expect(first.length).toBeGreaterThan(1000);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("loads in GLTFLoader with the stamp, one root at Y up in metres, and named nodes", () => {
    const stamp = gltf.asset.extras as Record<string, unknown>;
    expect(gltf.asset.generator).toBe("AluKit 0.0.0");
    expect(stamp).toMatchObject({ alukit: "0.0.0", variant: null, revision: null });
    expect(stamp.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stamp).toHaveProperty("git");

    expect(gltf.scene.children).toHaveLength(1);
    const root = gltf.scene.children[0] as Object3D;
    expect(root.userData.name).toBe("Cart (synthetic)");
    expect(root.scale.toArray()).toEqual([0.001, 0.001, 0.001]);
    expect(root.quaternion.x).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(root.quaternion.w).toBeCloseTo(Math.SQRT1_2, 12);

    const nodes = byName();
    // Every bar (pattern copies too), placed part and fastener, named <id> <label|item>.
    expect(nodes.size).toBe(Object.keys(input.bars).length + 3 + input.display.fasteners.length);
    expect(nodes.get("b1 test:TS40")?.userData).toMatchObject({
      kind: "bar",
      id: "b1",
      item: "test:TS40",
      sku: "TS40-c7",
      opt: { finish: "anodised" },
      cut_mm: 860,
    });
    expect(nodes.get("b18 steel beam")?.userData).toMatchObject({
      kind: "bar",
      id: "b18",
      item: "test-geo:RHS-100x50x4",
    });
    expect(nodes.has("b26@2 slat")).toBe(true);
    expect(nodes.get("p1 carriage")?.userData).toMatchObject({
      kind: "part",
      id: "p1",
      item: "test:CAR20",
      sku: "CAR20-1",
      opt: {},
    });
    expect(nodes.get("c23.f1 test:M10-ROD")?.userData).toMatchObject({
      kind: "fastener",
      id: "c23.f1",
      connection: "c23",
      item: "test:M10-ROD",
      cut_mm: 140,
    });
    // three keeps the written name in userData and sanitises the object's own.
    expect(nodes.get("b1 test:TS40")?.name).toBe("b1_testTS40");
  });

  it("places every bar where derive put it, converted to Y up and metres", () => {
    gltf.scene.updateMatrixWorld(true);
    const nodes = byName();
    let checked = 0;
    for (const [id, bar] of Object.entries(input.bars) as [string, BarJson][]) {
      const view = input.display.bars[id];
      if (!view) continue;
      const node = [...nodes.entries()].find(([name]) => name.split(" ")[0] === id)?.[1];
      expect(node, id).toBeDefined();
      const got = new Box3().setFromObject(node as Mesh, true);
      // The body's corners, Z up in mm, as glTF sees them: (x, z, −y) in metres.
      const corners = barCorners(bar, input.display.sections[view.section] as ViewSection, view);
      const want = new Box3();
      for (const [x, y, z] of corners)
        want.expandByPoint({ x: x / 1000, y: z / 1000, z: -y / 1000 } as never);
      for (const k of ["x", "y", "z"] as const) {
        expect(got.min[k], `${id} min ${k}`).toBeCloseTo(want.min[k], 4);
        expect(got.max[k], `${id} max ${k}`).toBeCloseTo(want.max[k], 4);
      }
      checked++;
    }
    expect(checked).toBe(Object.keys(input.bars).length);
  });

  it("shares one mesh per section and colour among square bars", () => {
    const nodes = byName();
    const a = nodes.get("b1 test:TS40") as Mesh;
    const b = nodes.get("b2 test:TS40") as Mesh;
    expect(a.geometry).toBe(b.geometry);
  });
});

describe("solids (§8)", () => {
  /** Every triangle faces away from the solid's centre (both are convex and centred). */
  function outward(m: ReturnType<typeof boxMesh>) {
    const p = m.positions;
    const idx = m.indices as Uint32Array;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [
        p[(i as number) * 3] as number,
        p[(i as number) * 3 + 1] as number,
        p[(i as number) * 3 + 2] as number,
      ]) as [number[], number[], number[]];
      const u = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
      const v = [0, 1, 2].map((k) => (c[k] as number) - (a[k] as number));
      const n = [
        (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
        (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
        (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
      ];
      const centroid = [0, 1, 2].map(
        (k) => ((a[k] as number) + (b[k] as number) + (c[k] as number)) / 3,
      );
      const d = n.reduce((s, x, k) => s + x * (centroid[k] as number), 0);
      expect(d).toBeGreaterThan(0);
    }
  }

  it("wind a box's and a rod's triangles outward", () => {
    outward(boxMesh([-1, -2, -3], [1, 2, 3]));
    outward(rodMesh(12));
  });

  it("write a scene with no geometry as a valid file with no buffer", async () => {
    const bytes = writeGlb({
      generator: "test",
      stamp: {},
      name: "empty",
      roots: [0],
      nodes: [{ name: "root" }],
      meshes: [],
      materials: [],
    });
    const g = await load(bytes);
    expect(g.scene.children[0]?.userData.name).toBe("root");
  });
});
