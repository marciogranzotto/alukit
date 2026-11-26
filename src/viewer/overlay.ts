import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
} from "three";
import { sectionGeometry } from "../mesh/bars.ts";
import type { V3, ViewSection } from "../mesh/model.ts";
import type { WorkPlane } from "./workplane.ts";

/**
 * What the tools draw over the model (design §8): the snap indicator, the line being drawn and
 * the axis it follows, a translucent preview of the bar, picked ends, and the work plane when it
 * is not the ground. Everything is in world coordinates (Z up), under the scene's world root, and
 * drawn on top of the model.
 */

export type MarkerKind = "point" | "line" | "grid" | "free" | "pick";

export interface GhostBar {
  section: ViewSection;
  /** Columns: local x, local y, the axis; origin at the design point a. */
  x: V3;
  y: V3;
  t: V3;
  a: V3;
  len: number;
  shift: readonly [number, number];
}

export interface OverlayState {
  marker?: { p: V3; kind: MarkerKind } | undefined;
  /** The line being drawn, from its start to the end under the pointer. */
  line?: { a: V3; b: V3 } | undefined;
  /** The axis the line follows: drawn long, in the axis colour. */
  guide?: { through: V3; axis: "x" | "y" | "z" } | undefined;
  ghost?: GhostBar | undefined;
  /** Picked points (a connection's ends, a station). */
  pins?: readonly V3[] | undefined;
  /** The work plane, drawn when it is not the ground. */
  plane?: WorkPlane | undefined;
}

const MARKER: Readonly<Record<MarkerKind, number>> = {
  point: 0x4ade80,
  line: 0x38bdf8,
  grid: 0x9aa4ae,
  free: 0xe5e7eb,
  pick: 0xff9f1c,
};
const AXIS_COLOUR = { x: 0xef4444, y: 0x22c55e, z: 0x3b82f6 } as const;
const GUIDE_MM = 100_000;

function onTop<T extends { renderOrder: number }>(o: T): T {
  o.renderOrder = 1000;
  return o;
}

export class Overlay {
  readonly group = new Group();
  private readonly marker: Points;
  private readonly markerMaterial = new PointsMaterial({
    size: 11,
    sizeAttenuation: false,
    depthTest: false,
    transparent: true,
  });
  private readonly line: Line;
  private readonly guide: Line;
  private readonly guideMaterial = new LineDashedMaterial({
    dashSize: 20,
    gapSize: 14,
    depthTest: false,
    transparent: true,
    opacity: 0.7,
  });
  private readonly pins: Points;
  private readonly plane: LineSegments;
  private ghost: { mesh: Mesh; key: string } | undefined;
  private readonly ghostMaterial = new MeshBasicMaterial({
    color: 0xffb454,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });

  constructor() {
    this.group.name = "overlay";
    this.marker = onTop(new Points(new BufferGeometry(), this.markerMaterial));
    this.line = onTop(
      new Line(
        new BufferGeometry(),
        new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
      ),
    );
    this.guide = onTop(new Line(new BufferGeometry(), this.guideMaterial));
    this.pins = onTop(
      new Points(
        new BufferGeometry(),
        new PointsMaterial({
          size: 9,
          sizeAttenuation: false,
          depthTest: false,
          transparent: true,
          color: MARKER.pick,
        }),
      ),
    );
    this.plane = onTop(
      new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.35,
          depthTest: false,
        }),
      ),
    );
    for (const o of [this.plane, this.guide, this.line, this.pins, this.marker]) {
      o.frustumCulled = false;
      o.raycast = () => {};
      this.group.add(o);
    }
    this.set({});
  }

  set(s: OverlayState): void {
    setPositions(this.marker, s.marker ? [s.marker.p] : []);
    if (s.marker) this.markerMaterial.color = new Color(MARKER[s.marker.kind]);
    setPositions(this.line, s.line ? [s.line.a, s.line.b] : []);
    if (s.guide) {
      const e: V3 = s.guide.axis === "x" ? [1, 0, 0] : s.guide.axis === "y" ? [0, 1, 0] : [0, 0, 1];
      const p = s.guide.through;
      setPositions(this.guide, [
        [p[0] - e[0] * GUIDE_MM, p[1] - e[1] * GUIDE_MM, p[2] - e[2] * GUIDE_MM],
        [p[0] + e[0] * GUIDE_MM, p[1] + e[1] * GUIDE_MM, p[2] + e[2] * GUIDE_MM],
      ]);
      this.guide.computeLineDistances();
      this.guideMaterial.color = new Color(AXIS_COLOUR[s.guide.axis]);
    } else setPositions(this.guide, []);
    setPositions(this.pins, s.pins ?? []);
    setPositions(this.plane, s.plane ? planeGrid(s.plane) : []);
    this.setGhost(s.ghost);
  }

  private setGhost(g: GhostBar | undefined): void {
    if (!g || g.len <= 0) {
      if (this.ghost) this.ghost.mesh.visible = false;
      return;
    }
    const key = JSON.stringify(g.section);
    if (this.ghost?.key !== key) {
      if (this.ghost) {
        this.group.remove(this.ghost.mesh);
        this.ghost.mesh.geometry.dispose();
      }
      const mesh = new Mesh(sectionGeometry(g.section), this.ghostMaterial);
      mesh.name = "preview";
      mesh.matrixAutoUpdate = false;
      mesh.raycast = () => {};
      mesh.renderOrder = 999;
      this.group.add(mesh);
      this.ghost = { mesh, key };
    }
    const { x, y, t, a, len, shift } = g;
    const o: V3 = [
      a[0] + x[0] * shift[0] + y[0] * shift[1],
      a[1] + x[1] * shift[0] + y[1] * shift[1],
      a[2] + x[2] * shift[0] + y[2] * shift[1],
    ];
    // biome-ignore format: a matrix reads best by rows
    const m = new Matrix4().set(
      x[0], y[0], t[0] * len, o[0],
      x[1], y[1], t[1] * len, o[1],
      x[2], y[2], t[2] * len, o[2],
      0, 0, 0, 1,
    );
    this.ghost.mesh.matrix.copy(m);
    this.ghost.mesh.matrixWorldNeedsUpdate = true;
    this.ghost.mesh.visible = true;
  }

  dispose(): void {
    for (const o of [this.marker, this.line, this.guide, this.pins, this.plane]) {
      o.geometry.dispose();
      (o.material as { dispose(): void }).dispose();
    }
    this.ghost?.mesh.geometry.dispose();
    this.ghostMaterial.dispose();
  }
}

function setPositions(o: Points | Line | LineSegments, pts: readonly V3[]): void {
  const g = o.geometry as BufferGeometry;
  g.setAttribute("position", new Float32BufferAttribute(pts.flat() as number[], 3));
  g.computeBoundingSphere();
  o.visible = pts.length > 0;
}

/** A 400 mm square of the work plane around its origin, ruled every 50 mm. */
function planeGrid(p: WorkPlane): V3[] {
  const out: V3[] = [];
  const half = 200;
  const at = (a: number, b: number): V3 => [
    p.origin[0] + p.u[0] * a + p.v[0] * b,
    p.origin[1] + p.u[1] * a + p.v[1] * b,
    p.origin[2] + p.u[2] * a + p.v[2] * b,
  ];
  for (let k = -half; k <= half; k += 50) {
    out.push(at(k, -half), at(k, half), at(-half, k), at(half, k));
  }
  return out;
}
