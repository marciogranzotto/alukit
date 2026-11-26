import type { Mat4, MeshData } from "../mesh/data.ts";

/**
 * A binary glTF writer (design §9; [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html),
 * "Binary glTF Layout"). three's `GLTFExporter` needs a browser, so AluKit writes the file itself:
 * positions, normals, indices and flat materials, no textures. Pure, with no three.js: the same
 * scene gives the same bytes, so a GLB joins the determinism claim (§5.2).
 *
 * Layout: a 12-byte header, a JSON chunk padded with spaces, a BIN chunk padded with zeros, every
 * number little-endian. One buffer view per accessor, in mesh order (positions, normals,
 * indices), each 4-byte aligned by construction (32-bit components).
 */

export interface GltfMaterial {
  name: string;
  /** Linear RGBA, each 0 to 1. */
  color: readonly [number, number, number, number];
  metallic: number;
  roughness: number;
  /** Blended (alpha below 1), and drawn from both sides. */
  translucent?: boolean;
}

export interface GltfMesh {
  name: string;
  data: MeshData;
  /** Index into `materials`. */
  material: number;
}

export interface GltfNode {
  name: string;
  mesh?: number;
  /** Column-major; absent for the identity. */
  matrix?: Mat4;
  rotation?: readonly [number, number, number, number];
  scale?: readonly [number, number, number];
  children?: readonly number[];
  extras?: Readonly<Record<string, unknown>>;
}

export interface GltfScene {
  /** `asset.generator`. */
  generator: string;
  /** `asset.extras`: the stamp (§9). */
  stamp: Readonly<Record<string, unknown>>;
  name: string;
  /** The scene's root nodes, by index. */
  roots: readonly number[];
  nodes: readonly GltfNode[];
  meshes: readonly GltfMesh[];
  materials: readonly GltfMaterial[];
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

interface Part {
  bytes: Uint8Array;
}

function floats(a: Float32Array): Uint8Array {
  const out = new Uint8Array(a.length * 4);
  const v = new DataView(out.buffer);
  for (let i = 0; i < a.length; i++) v.setFloat32(i * 4, a[i] as number, true);
  return out;
}

function uints(a: Uint32Array): Uint8Array {
  const out = new Uint8Array(a.length * 4);
  const v = new DataView(out.buffer);
  for (let i = 0; i < a.length; i++) v.setUint32(i * 4, a[i] as number, true);
  return out;
}

/** The per-component extent of a VEC3 array, as glTF requires for POSITION. */
function extent(a: Float32Array): { min: number[]; max: number[] } {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < a.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const x = a[i + k] as number;
      if (x < (min[k] as number)) min[k] = x;
      if (x > (max[k] as number)) max[k] = x;
    }
  }
  return { min, max };
}

function pad(bytes: Uint8Array, fill: number): Uint8Array {
  const n = (4 - (bytes.length % 4)) % 4;
  if (n === 0) return bytes;
  const out = new Uint8Array(bytes.length + n);
  out.set(bytes);
  out.fill(fill, bytes.length);
  return out;
}

export function writeGlb(scene: GltfScene): Uint8Array {
  const bin: Part[] = [];
  let offset = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const view = (bytes: Uint8Array, target: number): number => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    bin.push({ bytes });
    offset += bytes.length;
    return bufferViews.length - 1;
  };

  const meshes = scene.meshes.map((m) => {
    if (m.data.positions.length === 0) throw new Error(`mesh ${m.name} has no vertices`);
    const count = m.data.positions.length / 3;
    const { min, max } = extent(m.data.positions);
    accessors.push({
      bufferView: view(floats(m.data.positions), ARRAY_BUFFER),
      componentType: FLOAT,
      count,
      type: "VEC3",
      min,
      max,
    });
    const position = accessors.length - 1;
    accessors.push({
      bufferView: view(floats(m.data.normals), ARRAY_BUFFER),
      componentType: FLOAT,
      count,
      type: "VEC3",
    });
    const normal = accessors.length - 1;
    let indices: number | undefined;
    if (m.data.indices) {
      accessors.push({
        bufferView: view(uints(m.data.indices), ELEMENT_ARRAY_BUFFER),
        componentType: UNSIGNED_INT,
        count: m.data.indices.length,
        type: "SCALAR",
      });
      indices = accessors.length - 1;
    }
    return {
      name: m.name,
      primitives: [
        {
          attributes: { POSITION: position, NORMAL: normal },
          ...(indices !== undefined ? { indices } : {}),
          material: m.material,
        },
      ],
    };
  });

  const json = {
    asset: { version: "2.0", generator: scene.generator, extras: scene.stamp },
    scene: 0,
    scenes: [{ name: scene.name, nodes: [...scene.roots] }],
    nodes: scene.nodes.map((n) => ({
      name: n.name,
      ...(n.mesh !== undefined ? { mesh: n.mesh } : {}),
      ...(n.matrix !== undefined ? { matrix: [...n.matrix] } : {}),
      ...(n.rotation !== undefined ? { rotation: [...n.rotation] } : {}),
      ...(n.scale !== undefined ? { scale: [...n.scale] } : {}),
      ...(n.children !== undefined && n.children.length > 0 ? { children: [...n.children] } : {}),
      ...(n.extras !== undefined ? { extras: n.extras } : {}),
    })),
    meshes,
    materials: scene.materials.map((m) => ({
      name: m.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...m.color],
        metallicFactor: m.metallic,
        roughnessFactor: m.roughness,
      },
      ...(m.translucent ? { alphaMode: "BLEND", doubleSided: true } : {}),
    })),
    // A scene with no geometry has no buffer (glTF: a buffer holds at least one byte).
    ...(offset > 0 ? { accessors, bufferViews, buffers: [{ byteLength: offset }] } : {}),
  };

  const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = new Uint8Array(offset);
  let at = 0;
  for (const p of bin) {
    binBytes.set(p.bytes, at);
    at += p.bytes.length;
  }
  const binPadded = pad(binBytes, 0);
  const total = 12 + 8 + jsonBytes.length + (offset > 0 ? 8 + binPadded.length : 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, GLB_MAGIC, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonBytes.length, true);
  v.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  if (offset > 0) {
    const binAt = 20 + jsonBytes.length;
    v.setUint32(binAt, binPadded.length, true);
    v.setUint32(binAt + 4, CHUNK_BIN, true);
    out.set(binPadded, binAt + 8);
  }
  return out;
}
