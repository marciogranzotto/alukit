import CameraControls from "camera-controls";
// camera-controls needs three's classes installed once.
import * as THREE from "three";
import {
  AmbientLight,
  AxesHelper,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
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
  OrthographicCamera,
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
import { type Mat4, type MeshData, mulMatrix } from "../mesh/data.ts";
import { HOLE_SEGMENTS, holeMarks, partMesh } from "../mesh/items.ts";
import type { BarJson, MeshInput, V3, ViewSection } from "../mesh/model.ts";
import { fastenerMatrix, holeMatrix, partShape } from "../mesh/place.ts";
import { rodMesh } from "../mesh/solids.ts";
import { finishTone, partTone } from "../mesh/style.ts";
import { Overlay, type OverlayState } from "./overlay.ts";
import type { P2, Ray } from "./snap.ts";
import type { ViewTheme } from "./theme.ts";
import { type DocView, fromThree, isStandard, viewFrom } from "./views.ts";

CameraControls.install({
  THREE: THREE as unknown as Parameters<typeof CameraControls.install>[0]["THREE"],
});

/** What the scene holds, for the test hook and the status line. */
export interface ViewerStats {
  /** Bar bodies drawn: instanced (square ends) plus their own meshes (an angled end). */
  bars: number;
  instancedBars: number;
  angledBars: number;
  /** Part bodies drawn, and among them the project's plates, bent angles and placeholders. */
  parts: number;
  plates: number;
  bentAngles: number;
  placeholders: number;
  /** Holes marked on the plates and bent angles drawn. */
  holes: number;
  fasteners: number;
  edgeSegments: number;
}

export type SelectMode = "replace" | "toggle" | "add";

export type Projection = "perspective" | "orthographic";

/**
 * The section clipping plane (design §8): square to a world axis at `at_mm`. It hides the side
 * beyond it (coordinates above `at_mm`), or the side below with `flip`. It changes what is drawn
 * and what a pick or a snap can reach, nothing else: the document and its outputs are as they were.
 */
export interface SectionPlane {
  axis: "x" | "y" | "z";
  at_mm: number;
  flip: boolean;
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

/** The pointer as a tool reads it: where, and which modifier keys are held. */
export interface ToolPointer {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * A tool (design §8: draw, connect, place, pattern, measure) takes the viewport's pointer while
 * it is active: `move` on hover, `click` on a click that did not drag the camera. Dragging still
 * orbits, pans and zooms; box select belongs to the select tool, which is no tool.
 */
export interface ToolHandler {
  move?(e: ToolPointer): void;
  click?(e: ToolPointer): void;
  leave?(): void;
}

/** A corner as the view draws it (D-UX-10; src/ui/corners.ts derives the rest of it). */
export interface CornerMarker {
  key: string;
  at: V3;
  state: "joined" | "open" | "failed";
  /** The bar that runs through, when one does. */
  through?: string;
}

/** A problem drawn on the entities it is about (S3.7). */
export interface ProblemBadge {
  ids: string[];
  severity: "block" | "error" | "warn";
}

/**
 * The viewer's API. The methods after `stats` are the UX redesign's (docs/ux/plan.md §5.3):
 * today they do nothing, and S3 makes each work (the task named on it), keeping its signature.
 */
export interface Viewer {
  canvas: HTMLCanvasElement;
  setModel(m: MeshInput): void;
  setSelection(ids: ReadonlySet<string>): void;
  /** Entities a tool has picked (a connection's bars), drawn in their own colour. */
  setHighlight(ids: ReadonlySet<string>): void;
  /** Called with the entities a click or a box picked, and how they combine with the selection. */
  onSelect(cb: (ids: string[], mode: SelectMode) => void): void;
  setTool(tool: ToolHandler | undefined): void;
  /** What the active tool draws over the model. */
  setOverlay(state: OverlayState): void;
  /** The pointer's ray in world coordinates (Z up, mm), for analytic snapping (§8). */
  ray(clientX: number, clientY: number): Ray;
  /** A world point's position on the page, in CSS pixels; undefined behind the camera. */
  project(p: V3): P2 | undefined;
  /** The entity under the pointer, and where its body was hit, in world coordinates. */
  pickAt(clientX: number, clientY: number): { id: string; p: V3 } | undefined;
  /**
   * Looks from a standard view (iso, top, front, right or side, left, back, bottom), fitted to
   * the model, or from one of the document's named views (§4.2). False for an unknown name.
   */
  setView(name: string, views?: Readonly<Record<string, DocView>>, animate?: boolean): boolean;
  setProjection(p: Projection): void;
  projection(): Projection;
  fitView(): void;
  /** Fits the camera to the given entities, or to the whole model when there are none. */
  fitSelection(ids: ReadonlySet<string>): void;
  /** Renders now, whatever changed: a snapshot reads the canvas right after. */
  renderNow(): void;
  /** Sets the section clipping plane, or takes it away. */
  setSection(s: SectionPlane | undefined): void;
  section(): SectionPlane | undefined;
  /** Whether the section plane hides a world point. */
  clipped(p: V3): boolean;
  /** The model's extent along a world axis (mm): the section plane's range. */
  extent(axis: SectionPlane["axis"]): [number, number];
  stats(): ViewerStats;
  /** Tints the bodies the pointer, a row or a chip is over (S3.2). */
  setHover(ids: ReadonlySet<string>): void;
  /** Called with the entity under the pointer in Select, or undefined off every body (S3.2). */
  onHover(cb: (id?: string) => void): void;
  /** Ghosts every body but `keep`; undefined ends it (S3.6). */
  setGhost(keep: ReadonlySet<string> | undefined): void;
  /** Pulses the bodies, to draw the eye to them (S3.6). */
  pulse(ids: ReadonlySet<string>): void;
  /** Fits the camera to a box in world coordinates (Z up, mm), keeping its direction (S3.6). */
  fitBox(box: [V3, V3]): void;
  /** Draws a marker at each corner, by its state (S3.5). */
  setCorners(c: readonly CornerMarker[]): void;
  /** Draws each problem on its entities, by group (S3.7). */
  setProblemBadges(b: readonly ProblemBadge[]): void;
  /** Colours bars by their finish (today's look) or by their item, from the swatches (S3.10). */
  setColourBy(mode: "finish" | "item", swatches?: ReadonlyMap<string, number>): void;
  /** Draws with another theme's colours (S3.12). */
  setTheme(t: ViewTheme): void;
  /** Calls back after each frame drawn, for DOM overlays that follow the scene; returns the undo. */
  onRender(cb: () => void): () => void;
  /** A tool's label at a world point (S5's joint preview); undefined `at` takes it away (S3.8). */
  setLabel(key: string, at: V3 | undefined, text?: string): void;
  dispose(): void;
}

/** What a standard view fits when the model is empty: a metre cube on the ground (three's frame). */
const EMPTY_BOX = new Box3(new Vector3(0, 0, -1000), new Vector3(1000, 1000, 0));

/** Below this angle between faces a part's edge is smooth and not drawn (degrees), as a bar's. */
const PART_EDGE_DEG = 30;

/** A mesh from src/mesh as a geometry three can draw. */
function geometryOf(d: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(d.positions, 3));
  g.setAttribute("normal", new Float32BufferAttribute(d.normals, 3));
  if (d.indices) g.setIndex(new BufferAttribute(d.indices, 1));
  return g;
}

/**
 * The 3D viewport (design §8). The world is right-handed with Z up (§2); three.js is Y up, so the
 * conversion happens here and nowhere else: everything of ours lives under `world`, rotated −90°
 * about X. It renders on demand: after a camera move, a model, a selection or a resize. It draws
 * with the colours of `theme` (src/viewer/theme.ts).
 */
export function createViewer(container: HTMLElement, theme: ViewTheme): Viewer {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // The section plane clips the model's materials only, not the grid or the tools' overlay.
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(theme.background[0]);
  const world = new Group();
  world.name = "world (Z up)";
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  // The ground grid lies in the world XY plane: GridHelper is built in XZ, so tip it onto XY.
  const grid = new GridHelper(4000, 40, theme.grid.centre, theme.grid.line);
  grid.rotation.x = Math.PI / 2;
  world.add(grid);
  world.add(new AxesHelper(300)); // X red, Y green, Z blue (up)

  const content = new Group();
  content.name = "model";
  world.add(content);
  const overlay = new Overlay(theme);
  world.add(overlay.group);
  world.updateMatrixWorld(true);

  const lights = theme.lights;
  scene.add(new AmbientLight(lights.ambient.colour, lights.ambient.intensity));
  const sun = new DirectionalLight(lights.key.colour, lights.key.intensity);
  sun.position.set(800, 1500, 600);
  scene.add(sun);
  const fill = new DirectionalLight(lights.fill.colour, lights.fill.intensity);
  fill.position.set(-900, 400, -700);
  scene.add(fill);

  const persp = new PerspectiveCamera(45, 1, 5, 200_000);
  persp.position.set(2000, 1500, 2000);
  // Frustum in CSS pixels at zoom 1, set on resize; a negative near keeps the whole model in
  // front of an orthographic camera wherever it orbits.
  const ortho = new OrthographicCamera(-1, 1, 1, -1, -200_000, 200_000);
  let camera: PerspectiveCamera | OrthographicCamera = persp;
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
  /**
   * Per drawable: which entity it is and how to recolour it. A `fixed` group keeps its colours
   * when selected (holes stay dark on a selected plate) but still picks its entity.
   */
  let instanced: { mesh: InstancedMesh; ids: string[]; colours: number[]; fixed?: boolean }[] = [];
  let single: { mesh: Mesh; id: string; colour: number }[] = [];
  let owned: { dispose(): void }[] = [];
  let counts: ViewerStats = {
    bars: 0,
    instancedBars: 0,
    angledBars: 0,
    parts: 0,
    plates: 0,
    bentAngles: 0,
    placeholders: 0,
    holes: 0,
    fasteners: 0,
    edgeSegments: 0,
  };
  let selection: ReadonlySet<string> = new Set();
  let highlight: ReadonlySet<string> = new Set();
  let fitted = false;

  // ---------------------------------------------------------------------------------------------
  // The section plane (§8): local clipping on the model's materials, and an outline where it
  // crosses the model's box. The plane is one object every clipped material shares, moved in
  // place, so moving it recompiles nothing.

  let section: SectionPlane | undefined;
  const clipPlane = new THREE.Plane();
  const clipPlanes = [clipPlane];
  const outlineMaterial = new LineBasicMaterial({
    color: theme.tool,
    transparent: true,
    opacity: 0.8,
  });
  const outline = new THREE.LineLoop(new BufferGeometry(), outlineMaterial);
  outline.name = "section outline";
  outline.raycast = () => {};
  outline.visible = false;
  world.add(outline);

  /** The model's box in the world frame (Z up, mm); the empty project's metre cube. */
  function worldBox(): Box3 {
    const toWorld = world.matrixWorld.clone().invert();
    const box = new Box3();
    const b = modelBox();
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y])
        for (const z of [b.min.z, b.max.z])
          box.expandByPoint(new Vector3(x, y, z).applyMatrix4(toWorld));
    return box;
  }

  /** Every material of the model clips, or none does. */
  function clipMaterials(): void {
    const planes = section ? clipPlanes : null;
    content.traverse((o) => {
      const m = (o as { material?: THREE.Material | THREE.Material[] }).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.clippingPlanes = planes;
    });
  }

  /** Moves the plane and its outline to the section, in three's frame. */
  function placeSection(): void {
    if (!section) {
      outline.visible = false;
      return;
    }
    const i = AXIS_INDEX[section.axis];
    const n = new Vector3(0, 0, 0).setComponent(i, section.flip ? 1 : -1);
    // Kept where n·p + c ≥ 0: below at_mm, or above it when flipped.
    const c = section.flip ? -section.at_mm : section.at_mm;
    clipPlane.set(n, c).applyMatrix4(world.matrixWorld);
    // The outline: the plane's rectangle across the model's box, a little larger.
    const b = worldBox();
    const pad = Math.max(b.getSize(new Vector3()).length() * 0.02, 10);
    const [u, v] = [0, 1, 2].filter((k) => k !== i) as [number, number];
    const corners: number[] = [];
    for (const [su, sv] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const) {
      const p = new Vector3();
      p.setComponent(i, section.at_mm);
      p.setComponent(u, su === 0 ? b.min.getComponent(u) - pad : b.max.getComponent(u) + pad);
      p.setComponent(v, sv === 0 ? b.min.getComponent(v) - pad : b.max.getComponent(v) + pad);
      corners.push(p.x, p.y, p.z);
    }
    outline.geometry.setAttribute("position", new Float32BufferAttribute(corners, 3));
    outline.geometry.computeBoundingSphere();
    outline.visible = true;
  }

  /** Whether the section hides a point given in three's frame. */
  const hiddenThree = (p: Vector3) => section !== undefined && clipPlane.distanceToPoint(p) < 0;

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
      const key = `${view.section}\u0000${finishTone(bar)}`;
      const g = groups.get(key) ?? { section, sid: view.section, bars: [] };
      g.bars.push([id, bar]);
      groups.set(key, g);
    }

    // Square bars: one InstancedMesh per section and colour (§8).
    for (const g of groups.values()) {
      const unit = unitOf(g.sid, g.section);
      // White, so each instance is drawn in its own colour.
      const material = new MeshLambertMaterial();
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
        const c = theme.body[finishTone(bar)];
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
      const colour = theme.body[finishTone(bar)];
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
      color: theme.edge.colour,
      transparent: true,
      opacity: theme.edge.opacity,
    });
    const lines = new LineSegments(edgeGeometry, edgeMaterial);
    lines.name = "edges";
    lines.raycast = () => {};
    content.add(lines);
    owned.push(edgeGeometry, edgeMaterial);

    // Parts, each in its own frame (§3.2): the project's plates and bent angles from their shapes,
    // with their holes marked (§4.8); any other part as a box from its item's bounding box,
    // translucent and outlined when a placeholder; with no box, a translucent marker. Shapes and
    // places from src/mesh, as the GLB writer's (§9).
    let parts = 0;
    let plates = 0;
    let bentAngles = 0;
    let placeholders = 0;
    let holes = 0;
    /** Each hole's rod, placed in the world: the part's frame times the rod's in it. */
    const marks: { id: string; matrix: Mat4 }[] = [];
    const partEdges = new LineBasicMaterial({
      color: theme.edge.colour,
      transparent: true,
      opacity: theme.edge.opacity,
    });
    const placeholderEdges = new LineBasicMaterial({ color: theme.edge.placeholder });
    owned.push(partEdges, placeholderEdges);
    for (const [id, p] of Object.entries(m.parts)) {
      const placed = partShape(p, m.display.parts[id]);
      if (!placed) continue;
      const { shape, translucent } = placed;
      const geometry = geometryOf(partMesh(placed));
      const colour = theme.body[partTone(placed)];
      const material = new MeshLambertMaterial({
        color: colour,
        transparent: translucent,
        opacity: translucent ? theme.translucent : 1,
        depthWrite: !translucent,
        side: translucent ? DoubleSide : THREE.FrontSide,
      });
      const frame = placed.matrix;
      const mesh = new Mesh(geometry, material);
      mesh.name = id;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(frame);
      content.add(mesh);
      owned.push(geometry, material);
      single.push({ mesh, id, colour });
      parts++;

      // A shape's sharp edges, and a placeholder's box outlined (§4.8).
      if (shape || placed.placeholder) {
        const edges = new EdgesGeometry(geometry, PART_EDGE_DEG);
        const lines = new LineSegments(edges, shape ? partEdges : placeholderEdges);
        lines.name = `${id} edges`;
        lines.matrixAutoUpdate = false;
        lines.matrix.fromArray(frame);
        lines.raycast = () => {};
        content.add(lines);
        owned.push(edges);
      }
      if (placed.placeholder) placeholders++;
      if (shape) {
        if (shape.kind === "plate") plates++;
        else bentAngles++;
        holes += shape.holes.length;
        for (const mark of holeMarks(shape)) {
          marks.push({ id, matrix: mulMatrix(frame, holeMatrix(mark)) });
        }
      }
    }

    // Hole markers: one InstancedMesh, dark whatever the selection; a pick selects the part.
    if (marks.length > 0) {
      const geometry = geometryOf(rodMesh(HOLE_SEGMENTS));
      const material = new MeshLambertMaterial();
      const mesh = new InstancedMesh(geometry, material, marks.length);
      mesh.name = "holes";
      const ids: string[] = [];
      const colours: number[] = [];
      marks.forEach(({ id, matrix }, i) => {
        mesh.setMatrixAt(i, new Matrix4().fromArray(matrix));
        mesh.setColorAt(i, new Color(theme.body.hole));
        ids.push(id);
        colours.push(theme.body.hole);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
      owned.push(geometry, material, { dispose: () => mesh.dispose() });
      instanced.push({ mesh, ids, colours, fixed: true });
    }

    // Fasteners of face connections: rods from the head along the axis; a pick selects the
    // connection.
    const fs = m.display.fasteners;
    if (fs.length > 0) {
      const geometry = geometryOf(rodMesh());
      const material = new MeshLambertMaterial();
      const mesh = new InstancedMesh(geometry, material, fs.length);
      mesh.name = "fasteners";
      const ids: string[] = [];
      const colours: number[] = [];
      fs.forEach((f, i) => {
        mesh.setMatrixAt(i, new Matrix4().fromArray(fastenerMatrix(f)));
        mesh.setColorAt(i, new Color(theme.body.fastener));
        ids.push(f.connection);
        colours.push(theme.body.fastener);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
      owned.push(geometry, material, { dispose: () => mesh.dispose() });
      instanced.push({ mesh, ids, colours });
    }

    clipMaterials();
    counts = {
      bars: instancedCount + angled,
      instancedBars: instancedCount,
      angledBars: angled,
      parts,
      plates,
      bentAngles,
      placeholders,
      holes,
      fasteners: fs.length,
      edgeSegments: edges.length / 6,
    };
  }

  function paint(): void {
    const sel = new Color(theme.selection);
    const hi = new Color(theme.tool);
    const colourOf = (id: string, own: number) =>
      highlight.has(id) ? hi : selection.has(id) ? sel : new Color(own);
    for (const g of instanced) {
      if (g.fixed) continue;
      g.ids.forEach((id, i) => {
        g.mesh.setColorAt(i, colourOf(id, g.colours[i] as number));
      });
      if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
    }
    for (const s of single) {
      (s.mesh.material as MeshLambertMaterial).color.copy(colourOf(s.id, s.colour));
    }
    invalidate();
  }

  /** The model's box in three's frame, or the empty project's metre cube. */
  function modelBox(): Box3 {
    const box = new Box3();
    for (const c of content.children) if (c.name !== "edges") box.expandByObject(c);
    return box.isEmpty() ? EMPTY_BOX.clone() : box;
  }

  /** The box of some entities in three's frame: bars by their corners, parts by their meshes. */
  function boxOf(ids: ReadonlySet<string>): Box3 {
    const box = new Box3();
    if (!model) return box;
    const toThree = world.matrixWorld;
    for (const id of ids) {
      const bar = model.bars[id];
      const view = model.display.bars[id];
      const section = view ? model.display.sections[view.section] : undefined;
      if (bar && view && section) {
        for (const c of barCorners(bar, section, view))
          box.expandByPoint(new Vector3(...c).applyMatrix4(toThree));
      }
      for (const s of single) if (s.id === id && model.parts[id]) box.expandByObject(s.mesh);
    }
    return box;
  }

  /**
   * Fits a box (three's frame) looking from `from` (toward the camera; the current direction when
   * not given): every corner inside the view with a margin. camera-controls' own fitToBox turns
   * the view to the nearest axis, so an iso view would not stay iso.
   */
  function fitBox(box: Box3, animate: boolean, from?: Vector3): void {
    const target = controls.getTarget(new Vector3());
    const dir = (from ?? controls.getPosition(new Vector3()).sub(target)).clone().normalize();
    const f = dir.clone().negate();
    const up = new Vector3(0, 1, 0);
    // Straight down (or up), screen up is world +Y (three's −Z): right is +X.
    let right = f.clone().cross(up);
    right = right.lengthSq() < 1e-12 ? new Vector3(1, 0, 0) : right.normalize();
    const u = right.clone().cross(f).normalize();
    const c = box.getCenter(new Vector3());
    const corners: Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) corners.push(new Vector3(x, y, z).sub(c));
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const margin = 1.12;
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 50);
    if (camera === ortho) {
      let ex = 1;
      let ey = 1;
      for (const q of corners) {
        ex = Math.max(ex, Math.abs(q.dot(right)));
        ey = Math.max(ey, Math.abs(q.dot(u)));
      }
      const zoom = Math.min(w / (2 * ex * margin), h / (2 * ey * margin));
      const pos = c.clone().addScaledVector(dir, radius * 4 + 1000);
      void controls.setLookAt(pos.x, pos.y, pos.z, c.x, c.y, c.z, animate);
      void controls.zoomTo(zoom, animate);
    } else {
      const tanV = Math.tan(((persp.fov / 2) * Math.PI) / 180);
      const tanH = tanV * (w / h);
      // A corner at depth z beyond the centre is in view when |x| ≤ (d + z)·tan: d is the most
      // any corner asks for.
      let d = 0;
      for (const q of corners) {
        const z = q.dot(f);
        d = Math.max(
          d,
          (Math.abs(q.dot(right)) * margin) / tanH - z,
          (Math.abs(q.dot(u)) * margin) / tanV - z,
        );
      }
      d = Math.max(d, radius * 0.5);
      const pos = c.clone().addScaledVector(dir, d);
      void controls.setLookAt(pos.x, pos.y, pos.z, c.x, c.y, c.z, animate);
    }
    invalidate();
  }

  /** The iso view, fitted to the model (§8: the first model a tab draws is shown whole). */
  function fitView(): void {
    setView("iso", undefined, false);
  }

  function setView(
    name: string,
    views: Readonly<Record<string, DocView>> = {},
    animate = false,
  ): boolean {
    const named = Object.hasOwn(views, name) ? views[name] : undefined;
    if (named) {
      const p = new Vector3(...named.pos).applyMatrix4(world.matrixWorld);
      const t = new Vector3(...named.target).applyMatrix4(world.matrixWorld);
      void controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, animate);
      invalidate();
      return true;
    }
    if (!isStandard(name)) return false;
    const from = viewFrom(name);
    // World Z up to three's Y up, as the world root turns it.
    const dir = new Vector3(from[0], from[2], -from[1]).normalize();
    // Exactly down or up: lean a hair toward world −Y, so the screen's up is world +Y.
    if (Math.abs(dir.y) > 1 - 1e-9) dir.set(0, Math.sign(dir.y), 1e-6).normalize();
    fitBox(modelBox(), animate, dir);
    return true;
  }

  function setProjection(p: Projection): void {
    if ((p === "orthographic") === (camera === ortho)) return;
    const target = controls.getTarget(new Vector3());
    const pos = controls.getPosition(new Vector3());
    const dist = pos.distanceTo(target);
    const h = Math.max(container.clientHeight, 1);
    const tanHalf = Math.tan(((persp.fov / 2) * Math.PI) / 180);
    if (p === "orthographic") {
      // The same apparent size at the target: zoom is pixels per millimetre there.
      ortho.zoom = h / (2 * dist * tanHalf);
      ortho.updateProjectionMatrix();
      camera = ortho;
      controls.camera = ortho;
      controls.mouseButtons.wheel = CameraControls.ACTION.ZOOM;
      void controls.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, false);
    } else {
      const d = h / (2 * ortho.zoom * tanHalf);
      const at = pos.clone().sub(target).normalize().multiplyScalar(d).add(target);
      camera = persp;
      controls.camera = persp;
      controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
      void controls.setLookAt(at.x, at.y, at.z, target.x, target.y, target.z, false);
    }
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

  function castFrom(clientX: number, clientY: number): void {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function pickAt(clientX: number, clientY: number): { id: string; p: V3 } | undefined {
    castFrom(clientX, clientY);
    const hits = raycaster.intersectObjects(content.children as Object3D[], false);
    for (const h of hits) {
      // What the section plane hides is not there to pick: the ray goes on to what is drawn.
      if (hiddenThree(h.point)) continue;
      const g = instanced.find((x) => x.mesh === h.object);
      const s = single.find((x) => x.mesh === h.object);
      const id = g && h.instanceId !== undefined ? g.ids[h.instanceId] : s?.id;
      if (id) return { id, p: fromThree([h.point.x, h.point.y, h.point.z]) };
    }
    return undefined;
  }

  function pick(clientX: number, clientY: number): string | undefined {
    return pickAt(clientX, clientY)?.id;
  }

  function ray(clientX: number, clientY: number): Ray {
    castFrom(clientX, clientY);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    return { o: fromThree([o.x, o.y, o.z]), d: fromThree([d.x, d.y, d.z]) };
  }

  function project(p: V3): P2 | undefined {
    const v = new Vector3(...p).applyMatrix4(world.matrixWorld).project(camera);
    if (!(v.z >= -1 && v.z <= 1)) return undefined;
    const r = renderer.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
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

  let tool: ToolHandler | undefined;
  let down: { x: number; y: number; box: boolean } | undefined;
  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // A tool owns the click; Shift is its modifier (a free line), not a box.
    const box = e.shiftKey && !tool;
    down = { x: e.clientX, y: e.clientY, box };
    if (box) {
      controls.enabled = false;
      el.setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: PointerEvent) => {
    if (tool && !down && e.buttons === 0) {
      tool.move?.(e);
      return;
    }
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
    if (tool) {
      tool.click?.(e);
      return;
    }
    const id = pick(e.clientX, e.clientY);
    selectCb(id ? [id] : [], additive ? "toggle" : "replace");
  };
  const onLeave = () => tool?.leave?.();
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointerleave", onLeave);

  // ---------------------------------------------------------------------------------------------
  // Size and frames

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    persp.aspect = w / Math.max(h, 1);
    persp.updateProjectionMatrix();
    ortho.left = -w / 2;
    ortho.right = w / 2;
    ortho.top = h / 2;
    ortho.bottom = -h / 2;
    ortho.updateProjectionMatrix();
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
      // The first model is shown whole, even an empty one; later revisions keep the view.
      if (!fitted) {
        fitView();
        fitted = true;
      }
      // The outline spans the model's box, which a revision may change.
      placeSection();
    },
    setSelection(ids) {
      selection = ids;
      paint();
    },
    setHighlight(ids) {
      highlight = ids;
      paint();
    },
    onSelect(cb) {
      selectCb = cb;
    },
    setTool(t) {
      tool?.leave?.();
      tool = t;
      el.style.cursor = t ? "crosshair" : "";
    },
    setOverlay(state) {
      overlay.set(state);
      invalidate();
    },
    ray,
    project,
    pickAt,
    setView,
    setProjection,
    projection: () => (camera === ortho ? "orthographic" : "perspective"),
    fitView,
    fitSelection(ids) {
      const box = ids.size > 0 ? boxOf(ids) : modelBox();
      fitBox(box.isEmpty() ? modelBox() : box, true);
    },
    renderNow() {
      controls.update(0);
      renderer.render(scene, camera);
      dirty = false;
    },
    setSection(s) {
      const was = section !== undefined;
      section = s ? { ...s } : undefined;
      // Turning it on or off changes which materials clip; moving it only moves the plane.
      if (was !== (section !== undefined)) clipMaterials();
      placeSection();
      invalidate();
    },
    section: () => (section ? { ...section } : undefined),
    clipped: (p) => hiddenThree(new Vector3(...p).applyMatrix4(world.matrixWorld)),
    extent(axis) {
      const b = worldBox();
      const i = AXIS_INDEX[axis];
      return [b.min.getComponent(i), b.max.getComponent(i)];
    },
    stats: () => ({ ...counts }),
    // The UX redesign's methods (see the Viewer interface): no-ops until S3 builds them.
    setHover() {},
    onHover() {},
    setGhost() {},
    pulse() {},
    fitBox() {},
    setCorners() {},
    setProblemBadges() {},
    setColourBy() {},
    setTheme() {},
    onRender: () => () => {},
    setLabel() {},
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      clear();
      overlay.dispose();
      outline.geometry.dispose();
      outlineMaterial.dispose();
      for (const u of unitCache.values()) u.geometry.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      rectEl.remove();
    },
  };
}
