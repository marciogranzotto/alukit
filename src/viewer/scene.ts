import CameraControls from "camera-controls";
// camera-controls needs three's classes installed once.
import * as THREE from "three";
import {
  AmbientLight,
  AxesHelper,
  Box3,
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  GridHelper,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  angledGeometry,
  appendEdges,
  barCorners,
  sectionEdges,
  sectionGeometry,
  squareEnds,
  squareMatrix,
} from "../mesh/bars.ts";
import type { BarJson, MeshInput, V3, ViewSection } from "../mesh/model.ts";

CameraControls.install({
  THREE: THREE as unknown as Parameters<typeof CameraControls.install>[0]["THREE"],
});

/** What the scene holds, for the test hook and the status line. */
export interface ViewerStats {
  /** Bar bodies drawn: instanced (square ends) plus their own meshes (an angled end). */
  bars: number;
  instancedBars: number;
  angledBars: number;
  parts: number;
  fasteners: number;
  edgeSegments: number;
}

export type SelectMode = "replace" | "toggle" | "add";

export interface Viewer {
  canvas: HTMLCanvasElement;
  setModel(m: MeshInput): void;
  setSelection(ids: ReadonlySet<string>): void;
  /** Called with the entities a click or a box picked, and how they combine with the selection. */
  onSelect(cb: (ids: string[], mode: SelectMode) => void): void;
  fitView(): void;
  stats(): ViewerStats;
  dispose(): void;
}

const COLOURS = {
  background: 0x1b1f24,
  anodised: 0xb9c3cd,
  black: 0x3a3f46,
  steel: 0x8d949c,
  part: 0x6fa8dc,
  fastener: 0xc9a227,
  edge: 0x15181c,
  selected: 0xff9f1c,
} as const;

function barColour(bar: BarJson): number {
  if (bar.opt.finish === "black") return COLOURS.black;
  if (bar.opt.finish !== undefined) return COLOURS.anodised;
  return COLOURS.steel;
}

/** Columns x, y, z and a translation: a frame as a matrix. */
function basis(x: V3, y: V3, z: V3, o: V3): Matrix4 {
  // biome-ignore format: a matrix reads best by rows
  return new Matrix4().set(
    x[0], y[0], z[0], o[0],
    x[1], y[1], z[1], o[1],
    x[2], y[2], z[2], o[2],
    0, 0, 0, 1,
  );
}

/** Two unit vectors square to `a` and to each other, completing a right-handed frame. */
function across(a: V3): [V3, V3] {
  const ref: V3 = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = new Vector3(...ref).cross(new Vector3(...a)).normalize();
  const w = new Vector3(...a).cross(u).normalize();
  return [u.toArray() as unknown as V3, w.toArray() as unknown as V3];
}

/**
 * The 3D viewport (design §8). The world is right-handed with Z up (§2); three.js is Y up, so the
 * conversion happens here and nowhere else: everything of ours lives under `world`, rotated −90°
 * about X. It renders on demand: after a camera move, a model, a selection or a resize.
 */
export function createViewer(container: HTMLElement): Viewer {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(COLOURS.background);
  const world = new Group();
  world.name = "world (Z up)";
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  // The ground grid lies in the world XY plane: GridHelper is built in XZ, so tip it onto XY.
  const grid = new GridHelper(4000, 40, 0x59636e, 0x2c3238);
  grid.rotation.x = Math.PI / 2;
  world.add(grid);
  world.add(new AxesHelper(300)); // X red, Y green, Z blue (up)

  const content = new Group();
  content.name = "model";
  world.add(content);

  scene.add(new AmbientLight(0xffffff, 0.9));
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(800, 1500, 600);
  scene.add(sun);
  const fill = new DirectionalLight(0xffffff, 0.6);
  fill.position.set(-900, 400, -700);
  scene.add(fill);

  const camera = new PerspectiveCamera(45, 1, 5, 200_000);
  camera.position.set(2000, 1500, 2000);
  const controls = new CameraControls(camera, renderer.domElement);
  controls.setTarget(0, 0, 0, false);

  let dirty = true;
  const invalidate = () => {
    dirty = true;
  };

  // ---------------------------------------------------------------------------------------------
  // The model

  /** Unit extrusions and their edges, kept across revisions while a section stays the same. */
  const unitCache = new Map<
    string,
    { key: string; geometry: BufferGeometry; edges: Float32Array }
  >();
  const unitOf = (id: string, s: ViewSection) => {
    const key = JSON.stringify(s);
    const hit = unitCache.get(id);
    if (hit?.key === key) return hit;
    hit?.geometry.dispose();
    const geometry = sectionGeometry(s);
    const entry = { key, geometry, edges: sectionEdges(geometry) };
    unitCache.set(id, entry);
    return entry;
  };

  let model: MeshInput | undefined;
  /** Per drawable: which entity it is and how to recolour it. */
  let instanced: { mesh: InstancedMesh; ids: string[]; colours: number[] }[] = [];
  let single: { mesh: Mesh; id: string; colour: number }[] = [];
  let owned: { dispose(): void }[] = [];
  let counts: ViewerStats = {
    bars: 0,
    instancedBars: 0,
    angledBars: 0,
    parts: 0,
    fasteners: 0,
    edgeSegments: 0,
  };
  let selection: ReadonlySet<string> = new Set();
  let fitted = false;

  function clear(): void {
    for (const c of [...content.children]) content.remove(c);
    for (const o of owned) o.dispose();
    owned = [];
    instanced = [];
    single = [];
  }

  function build(m: MeshInput): void {
    clear();
    const groups = new Map<
      string,
      { section: ViewSection; sid: string; bars: [string, BarJson][] }
    >();
    let angled = 0;
    let instancedCount = 0;
    let edgeFloats = 0;
    const drawable: [string, BarJson, string][] = [];
    for (const [id, bar] of Object.entries(m.bars)) {
      const view = m.display.bars[id];
      const section = view ? m.display.sections[view.section] : undefined;
      if (!view || !section) continue;
      drawable.push([id, bar, view.section]);
      edgeFloats += unitOf(view.section, section).edges.length;
      if (!squareEnds(bar)) continue;
      const key = `${view.section}\u0000${barColour(bar)}`;
      const g = groups.get(key) ?? { section, sid: view.section, bars: [] };
      g.bars.push([id, bar]);
      groups.set(key, g);
    }

    // Square bars: one InstancedMesh per section and colour (§8).
    for (const g of groups.values()) {
      const unit = unitOf(g.sid, g.section);
      const material = new MeshLambertMaterial({ color: 0xffffff });
      const mesh = new InstancedMesh(unit.geometry, material, g.bars.length);
      mesh.name = `bars ${g.sid}`;
      const ids: string[] = [];
      const colours: number[] = [];
      g.bars.forEach(([id, bar], i) => {
        mesh.setMatrixAt(
          i,
          squareMatrix(
            bar,
            m.display.bars[id] as NonNullable<MeshInput["display"]["bars"][string]>,
          ),
        );
        const c = barColour(bar);
        mesh.setColorAt(i, new Color(c));
        ids.push(id);
        colours.push(c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
      owned.push(material, { dispose: () => mesh.dispose() });
      instanced.push({ mesh, ids, colours });
      instancedCount += g.bars.length;
    }

    // Angled bars: their own geometry, exact on their end planes.
    for (const [id, bar, sid] of drawable) {
      if (squareEnds(bar)) continue;
      const view = m.display.bars[id] as NonNullable<MeshInput["display"]["bars"][string]>;
      const unit = unitOf(sid, m.display.sections[sid] as ViewSection);
      const geometry = angledGeometry(unit.geometry, bar, view);
      const colour = barColour(bar);
      const material = new MeshLambertMaterial({ color: colour });
      const mesh = new Mesh(geometry, material);
      mesh.name = id;
      content.add(mesh);
      owned.push(geometry, material);
      single.push({ mesh, id, colour });
      angled++;
    }

    // Edges: one merged buffer for every bar.
    const edges = new Float32Array(edgeFloats);
    let at = 0;
    for (const [id, bar, sid] of drawable) {
      const view = m.display.bars[id] as NonNullable<MeshInput["display"]["bars"][string]>;
      at = appendEdges(
        unitOf(sid, m.display.sections[sid] as ViewSection).edges,
        bar,
        view,
        edges,
        at,
      );
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new Float32BufferAttribute(edges, 3));
    const edgeMaterial = new LineBasicMaterial({
      color: COLOURS.edge,
      transparent: true,
      opacity: 0.6,
    });
    const lines = new LineSegments(edgeGeometry, edgeMaterial);
    lines.name = "edges";
    lines.raycast = () => {};
    content.add(lines);
    owned.push(edgeGeometry, edgeMaterial);

    // Parts: a box from the item's bounding box in its own frame; translucent when a placeholder
    // or when the catalog gives no box (a marker).
    let parts = 0;
    for (const [id, p] of Object.entries(m.parts)) {
      if (p.unplaced || !p.frame || !p.origin || !p.point) continue;
      const view = m.display.parts[id];
      const box = view?.box;
      const [lo, hi]: [V3, V3] = box ?? [
        [-10, -10, -10],
        [10, 10, 10],
      ];
      const geometry = new BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      geometry.translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
      const translucent = view?.translucent ?? true;
      const material = new MeshLambertMaterial({
        color: COLOURS.part,
        transparent: translucent,
        opacity: translucent ? 0.35 : 1,
        depthWrite: !translucent,
        side: translucent ? DoubleSide : THREE.FrontSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.name = id;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(basis(p.frame.x, p.frame.y, p.frame.z, box ? p.origin : p.point));
      content.add(mesh);
      owned.push(geometry, material);
      single.push({ mesh, id, colour: COLOURS.part });
      parts++;
    }

    // Fasteners of face connections: rods from the head along the axis; a pick selects the
    // connection.
    const fs = m.display.fasteners;
    if (fs.length > 0) {
      const geometry = new CylinderGeometry(0.5, 0.5, 1, 12);
      const material = new MeshLambertMaterial({ color: 0xffffff });
      const mesh = new InstancedMesh(geometry, material, fs.length);
      mesh.name = "fasteners";
      const ids: string[] = [];
      const colours: number[] = [];
      fs.forEach((f, i) => {
        const [u, w] = across(f.axis);
        const mid: V3 = [
          f.head[0] + (f.axis[0] * f.len) / 2,
          f.head[1] + (f.axis[1] * f.len) / 2,
          f.head[2] + (f.axis[2] * f.len) / 2,
        ];
        // The cylinder runs along its local y: y onto the axis, scaled to the length.
        const M = basis(w, f.axis, u, mid).multiply(new Matrix4().makeScale(f.d, f.len, f.d));
        mesh.setMatrixAt(i, M);
        mesh.setColorAt(i, new Color(COLOURS.fastener));
        ids.push(f.connection);
        colours.push(COLOURS.fastener);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
      owned.push(geometry, material, { dispose: () => mesh.dispose() });
      instanced.push({ mesh, ids, colours });
    }

    counts = {
      bars: instancedCount + angled,
      instancedBars: instancedCount,
      angledBars: angled,
      parts,
      fasteners: fs.length,
      edgeSegments: edges.length / 6,
    };
  }

  function paint(): void {
    const sel = new Color(COLOURS.selected);
    for (const g of instanced) {
      g.ids.forEach((id, i) => {
        g.mesh.setColorAt(i, selection.has(id) ? sel : new Color(g.colours[i]));
      });
      if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
    }
    for (const s of single) {
      (s.mesh.material as MeshLambertMaterial).color.set(selection.has(s.id) ? sel : s.colour);
    }
    invalidate();
  }

  function fitView(): void {
    const box = new Box3().setFromObject(content);
    if (box.isEmpty()) return;
    const c = box.getCenter(new Vector3());
    const r = Math.max(box.getSize(new Vector3()).length() / 2, 50);
    // An iso view from the front right, above (model +x, −y, +z; three's frame is Y up).
    const dir = new Vector3(1, 0.8, 1).normalize();
    void controls.setLookAt(
      c.x + dir.x * r * 2.6,
      c.y + dir.y * r * 2.6,
      c.z + dir.z * r * 2.6,
      c.x,
      c.y,
      c.z,
      false,
    );
    invalidate();
  }

  // ---------------------------------------------------------------------------------------------
  // Picking: click, and box select with Shift held

  let selectCb: (ids: string[], mode: SelectMode) => void = () => {};
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const rectEl = document.createElement("div");
  rectEl.className = "select-box";
  rectEl.hidden = true;
  container.appendChild(rectEl);

  function pick(clientX: number, clientY: number): string | undefined {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(content.children as Object3D[], false);
    for (const h of hits) {
      const g = instanced.find((x) => x.mesh === h.object);
      if (g && h.instanceId !== undefined) return g.ids[h.instanceId];
      const s = single.find((x) => x.mesh === h.object);
      if (s) return s.id;
    }
    return undefined;
  }

  /** Entities whose body lies wholly inside a screen rectangle (window selection). */
  function inside(x0: number, y0: number, x1: number, y1: number): string[] {
    if (!model) return [];
    const r = renderer.domElement.getBoundingClientRect();
    const toWorld = world.matrixWorld;
    const v = new Vector3();
    const within = (pts: readonly (readonly [number, number, number])[]) =>
      pts.every(([a, b, c]) => {
        v.set(a, b, c).applyMatrix4(toWorld).project(camera);
        if (v.z < -1 || v.z > 1) return false;
        const sx = r.left + ((v.x + 1) / 2) * r.width;
        const sy = r.top + ((1 - v.y) / 2) * r.height;
        return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      });
    const out: string[] = [];
    for (const [id, bar] of Object.entries(model.bars)) {
      const view = model.display.bars[id];
      const section = view ? model.display.sections[view.section] : undefined;
      if (view && section && within(barCorners(bar, section, view))) out.push(id);
    }
    for (const s of single) {
      if (!model.parts[s.id]) continue;
      const g = s.mesh.geometry;
      g.computeBoundingBox();
      const b = g.boundingBox as Box3;
      const corners: [number, number, number][] = [];
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z]) {
            const p = new Vector3(x, y, z).applyMatrix4(s.mesh.matrix);
            corners.push([p.x, p.y, p.z]);
          }
      if (within(corners)) out.push(s.id);
    }
    return out;
  }

  let down: { x: number; y: number; box: boolean } | undefined;
  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, box: e.shiftKey };
    if (e.shiftKey) {
      controls.enabled = false;
      el.setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!down?.box) return;
    const cr = container.getBoundingClientRect();
    rectEl.hidden = false;
    rectEl.style.left = `${Math.min(down.x, e.clientX) - cr.left}px`;
    rectEl.style.top = `${Math.min(down.y, e.clientY) - cr.top}px`;
    rectEl.style.width = `${Math.abs(e.clientX - down.x)}px`;
    rectEl.style.height = `${Math.abs(e.clientY - down.y)}px`;
  };
  const onUp = (e: PointerEvent) => {
    if (!down) return;
    const d = down;
    down = undefined;
    const additive = e.ctrlKey || e.metaKey;
    if (d.box) {
      rectEl.hidden = true;
      controls.enabled = true;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) {
        const ids = inside(
          Math.min(d.x, e.clientX),
          Math.min(d.y, e.clientY),
          Math.max(d.x, e.clientX),
          Math.max(d.y, e.clientY),
        );
        selectCb(ids, additive ? "add" : "replace");
        return;
      }
    }
    // A click, not a drag of the camera.
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const id = pick(e.clientX, e.clientY);
    selectCb(id ? [id] : [], additive ? "toggle" : "replace");
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);

  // ---------------------------------------------------------------------------------------------
  // Size and frames

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    invalidate();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let frame = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const moved = controls.update((now - last) / 1000);
    last = now;
    if (moved || dirty) {
      dirty = false;
      renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    canvas: renderer.domElement,
    setModel(m) {
      model = m;
      build(m);
      paint();
      if (!fitted && content.children.length > 1) {
        fitView();
        fitted = true;
      }
    },
    setSelection(ids) {
      selection = ids;
      paint();
    },
    onSelect(cb) {
      selectCb = cb;
    },
    fitView,
    stats: () => ({ ...counts }),
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      clear();
      for (const u of unitCache.values()) u.geometry.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      rectEl.remove();
    },
  };
}
