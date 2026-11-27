import CameraControls from "camera-controls";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  InstancedMesh,
  type Intersection,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";
import {
  angledGeometry,
  appendEdges,
  barCorners,
  sectionEdgeSets,
  sectionGeometry,
  squareEnds,
  squareMatrix,
} from "../mesh/bars.ts";
import { applyMatrix, type Mat4, type MeshData, mulMatrix } from "../mesh/data.ts";
import { HOLE_SEGMENTS, holeMarks, partMesh } from "../mesh/items.ts";
import type { BarJson, MeshInput, V3, ViewSection } from "../mesh/model.ts";
import { fastenerMatrix, holeMatrix, partShape } from "../mesh/place.ts";
import { rodMesh } from "../mesh/solids.ts";
import { finishTone, partTone } from "../mesh/style.ts";
import { Ground } from "./ground.ts";
import { Labels } from "./labels.ts";
import {
  edgeColour,
  fogColour,
  GHOST_EDGES,
  type Glyph,
  Glyphs,
  Look,
  MIX,
  mix,
  THREE_UP,
} from "./look.ts";
import { CORNER_PREFIX, MarkerLayer, type MarkerPoint } from "./markers.ts";

export { CORNER_PREFIX };

import {
  Gizmo,
  type GizmoDrag,
  type GizmoPart,
  type GizmoSpec,
  gizmoDrag,
  gizmoPartAt,
  mmPerPx,
} from "./gizmo.ts";
import { Overlay, type OverlayState } from "./overlay.ts";
import { boxTakes, hitOn, type ScreenRect } from "./pick.ts";
import type { P2, Ray } from "./snap.ts";
import type { Hex, ViewTheme } from "./theme.ts";
import { type DocView, fromThree, isStandard, viewFrom } from "./views.ts";

// camera-controls needs three's classes installed once. Only the ones it uses, as its README's
// subset: handing it three's whole namespace keeps every export of three in the bundle, since a
// bundler cannot tell which ones the namespace's reader takes (measured: 176 kB more of three,
// 793 kB against 618 kB; docs/ux/integration-decisions.md).
CameraControls.install({
  THREE: { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster },
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
  /** Edge segments drawn on bars: outline and detail together. */
  edgeSegments: number;
  /** Of them, the outline's (ends and silhouettes) and the detail's (slot lips, chambers). */
  outlineSegments: number;
  detailSegments: number;
  /** Joint markers drawn, by state. */
  joints: { joined: number; open: number; failed: number };
  /** Problem badges drawn. */
  badges: number;
}

/** What the viewer has spent drawing: frames, and CPU time in render calls and hover picks. */
export interface RenderStats {
  frames: number;
  renderMs: number;
  hovers: number;
  hoverMs: number;
  /**
   * The frame that first drew the model given last, 0 until one has: the model's programs are
   * linked by then. (A revision is the app's as soon as `setModel` takes it, before it is drawn.)
   */
  modelFrame: number;
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

/**
 * A press the app takes as a drag (an end handle, the Move tool; docs/ux/drag-ends-decisions.md),
 * asked before the camera, the tools and Select see it. A taken press turns the camera off and
 * captures the pointer until the button comes up, and makes no click.
 */
export interface Grab {
  /** Whether a press here is the grab's: a handle under the pointer, or a gesture already on. */
  press(e: ToolPointer): boolean;
  /** The pointer moved: with the button held after a taken press (`held`), or with none. */
  move(e: ToolPointer, held: boolean): void;
  /** The button came up after a taken press. */
  release(e: ToolPointer): void;
  /** While true (a gesture on), nothing hovers in Select. */
  busy(): boolean;
}

/**
 * What is under the pointer (docs/ux/editing-audit.md §7.3): the entity, where its body was hit,
 * in world coordinates, the outward normal there, and on a bar the face (a side of its placed
 * box, or an end, `a` or `b`) and the station along it, both found from the derived model, as
 * snapping finds them.
 */
export interface Hit {
  id: string;
  p: V3;
  normal: V3;
  face?: "+x" | "-x" | "+y" | "-y" | "a" | "b";
  station?: { bar: string; at_mm: number };
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

/** The camera, in world coordinates (Z up, mm): where it is, what it looks at, its screen axes. */
export interface CameraState {
  position: V3;
  target: V3;
  /** Screen right and screen up, as world directions. */
  right: V3;
  up: V3;
  /**
   * Whether the camera is on its way somewhere: from the moment a move starts (a standard view,
   * a fit, a Show; set when the call is made, before any frame) until it comes to rest. A script
   * waits for false, not for the camera to look still between two frames.
   */
  moving: boolean;
}

/**
 * The viewer's API. The methods after `stats` are the UX redesign's (docs/ux/plan.md §5.3).
 */
export interface Viewer {
  canvas: HTMLCanvasElement;
  setModel(m: MeshInput): void;
  setSelection(ids: ReadonlySet<string>): void;
  /** Entities a tool has picked (a connection's bars), drawn in the tool's colour. */
  setHighlight(ids: ReadonlySet<string>): void;
  /** Called with the entities a click or a box picked, and how they combine with the selection. */
  onSelect(cb: (ids: string[], mode: SelectMode) => void): void;
  setTool(tool: ToolHandler | undefined): void;
  /** What the active tool draws over the model. */
  setOverlay(state: OverlayState): void;
  /** The press the app takes as a drag, before the camera; undefined: none. */
  setGrab(g: Grab | undefined): void;
  /**
   * The gizmo (src/viewer/gizmo.ts): axes at a point, or grips (a selected bar's end handles),
   * drawn over every body, built once; undefined takes it away. One at a time.
   */
  setGizmo(spec: GizmoSpec | undefined): void;
  /** The gizmo shown now. */
  gizmo(): GizmoSpec | undefined;
  /**
   * Calls back while an axes gizmo's part is dragged: at the press (`start`), as the pointer
   * moves, and as it comes up (`end`), with how far along the part and, on a ring, how far
   * round. A press on a part is the gizmo's, before a grab, a tool or the camera. Returns the
   * undo. (Handles are dragged through `setGrab`.)
   */
  onGizmoDrag(cb: (e: GizmoDrag) => void): () => void;
  /** The pointer's ray in world coordinates (Z up, mm), for analytic snapping (§8). */
  ray(clientX: number, clientY: number): Ray;
  /** A world point's position on the page, in CSS pixels; undefined behind the camera. */
  project(p: V3): P2 | undefined;
  /**
   * The entity under the pointer, where its body was hit, in world coordinates, and on a bar the
   * face and station there (`Hit`). What `skip` holds (hidden entities, by id) is passed over:
   * the ray goes on to what is behind it.
   */
  pickAt(clientX: number, clientY: number, skip?: ReadonlySet<string>): Hit | undefined;
  /**
   * Calls back on a right-click that did not move (4 px or less, as a click), with what is under
   * the pointer (a joint marker as `corner:<key>`, else a body) and where; a right-drag still
   * pans. Returns the undo.
   */
  onContextMenu(cb: (hit: Hit | undefined, client: readonly [number, number]) => void): () => void;
  /** The entities hidden from the view (E-UX-9). A no-op until E2.4 builds hiding. */
  setHidden(ids: ReadonlySet<string>): void;
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
  /** Tints the bodies the pointer, a row or a chip is over (C's pale amber; D-UX-23). */
  setHover(ids: ReadonlySet<string>): void;
  /**
   * Called with what is under the pointer in Select (an entity, or `corner:<key>` on a joint
   * marker), or undefined off everything. At most once a frame, and only when it changes.
   */
  onHover(cb: (id?: string) => void): void;
  /** Ghosts every body but `keep`, sinking it toward the fog; undefined ends it. */
  setGhost(keep: ReadonlySet<string> | undefined): void;
  /** Pulses the bodies three times over a second, to draw the eye to them. */
  pulse(ids: ReadonlySet<string>): void;
  /** Fits the camera to a box in world coordinates (Z up, mm), keeping its direction. */
  fitBox(box: [V3, V3]): void;
  /** Draws a marker at each corner, by its state. */
  setCorners(c: readonly CornerMarker[]): void;
  /**
   * Whether a joined corner's marker is drawn always, or only while it is hovered or selected
   * (the default: open and failed corners always are; review m8).
   */
  setJoinedShown(all: boolean): void;
  /** Draws each problem on its entities, by group: a tinted outline and a glyph. */
  setProblemBadges(b: readonly ProblemBadge[]): void;
  /** Colours bodies by their finish (today's look) or by their item, from the swatches. */
  setColourBy(mode: "finish" | "item", swatches?: ReadonlyMap<string, number>): void;
  /** Draws with another theme's colours. */
  setTheme(t: ViewTheme): void;
  /** Calls back after each frame drawn, for DOM overlays that follow the scene; returns the undo. */
  onRender(cb: () => void): () => void;
  /** A tool's label at a world point (S5's joint preview); undefined `at` takes it away. */
  setLabel(key: string, at: V3 | undefined, text?: string): void;
  /** The camera in world coordinates: for the orientation gizmo, and for tests. */
  camera(): CameraState;
  /** What drawing has cost so far (frames, CPU ms): S3.13's measure. */
  renderStats(): RenderStats;
  dispose(): void;
}

/** What a standard view fits when the model is empty: a metre cube on the ground (three's frame). */
const EMPTY_BOX = new Box3(new Vector3(0, 0, -1000), new Vector3(1000, 1000, 0));

/** Below this angle between faces a part's edge is smooth and not drawn (degrees), as a bar's. */
const PART_EDGE_DEG = 30;

/** The detail edges fade in as a 40 mm face grows from 24 to 64 px on screen (C §5.2). */
const RAMP = { face_mm: 40, from_px: 24, to_px: 64 } as const;

/** A pulse: three beats over a second (B §5.3). */
const PULSE = { ms: 1000, beats: 3 } as const;

/** More changed bars than this, and a paint uploads a whole edge buffer, not their ranges. */
const MAX_RANGES = 64;

/** Joint markers and problem badges, CSS pixels. */
const JOINT_PX = 13;
const BADGE_PX = 16;
/** The joint glyphs drawn only while emphasised, by default (review m8). */
const JOINED_QUIET: ReadonlySet<Glyph> = new Set<Glyph>(["joined"]);

/** A mesh from src/mesh as a geometry three can draw. */
function geometryOf(d: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(d.positions, 3));
  g.setAttribute("normal", new Float32BufferAttribute(d.normals, 3));
  if (d.indices) g.setIndex(new BufferAttribute(d.indices, 1));
  return g;
}

/**
 * A geometry with no points yet, for a lasting object filled later. It has its position
 * attribute from the start: three keys a program by whether there is one, so the program the
 * viewer links before its first frame is the one the object draws with.
 */
function emptyGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([], 3));
  return g;
}

/** A body's material: Lambert (cheapest on SwiftShader), pushed back so its edges always win. */
function bodyMaterial(opts: ConstructorParameters<typeof MeshLambertMaterial>[0] = {}) {
  return new MeshLambertMaterial({
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    ...opts,
  });
}

/** Where an entity's edges sit in a merged edge buffer: first vertex and count. */
interface Range {
  start: number;
  count: number;
}

/** A merged edge buffer: positions, colours with alpha, and each bar's range. */
interface EdgeBuffer {
  lines: LineSegments;
  colours: Float32Array;
  ranges: Map<string, Range>;
}

/**
 * The 3D viewport (design §8). The world is right-handed with Z up (§2); three.js is Y up, so the
 * conversion happens here and nowhere else: everything of ours lives under `world`, rotated −90°
 * about X. It renders on demand: after a camera move, a model, a state or a resize; every frame
 * while a pulse runs. It draws with the colours of `theme` (src/viewer/theme.ts) and the look of
 * C's rendering spec (src/viewer/look.ts).
 */
export function createViewer(container: HTMLElement, initialTheme: ViewTheme): Viewer {
  let theme = initialTheme;
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // The section plane clips the model's materials only, not the grid or the tools' overlay.
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);
  const dpr = () => renderer.getPixelRatio();

  const scene = new Scene();
  const look = new Look(scene, theme);
  const world = new Group();
  world.name = "world (Z up)";
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  const ground = new Ground(theme);
  world.add(ground.group);

  const content = new Group();
  content.name = "model";
  world.add(content);
  const glyphs = new Glyphs(theme.overlay.ring);
  const overlay = new Overlay(theme, glyphs, dpr);
  world.add(overlay.group);
  const gizmo = new Gizmo(theme, glyphs, dpr);
  world.add(gizmo.group);
  const joints = new MarkerLayer("joints", glyphs, JOINT_PX, dpr, 900);
  // Joined corners are drawn while hovered or selected, until the view asks for every one (m8).
  joints.setQuiet(JOINED_QUIET);
  const badges = new MarkerLayer("badges", glyphs, BADGE_PX, dpr, 910);
  world.add(joints.group, badges.group);
  world.updateMatrixWorld(true);

  const persp = new PerspectiveCamera(45, 1, 5, 200_000);
  persp.position.set(2000, 1500, 2000);
  // Frustum in CSS pixels at zoom 1, set on resize; a negative near keeps the whole model in
  // front of an orthographic camera wherever it orbits.
  const ortho = new OrthographicCamera(-1, 1, 1, -1, -200_000, 200_000);
  let camera: PerspectiveCamera | OrthographicCamera = persp;
  const controls = new CameraControls(camera, renderer.domElement);
  controls.setTarget(0, 0, 0, false);
  /**
   * Whether the camera has stopped changing. camera-controls' `active` turns false only when an
   * eased move comes to rest: after a move made at once (a fit when the first model comes, a
   * change of projection) it stays true, though nothing moves (**read**: its `update` checks for
   * rest only between two frames that both changed). Its `sleep` event, the first frame that
   * changes nothing, says so; `transitionstart`, sent when an eased move is asked for, and
   * `wake`, the first frame that changes, end it.
   */
  let asleep = true;
  controls.addEventListener("transitionstart", () => {
    asleep = false;
  });
  controls.addEventListener("wake", () => {
    asleep = false;
  });
  controls.addEventListener("sleep", () => {
    asleep = true;
  });

  let dirty = true;
  const invalidate = () => {
    dirty = true;
  };

  // ---------------------------------------------------------------------------------------------
  // The model

  /** Unit extrusions and their edges, kept across revisions while a section stays the same. */
  const unitCache = new Map<
    string,
    {
      key: string;
      section: ViewSection;
      geometry: BufferGeometry;
      outline: Float32Array;
      detail: Float32Array;
    }
  >();
  const unitOf = (id: string, s: ViewSection) => {
    const key = JSON.stringify(s);
    const hit = unitCache.get(id);
    if (hit?.key === key) return hit;
    hit?.geometry.dispose();
    const geometry = sectionGeometry(s);
    const { outline, detail } = sectionEdgeSets(s);
    const entry = { key, section: s, geometry, outline, detail };
    unitCache.set(id, entry);
    return entry;
  };

  let model: MeshInput | undefined;
  /**
   * Per drawable: which entity it is, its item, its own colour and how it recolours. A `fixed`
   * group keeps its colours when selected (holes stay dark on a selected plate) but still picks
   * its entity.
   */
  interface Instanced {
    mesh: InstancedMesh;
    ids: string[];
    items: string[];
    tones: Hex[];
    fixed?: boolean;
    shown: Hex[];
  }
  interface Single {
    mesh: Mesh;
    id: string;
    item: string;
    tone: Hex;
    /** The cut faces' material, on a bar with an angled end. */
    cap?: MeshLambertMaterial;
    edges?: LineSegments;
    shown?: Hex;
    shownEdge?: string;
  }
  let instanced: Instanced[] = [];
  let single: Single[] = [];
  /**
   * What the model in the scene owns on the GPU, and whether a frame has drawn it yet. A
   * revision's build does not dispose the generation it replaces: that generation's materials
   * hold their shader programs, and three.js deletes a program when the last material using it
   * goes. The new generation's materials, alike, find their programs in the cache on its first
   * frame; only then is the old one disposed (`retired`). Disposing first made every revision
   * compile its programs again (six on the cart): on SwiftShader that blocks the revision's frame
   * for up to a second, waiting on the links.
   */
  let owned: { dispose(): void }[] = [];
  let ownedDrawn = false;
  let retired: { dispose(): void }[] = [];
  const release = (list: readonly { dispose(): void }[]) => {
    for (const o of list) o.dispose();
  };
  let outline: EdgeBuffer | undefined;
  let detail: EdgeBuffer | undefined;
  /** Each bar's own colour, as painted last (its edges follow its lightness). */
  const barTone = new Map<string, Hex>();
  const edgeState = new Map<string, string>();
  const capMaterial = bodyMaterial();
  const sideMaterial = bodyMaterial();
  const detailMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true });
  const outlineMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true });
  const xrayMaterial = new LineBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const xray = new LineSegments(emptyGeometry(), xrayMaterial);
  xray.name = "selection x-ray";
  xray.renderOrder = 800;
  xray.raycast = () => {};
  xray.frustumCulled = false;
  world.add(xray);

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
    outlineSegments: 0,
    detailSegments: 0,
    joints: { joined: 0, open: 0, failed: 0 },
    badges: 0,
  };
  let selection: ReadonlySet<string> = new Set();
  let highlight: ReadonlySet<string> = new Set();
  let hovered: ReadonlySet<string> = new Set();
  let ghost: ReadonlySet<string> | undefined;
  let pulsing: { ids: ReadonlySet<string>; start: number } | undefined;
  let colourBy: { mode: "finish" | "item"; swatches: ReadonlyMap<string, number> } = {
    mode: "finish",
    swatches: new Map(),
  };
  let badgeOf = new Map<string, ProblemBadge["severity"]>();
  let corners: readonly CornerMarker[] = [];
  let badgeList: readonly ProblemBadge[] = [];
  let fitted = false;
  /** The model's bounding sphere's radius (mm), cached per revision for the fog. */
  let radius = 1000;
  const stats: RenderStats = { frames: 0, renderMs: 0, hovers: 0, hoverMs: 0, modelFrame: 0 };

  const applyThemeMaterials = () => {
    capMaterial.color.setRGB(...theme.cut);
    xrayMaterial.color.setHex(theme.selection);
    xrayMaterial.opacity = theme.edge.xray;
  };
  applyThemeMaterials();

  // ---------------------------------------------------------------------------------------------
  // The section plane (§8): local clipping on the model's materials, and an outline where it
  // crosses the model's box. The plane is one object every clipped material shares, moved in
  // place, so moving it recompiles nothing.

  let section: SectionPlane | undefined;
  const clipPlane = new Plane();
  const clipPlanes = [clipPlane];
  const sectionMaterial = new LineBasicMaterial({
    color: theme.tool,
    transparent: true,
    opacity: 0.8,
    fog: false,
  });
  const sectionLine = new LineLoop(emptyGeometry(), sectionMaterial);
  sectionLine.name = "section outline";
  sectionLine.raycast = () => {};
  sectionLine.visible = false;
  world.add(sectionLine);

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

  /** Every material of the model clips, and the markers and the x-ray with it, or none does. */
  function clipMaterials(): void {
    const planes = section ? clipPlanes : null;
    content.traverse((o) => {
      const m = (o as { material?: Material | Material[] }).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.clippingPlanes = planes;
    });
    for (const m of [capMaterial, sideMaterial, outlineMaterial, detailMaterial, xrayMaterial]) {
      m.clippingPlanes = planes;
    }
    joints.setClipping(planes);
    badges.setClipping(planes);
  }

  /** Moves the plane and its outline to the section, in three's frame. */
  function placeSection(): void {
    if (!section) {
      sectionLine.visible = false;
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
    const pts: number[] = [];
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
      pts.push(p.x, p.y, p.z);
    }
    sectionLine.geometry.setAttribute("position", new Float32BufferAttribute(pts, 3));
    sectionLine.geometry.computeBoundingSphere();
    sectionLine.visible = true;
  }

  /** Whether the section hides a point given in three's frame. */
  const hiddenThree = (p: Vector3) => section !== undefined && clipPlane.distanceToPoint(p) < 0;
  const hiddenWorld = (p: V3) => hiddenThree(new Vector3(...p).applyMatrix4(world.matrixWorld));

  function clear(): void {
    for (const c of [...content.children]) content.remove(c);
    // A drawn generation waits for the next frame (it holds the programs); one never drawn holds
    // none, so it goes now, and at most one generation waits.
    if (ownedDrawn) {
      release(retired);
      retired = owned;
    } else release(owned);
    owned = [];
    ownedDrawn = false;
    stats.modelFrame = 0;
    instanced = [];
    single = [];
    outline = undefined;
    detail = undefined;
    barTone.clear();
    edgeState.clear();
  }

  /** One merged edge buffer of every bar's edges of one kind, with each bar's range. */
  function edgeBuffer(
    m: MeshInput,
    drawable: readonly [string, BarJson, string][],
    which: "outline" | "detail",
    material: LineBasicMaterial,
  ): EdgeBuffer {
    let floats = 0;
    for (const [, , sid] of drawable) {
      floats += unitOf(sid, m.display.sections[sid] as ViewSection)[which].length;
    }
    const positions = new Float32Array(floats);
    const ranges = new Map<string, Range>();
    let at = 0;
    for (const [id, bar, sid] of drawable) {
      const view = m.display.bars[id] as NonNullable<MeshInput["display"]["bars"][string]>;
      const start = at / 3;
      at = appendEdges(
        unitOf(sid, m.display.sections[sid] as ViewSection)[which],
        bar,
        view,
        positions,
        at,
      );
      ranges.set(id, { start, count: at / 3 - start });
    }
    const colours = new Float32Array((positions.length / 3) * 4);
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new Float32BufferAttribute(colours, 4));
    const lines = new LineSegments(g, material);
    lines.name = which;
    lines.raycast = () => {};
    content.add(lines);
    owned.push(g);
    return {
      lines,
      colours: (g.getAttribute("color") as BufferAttribute).array as Float32Array,
      ranges,
    };
  }

  function build(m: MeshInput): void {
    clear();
    const groups = new Map<string, { sid: string; bars: [string, BarJson][] }>();
    let angled = 0;
    let instancedCount = 0;
    const drawable: [string, BarJson, string][] = [];
    for (const [id, bar] of Object.entries(m.bars)) {
      const view = m.display.bars[id];
      const section = view ? m.display.sections[view.section] : undefined;
      if (!view || !section) continue;
      drawable.push([id, bar, view.section]);
      unitOf(view.section, section);
      if (!squareEnds(bar)) continue;
      const g = groups.get(view.section) ?? { sid: view.section, bars: [] };
      g.bars.push([id, bar]);
      groups.set(view.section, g);
    }

    // Square bars: one InstancedMesh per section (§8), each instance in its own colour; the
    // ends (the extrusion's first group) a shade brighter than the sides.
    for (const g of groups.values()) {
      const unit = unitOf(g.sid, m.display.sections[g.sid] as ViewSection);
      const mesh = new InstancedMesh(unit.geometry, [capMaterial, sideMaterial], g.bars.length);
      mesh.name = `bars ${g.sid}`;
      const ids: string[] = [];
      const items: string[] = [];
      const tones: Hex[] = [];
      g.bars.forEach(([id, bar], i) => {
        mesh.setMatrixAt(
          i,
          squareMatrix(
            bar,
            m.display.bars[id] as NonNullable<MeshInput["display"]["bars"][string]>,
          ),
        );
        mesh.setColorAt(i, new Color(theme.body[finishTone(bar)]));
        ids.push(id);
        items.push(bar.item);
        tones.push(theme.body[finishTone(bar)]);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
      owned.push({ dispose: () => mesh.dispose() });
      instanced.push({ mesh, ids, items, tones, shown: tones.map(() => -1) });
      instancedCount += g.bars.length;
    }

    // Angled bars: their own geometry, exact on their end planes, with the same two groups.
    for (const [id, bar, sid] of drawable) {
      if (squareEnds(bar)) continue;
      const view = m.display.bars[id] as NonNullable<MeshInput["display"]["bars"][string]>;
      const unit = unitOf(sid, m.display.sections[sid] as ViewSection);
      const geometry = angledGeometry(unit.geometry, bar, view);
      const tone = theme.body[finishTone(bar)];
      const cap = bodyMaterial();
      const side = bodyMaterial();
      const mesh = new Mesh(geometry, [cap, side]);
      mesh.name = id;
      content.add(mesh);
      owned.push(geometry, cap, side);
      single.push({ mesh, id, item: bar.item, tone, cap });
      angled++;
    }

    // Edges: two merged buffers for every bar, the outline and the detail (C §5.2).
    outline = edgeBuffer(m, drawable, "outline", outlineMaterial);
    detail = edgeBuffer(m, drawable, "detail", detailMaterial);

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
    for (const [id, p] of Object.entries(m.parts)) {
      const placed = partShape(p, m.display.parts[id]);
      if (!placed) continue;
      const { shape, translucent } = placed;
      const geometry = geometryOf(partMesh(placed));
      const tone = theme.body[partTone(placed)];
      const material = bodyMaterial({
        color: tone,
        transparent: translucent,
        opacity: translucent ? theme.translucent : 1,
        depthWrite: !translucent,
        side: translucent ? DoubleSide : FrontSide,
      });
      const frame = placed.matrix;
      const mesh = new Mesh(geometry, material);
      mesh.name = id;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(frame);
      content.add(mesh);
      owned.push(geometry, material);
      const entry: Single = { mesh, id, item: p.item, tone };
      single.push(entry);
      parts++;

      // A shape's sharp edges, and a placeholder's box outlined (§4.8).
      if (shape || placed.placeholder) {
        const edges = new EdgesGeometry(geometry, PART_EDGE_DEG);
        const lineMaterial = new LineBasicMaterial({ transparent: true });
        const lines = new LineSegments(edges, lineMaterial);
        lines.name = `${id} edges`;
        lines.matrixAutoUpdate = false;
        lines.matrix.fromArray(frame);
        lines.raycast = () => {};
        lines.userData.placeholder = !shape;
        content.add(lines);
        owned.push(edges, lineMaterial);
        entry.edges = lines;
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
      const material = bodyMaterial();
      const mesh = new InstancedMesh(geometry, material, marks.length);
      mesh.name = "holes";
      const ids: string[] = [];
      marks.forEach(({ id, matrix }, i) => {
        mesh.setMatrixAt(i, new Matrix4().fromArray(matrix));
        mesh.setColorAt(i, new Color(theme.body.hole));
        ids.push(id);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
      owned.push(geometry, material, { dispose: () => mesh.dispose() });
      instanced.push({
        mesh,
        ids,
        items: ids.map(() => ""),
        tones: ids.map(() => theme.body.hole),
        fixed: true,
        shown: ids.map(() => -1),
      });
    }

    // Fasteners of face connections: rods from the head along the axis; a pick selects the
    // connection.
    const fs = m.display.fasteners;
    if (fs.length > 0) {
      const geometry = geometryOf(rodMesh());
      const material = bodyMaterial();
      const mesh = new InstancedMesh(geometry, material, fs.length);
      mesh.name = "fasteners";
      const ids: string[] = [];
      fs.forEach((f, i) => {
        mesh.setMatrixAt(i, new Matrix4().fromArray(fastenerMatrix(f)));
        mesh.setColorAt(i, new Color(theme.body.fastener));
        ids.push(f.connection);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
      owned.push(geometry, material, { dispose: () => mesh.dispose() });
      instanced.push({
        mesh,
        ids,
        items: fs.map((f) => f.item),
        tones: ids.map(() => theme.body.fastener),
        shown: ids.map(() => -1),
      });
    }

    clipMaterials();
    const segs = (b: EdgeBuffer | undefined) =>
      b ? (b.lines.geometry.getAttribute("position") as BufferAttribute).count / 2 : 0;
    counts = {
      ...counts,
      bars: instancedCount + angled,
      instancedBars: instancedCount,
      angledBars: angled,
      parts,
      plates,
      bentAngles,
      placeholders,
      holes,
      fasteners: fs.length,
      outlineSegments: segs(outline),
      detailSegments: segs(detail),
      edgeSegments: segs(outline) + segs(detail),
    };

    // What depends on the model's size: the fog's depth, the ground, the markers' lift.
    const sphere = modelBox().getBoundingSphere(new Sphere());
    radius = Math.max(sphere.radius, 200);
    const wb = worldBox();
    ground.fit({ x0: wb.min.x, y0: wb.min.y, x1: wb.max.x, y1: wb.max.y });
    let lift = 40;
    for (const s of Object.values(m.display.sections)) {
      const [[x0, y0], [x1, y1]] = s.bbox;
      lift = Math.max(lift, Math.hypot(x1 - x0, y1 - y0) + 10);
    }
    joints.setLift(lift);
    badges.setLift(lift);
  }

  // ---------------------------------------------------------------------------------------------
  // Painting: every body's colour and every bar's edges, from the states (C §5.3)

  /** A body's own colour: its finish's or part's tone, or its item's swatch. */
  const toneOf = (tone: Hex, item: string): Hex =>
    colourBy.mode === "item" && item !== ""
      ? (colourBy.swatches.get(item) ?? theme.body.neutral)
      : tone;

  /** How far into a pulse the time is, 0 (rest) to 1 (peak). */
  const pulseAt = (now: number): number => {
    if (!pulsing) return 0;
    const t = (now - pulsing.start) / PULSE.ms;
    if (t >= 1) return 0;
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * PULSE.beats * t);
  };

  /** A body's colour now, from its own and the states. */
  function shade(id: string, own: Hex, fixed: boolean, beat: number): Hex {
    if (fixed) return ghost && !ghost.has(id) ? mix(own, fogColour(theme), MIX.ghost) : own;
    if (highlight.has(id)) return theme.tool;
    let c = own;
    if (selection.has(id)) c = mix(own, theme.selection, MIX.selected);
    else if (hovered.has(id)) c = mix(own, theme.hover, MIX.hover);
    else if (ghost && !ghost.has(id)) c = mix(own, fogColour(theme), MIX.ghost);
    if (beat > 0 && pulsing?.ids.has(id)) c = mix(c, theme.hover, 0.65 * beat);
    return c;
  }

  /** An entity's edges now: colour and alpha for its outline, alpha for its detail. */
  function edgeLook(id: string, body: Hex): { colour: Hex; outline: number; detail: number } {
    const ghosted = ghost !== undefined && !ghost.has(id) && !selection.has(id);
    // Only what blocks or errs outlines its bar, in red; a warning keeps its triangle badge and
    // leaves the amber band to the selection, which its outline was read as (review m1).
    const badge = badgeOf.get(id);
    const red = badge !== undefined && badge !== "warn";
    const colour = selection.has(id)
      ? theme.edge.selected
      : red
        ? theme.status.blocked
        : edgeColour(theme, body);
    return {
      colour,
      outline: ghosted ? GHOST_EDGES.outline : red ? 1 : theme.edge.outline,
      detail: ghosted ? GHOST_EDGES.detail / theme.edge.detail : 1,
    };
  }

  function writeRange(b: EdgeBuffer, id: string, colour: Hex, alpha: number): Range | undefined {
    const r = b.ranges.get(id);
    if (!r || r.count === 0) return undefined;
    const c = new Color(colour);
    for (let v = r.start; v < r.start + r.count; v++) {
      b.colours[v * 4] = c.r;
      b.colours[v * 4 + 1] = c.g;
      b.colours[v * 4 + 2] = c.b;
      b.colours[v * 4 + 3] = alpha;
    }
    return r;
  }

  /** Uploads what changed: a few bars' ranges alone, or the whole buffer when many changed. */
  function upload(b: EdgeBuffer, ranges: readonly Range[]): void {
    if (ranges.length === 0) return;
    const attr = b.lines.geometry.getAttribute("color") as BufferAttribute;
    attr.clearUpdateRanges();
    if (ranges.length <= MAX_RANGES)
      for (const r of ranges) attr.addUpdateRange(r.start * 4, r.count * 4);
    attr.needsUpdate = true;
  }

  function paint(now = performance.now()): void {
    const beat = pulseAt(now);
    for (const g of instanced) {
      let changed = false;
      g.ids.forEach((id, i) => {
        const own = g.fixed ? (g.tones[i] as Hex) : toneOf(g.tones[i] as Hex, g.items[i] as string);
        const c = shade(id, own, g.fixed === true, beat);
        if (g.shown[i] === c) return;
        g.shown[i] = c;
        g.mesh.setColorAt(i, new Color(c));
        changed = true;
        if (!g.fixed && model?.bars[id]) barTone.set(id, own);
      });
      if (changed && g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
    }
    for (const s of single) {
      const own = toneOf(s.tone, s.item);
      const c = shade(s.id, own, false, beat);
      if (model?.bars[s.id]) barTone.set(s.id, own);
      if (s.shown !== c) {
        s.shown = c;
        const mats = Array.isArray(s.mesh.material) ? s.mesh.material : [s.mesh.material];
        const side = mats[mats.length - 1] as MeshLambertMaterial;
        side.color.setHex(c);
        if (s.cap) s.cap.color.setHex(c).multiply(new Color().setRGB(...theme.cut));
      }
      if (s.edges) {
        const e = edgeLook(s.id, own);
        const key = `${e.colour}/${e.outline}`;
        if (s.shownEdge !== key) {
          s.shownEdge = key;
          const mat = s.edges.material as LineBasicMaterial;
          mat.color.setHex(s.edges.userData.placeholder ? theme.edge.placeholder : e.colour);
          mat.opacity = s.edges.userData.placeholder && !selection.has(s.id) ? 1 : e.outline;
        }
      }
    }
    if (outline && detail) {
      const changed: { outline: Range[]; detail: Range[] } = { outline: [], detail: [] };
      for (const [id, own] of barTone) {
        const e = edgeLook(id, own);
        const key = `${e.colour}/${e.outline}/${e.detail}`;
        if (edgeState.get(id) === key) continue;
        edgeState.set(id, key);
        const o = writeRange(outline, id, e.colour, e.outline);
        const d = writeRange(detail, id, e.colour, e.detail);
        if (o) changed.outline.push(o);
        if (d) changed.detail.push(d);
      }
      upload(outline, changed.outline);
      upload(detail, changed.detail);
    }
    invalidate();
  }

  /** The selection's outline again, on top of everything, faint: where it continues, hidden. */
  function buildXray(): void {
    const pts: number[] = [];
    if (outline) {
      const pos = (outline.lines.geometry.getAttribute("position") as BufferAttribute)
        .array as Float32Array;
      for (const id of selection) {
        const r = outline.ranges.get(id);
        if (r)
          for (let k = r.start * 3; k < (r.start + r.count) * 3; k++) pts.push(pos[k] as number);
      }
    }
    for (const s of single) {
      if (!selection.has(s.id) || !s.edges) continue;
      const pos = (s.edges.geometry.getAttribute("position") as BufferAttribute)
        .array as ArrayLike<number>;
      const frame = s.mesh.matrix.elements;
      for (let k = 0; k < pos.length; k += 3) {
        pts.push(
          ...applyMatrix(frame, [pos[k] as number, pos[k + 1] as number, pos[k + 2] as number]),
        );
      }
    }
    xray.geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    xray.geometry = g;
    xray.visible = pts.length > 0;
  }

  /** The model's box in three's frame, or the empty project's metre cube. */
  function modelBox(): Box3 {
    const box = new Box3();
    for (const c of content.children) if (!(c instanceof LineSegments)) box.expandByObject(c);
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
  function fitThreeBox(box: Box3, animate: boolean, from?: Vector3): void {
    const target = controls.getTarget(new Vector3());
    const dir = (from ?? controls.getPosition(new Vector3()).sub(target)).clone().normalize();
    const f = dir.clone().negate();
    const up = new Vector3(0, 1, 0);
    // Straight down (or up), screen up is world +Y (three's −Z): right is +X.
    let right = f.clone().cross(up);
    right = right.lengthSq() < 1e-12 ? new Vector3(1, 0, 0) : right.normalize();
    const u = right.clone().cross(f).normalize();
    const c = box.getCenter(new Vector3());
    const pts: Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) pts.push(new Vector3(x, y, z).sub(c));
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const margin = 1.12;
    const r = Math.max(box.getSize(new Vector3()).length() / 2, 50);
    if (camera === ortho) {
      let ex = 1;
      let ey = 1;
      for (const q of pts) {
        ex = Math.max(ex, Math.abs(q.dot(right)));
        ey = Math.max(ey, Math.abs(q.dot(u)));
      }
      const zoom = Math.min(w / (2 * ex * margin), h / (2 * ey * margin));
      const pos = c.clone().addScaledVector(dir, r * 4 + 1000);
      void controls.setLookAt(pos.x, pos.y, pos.z, c.x, c.y, c.z, animate);
      void controls.zoomTo(zoom, animate);
    } else {
      const tanV = Math.tan(((persp.fov / 2) * Math.PI) / 180);
      const tanH = tanV * (w / h);
      // A corner at depth z beyond the centre is in view when |x| ≤ (d + z)·tan: d is the most
      // any corner asks for.
      let d = 0;
      for (const q of pts) {
        const z = q.dot(f);
        d = Math.max(
          d,
          (Math.abs(q.dot(right)) * margin) / tanH - z,
          (Math.abs(q.dot(u)) * margin) / tanV - z,
        );
      }
      d = Math.max(d, r * 0.5);
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
    fitThreeBox(modelBox(), animate, dir);
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
  // Picking: click, hover, and box select with Shift held

  let selectCb: (ids: string[], mode: SelectMode) => void = () => {};
  let hoverCb: (id?: string) => void = () => {};
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const rectEl = document.createElement("div");
  rectEl.className = "select-box";
  rectEl.hidden = true;
  container.appendChild(rectEl);
  const labels = new Labels(container, (p) => project(p));

  function castFrom(clientX: number, clientY: number): void {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  const instanceMatrix = new Matrix4();
  /** A raycast's face normal in the world (Z up): through the instance's and the object's matrix. */
  function worldNormal(h: Intersection): V3 {
    const n = h.face?.normal.clone() ?? new Vector3(0, 1, 0);
    const m = h.object.matrixWorld.clone();
    if (h.object instanceof InstancedMesh && h.instanceId !== undefined) {
      h.object.getMatrixAt(h.instanceId, instanceMatrix);
      m.multiply(instanceMatrix);
    }
    n.transformDirection(m);
    return fromThree([n.x, n.y, n.z]);
  }

  function pickAt(clientX: number, clientY: number, skip?: ReadonlySet<string>): Hit | undefined {
    castFrom(clientX, clientY);
    const hits = raycaster.intersectObjects(content.children as Object3D[], false);
    for (const h of hits) {
      // What the section plane hides is not there to pick: the ray goes on to what is drawn.
      if (hiddenThree(h.point)) continue;
      const g = instanced.find((x) => x.mesh === h.object);
      const s = single.find((x) => x.mesh === h.object);
      const id = g && h.instanceId !== undefined ? g.ids[h.instanceId] : s?.id;
      if (!id || skip?.has(id)) continue;
      const r = raycaster.ray;
      const ray: Ray = {
        o: fromThree([r.origin.x, r.origin.y, r.origin.z]),
        d: fromThree([r.direction.x, r.direction.y, r.direction.z]),
      };
      const p = fromThree([h.point.x, h.point.y, h.point.z]);
      return hitOn(model?.bars ?? {}, id, ray, p, worldNormal(h));
    }
    return undefined;
  }

  /** What a click or a hover in Select takes: a joint marker first, else a body. */
  function pick(clientX: number, clientY: number): string | undefined {
    const corner = joints.pickAt(clientX, clientY, project, hiddenWorld);
    if (corner !== undefined) return `${CORNER_PREFIX}${corner}`;
    return pickAt(clientX, clientY)?.id;
  }

  /** What a right-click is on: a joint marker, facing the camera, else a body. */
  function hitUnder(clientX: number, clientY: number): Hit | undefined {
    const corner = joints.pickAt(clientX, clientY, project, hiddenWorld);
    const at = corner !== undefined ? corners.find((c) => c.key === corner)?.at : undefined;
    if (corner === undefined || !at) return pickAt(clientX, clientY);
    const d = ray(clientX, clientY).d;
    return { id: `${CORNER_PREFIX}${corner}`, p: at, normal: [-d[0], -d[1], -d[2]] };
  }

  const menuCbs = new Set<(hit: Hit | undefined, client: readonly [number, number]) => void>();

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

  /**
   * What a box drawn on the screen takes (E-UX-10): as a window, the entities whose body lies
   * wholly inside it; as a crossing, those whose body's outline touches it (`boxTakes`). A body
   * with a corner behind the camera is never wholly inside; a crossing reads the corners in front.
   */
  function boxed(rect: ScreenRect, mode: "window" | "crossing"): string[] {
    if (!model) return [];
    const r = renderer.domElement.getBoundingClientRect();
    const toWorld = world.matrixWorld;
    const v = new Vector3();
    const within = (pts: readonly (readonly [number, number, number])[]) => {
      const seen: P2[] = [];
      let behind = false;
      for (const [a, b, c] of pts) {
        v.set(a, b, c).applyMatrix4(toWorld).project(camera);
        if (v.z < -1 || v.z > 1) behind = true;
        else seen.push([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
      }
      return mode === "window" && behind ? false : boxTakes(seen, rect, mode);
    };
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
      const pts: [number, number, number][] = [];
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z]) {
            const p = new Vector3(x, y, z).applyMatrix4(s.mesh.matrix);
            pts.push([p.x, p.y, p.z]);
          }
      if (within(pts)) out.push(s.id);
    }
    return out;
  }

  let tool: ToolHandler | undefined;
  let grab: Grab | undefined;
  /** A press the grab took: until the button comes up, the pointer is the grab's alone. */
  let grabbing = false;
  let down: { x: number; y: number; box: boolean } | undefined;
  /** The pointer to hover-pick at the next frame, in Select with no button held. */
  let hoverAt: { x: number; y: number } | undefined;
  let hoverId: string | undefined;
  const reportHover = (id: string | undefined) => {
    if (id === hoverId) return;
    hoverId = id;
    hoverCb(id);
  };
  /** A right press, until it comes up: a click there opens the context menu, a drag pans. */
  let rightDown: { x: number; y: number } | undefined;
  /** An axes gizmo's part being dragged: which, through which point, and the press's ray. */
  let gizmoDragging: { part: GizmoPart; at: V3; from: Ray } | undefined;
  const gizmoCbs = new Set<(e: GizmoDrag) => void>();
  /** Millimetres per CSS pixel at a world point (Z up), as the camera sees it now. */
  function mmPerPxAt(at: V3): number {
    if (camera === ortho) return mmPerPx({ perspective: false, zoom: ortho.zoom }, at, 1);
    const p = new Vector3(...at).applyMatrix4(world.matrixWorld);
    const f = persp.getWorldDirection(new Vector3());
    return mmPerPx(
      {
        perspective: true,
        eye: [persp.position.x, persp.position.y, persp.position.z],
        forward: [f.x, f.y, f.z],
        fovDeg: persp.fov,
      },
      [p.x, p.y, p.z],
      container.clientHeight,
    );
  }
  /** The axes gizmo's part under the pointer, if one is shown there. */
  function gizmoPartUnder(clientX: number, clientY: number): GizmoPart | undefined {
    const g = gizmo.shown();
    if (!g || !("parts" in g)) return undefined;
    return gizmoPartAt(g, {
      at: [clientX, clientY],
      ray: ray(clientX, clientY),
      project,
      mmPerPx: mmPerPxAt(g.at),
    });
  }
  function emitGizmo(phase: GizmoDrag["phase"], e: { clientX: number; clientY: number }): void {
    const d = gizmoDragging;
    if (!d) return;
    const r = gizmoDrag(d.part, d.at, d.from, ray(e.clientX, e.clientY));
    for (const cb of gizmoCbs) cb({ part: d.part, phase, ...r });
  }
  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => {
    if (e.button === 2) {
      rightDown = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    // A gizmo's part under the pointer is what the press is on, before anything else.
    const part = gizmoPartUnder(e.clientX, e.clientY);
    const shown = gizmo.shown();
    if (part && shown && "parts" in shown) {
      gizmoDragging = { part, at: shown.at, from: ray(e.clientX, e.clientY) };
      down = undefined;
      controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      emitGizmo("start", e);
      invalidate();
      return;
    }
    // A drag the app takes (a handle, Move) goes first: the camera lets go of this press.
    if (grab?.press(e)) {
      grabbing = true;
      down = undefined;
      controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      hoverAt = undefined;
      reportHover(undefined);
      invalidate();
      return;
    }
    // A tool owns the click; Shift is its modifier (a free line), not a box.
    const box = e.shiftKey && !tool;
    down = { x: e.clientX, y: e.clientY, box };
    if (box) {
      controls.enabled = false;
      el.setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: PointerEvent) => {
    if (gizmoDragging) {
      emitGizmo("move", e);
      invalidate();
      return;
    }
    // The part a press would take is drawn lit.
    if (e.buttons === 0 && gizmo.setHover(gizmoPartUnder(e.clientX, e.clientY))) invalidate();
    if (grabbing) {
      grab?.move(e, true);
      invalidate();
      return;
    }
    if (grab && e.buttons === 0) {
      grab.move(e, false);
      invalidate();
      if (grab.busy()) {
        hoverAt = undefined;
        reportHover(undefined);
        return;
      }
    }
    if (tool && !down && e.buttons === 0) {
      tool.move?.(e);
      return;
    }
    if (!tool && e.buttons === 0) hoverAt = { x: e.clientX, y: e.clientY };
    // Dragging the camera or a box: nothing is under the pointer for long, so nothing hovers.
    if (!tool && e.buttons !== 0) {
      hoverAt = undefined;
      reportHover(undefined);
    }
    if (!down?.box) return;
    const cr = container.getBoundingClientRect();
    rectEl.hidden = false;
    // Right to left is a crossing, drawn dashed; left to right a window, drawn solid (E-UX-10).
    rectEl.classList.toggle("crossing", e.clientX < down.x);
    rectEl.style.left = `${Math.min(down.x, e.clientX) - cr.left}px`;
    rectEl.style.top = `${Math.min(down.y, e.clientY) - cr.top}px`;
    rectEl.style.width = `${Math.abs(e.clientX - down.x)}px`;
    rectEl.style.height = `${Math.abs(e.clientY - down.y)}px`;
  };
  const onUp = (e: PointerEvent) => {
    if (e.button === 2) {
      const r = rightDown;
      rightDown = undefined;
      // The same click threshold as a left click (E-UX-2): a right-drag panned the camera.
      if (r && Math.hypot(e.clientX - r.x, e.clientY - r.y) <= 4 && menuCbs.size > 0) {
        const hit = hitUnder(e.clientX, e.clientY);
        for (const cb of menuCbs) cb(hit, [e.clientX, e.clientY]);
      }
      return;
    }
    if (gizmoDragging) {
      emitGizmo("end", e);
      gizmoDragging = undefined;
      controls.enabled = true;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      invalidate();
      return;
    }
    if (grabbing) {
      grabbing = false;
      controls.enabled = true;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      grab?.release(e);
      invalidate();
      return;
    }
    if (!down) return;
    const d = down;
    down = undefined;
    // Pick again where the drag ended, without waiting for the pointer to move.
    if (!tool) hoverAt = { x: e.clientX, y: e.clientY };
    const additive = e.ctrlKey || e.metaKey;
    if (d.box) {
      rectEl.hidden = true;
      controls.enabled = true;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) {
        const ids = boxed(
          {
            x0: Math.min(d.x, e.clientX),
            y0: Math.min(d.y, e.clientY),
            x1: Math.max(d.x, e.clientX),
            y1: Math.max(d.y, e.clientY),
          },
          e.clientX < d.x ? "crossing" : "window",
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
  const onLeave = () => {
    tool?.leave?.();
    hoverAt = undefined;
    reportHover(undefined);
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointerleave", onLeave);

  // ---------------------------------------------------------------------------------------------
  // Markers: the joints and the problem badges

  const JOINT_GLYPH = { joined: "joined", open: "open", failed: "failed" } as const;
  function drawCorners(): void {
    const colour = {
      joined: theme.status.ready,
      open: theme.status.warn,
      failed: theme.status.blocked,
    };
    joints.set(
      corners.map(
        (c): MarkerPoint => ({
          key: c.key,
          at: c.at,
          glyph: JOINT_GLYPH[c.state],
          colour: colour[c.state],
        }),
      ),
    );
    counts.joints = { joined: 0, open: 0, failed: 0 };
    for (const c of corners) counts.joints[c.state]++;
    emphasiseCorners();
  }

  /** The hovered corner and the selected ones, drawn larger. */
  function emphasiseCorners(): void {
    const keys = new Set<string>();
    for (const r of [...selection, ...hovered]) {
      if (r.startsWith(CORNER_PREFIX)) keys.add(r.slice(CORNER_PREFIX.length));
    }
    joints.emphasise(keys);
  }

  /** Where a badge sits on an entity: a bar's middle, a part's origin. */
  function anchorOf(id: string): V3 | undefined {
    const b = model?.bars[id];
    if (b) return [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2, (b.a[2] + b.b[2]) / 2];
    const p = model?.parts[id];
    return p?.origin ?? p?.point;
  }

  const RANK = { block: 0, error: 1, warn: 2 } as const;
  function drawBadges(): void {
    badgeOf = new Map();
    for (const b of badgeList) {
      for (const id of b.ids) {
        const was = badgeOf.get(id);
        if (!was || RANK[b.severity] < RANK[was]) badgeOf.set(id, b.severity);
      }
    }
    const pts: MarkerPoint[] = [];
    for (const [id, sev] of badgeOf) {
      const at = anchorOf(id);
      if (!at) continue;
      pts.push({
        key: id,
        at,
        glyph: sev === "warn" ? "warn" : "block",
        colour: sev === "warn" ? theme.status.warn : theme.status.blocked,
      });
    }
    badges.set(pts);
    counts.badges = pts.length;
    paint();
  }

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

  /** Before a frame: the key light and the fog follow the camera; the detail edges, the zoom. */
  function beforeRender(): void {
    const eye = controls.getPosition(new Vector3());
    const target = controls.getTarget(new Vector3());
    look.follow(eye, target, THREE_UP, radius);
    // Pixels per millimetre at the target, as a 40 mm face sees them.
    const h = Math.max(container.clientHeight, 1);
    let opacity: number;
    if (camera === ortho) opacity = theme.edge.opacity;
    else {
      const d = eye.distanceTo(target);
      const ppm = h / (2 * d * Math.tan(((persp.fov / 2) * Math.PI) / 180));
      const face = RAMP.face_mm * ppm;
      const k = Math.min(1, Math.max(0, (face - RAMP.from_px) / (RAMP.to_px - RAMP.from_px)));
      opacity = k * theme.edge.detail;
    }
    detailMaterial.opacity = opacity;
    if (detail) detail.lines.visible = opacity > 0.004;
    // The axes keep their size on the screen wherever the camera goes.
    const g = gizmo.shown();
    if (g && "parts" in g) gizmo.fit(mmPerPxAt(g.at));
  }

  const renderCbs = new Set<() => void>();
  function draw(): void {
    beforeRender();
    const t0 = performance.now();
    renderer.render(scene, camera);
    stats.renderMs += performance.now() - t0;
    stats.frames++;
    // The model drawn has taken its programs; the generation it replaced can go.
    if (!ownedDrawn && model) stats.modelFrame = stats.frames;
    ownedDrawn = true;
    if (retired.length > 0) {
      release(retired);
      retired = [];
    }
    labels.update();
    for (const cb of renderCbs) cb();
  }

  let frame = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const moved = controls.update((now - last) / 1000);
    last = now;
    // One hover pick a frame, at the pointer's last place.
    if (hoverAt && !tool && !down && model) {
      const at = hoverAt;
      hoverAt = undefined;
      const t0 = performance.now();
      const id = pick(at.x, at.y);
      stats.hoverMs += performance.now() - t0;
      stats.hovers++;
      reportHover(id);
    }
    if (pulsing) {
      paint(now);
      if (now - pulsing.start >= PULSE.ms) {
        pulsing = undefined;
        paint(now);
      }
    }
    if (moved || dirty) {
      dirty = false;
      draw();
    }
    frame = requestAnimationFrame(tick);
  };
  // Every lasting object is in the scene now, shown or not: link their programs before the first
  // frame. three's compile prepares the material of every object, hidden ones too (it gathers
  // only the lights from the visible ones), so what is first shown later (the gizmo's handles or
  // axes, the selection's x-ray, the section's outline) draws with a program it has: selecting a
  // bar links nothing (E-UX-19). The model's materials link on the frame that first draws it.
  renderer.compile(scene, camera);
  frame = requestAnimationFrame(tick);

  return {
    canvas: renderer.domElement,
    setModel(m) {
      model = m;
      build(m);
      paint();
      buildXray();
      drawCorners();
      drawBadges();
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
      buildXray();
      emphasiseCorners();
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
      if (t) {
        hoverAt = undefined;
        reportHover(undefined);
      }
    },
    setOverlay(state) {
      overlay.set(state);
      invalidate();
    },
    setGrab(g) {
      grab = g;
    },
    setGizmo(spec) {
      gizmo.set(spec);
      if (!spec || !("parts" in spec)) gizmoDragging = undefined;
      invalidate();
    },
    gizmo: () => gizmo.shown(),
    onGizmoDrag(cb) {
      gizmoCbs.add(cb);
      return () => gizmoCbs.delete(cb);
    },
    ray,
    project,
    pickAt,
    onContextMenu(cb) {
      menuCbs.add(cb);
      return () => menuCbs.delete(cb);
    },
    setHidden() {
      // E2.4 draws hidden bodies hidden, and Select's own pick passes them over.
    },
    setView,
    setProjection,
    projection: () => (camera === ortho ? "orthographic" : "perspective"),
    fitView,
    fitSelection(ids) {
      const box = ids.size > 0 ? boxOf(ids) : modelBox();
      fitThreeBox(box.isEmpty() ? modelBox() : box, true);
    },
    renderNow() {
      controls.update(0);
      draw();
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
    clipped: (p) => hiddenWorld(p),
    extent(axis) {
      const b = worldBox();
      const i = AXIS_INDEX[axis];
      return [b.min.getComponent(i), b.max.getComponent(i)];
    },
    stats: () => ({ ...counts, joints: { ...counts.joints } }),
    setHover(ids) {
      hovered = ids;
      paint();
      emphasiseCorners();
    },
    onHover(cb) {
      hoverCb = cb;
    },
    setGhost(keep) {
      ghost = keep;
      const fade = keep ? GHOST_EDGES.outline / theme.edge.outline : 1;
      joints.setFade(fade);
      badges.setFade(fade);
      paint();
    },
    pulse(ids) {
      pulsing = ids.size > 0 ? { ids, start: performance.now() } : undefined;
      paint();
    },
    fitBox(box) {
      const b = new Box3();
      for (const x of [box[0][0], box[1][0]])
        for (const y of [box[0][1], box[1][1]])
          for (const z of [box[0][2], box[1][2]])
            b.expandByPoint(new Vector3(x, y, z).applyMatrix4(world.matrixWorld));
      fitThreeBox(b, true);
    },
    setCorners(c) {
      corners = c;
      drawCorners();
      invalidate();
    },
    setJoinedShown(all) {
      joints.setQuiet(all ? new Set() : JOINED_QUIET);
      invalidate();
    },
    setProblemBadges(b) {
      badgeList = b;
      drawBadges();
    },
    setColourBy(mode, swatches = new Map()) {
      colourBy = { mode, swatches };
      paint();
    },
    setTheme(t) {
      theme = t;
      look.setTheme(t);
      ground.setTheme(t);
      overlay.setTheme(t);
      gizmo.setTheme(t);
      glyphs.setRing(t.overlay.ring);
      sectionMaterial.color.setHex(t.tool);
      applyThemeMaterials();
      if (model) {
        build(model);
        paint();
        buildXray();
      }
      drawCorners();
      drawBadges();
      invalidate();
    },
    onRender(cb) {
      renderCbs.add(cb);
      return () => renderCbs.delete(cb);
    },
    setLabel(key, at, text) {
      labels.set(key, at, text);
    },
    camera() {
      const pos = controls.getPosition(new Vector3());
      const target = controls.getTarget(new Vector3());
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      const right: V3 = fromThree([e[0] as number, e[1] as number, e[2] as number]);
      const up: V3 = fromThree([e[4] as number, e[5] as number, e[6] as number]);
      return {
        position: fromThree([pos.x, pos.y, pos.z]),
        target: fromThree([target.x, target.y, target.z]),
        right,
        up,
        // camera-controls marks a transition active when it is asked for, and rested when the
        // camera's change per frame falls below its rest threshold (0.01 mm here); a move made
        // at once is over at the first frame that changes nothing (`asleep`).
        moving: controls.active && !asleep,
      };
    },
    renderStats: () => ({ ...stats }),
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      clear();
      release(owned);
      release(retired);
      overlay.dispose();
      gizmo.dispose();
      joints.dispose();
      badges.dispose();
      ground.dispose();
      look.dispose();
      glyphs.dispose();
      labels.dispose();
      xray.geometry.dispose();
      for (const m of [capMaterial, sideMaterial, outlineMaterial, detailMaterial, xrayMaterial]) {
        m.dispose();
      }
      sectionLine.geometry.dispose();
      sectionMaterial.dispose();
      for (const u of unitCache.values()) u.geometry.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      rectEl.remove();
    },
  };
}
