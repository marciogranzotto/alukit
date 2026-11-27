import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
} from "three";
import type { ViewTheme } from "./theme.ts";

/**
 * The ground (docs/ux/visual-design.md §5.1): a grid on the world's XY plane at z = 0, sized to
 * 2.6 times the model's footprint and rounded up to the metre, with 100 mm lines and stronger
 * metre lines, fogged so it fades out with the model's back; and the world X and Y axes as faint
 * coloured lines across it. Lines lie on world multiples of their spacing, so the grid the draw
 * tool snaps to (snap.ts) and the one drawn agree. In world coordinates, under the scene's world
 * root. Owner: S3.
 */

/** Grid spacing, mm: minor and major lines. */
const MINOR = 100;
const MAJOR = 1000;
/** More lines than this a side, and the minor spacing grows tenfold (a very large model). */
const MOST_LINES = 400;

export interface Footprint {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Ground {
  readonly group = new Group();
  private readonly grid: LineSegments;
  private readonly axes: LineSegments;
  private readonly gridMaterial = new LineBasicMaterial({ vertexColors: true });
  private readonly axisMaterial = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  private theme: ViewTheme;
  private footprint: Footprint = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
  /** The ground's half size and centre, mm, as last built. */
  extent = { cx: 0, cy: 0, half: 1500 };

  constructor(theme: ViewTheme) {
    this.theme = theme;
    this.group.name = "ground";
    this.grid = new LineSegments(new BufferGeometry(), this.gridMaterial);
    this.grid.name = "grid";
    this.axes = new LineSegments(new BufferGeometry(), this.axisMaterial);
    this.axes.name = "axes";
    // Drawn after the grid, on it: the axes win where they cross it.
    this.axes.renderOrder = 1;
    for (const o of [this.grid, this.axes]) {
      o.raycast = () => {};
      this.group.add(o);
    }
    this.build();
  }

  /** Sizes the ground to a model's footprint on the XY plane (mm). */
  fit(f: Footprint): void {
    this.footprint = f;
    this.build();
  }

  setTheme(t: ViewTheme): void {
    this.theme = t;
    this.build();
  }

  private build(): void {
    const f = this.footprint;
    const t = this.theme;
    const span = Math.max(f.x1 - f.x0, f.y1 - f.y0, 1000);
    const size = Math.ceil((2.6 * span) / MAJOR) * MAJOR;
    let minor = MINOR;
    while (size / minor > MOST_LINES) minor *= 10;
    const major = Math.max(MAJOR, minor);
    // The centre on the minor spacing, so every line lies on a world multiple of it.
    const cx = Math.round((f.x0 + f.x1) / 2 / minor) * minor;
    const cy = Math.round((f.y0 + f.y1) / 2 / minor) * minor;
    const half = size / 2;
    this.extent = { cx, cy, half };

    const pos: number[] = [];
    const col: number[] = [];
    const line = new Color(t.grid.line);
    const strong = new Color(t.grid.major);
    const n = Math.round(size / minor);
    for (let i = 0; i <= n; i++) {
      const x = cx - half + i * minor;
      const y = cy - half + i * minor;
      const cxLine = Math.abs(x % major) < 1e-6 ? strong : line;
      const cyLine = Math.abs(y % major) < 1e-6 ? strong : line;
      pos.push(x, cy - half, 0, x, cy + half, 0, cx - half, y, 0, cx + half, y, 0);
      for (const c of [cxLine, cxLine, cyLine, cyLine]) col.push(c.r, c.g, c.b);
    }
    setLines(this.grid, pos, col, 3);

    // The world X and Y axes across the ground, where the ground holds them.
    const ap: number[] = [];
    const ac: number[] = [];
    const x = new Color(t.grid.axis.x);
    const y = new Color(t.grid.axis.y);
    const a = t.grid.axisOpacity;
    if (Math.abs(cy) <= half) {
      ap.push(cx - half, 0, 0, cx + half, 0, 0);
      ac.push(x.r, x.g, x.b, a, x.r, x.g, x.b, a);
    }
    if (Math.abs(cx) <= half) {
      ap.push(0, cy - half, 0, 0, cy + half, 0);
      ac.push(y.r, y.g, y.b, a, y.r, y.g, y.b, a);
    }
    setLines(this.axes, ap, ac, 4);
  }

  dispose(): void {
    for (const o of [this.grid, this.axes]) {
      o.geometry.dispose();
      (o.material as LineBasicMaterial).dispose();
    }
  }
}

function setLines(o: LineSegments, pos: number[], col: number[], size: 3 | 4): void {
  o.geometry.dispose();
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, size));
  g.computeBoundingSphere();
  o.geometry = g;
  o.visible = pos.length > 0;
}
