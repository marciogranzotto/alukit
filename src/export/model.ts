import type { Derived } from "#core/derive/derive.ts";
import { compareIds } from "#core/ids.ts";
import type { ItemSource } from "#core/items.ts";
import type { Outputs } from "#core/revision/outputs.ts";
import { angledGeometry, sectionGeometry, squareEnds, squareMatrix } from "../mesh/bars.ts";
import { type Mat4, type MeshData, meshData } from "../mesh/data.ts";
import { meshDisplay } from "../mesh/display.ts";
import type { BarJson, PartJson, ViewSection } from "../mesh/model.ts";
import { fastenerId, fastenerMatrix, partShape } from "../mesh/place.ts";
import { boxMesh, rodMesh } from "../mesh/solids.ts";
import { barColour, COLOURS, TRANSLUCENT_OPACITY } from "../mesh/style.ts";
import type { GltfMaterial, GltfMesh, GltfNode, GltfScene } from "./glb.ts";

/**
 * The export scene of a derived model (design §9): the meshes `src/mesh/` builds for the viewer,
 * gathered for the GLB writer. It is not the render scene:
 *
 * - One root node converts the design's Z-up millimetres to glTF's Y-up metres (§2): a rotation
 *   of −90° about X and a scale of 0.001.
 * - Under it, one node per bar, placed part and fastener, named `<id> <label|item>`, in id order.
 *   Nodes share one mesh per distinct geometry and material: a section's unit extrusion under
 *   each square bar's matrix, a box per part shape, one rod for every fastener; a bar with an
 *   angled end has its own mesh.
 * - Each node's `extras`: what it is, its id, item, SKU (what to order: the cut list's offer
 *   for a bar or a piece cut from stock, the order's lines for an item), options and cut length.
 */

export interface ExportInput {
  derived: Derived;
  items: ItemSource;
  /** The outputs of the same derive: the cut list and the order give the SKUs. */
  outputs: Outputs;
  /** `asset.extras`. */
  stamp: Readonly<Record<string, unknown>>;
  generator: string;
  name: string;
}

/** sRGB to linear, as glTF's `baseColorFactor` takes it, to six decimals. */
function linear(hex: number, alpha = 1): [number, number, number, number] {
  const ch = (shift: number) => {
    const c = ((hex >> shift) & 0xff) / 255;
    const l = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return Math.round(l * 1e6) / 1e6;
  };
  return [ch(16), ch(8), ch(0), alpha];
}

const COLOUR_NAMES = new Map<number, string>(
  Object.entries(COLOURS).map(([name, hex]) => [hex, name] as [number, string]),
);

/** -0 as 0, so a matrix's numbers never depend on how a zero was reached. */
function matrixOf(m: ArrayLike<number>): Mat4 {
  return Array.from(m, (x) => (x === 0 ? 0 : x));
}

function optKey(opt: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.keys(opt)
      .sort()
      .map((k) => [k, opt[k]]),
  );
}

/** SKUs to order, by cut-list source (bars, pieces cut from stock) and by item and options. */
function skus(input: ExportInput) {
  const code = (item: string, offer: string): string =>
    input.items.offers(item).find((o) => o.sku === offer)?.code ?? offer.replace(/^[^:]*:/, "");
  const bySource = new Map<string, string>();
  for (const g of input.outputs.cutlist.groups ?? []) {
    if (g.offer) {
      for (const l of g.lines) for (const s of l.sources) bySource.set(s, code(g.item, g.offer));
    }
    for (const b of g.stock ?? []) {
      for (const p of b.pieces ?? []) bySource.set(p.source, code(g.item, b.sku));
    }
  }
  const byItem = new Map<string, Set<string>>();
  for (const s of input.outputs.order.suppliers ?? []) {
    for (const l of s.lines) {
      if (!l.sku) continue;
      const k = `${l.item}|${optKey(l.opt)}`;
      const set = byItem.get(k) ?? new Set<string>();
      set.add(l.sku);
      byItem.set(k, set);
    }
  }
  const ofItem = (item: string, opt: Readonly<Record<string, string>>) => {
    const set = byItem.get(`${item}|${optKey(opt)}`);
    if (!set) return undefined;
    const all = [...set].sort(compareIds);
    return all.length === 1 ? all[0] : all;
  };
  return { bySource, ofItem };
}

export function glbScene(input: ExportInput): GltfScene {
  const { derived } = input;
  const json = input.outputs.derived as {
    bars?: Record<string, BarJson>;
    parts?: Record<string, PartJson>;
    pieces?: { source: string; len_mm: number }[];
  };
  const display = meshDisplay(derived, input.items);
  const sku = skus(input);
  const pieceLen = new Map((json.pieces ?? []).map((p) => [p.source, p.len_mm]));

  const materials: GltfMaterial[] = [];
  const materialIndex = new Map<string, number>();
  const material = (name: string, make: () => Omit<GltfMaterial, "name">) => {
    let i = materialIndex.get(name);
    if (i === undefined) {
      i = materials.push({ name, ...make() }) - 1;
      materialIndex.set(name, i);
    }
    return i;
  };
  const meshes: GltfMesh[] = [];
  const meshIndex = new Map<string, number>();
  const mesh = (key: string, name: string, mat: number, make: () => MeshData) => {
    let i = meshIndex.get(key);
    if (i === undefined) {
      i = meshes.push({ name, data: make(), material: mat }) - 1;
      meshIndex.set(key, i);
    }
    return i;
  };
  const units = new Map<string, ReturnType<typeof sectionGeometry>>();
  const unit = (sid: string, s: ViewSection) => {
    let g = units.get(sid);
    if (!g) {
      g = sectionGeometry(s);
      units.set(sid, g);
    }
    return g;
  };
  const label = (id: string, map: Readonly<Record<string, { label?: string } | unknown>>) => {
    const own = map[id.split("@")[0] as string] as { label?: unknown } | undefined;
    return typeof own?.label === "string" && own.label !== "" ? own.label : undefined;
  };

  // Node 0 is the root; the model's nodes follow, each a child of it.
  const nodes: GltfNode[] = [];

  for (const [id, bar] of Object.entries(json.bars ?? {})) {
    const view = display.bars[id];
    const section = view ? display.sections[view.section] : undefined;
    if (!view || !section) continue;
    const colour = barColour(bar);
    const matName = COLOUR_NAMES.get(colour) ?? "bar";
    const mat = material(matName, () => ({
      color: linear(colour),
      metallic: matName === "steel" ? 0.6 : 0.3,
      roughness: 0.5,
    }));
    const square = squareEnds(bar);
    const m = square
      ? mesh(`section ${view.section} ${matName}`, `${view.section} (${matName})`, mat, () =>
          meshData(unit(view.section, section)),
        )
      : mesh(`bar ${id}`, `${id} (angled ends)`, mat, () =>
          meshData(angledGeometry(unit(view.section, section), bar, view)),
        );
    const code = sku.bySource.get(id);
    nodes.push({
      name: `${id} ${label(id, derived.doc.bars) ?? bar.item}`,
      mesh: m,
      ...(square ? { matrix: matrixOf(squareMatrix(bar, view).elements) } : {}),
      extras: {
        kind: "bar",
        id,
        item: bar.item,
        ...(code !== undefined ? { sku: code } : {}),
        opt: bar.opt,
        cut_mm: bar.cut_mm,
      },
    });
  }

  for (const [id, p] of Object.entries(json.parts ?? {})) {
    const shape = partShape(p, display.parts[id]);
    if (!shape) continue;
    const matName = shape.translucent ? "part, translucent" : "part";
    const mat = material(matName, () => ({
      color: linear(COLOURS.part, shape.translucent ? TRANSLUCENT_OPACITY : 1),
      metallic: 0.1,
      roughness: 0.6,
      ...(shape.translucent ? { translucent: true } : {}),
    }));
    const [lo, hi] = shape.box;
    const m = mesh(`box ${JSON.stringify(shape.box)} ${matName}`, `box (${matName})`, mat, () =>
      boxMesh(lo, hi),
    );
    const code = sku.ofItem(p.item, p.opt);
    nodes.push({
      name: `${id} ${label(id, derived.doc.parts) ?? p.item}`,
      mesh: m,
      matrix: matrixOf(shape.matrix),
      extras: {
        kind: "part",
        id,
        item: p.item,
        ...(code !== undefined ? { sku: code } : {}),
        opt: p.opt,
      },
    });
  }

  for (const f of display.fasteners) {
    const id = fastenerId(f);
    const mat = material("fastener", () => ({
      color: linear(COLOURS.fastener),
      metallic: 0.8,
      roughness: 0.4,
    }));
    const m = mesh("rod", "rod", mat, () => rodMesh());
    const code = sku.bySource.get(id) ?? sku.ofItem(f.item, {});
    const cut = pieceLen.get(id);
    nodes.push({
      name: `${id} ${f.item}`,
      mesh: m,
      matrix: matrixOf(fastenerMatrix(f)),
      extras: {
        kind: "fastener",
        id,
        connection: f.connection,
        item: f.item,
        ...(code !== undefined ? { sku: code } : {}),
        ...(cut !== undefined ? { cut_mm: cut } : {}),
      },
    });
  }

  for (const g of units.values()) g.dispose();
  const root: GltfNode = {
    name: input.name,
    // −90° about X: Z up becomes Y up (§2). Millimetres to metres.
    rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    scale: [0.001, 0.001, 0.001],
    children: nodes.map((_, i) => i + 1),
  };
  return {
    generator: input.generator,
    stamp: input.stamp,
    name: input.name,
    roots: [0],
    nodes: [root, ...nodes],
    meshes,
    materials,
  };
}
