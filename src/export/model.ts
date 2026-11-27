import type { Derived } from "#core/derive/derive.ts";
import { compareIds } from "#core/ids.ts";
import type { ItemSource } from "#core/items.ts";
import type { Outputs } from "#core/revision/outputs.ts";
import { angledGeometry, sectionGeometry, squareEnds, squareMatrix } from "../mesh/bars.ts";
import { type Mat4, type MeshData, meshData } from "../mesh/data.ts";
import { meshDisplay } from "../mesh/display.ts";
import { HOLE_SEGMENTS, holeMarks, partMesh } from "../mesh/items.ts";
import type { BarJson, PartJson, ViewSection } from "../mesh/model.ts";
import { fastenerId, fastenerMatrix, holeMatrix, partShape } from "../mesh/place.ts";
import { rodMesh } from "../mesh/solids.ts";
import { barColour, COLOURS, partColour, TRANSLUCENT_OPACITY } from "../mesh/style.ts";
import type { GltfMaterial, GltfMesh, GltfNode, GltfScene } from "./glb.ts";

/**
 * The export scene of a derived model (design §9): the meshes `src/mesh/` builds for the viewer,
 * gathered for the GLB writer. It is not the render scene:
 *
 * - One root node converts the design's Z-up millimetres to glTF's Y-up metres (§2): a rotation
 *   of −90° about X and a scale of 0.001.
 * - Under it, one node per bar, placed part and fastener, named `<id> <label|item>`, in id order.
 *   Nodes share one mesh per distinct geometry and material: a section's unit extrusion under
 *   each square bar's matrix, a box per part shape, a project item's plate or bent angle (§4.8),
 *   one rod for every fastener; a bar with an angled end has its own mesh.
 * - A project plate's or bent angle's holes are its node's children, one per rod (the drill's,
 *   and a countersink's or counterbore's mouth), named `<part>.<hole> <rod>` and placed in the
 *   part's frame on one shared rod, as the viewer marks them.
 * - Each node's `extras`: what it is, its id, item, SKU (what to order: the cut list's offer
 *   for a bar or a piece cut from stock, the order's lines for an item), options and cut length;
 *   a project shape's kind, or that a part is a placeholder; a hole's part, id, type and rod.
 * - Context (X11), a bar, a part or a context connection's fastener, is exported where it stands
 *   so the frame shows in its room: `extras.context`, one translucent material of its own, and no
 *   SKU or cut length, since it is not bought or cut.
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

  // Node 0 is the root; the model's nodes follow, the top-level ones children of it and a part's
  // holes children of the part. `nodes` and `top` index the model's nodes from 0.
  const nodes: GltfNode[] = [];
  const top: number[] = [];

  // Context (X11), bar or part: one translucent material of its own, and no SKU or cut length,
  // since it is not bought or cut; `extras.context` lets a reader leave it out.
  const contextMaterial = () =>
    material("context, translucent", () => ({
      color: linear(COLOURS.context, TRANSLUCENT_OPACITY),
      metallic: 0.1,
      roughness: 0.8,
      translucent: true,
    }));

  for (const [id, bar] of Object.entries(json.bars ?? {})) {
    const view = display.bars[id];
    const section = view ? display.sections[view.section] : undefined;
    if (!view || !section) continue;
    const context = bar.context === true;
    const colour = barColour(bar);
    const matName = context ? "context, translucent" : (COLOUR_NAMES.get(colour) ?? "bar");
    const mat = context
      ? contextMaterial()
      : material(matName, () => ({
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
    const code = context ? undefined : sku.bySource.get(id);
    top.push(nodes.length);
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
        ...(context ? { context: true } : { cut_mm: bar.cut_mm }),
      },
    });
  }

  for (const [id, p] of Object.entries(json.parts ?? {})) {
    const placed = partShape(p, display.parts[id]);
    if (!placed) continue;
    const { shape, translucent, context } = placed;
    const colour = partColour(placed);
    const base = COLOUR_NAMES.get(colour) ?? "part";
    const matName = translucent ? `${base}, translucent` : base;
    const mat = context
      ? contextMaterial()
      : material(matName, () => ({
          color: linear(colour, translucent ? TRANSLUCENT_OPACITY : 1),
          metallic: shape ? 0.4 : 0.1,
          roughness: 0.6,
          ...(translucent ? { translucent: true } : {}),
        }));
    // One item gives one shape, so parts of the same project item share its mesh.
    const m = shape
      ? mesh(
          `shape ${p.item}${context ? " context" : ""}`,
          `${p.item} (${shape.kind}${context ? ", context" : ""})`,
          mat,
          () => partMesh(placed),
        )
      : mesh(`box ${JSON.stringify(placed.box)} ${matName}`, `box (${matName})`, mat, () =>
          partMesh(placed),
        );
    const code = context ? undefined : sku.ofItem(p.item, p.opt);
    const at = nodes.length;
    const holes: GltfNode[] = [];
    if (shape) {
      const hmat = material("hole", () => ({
        color: linear(COLOURS.hole),
        metallic: 0,
        roughness: 0.9,
      }));
      const rod = mesh("hole rod", "hole rod", hmat, () => rodMesh(HOLE_SEGMENTS));
      for (const mark of holeMarks(shape)) {
        holes.push({
          name: `${id}.${mark.hole} ${mark.rod}`,
          mesh: rod,
          matrix: matrixOf(holeMatrix(mark)),
          extras: {
            kind: "hole",
            id: `${id}.${mark.hole}`,
            part: id,
            hole: mark.hole,
            type: mark.type,
            rod: mark.rod,
            d_mm: mark.d,
          },
        });
      }
    }
    top.push(at);
    nodes.push(
      {
        name: `${id} ${label(id, derived.doc.parts) ?? p.item}`,
        mesh: m,
        matrix: matrixOf(placed.matrix),
        // Children index the file's nodes, where the root comes first.
        ...(holes.length > 0 ? { children: holes.map((_, k) => at + 2 + k) } : {}),
        extras: {
          kind: "part",
          id,
          item: p.item,
          ...(code !== undefined ? { sku: code } : {}),
          opt: p.opt,
          ...(shape ? { shape: shape.kind } : {}),
          ...(placed.placeholder ? { placeholder: true } : {}),
          ...(context ? { context: true } : {}),
        },
      },
      ...holes,
    );
  }

  for (const f of display.fasteners) {
    const id = fastenerId(f);
    const context = f.context === true;
    const mat = context
      ? contextMaterial()
      : material("fastener", () => ({
          color: linear(COLOURS.fastener),
          metallic: 0.8,
          roughness: 0.4,
        }));
    const m = context
      ? mesh("rod context", "rod (context)", mat, () => rodMesh())
      : mesh("rod", "rod", mat, () => rodMesh());
    const code = context ? undefined : (sku.bySource.get(id) ?? sku.ofItem(f.item, {}));
    const cut = context ? undefined : pieceLen.get(id);
    top.push(nodes.length);
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
        ...(context ? { context: true } : {}),
      },
    });
  }

  for (const g of units.values()) g.dispose();
  const root: GltfNode = {
    name: input.name,
    // −90° about X: Z up becomes Y up (§2). Millimetres to metres.
    rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    scale: [0.001, 0.001, 0.001],
    children: top.map((i) => i + 1),
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
