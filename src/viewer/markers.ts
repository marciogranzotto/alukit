import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  type Plane,
  Points,
  PointsMaterial,
} from "three";
import type { V3 } from "../mesh/model.ts";
import type { Glyph, Glyphs } from "./look.ts";
import type { P2 } from "./snap.ts";
import type { Hex } from "./theme.ts";

/**
 * Glyphs at world points over the model: the joint markers (D-UX-23: a filled dot for a joined
 * corner, a ring for an open one, a cross for a failed one) and the problem badges (an octagon
 * for what blocks or errs, a triangle for a warning). Each point is drawn twice: in front, depth
 * tested but lifted toward the eye by about a section's size, so a marker inside the bars it
 * sits in shows; and faintly on top, so one hidden behind other bars still shows where it is.
 * Emphasised points (the hovered marker, a selected corner) are drawn larger and solid on top.
 * Picking is by distance on the screen, before the bodies. Owner: S3.
 */

/**
 * How the selection, the hover and the viewer's callbacks name a corner: `corner:<key>`
 * (D-UX-10). A click or a hover on a joint marker reports this ref.
 */
export const CORNER_PREFIX = "corner:";

export interface MarkerPoint {
  key: string;
  at: V3;
  glyph: Glyph;
  colour: Hex;
}

/** Hidden markers' opacity: present, not loud. */
const BEHIND = 0.28;
/** How near the pointer must come to a marker to take it, CSS pixels. */
const REACH_PX = 9;
/** An emphasised marker's size, against the others'. */
const EMPHASIS = 1.5;

/**
 * A points material whose points are lifted toward the eye by `lift` mm along their line of
 * sight, so each stays where it projects: toward the eye in perspective, along the view axis in
 * an orthographic view (whose projection matrix has no perspective term).
 */
function lifted(lift: { value: number }, opts: ConstructorParameters<typeof PointsMaterial>[0]) {
  const m = new PointsMaterial(opts);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLift = lift;
    shader.vertexShader = `uniform float uLift;\n${shader.vertexShader}`.replace(
      "#include <fog_vertex>",
      [
        "#include <fog_vertex>",
        "\tif ( projectionMatrix[ 2 ][ 3 ] == 0.0 ) mvPosition.z += uLift;",
        "\telse mvPosition.xyz *= max( 0.05, 1.0 - uLift / length( mvPosition.xyz ) );",
        "\tgl_Position = projectionMatrix * mvPosition;",
      ].join("\n"),
    );
  };
  m.customProgramCacheKey = () => "lifted";
  return m;
}

/** Points sharing a glyph, drawn by one or two `Points`. */
interface Layer {
  objects: Points[];
  geometry: BufferGeometry;
}

/** How a glyph's points are drawn: faint on top, lifted in front, or emphasised on top. */
type Variant = "behind" | "front" | "emphasis";

export class MarkerLayer {
  readonly group = new Group();
  private layers: Layer[] = [];
  private emphasised: Layer[] = [];
  private points: MarkerPoint[] = [];
  private readonly lift = { value: 60 };
  private clip: Plane[] | null = null;
  private keys: ReadonlySet<string> = new Set();
  /** The markers' opacity, while the model around them is ghosted (Show's isolate). */
  private fade = 1;
  /**
   * One material per glyph and variant, for the layer's life: a revision, a hover or a fade
   * replaces the points, not the materials, so no shader program is released and compiled again.
   */
  private readonly materials = new Map<string, PointsMaterial>();
  private readonly glyphs: Glyphs;
  private readonly sizePx: number;
  private readonly pixelRatio: () => number;
  private readonly order: number;

  constructor(
    name: string,
    glyphs: Glyphs,
    sizePx: number,
    pixelRatio: () => number,
    order: number,
  ) {
    this.group.name = name;
    this.glyphs = glyphs;
    this.sizePx = sizePx;
    this.pixelRatio = pixelRatio;
    this.order = order;
  }

  /** How far markers rise toward the eye to clear the bars they sit in, mm. */
  setLift(mm: number): void {
    this.lift.value = mm;
  }

  set(points: readonly MarkerPoint[]): void {
    this.points = [...points];
    for (const l of this.layers) this.drop(l);
    this.layers = [];
    const byGlyph = new Map<Glyph, MarkerPoint[]>();
    for (const p of this.points) byGlyph.set(p.glyph, [...(byGlyph.get(p.glyph) ?? []), p]);
    for (const [g, pts] of byGlyph) this.layers.push(this.make(g, pts, false));
    this.emphasise(this.keys);
  }

  /** Draws these keys larger and solid on top (the hovered marker, a selected corner). */
  emphasise(keys: ReadonlySet<string>): void {
    this.keys = keys;
    for (const l of this.emphasised) this.drop(l);
    this.emphasised = this.points
      .filter((p) => keys.has(p.key))
      .map((p) => this.make(p.glyph, [p], true));
  }

  /** Fades the markers with a ghosted model, or brings them back. */
  setFade(opacity: number): void {
    if (opacity === this.fade) return;
    this.fade = opacity;
    this.set(this.points);
  }

  /** The section plane clips markers as it clips the model, or no longer does. */
  setClipping(planes: Plane[] | null): void {
    this.clip = planes;
    for (const m of this.materials.values()) m.clippingPlanes = planes;
  }

  /** The marker nearest the pointer, within reach; `hidden` drops points the section hides. */
  pickAt(
    clientX: number,
    clientY: number,
    project: (p: V3) => P2 | undefined,
    hidden: (p: V3) => boolean,
  ): string | undefined {
    if (!this.group.visible) return undefined;
    let best: { key: string; d: number } | undefined;
    for (const p of this.points) {
      const s = project(p.at);
      if (!s) continue;
      const d = Math.hypot(s[0] - clientX, s[1] - clientY);
      if (d <= REACH_PX && (!best || d < best.d) && !hidden(p.at)) best = { key: p.key, d };
    }
    return best?.key;
  }

  /** Follows the device pixel ratio. */
  resize(): void {
    this.set(this.points);
  }

  private make(glyph: Glyph, pts: readonly MarkerPoint[], emphasis: boolean): Layer {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(
        pts.flatMap((p) => [...p.at]),
        3,
      ),
    );
    const colours: number[] = [];
    for (const p of pts) {
      const c = new Color(p.colour);
      colours.push(c.r, c.g, c.b);
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
    geometry.computeBoundingSphere();
    const variants: Variant[] = emphasis ? ["emphasis"] : ["behind", "front"];
    const objects = variants.map((v) => new Points(geometry, this.material(glyph, v)));
    objects.forEach((o, i) => {
      o.renderOrder = this.order + (emphasis ? 2 : i);
      o.raycast = () => {};
      o.frustumCulled = false;
      this.group.add(o);
    });
    return { objects, geometry };
  }

  /** A glyph's material for a variant, made once, brought up to date (size, glyph, fade). */
  private material(glyph: Glyph, v: Variant): PointsMaterial {
    const key = `${glyph}:${v}`;
    let m = this.materials.get(key);
    if (!m) {
      const base = {
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        fog: false,
        clippingPlanes: this.clip,
      };
      m =
        v === "front" ? lifted(this.lift, base) : new PointsMaterial({ ...base, depthTest: false });
      this.materials.set(key, m);
    }
    m.size = this.sizePx * (v === "emphasis" ? EMPHASIS : 1) * this.pixelRatio();
    m.map = this.glyphs.get(glyph);
    m.opacity = v === "behind" ? BEHIND * this.fade : v === "front" ? this.fade : 1;
    return m;
  }

  private drop(l: Layer): void {
    for (const o of l.objects) this.group.remove(o);
    l.geometry.dispose();
  }

  dispose(): void {
    for (const l of [...this.layers, ...this.emphasised]) this.drop(l);
    this.layers = [];
    this.emphasised = [];
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
