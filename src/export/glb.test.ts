import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box3, Matrix4, type Mesh, type Object3D, Vector3 } from "three";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { derive } from "#core/derive/derive.ts";
import { derivedJson } from "#core/derive/output.ts";
import { LockFile } from "#core/lock/schema.ts";
import { lockItems } from "#core/lock/source.ts";
import { openProject } from "#core/project/open.ts";
import { FIXTURES, readJson } from "#core/testing.ts";
import { capture } from "../cli/testing.ts";
import { barCorners } from "../mesh/bars.ts";
import { meshDisplay } from "../mesh/display.ts";
import { type Extent, extentOf, modelBodies } from "../mesh/extent.ts";
import type { BarJson, MeshInput, PartJson, ViewSection } from "../mesh/model.ts";
import { partShape } from "../mesh/place.ts";
import { boxMesh, rodMesh } from "../mesh/solids.ts";
import { writeGlb } from "./glb.ts";
import { projectGlb } from "./project.ts";

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
    // Every bar (pattern copies too), placed part and fastener, named <id> <label|item>: the six
    // parts are the three carriages (p1 and its pattern copies) and M6's plate, bent angle and
    // placeholder (p6, p7, p8).
    expect(Object.keys(input.display.parts)).toEqual(["p1", "p1@1", "p1@2", "p6", "p7", "p8"]);
    expect(nodes.size).toBe(Object.keys(input.bars).length + 6 + input.display.fasteners.length);
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

  it("exports the project's plate, bent angle and placeholder, with their holes under them", () => {
    const nodes = byName();
    const p6 = nodes.get("p6 motor plate on the back base rail") as Mesh;
    const p7 = nodes.get("p7 sensor bracket on the left top rail") as Mesh;
    const p8 = nodes.get("p8 the gear motor, on the motor plate") as Mesh;
    expect(p6.userData).toMatchObject({
      kind: "part",
      id: "p6",
      item: "project:plate-a",
      opt: {},
      shape: "plate",
    });
    expect(p7.userData).toMatchObject({
      kind: "part",
      id: "p7",
      item: "project:angle-a",
      shape: "bent-angle",
    });
    expect(p8.userData).toMatchObject({
      kind: "part",
      id: "p8",
      item: "project:motor",
      placeholder: true,
    });
    // A project item has no offer, so no SKU.
    for (const n of [p6, p7, p8]) expect(n.userData).not.toHaveProperty("sku");

    // Each mesh is the shape in the part's own frame, placed by the part's matrix (which three
    // decomposes and composes again, to a few parts in 10¹⁶).
    p6.geometry.computeBoundingBox();
    expect(p6.geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0]);
    expect(p6.geometry.boundingBox?.max.toArray()).toEqual([160, 100, 8]);
    p8.geometry.computeBoundingBox();
    expect(p8.geometry.boundingBox?.min.toArray()).toEqual([-60, -45, 0]);
    expect(p8.geometry.boundingBox?.max.toArray()).toEqual([60, 45, 110]);
    for (const [id, node] of [
      ["p6", p6],
      ["p7", p7],
      ["p8", p8],
    ] as const) {
      const placed = partShape(input.parts[id] as PartJson, input.display.parts[id]);
      const got = node.matrix.toArray();
      for (const [k, x] of (placed?.matrix ?? []).entries()) {
        expect(got[k], `${id} [${k}]`).toBeCloseTo(x, 9);
      }
    }
    expect((p8.material as { transparent: boolean }).transparent).toBe(true);
    expect((p6.material as { transparent: boolean }).transparent).toBe(false);

    // Holes: one rod per drill and one per countersink or counterbore, named <part>.<hole> <rod>.
    const holes = (n: Object3D) => n.children.map((c) => c.userData.name as string);
    expect(holes(p6)).toEqual([
      "p6.h1 drill",
      "p6.h2 drill",
      "p6.h2 countersink",
      "p6.h3 drill",
      "p6.h3 counterbore",
      "p6.h4 drill",
    ]);
    expect(holes(p7)).toEqual(["p7.a1 drill", "p7.b1 drill"]);
    expect(holes(p8)).toEqual([]);
    expect(p6.children[0]?.userData).toMatchObject({
      kind: "hole",
      id: "p6.h1",
      part: "p6",
      hole: "h1",
      type: "threaded",
      rod: "drill",
      d_mm: 5,
    });
    // h1's rod stands on (20, 20) of the plate, through it: its middle is at z = 4 in the part.
    const mid = new Vector3().applyMatrix4(
      new Matrix4().multiplyMatrices(p6.matrix, (p6.children[0] as Object3D).matrix),
    );
    const want = new Vector3(20, 20, 4).applyMatrix4(p6.matrix);
    expect(mid.distanceTo(want)).toBeLessThan(1e-9);
  });

  it("holds every body bbox() measures, each with the same extent: the three agree (§4.9)", async () => {
    const raw = readJson(join(CART, "alukit.json"));
    const lock = LockFile.parse(readJson(join(CART, "alukit.lock.json")));
    const items = lockItems(lock);
    const derived = derive(raw, items);
    const { scene } = projectGlb({
      raw,
      lock,
      items,
      version: "0.0.0",
      git: null,
      asOf: "2026-11-26",
    });
    // Each top-level node's mesh under its matrix, in the model's millimetres (Z up); a part's
    // hole markers are its children and stand proud of it, so they are not bodies.
    const apply = (m: readonly number[] | undefined, p: readonly number[]) =>
      [0, 1, 2].map((r) =>
        m
          ? (m[r] as number) * (p[0] as number) +
            (m[4 + r] as number) * (p[1] as number) +
            (m[8 + r] as number) * (p[2] as number) +
            (m[12 + r] as number)
          : (p[r] as number),
      );
    const inGlb = new Map<string, { min: number[]; max: number[] }>();
    for (const i of scene.nodes[0]?.children ?? []) {
      const n = scene.nodes[i];
      if (n?.mesh === undefined) continue;
      const pos = scene.meshes[n.mesh]?.data.positions as Float32Array;
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let k = 0; k < pos.length; k += 3) {
        const w = apply(n.matrix, [pos[k], pos[k + 1], pos[k + 2]] as number[]);
        box.min = box.min.map((x, j) => Math.min(x, w[j] as number));
        box.max = box.max.map((x, j) => Math.max(x, w[j] as number));
      }
      inGlb.set(n.extras?.id as string, box);
    }
    const { bodies, noBox } = modelBodies(derived, items);
    expect(noBox).toEqual([]);
    // Every node is a body and every body a node: bars, parts and fasteners alike.
    expect(bodies.map((b) => b.id).sort()).toEqual([...inGlb.keys()].sort());
    const kinds = new Set(bodies.map((b) => b.kind));
    expect([...kinds].sort()).toEqual(["bar", "fastener", "part"]);
    // The same extent. A part's and a fastener's to the GLB's float32 positions: both place them
    // from `derive --json`, through the same functions. A bar's to the output quantum, 0.01 mm:
    // the GLB places it from `derive --json`'s rounded points, bbox() from derive's own; its mesh
    // is its outline, whose extent is its section's box on the cart's sections.
    for (const b of bodies) {
      const want = extentOf(b.points) as Extent;
      const got = inGlb.get(b.id) as { min: number[]; max: number[] };
      const tol = b.kind === "bar" ? 0.01 : 1e-3;
      const off = (g: readonly number[], w: readonly number[]) =>
        Math.max(...[0, 1, 2].map((k) => Math.abs((g[k] as number) - (w[k] as number))));
      expect(off(got.min, want.min), `${b.id} min`).toBeLessThan(tol);
      expect(off(got.max, want.max), `${b.id} max`).toBeLessThan(tol);
    }
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
