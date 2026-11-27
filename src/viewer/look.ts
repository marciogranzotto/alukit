import {
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  type Object3D,
  type Scene,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from "three";
import type { Hex, ViewTheme } from "./theme.ts";

/**
 * The 3D view's look (docs/ux/visual-design.md §5.1, §5.3): the lights, the fog and the
 * background, the state tints, and the point glyphs the markers are drawn with. Everything here
 * is deterministic (no noise, no time), so `alukit snapshot` gives the same image twice. Owner:
 * S3.
 */

/** How far a state tints a body toward its colour (C §5.3), in sRGB. */
export const MIX = {
  /** A selected body keeps some of its own colour, and its shading. */
  selected: 0.78,
  /** Hover previews the selection, paler. */
  hover: 0.45,
  /** A ghosted body sinks toward the fog. */
  ghost: 0.72,
} as const;

/** Edge opacities of a ghosted body (C §5.3): its outline, its detail. */
export const GHOST_EDGES = { outline: 0.18, detail: 0.12 } as const;

/** A body darker than this relative luminance gets light edges (a black profile, §5.2). */
const DARK_BODY = 0.15;

/** `a` moved `t` of the way to `b`, in sRGB. */
export function mix(a: Hex, b: Hex, t: number): Hex {
  const ch = (s: number) => {
    const x = (a >> s) & 0xff;
    const y = (b >> s) & 0xff;
    return Math.round(x + (y - x) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A colour's relative luminance (WCAG 2). */
export function luminance(c: Hex): number {
  const ch = (s: number) => {
    const v = ((c >> s) & 0xff) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
}

/** The contrast ratio of two colours (WCAG 2). */
export function contrast(a: Hex, b: Hex): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** The edge colour for a body: mid-tone on a light body, light on a dark one. */
export function edgeColour(t: ViewTheme, body: Hex): Hex {
  return luminance(body) < DARK_BODY ? t.edge.onDark : t.edge.colour;
}

/** The fog's colour, or the background's middle when there is no fog. */
export function fogColour(t: ViewTheme): Hex {
  if (t.fog) return t.fog.colour;
  const [top, bottom] = t.background;
  return mix(top, bottom ?? top, 0.5);
}

/** A vertical gradient as a texture, top to bottom; a flat colour gives a flat texture. */
function gradientTexture(stops: ViewTheme["background"]): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const css = (c: Hex) => `#${c.toString(16).padStart(6, "0")}`;
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, css(stops[0]));
  g.addColorStop(1, css(stops[1] ?? stops[0]));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * The lights (C §5.1): a sky light, tops bright and undersides darker, so orientation reads at a
 * glance; a key light that rides with the camera, above and to the left of the eye, so the faces
 * toward the eye are lit from any side and a bar's two visible sides differ; a low ambient. With
 * the fog in the background's middle tone and the background's gradient.
 */
export class Look {
  private readonly ambient = new AmbientLight();
  private readonly key = new DirectionalLight();
  private readonly sky = new HemisphereLight();
  private background: Texture | undefined;
  /** Placed by `follow`, coloured again by `setTheme`. */
  private readonly fog: Fog;
  private readonly scene: Scene;
  private theme: ViewTheme;

  constructor(scene: Scene, theme: ViewTheme) {
    this.scene = scene;
    this.theme = theme;
    this.fog = new Fog(fogColour(theme), 1, 2);
    scene.add(this.ambient, this.key, this.key.target, this.sky);
    this.setTheme(theme);
  }

  setTheme(t: ViewTheme): void {
    this.theme = t;
    const l = t.lights;
    this.ambient.color.setHex(l.ambient.colour);
    this.ambient.intensity = l.ambient.intensity;
    this.key.color.setHex(l.key.colour);
    this.key.intensity = l.key.intensity;
    this.sky.color.setHex(l.sky.colour);
    this.sky.groundColor.setHex(l.sky.ground);
    this.sky.intensity = l.sky.intensity;
    this.background?.dispose();
    this.background = gradientTexture(t.background);
    this.scene.background = this.background;
    this.fog.color = new Color(fogColour(t));
    this.scene.fog = t.fog ? this.fog : null;
  }

  /**
   * Follows the camera: the key light from above and left of the eye, the fog from the target's
   * depth (`radius` is the model's bounding sphere's). In three's frame (Y up).
   */
  follow(eye: Vector3, target: Vector3, up: Vector3, radius: number): void {
    const d = eye.distanceTo(target);
    const back = eye.clone().sub(target).normalize();
    const right = up.clone().cross(back).normalize();
    const camUp = back.clone().cross(right).normalize();
    this.key.position
      .copy(eye)
      .addScaledVector(camUp, 0.6 * d)
      .addScaledVector(right, -0.45 * d);
    this.key.target.position.copy(target);
    this.key.target.updateMatrixWorld();
    const fog = this.theme.fog;
    if (fog) {
      this.fog.near = Math.max(d + fog.near * radius, 1);
      this.fog.far = this.fog.near + fog.far * radius;
    }
  }

  dispose(): void {
    for (const o of [this.ambient, this.key, this.key.target, this.sky] as Object3D[]) {
      this.scene.remove(o);
    }
    this.background?.dispose();
  }
}

/** The shapes the point markers take (D-UX-23): snaps, picks, joints and problem badges. */
export type Glyph =
  | "square"
  | "triangle"
  | "diamond"
  | "plus"
  | "ring"
  | "datum"
  | "dot"
  | "joined"
  | "open"
  | "failed"
  | "block"
  | "warn";

const GLYPH_PX = 64;

/**
 * A glyph as a texture: white where the marker takes its colour, the dark ring round it so it
 * reads on any body. Drawn once into a canvas (C §5.3); a point material tints it.
 */
export function glyphTexture(g: Glyph, ring: Hex): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = GLYPH_PX;
  canvas.height = GLYPH_PX;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const s = GLYPH_PX;
  const c = s / 2;
  const dark = `#${ring.toString(16).padStart(6, "0")}`;
  // The mask: full intensity, which the point's colour multiplies. Not a colour of the theme.
  const mask = "white";
  ctx.lineJoin = "round";
  const path = (pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };
  const filled = (outline: number) => {
    ctx.fillStyle = mask;
    ctx.fill();
    ctx.lineWidth = outline;
    ctx.strokeStyle = dark;
    ctx.stroke();
  };
  /** A white stroke with a dark edge on both sides. */
  const line = (width: number) => {
    ctx.lineCap = "round";
    ctx.lineWidth = width + 10;
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = mask;
    ctx.stroke();
  };
  const circle = (r: number) => {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
  };
  const octagon = (r: number) =>
    path(
      Array.from({ length: 8 }, (_, i) => {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        return [c + r * Math.cos(a), c + r * Math.sin(a)] as [number, number];
      }),
    );
  const bang = () => {
    ctx.fillStyle = dark;
    ctx.fillRect(c - 3.5, s * 0.27, 7, s * 0.3);
    ctx.fillRect(c - 3.5, s * 0.64, 7, 7);
  };
  switch (g) {
    case "square":
      path([
        [12, 12],
        [s - 12, 12],
        [s - 12, s - 12],
        [12, s - 12],
      ]);
      filled(8);
      break;
    case "triangle":
      path([
        [c, 8],
        [s - 8, s - 12],
        [8, s - 12],
      ]);
      filled(8);
      break;
    case "diamond":
      path([
        [c, 6],
        [s - 6, c],
        [c, s - 6],
        [6, c],
      ]);
      filled(8);
      break;
    case "plus":
      ctx.beginPath();
      ctx.moveTo(c, 12);
      ctx.lineTo(c, s - 12);
      ctx.moveTo(12, c);
      ctx.lineTo(s - 12, c);
      line(8);
      break;
    case "ring":
      circle(c - 14);
      line(9);
      break;
    case "datum":
      circle(c - 14);
      ctx.moveTo(c, 10);
      ctx.lineTo(c, s - 10);
      ctx.moveTo(10, c);
      ctx.lineTo(s - 10, c);
      line(7);
      break;
    case "dot":
    case "joined":
      circle(c - 12);
      filled(8);
      break;
    case "open":
      circle(c - 14);
      line(10);
      break;
    case "failed":
      ctx.beginPath();
      ctx.moveTo(14, 14);
      ctx.lineTo(s - 14, s - 14);
      ctx.moveTo(s - 14, 14);
      ctx.lineTo(14, s - 14);
      line(10);
      break;
    case "block":
      octagon(c - 6);
      filled(6);
      bang();
      break;
    case "warn":
      path([
        [c, 5],
        [s - 4, s - 8],
        [4, s - 8],
      ]);
      filled(6);
      bang();
      break;
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Glyphs by key, drawn once and shared, disposed together. */
export class Glyphs {
  private readonly made = new Map<Glyph, Texture>();
  private ring: Hex;

  constructor(ring: Hex) {
    this.ring = ring;
  }

  get(g: Glyph): Texture {
    let t = this.made.get(g);
    if (!t) {
      t = glyphTexture(g, this.ring);
      this.made.set(g, t);
    }
    return t;
  }

  /** Redraws every glyph with another ring colour, keeping the textures. */
  setRing(ring: Hex): void {
    if (ring === this.ring) return;
    this.ring = ring;
    for (const [g, t] of this.made) {
      const fresh = glyphTexture(g, ring);
      (t as CanvasTexture).image = (fresh as CanvasTexture).image;
      t.needsUpdate = true;
      fresh.dispose();
    }
  }

  dispose(): void {
    for (const t of this.made.values()) t.dispose();
    this.made.clear();
  }
}

/** Unit vectors of three's frame, for the camera's up. */
export const THREE_UP = new Vector3(0, 1, 0);
