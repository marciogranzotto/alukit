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
import type { Glyph, Glyphs } from "./look.ts";
import type { ViewTheme } from "./theme.ts";
import type { WorkPlane } from "./workplane.ts";

/**
 * What the tools draw over the model (design §8): the snap indicator, the line being drawn and
 * the axis it follows, a translucent preview of the bar, picked ends, and the work plane when it
 * is not the ground. Everything is in world coordinates (Z up), under the scene's world root, and
 * drawn on top of the model, in the theme's colours (`ViewTheme.overlay`; the plane, the preview
 * and the picks in its tool colour, which means "a tool is building this").
 *
 * A snap marker's shape says what it is on (D-UX-23, AutoCAD's AutoSnap), its colour and its
 * name in the hint say it again: a filled square on a node or a bar's end (`point`), a triangle
 * on a face's centre (`face`), a circled plus on a part's datum (`datum`), a diamond on a line
 * (`line`), a cross on the grid (`grid`), an open ring in free space (`free`); a picked point is
 * a dot (`pick`). Each has a dark ring, so it reads on any body.
 */

export type MarkerKind = "point" | "face" | "datum" | "line" | "grid" | "free" | "pick";

const GLYPH: Readonly<Record<MarkerKind, Glyph>> = {
  point: "square",
  face: "triangle",
  datum: "datum",
  line: "diamond",
  grid: "plus",
  free: "ring",
  pick: "dot",
};

/** A snap marker's size, CSS pixels. */
const MARKER_PX = 13;
const PIN_PX = 11;

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
  /**
   * Several bars as they would be (the Move tool's selection, moved): drawn as the ghost is, with
   * its one material, from a pool of meshes that only grows, so a drag makes no material.
   */
  ghosts?: readonly GhostBar[] | undefined;
  /** Picked points (a connection's ends, a station). */
  pins?: readonly V3[] | undefined;
  /** The work plane, drawn when it is not the ground. */
  plane?: WorkPlane | undefined;
}

const GUIDE_MM = 100_000;

function onTop<T extends { renderOrder: number }>(o: T): T {
  o.renderOrder = 1000;
  return o;
}

export class Overlay {
  readonly group = new Group();
  private readonly marker: Points;
  private readonly markerMaterial: PointsMaterial;
  private readonly lineMaterial: LineBasicMaterial;
  private readonly line: Line;
  private readonly guide: Line;
  private readonly guideMaterial = new LineDashedMaterial({
    dashSize: 20,
    gapSize: 14,
    depthTest: false,
    transparent: true,
    opacity: 0.7,
    fog: false,
  });
  private readonly pins: Points;
  private readonly pinMaterial: PointsMaterial;
  private readonly plane: LineSegments;
  private readonly planeMaterial: LineBasicMaterial;
  private ghost: { mesh: Mesh; key: string } | undefined;
  private readonly ghostMaterial: MeshBasicMaterial;
  /** The ghosts' meshes, reused; and each section's geometry, made once. */
  private readonly ghostPool: Mesh[] = [];
  private readonly ghostGeometry = new Map<string, BufferGeometry>();
  private colours: ViewTheme["overlay"];
  private kind: MarkerKind | undefined;
  private last: OverlayState = {};
  private readonly glyphs: Glyphs;
  private readonly pixelRatio: () => number;

  constructor(theme: ViewTheme, glyphs: Glyphs, pixelRatio: () => number) {
    this.glyphs = glyphs;
    this.pixelRatio = pixelRatio;
    this.colours = theme.overlay;
    this.ghostMaterial = new MeshBasicMaterial({
      color: theme.overlay.ghost,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      fog: false,
    });
    this.group.name = "overlay";
    // A glyph from the start, so the program the viewer links before its first frame is the one
    // the marker draws with: a map added later would ask for another.
    this.markerMaterial = new PointsMaterial({
      size: MARKER_PX,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
      map: glyphs.get(GLYPH.point),
      fog: false,
    });
    this.marker = onTop(new Points(new BufferGeometry(), this.markerMaterial));
    this.lineMaterial = new LineBasicMaterial({
      color: theme.overlay.line,
      depthTest: false,
      transparent: true,
      fog: false,
    });
    this.line = onTop(new Line(new BufferGeometry(), this.lineMaterial));
    this.guide = onTop(new Line(new BufferGeometry(), this.guideMaterial));
    this.pinMaterial = new PointsMaterial({
      size: PIN_PX,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
      color: theme.overlay.marker.pick,
      map: glyphs.get("dot"),
      fog: false,
    });
    this.pins = onTop(new Points(new BufferGeometry(), this.pinMaterial));
    this.planeMaterial = new LineBasicMaterial({
      color: theme.tool,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
      fog: false,
    });
    this.plane = onTop(new LineSegments(new BufferGeometry(), this.planeMaterial));
    for (const o of [this.plane, this.guide, this.line, this.pins, this.marker]) {
      o.frustumCulled = false;
      o.raycast = () => {};
      this.group.add(o);
    }
    this.set({});
  }

  /** Draws with another theme's colours, keeping what is drawn. */
  setTheme(t: ViewTheme): void {
    this.colours = t.overlay;
    this.ghostMaterial.color.setHex(t.overlay.ghost);
    this.lineMaterial.color.setHex(t.overlay.line);
    this.pinMaterial.color.setHex(t.overlay.marker.pick);
    this.planeMaterial.color.setHex(t.tool);
    this.set(this.last);
  }

  set(s: OverlayState): void {
    this.last = s;
    const dpr = this.pixelRatio();
    this.markerMaterial.size = MARKER_PX * dpr;
    this.pinMaterial.size = PIN_PX * dpr;
    setPositions(this.marker, s.marker ? [s.marker.p] : []);
    if (s.marker) {
      this.markerMaterial.color = new Color(this.colours.marker[s.marker.kind]);
      if (this.kind !== s.marker.kind) {
        this.kind = s.marker.kind;
        this.markerMaterial.map = this.glyphs.get(GLYPH[s.marker.kind]);
        this.markerMaterial.needsUpdate = true;
      }
    }
    setPositions(this.line, s.line ? [s.line.a, s.line.b] : []);
    if (s.guide) {
      const e: V3 = s.guide.axis === "x" ? [1, 0, 0] : s.guide.axis === "y" ? [0, 1, 0] : [0, 0, 1];
      const p = s.guide.through;
      setPositions(this.guide, [
        [p[0] - e[0] * GUIDE_MM, p[1] - e[1] * GUIDE_MM, p[2] - e[2] * GUIDE_MM],
        [p[0] + e[0] * GUIDE_MM, p[1] + e[1] * GUIDE_MM, p[2] + e[2] * GUIDE_MM],
      ]);
      this.guide.computeLineDistances();
      this.guideMaterial.color = new Color(this.colours.axis[s.guide.axis]);
    } else setPositions(this.guide, []);
    setPositions(this.pins, s.pins ?? []);
    setPositions(this.plane, s.plane ? planeGrid(s.plane) : []);
    this.setGhost(s.ghost);
    this.setGhosts(s.ghosts ?? []);
  }

  private setGhosts(gs: readonly GhostBar[]): void {
    gs.forEach((g, i) => {
      const key = JSON.stringify(g.section);
      let geometry = this.ghostGeometry.get(key);
      if (!geometry) {
        geometry = sectionGeometry(g.section);
        this.ghostGeometry.set(key, geometry);
      }
      let mesh = this.ghostPool[i];
      if (!mesh) {
        mesh = new Mesh(geometry, this.ghostMaterial);
        mesh.name = "preview";
        mesh.matrixAutoUpdate = false;
        mesh.raycast = () => {};
        mesh.renderOrder = 999;
        this.group.add(mesh);
        this.ghostPool.push(mesh);
      }
      mesh.geometry = geometry;
      mesh.matrix.copy(ghostMatrix(g));
      mesh.matrixWorldNeedsUpdate = true;
      mesh.visible = g.len > 0;
    });
    for (let i = gs.length; i < this.ghostPool.length; i++) {
      (this.ghostPool[i] as Mesh).visible = false;
    }
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
    this.ghost.mesh.matrix.copy(ghostMatrix(g));
    this.ghost.mesh.matrixWorldNeedsUpdate = true;
    this.ghost.mesh.visible = true;
  }

  dispose(): void {
    for (const o of [this.marker, this.line, this.guide, this.pins, this.plane]) {
      o.geometry.dispose();
      (o.material as { dispose(): void }).dispose();
    }
    this.ghost?.mesh.geometry.dispose();
    for (const g of this.ghostGeometry.values()) g.dispose();
    this.ghostMaterial.dispose();
  }
}

/** A ghost bar's placement: the section's x and y, the axis scaled to its length, at a + shift. */
function ghostMatrix(g: GhostBar): Matrix4 {
  const { x, y, t, a, len, shift } = g;
  const o: V3 = [
    a[0] + x[0] * shift[0] + y[0] * shift[1],
    a[1] + x[1] * shift[0] + y[1] * shift[1],
    a[2] + x[2] * shift[0] + y[2] * shift[1],
  ];
  // biome-ignore format: a matrix reads best by rows
  return new Matrix4().set(
    x[0], y[0], t[0] * len, o[0],
    x[1], y[1], t[1] * len, o[1],
    x[2], y[2], t[2] * len, o[2],
    0, 0, 0, 1,
  );
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
