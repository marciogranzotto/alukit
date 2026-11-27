import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  TorusGeometry,
} from "three";
import type { V3 } from "../mesh/model.ts";
import type { Glyphs } from "./look.ts";
import { type P2, type Project, type Ray, rayLineParams } from "./snap.ts";
import type { ViewTheme } from "./theme.ts";
import { rayPlane } from "./workplane.ts";

/**
 * Gizmos (docs/ux/editing-audit.md E-UX-19, E0.6): what a person grabs in the view to move,
 * turn or stretch something, drawn over every body, built once with their materials, and shown,
 * hidden and moved per frame; nothing makes or disposes a material per revision or per drag
 * (`view.spec` counts no shader link across a revision).
 *
 * Two kinds, one at a time:
 * - **axes** at a point: an arrow along each world axis to move along it, a ring square to it to
 *   turn about it, a square in each plane to move in it; a constant size on the screen;
 * - **handles**: grips at points (a selected bar's ends, docs/ux/drag-ends-decisions.md), each
 *   draggable, in the tool's colour, or locked, grey; the hovered or held one larger. The end
 *   handles were the first; they moved here from the overlay.
 *
 * What a press on a part means is the viewer's (`onGizmoDrag`): the pure functions here say
 * which part is under the pointer (`gizmoPartAt`, `handleAt`) and what a drag from one ray to
 * another comes to (`gizmoDrag`), so a test needs no renderer. Owner: E3.
 */

export type GizmoPart =
  | "move-x"
  | "move-y"
  | "move-z"
  | "ring-x"
  | "ring-y"
  | "ring-z"
  | "plane-xy"
  | "plane-xz"
  | "plane-yz";

export interface GizmoHandle {
  key: string;
  at: V3;
  /** The axis it drags along, when it has one. */
  axis?: V3;
  /** Drawn grey: pressing it says why it does not drag. */
  locked?: boolean;
}

export type GizmoSpec =
  | { at: V3; parts: readonly GizmoPart[] }
  | { handles: readonly GizmoHandle[] /** The hovered or held handle's key. */; hot?: string };

/** A drag on a gizmo part, from its press: how far, and for a ring how far round. */
export interface GizmoDrag {
  part: GizmoPart;
  phase: "start" | "move" | "end";
  /** The world offset from the press, along the arrow or in the plane; zero on a ring. */
  delta: V3;
  /** A ring's turn from the press, degrees, counter-clockwise looking down its axis. */
  angle?: number;
}

/** An arrow's length on the screen, CSS pixels; the rings and squares scale with it. */
export const GIZMO_PX = 96;
/** A ring's radius, and a square's span from the centre, as fractions of an arrow's length. */
const RING = 0.78;
const SQUARE: readonly [number, number] = [0.22, 0.42];
/** How near the pointer must be to a part to take it, px. */
export const GIZMO_HIT_PX = 8;
/** How near a press must be to a handle to grab it, px. */
export const GRAB_PX = 12;
/** A handle's size, and the hovered or held one's, CSS pixels: big enough to grab. */
const HANDLE_PX = 17;
const HANDLE_HOT_PX = 23;

const UNIT: Readonly<Record<"x" | "y" | "z", V3>> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
/** A plane's two axes, and the one square to it. */
const PLANES: Readonly<
  Record<"xy" | "xz" | "yz", ["x" | "y" | "z", "x" | "y" | "z", "x" | "y" | "z"]>
> = {
  xy: ["x", "y", "z"],
  xz: ["x", "z", "y"],
  yz: ["y", "z", "x"],
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const addScaled = (a: V3, b: V3, s: number): V3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];

/** The distance from a point to a segment, on the screen. */
function toSegment(p: P2, a: P2, b: P2): number {
  const ab: P2 = [b[0] - a[0], b[1] - a[1]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t =
    l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
  return Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t));
}

/** Where the pointer is, as a gizmo reads it: on the screen, as a ray, and the scale there. */
export interface GizmoView {
  at: P2;
  ray: Ray;
  project: Project;
  /** World millimetres per CSS pixel at the gizmo's point. */
  mmPerPx: number;
}

/**
 * The axes part under the pointer: an arrow within a few pixels of its shaft, else a plane's
 * square the ray crosses, else a ring the ray meets its plane near.
 */
export function gizmoPartAt(
  spec: Extract<GizmoSpec, { parts: unknown }>,
  v: GizmoView,
): GizmoPart | undefined {
  const size = GIZMO_PX * v.mmPerPx;
  const tol = GIZMO_HIT_PX * v.mmPerPx;
  const has = new Set(spec.parts);
  const o = v.project(spec.at);
  let best: { part: GizmoPart; d: number } | undefined;
  for (const k of ["x", "y", "z"] as const) {
    const part = `move-${k}` as const;
    if (!has.has(part) || !o) continue;
    const tip = v.project(addScaled(spec.at, UNIT[k], size));
    if (!tip) continue;
    const d = toSegment(v.at, o, tip);
    if (d <= GIZMO_HIT_PX && (!best || d < best.d)) best = { part, d };
  }
  if (best) return best.part;
  for (const [name, [u, w, n]] of Object.entries(PLANES)) {
    const part = `plane-${name}` as GizmoPart;
    if (!has.has(part)) continue;
    const p = rayPlane(v.ray, { origin: spec.at, n: UNIT[n] });
    if (!p) continue;
    const a = dot(sub(p, spec.at), UNIT[u]) / size;
    const b = dot(sub(p, spec.at), UNIT[w]) / size;
    if (a >= SQUARE[0] && a <= SQUARE[1] && b >= SQUARE[0] && b <= SQUARE[1]) return part;
  }
  let ring: { part: GizmoPart; d: number } | undefined;
  for (const k of ["x", "y", "z"] as const) {
    const part = `ring-${k}` as const;
    if (!has.has(part)) continue;
    const p = rayPlane(v.ray, { origin: spec.at, n: UNIT[k] });
    if (!p) continue;
    const r = Math.hypot(...sub(p, spec.at));
    const d = Math.abs(r - RING * size);
    if (d <= tol && (!ring || d < ring.d)) ring = { part, d };
  }
  return ring?.part;
}

/** The handle within grabbing distance of the pointer, nearest first. */
export function handleAt(
  handles: readonly GizmoHandle[],
  at: P2,
  project: Project,
  px = GRAB_PX,
): string | undefined {
  let best: { key: string; d: number } | undefined;
  for (const h of handles) {
    const s = project(h.at);
    if (!s) continue;
    const d = Math.hypot(s[0] - at[0], s[1] - at[1]);
    if (d <= px && (!best || d < best.d)) best = { key: h.key, d };
  }
  return best?.key;
}

/** A box on the screen, CSS pixels, as `getBoundingClientRect` gives one. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where on the screen a press is the gizmo's (added by E2, so the labels over the view keep clear
 * of it: docs/ux/e2-decisions.md): for axes, the box round the projected ends of an arrow's
 * length along each axis both ways (every arrow, cone, ring and square lies inside it), padded by
 * how near a press takes a part; for handles, a box round each, as far as a press grabs it. Empty
 * when nothing projects. Pure.
 */
export function gizmoFootprint(spec: GizmoSpec, project: Project, mmPerPx: number): ScreenBox[] {
  const square = (s: P2, r: number): ScreenBox => ({
    left: s[0] - r,
    top: s[1] - r,
    right: s[0] + r,
    bottom: s[1] + r,
  });
  if ("handles" in spec) {
    const r = Math.max(GRAB_PX, HANDLE_HOT_PX / 2);
    return spec.handles.flatMap((h) => {
      const s = project(h.at);
      return s ? [square(s, r)] : [];
    });
  }
  const size = GIZMO_PX * mmPerPx;
  const ends: P2[] = [];
  for (const u of Object.values(UNIT)) {
    for (const sign of [1, -1]) {
      const s = project(addScaled(spec.at, u, sign * size));
      if (s) ends.push(s);
    }
  }
  if (ends.length === 0) return [];
  const xs = ends.map((s) => s[0]);
  const ys = ends.map((s) => s[1]);
  return [
    {
      left: Math.min(...xs) - GIZMO_HIT_PX,
      top: Math.min(...ys) - GIZMO_HIT_PX,
      right: Math.max(...xs) + GIZMO_HIT_PX,
      bottom: Math.max(...ys) + GIZMO_HIT_PX,
    },
  ];
}

/**
 * What a drag on a part comes to, from the ray at the press to the ray now: along an arrow, the
 * pointer's ray read on its axis; in a plane, where the rays cross it; round a ring, the angle
 * between where they cross its plane, signed about its axis.
 */
export function gizmoDrag(
  part: GizmoPart,
  at: V3,
  from: Ray,
  to: Ray,
): Omit<GizmoDrag, "phase" | "part"> {
  const [kind, axes] = part.split("-") as ["move" | "ring" | "plane", string];
  if (kind === "move") {
    const u = UNIT[axes as "x" | "y" | "z"];
    const s = rayLineParams(to, at, u).s - rayLineParams(from, at, u).s;
    return { delta: scale(u, s) };
  }
  const n = kind === "ring" ? UNIT[axes as "x" | "y" | "z"] : UNIT[PLANES[axes as "xy"][2]];
  const p0 = rayPlane(from, { origin: at, n });
  const p1 = rayPlane(to, { origin: at, n });
  if (!p0 || !p1) return kind === "ring" ? { delta: [0, 0, 0], angle: 0 } : { delta: [0, 0, 0] };
  if (kind === "plane") return { delta: sub(p1, p0) };
  const a = sub(p0, at);
  const b = sub(p1, at);
  const angle = (Math.atan2(dot(cross(a, b), n), dot(a, b)) * 180) / Math.PI;
  return { delta: [0, 0, 0], angle };
}

/** World millimetres per CSS pixel at a point, for a camera at `eye` looking along `forward`. */
export function mmPerPx(
  camera:
    | { perspective: true; eye: V3; forward: V3; fovDeg: number }
    | { perspective: false; zoom: number },
  at: V3,
  heightPx: number,
): number {
  if (!camera.perspective) return 1 / camera.zoom;
  const d = Math.max(dot(sub(at, camera.eye), camera.forward), 1e-6);
  return (2 * d * Math.tan((camera.fovDeg * Math.PI) / 360)) / Math.max(heightPx, 1);
}

function onTop<T extends { renderOrder: number }>(o: T): T {
  o.renderOrder = 1001;
  return o;
}

/** A material that draws over every body, never fogged. */
const flat = (colour: number, opacity = 1) =>
  new MeshBasicMaterial({
    color: colour,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity,
    fog: false,
    side: DoubleSide,
  });

/**
 * The gizmo in the scene: one group under the world root (Z up), its parts' geometries and
 * materials made in the constructor and kept until `dispose`.
 */
export class Gizmo {
  readonly group = new Group();
  private readonly axes = new Group();
  private readonly parts = new Map<GizmoPart, { obj: Group | Mesh; material: MeshBasicMaterial }>();
  private readonly geometries: BufferGeometry[] = [];
  private readonly handles: Points;
  private readonly lockedHandles: Points;
  private readonly hotHandle: Points;
  private readonly handleMaterial: PointsMaterial;
  private readonly lockedMaterial: PointsMaterial;
  private readonly hotMaterial: PointsMaterial;
  private spec: GizmoSpec | undefined;
  private hover: GizmoPart | undefined;
  private theme: ViewTheme;
  private readonly pixelRatio: () => number;

  constructor(theme: ViewTheme, glyphs: Glyphs, pixelRatio: () => number) {
    this.theme = theme;
    this.pixelRatio = pixelRatio;
    this.group.name = "gizmo";
    this.axes.name = "gizmo axes";
    this.group.add(this.axes);
    // Unit parts: an arrow along +Y, a ring and a square in the XY plane; each axis's copy is
    // turned onto its axis.
    const shaft = this.keep(new CylinderGeometry(0.012, 0.012, 0.82, 8).translate(0, 0.41, 0));
    const cone = this.keep(new ConeGeometry(0.05, 0.18, 16).translate(0, 0.91, 0));
    const torus = this.keep(new TorusGeometry(RING, 0.012, 6, 64));
    const square = this.keep(new RingGeometry(0, 1, 4, 1, Math.PI / 4));
    const turn: Readonly<Record<"x" | "y" | "z", (o: Mesh | Group) => void>> = {
      x: (o) => o.rotation.set(0, 0, -Math.PI / 2),
      y: (o) => o.rotation.set(0, 0, 0),
      z: (o) => o.rotation.set(Math.PI / 2, 0, 0),
    };
    for (const k of ["x", "y", "z"] as const) {
      const colour = theme.overlay.axis[k];
      const arrowMaterial = flat(colour);
      const arrow = new Group();
      arrow.add(onTop(new Mesh(shaft, arrowMaterial)), onTop(new Mesh(cone, arrowMaterial)));
      turn[k](arrow);
      this.add(`move-${k}`, arrow, arrowMaterial);
      const ringMaterial = flat(colour);
      const ring = onTop(new Mesh(torus, ringMaterial));
      // A torus lies in its XY plane: square to Z already; turned for X and Y.
      if (k === "x") ring.rotation.set(0, Math.PI / 2, 0);
      if (k === "y") ring.rotation.set(Math.PI / 2, 0, 0);
      this.add(`ring-${k}`, ring, ringMaterial);
    }
    for (const [name, [u, w, n]] of Object.entries(PLANES)) {
      const material = flat(theme.overlay.axis[n], 0.45);
      const plane = onTop(new Mesh(square, material));
      // A unit diamond turned square, scaled to the span, centred between the two axes.
      const span = (SQUARE[1] - SQUARE[0]) / Math.SQRT2;
      plane.scale.set(span, span, 1);
      const mid = (SQUARE[0] + SQUARE[1]) / 2;
      const c = addScaled(addScaled([0, 0, 0], UNIT[u], mid), UNIT[w], mid);
      plane.position.set(...c);
      // Its face square to the third axis: the XY plane's as made; turned for the others.
      if (n === "y") plane.rotation.set(-Math.PI / 2, 0, 0);
      if (n === "x") plane.rotation.set(0, Math.PI / 2, 0);
      this.add(`plane-${name}` as GizmoPart, plane, material);
    }
    const handle = (colour: number) =>
      new PointsMaterial({
        size: HANDLE_PX,
        sizeAttenuation: false,
        depthTest: false,
        transparent: true,
        color: colour,
        map: glyphs.get("square"),
        fog: false,
      });
    this.handleMaterial = handle(theme.overlay.marker.pick);
    this.lockedMaterial = handle(theme.overlay.marker.grid);
    this.hotMaterial = handle(theme.overlay.marker.pick);
    this.handles = onTop(new Points(new BufferGeometry(), this.handleMaterial));
    this.lockedHandles = onTop(new Points(new BufferGeometry(), this.lockedMaterial));
    this.hotHandle = onTop(new Points(new BufferGeometry(), this.hotMaterial));
    for (const o of [this.lockedHandles, this.handles, this.hotHandle]) {
      o.frustumCulled = false;
      o.raycast = () => {};
      this.group.add(o);
    }
    this.set(undefined);
  }

  private keep<G extends BufferGeometry>(g: G): G {
    this.geometries.push(g);
    return g;
  }

  private add(part: GizmoPart, obj: Group | Mesh, material: MeshBasicMaterial): void {
    obj.traverse((o) => {
      o.frustumCulled = false;
      o.raycast = () => {};
    });
    this.parts.set(part, { obj, material });
    this.axes.add(obj);
  }

  /** What is shown now. */
  shown(): GizmoSpec | undefined {
    return this.spec;
  }

  /** Shows a gizmo, or takes it away. Only positions, visibility and colours change. */
  set(spec: GizmoSpec | undefined): void {
    this.spec = spec;
    const axes = spec && "parts" in spec ? spec : undefined;
    this.axes.visible = axes !== undefined;
    if (axes) {
      this.axes.position.set(...axes.at);
      for (const [part, { obj }] of this.parts) obj.visible = axes.parts.includes(part);
    } else this.hover = undefined;
    this.paint();
    const handles = spec && "handles" in spec ? spec : undefined;
    const dpr = this.pixelRatio();
    this.handleMaterial.size = HANDLE_PX * dpr;
    this.lockedMaterial.size = HANDLE_PX * dpr;
    this.hotMaterial.size = HANDLE_HOT_PX * dpr;
    const pts = handles?.handles ?? [];
    const hot = pts.find((h) => h.key === handles?.hot);
    setPositions(
      this.handles,
      pts.filter((h) => !h.locked && h !== hot).map((h) => h.at),
    );
    setPositions(
      this.lockedHandles,
      pts.filter((h) => h.locked && h !== hot).map((h) => h.at),
    );
    setPositions(this.hotHandle, hot ? [hot.at] : []);
    if (hot) {
      this.hotMaterial.color.setHex(
        hot.locked ? this.theme.overlay.marker.grid : this.theme.overlay.marker.pick,
      );
    }
  }

  /** The axes part under the pointer, drawn lit; undefined for none. True when it changed. */
  setHover(part: GizmoPart | undefined): boolean {
    if (part === this.hover) return false;
    this.hover = part;
    this.paint();
    return true;
  }

  /** Keeps the axes a constant size on the screen: an arrow `GIZMO_PX` long. */
  fit(mmPerPx: number): void {
    const s = GIZMO_PX * mmPerPx;
    this.axes.scale.set(s, s, s);
  }

  /** Draws with another theme's colours, keeping what is shown. */
  setTheme(t: ViewTheme): void {
    this.theme = t;
    this.handleMaterial.color.setHex(t.overlay.marker.pick);
    this.lockedMaterial.color.setHex(t.overlay.marker.grid);
    this.set(this.spec);
  }

  private paint(): void {
    for (const [part, { material }] of this.parts) {
      const [kind, axes] = part.split("-") as [string, string];
      const axis = (kind === "plane" ? PLANES[axes as "xy"][2] : axes) as "x" | "y" | "z";
      material.color.setHex(
        part === this.hover ? this.theme.overlay.marker.pick : this.theme.overlay.axis[axis],
      );
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const { material } of this.parts.values()) material.dispose();
    for (const o of [this.handles, this.lockedHandles, this.hotHandle]) {
      o.geometry.dispose();
      (o.material as PointsMaterial).dispose();
    }
  }
}

function setPositions(o: Points, pts: readonly V3[]): void {
  const g = o.geometry as BufferGeometry;
  g.setAttribute("position", new Float32BufferAttribute(pts.flat() as number[], 3));
  g.computeBoundingSphere();
  o.visible = pts.length > 0;
}
