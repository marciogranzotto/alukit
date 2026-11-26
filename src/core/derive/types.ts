import type { BarItemInfo } from "../items.ts";
import type { V3 } from "../vec.ts";

/**
 * The derived model in memory, at full precision (design §5). Output files quantise it
 * (`output.ts`); the viewer reads it as is.
 */

/** A bar's local frame (design §4.4): z along the bar, x and y across it, after roll. */
export interface Frame {
  t: V3;
  x: V3;
  y: V3;
}

/** The placed section's bounding box in the local x, y frame, relative to the design line. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Where a pattern copy came from, and how far it is translated (design §4.7). */
export interface Copy {
  pattern: string;
  k: number;
  /** The bar or run the copies are translated along, when `along` names one. */
  along?: string;
  /** A direction, when `along` is `{ dir }`. */
  dir?: V3;
  /** The translation along the axis, in mm. */
  step: number;
}

export interface PlacedBar {
  /** `b7`, or a pattern copy `b30@2`. */
  id: string;
  item: BarItemInfo;
  opt: Readonly<Record<string, string>>;
  /** Design point a. */
  A: V3;
  /**
   * Design point b. Undefined until stage 3 for a free end counted from end a's cut (§4.3);
   * nothing may depend on it before then.
   */
  B: V3 | undefined;
  frame: Frame;
  box: Box;
  /** The anchor in section coordinates, and the offset: section point s lands at s − anchor + off. */
  anchor: readonly [number, number];
  off: readonly [number, number];
  /** A free end b: its length and direction as written. */
  free?: { len: number; dir: V3; fromCut: boolean };
  copy?: Copy;
}

/** A point on a bar's face or groove, or its design line (design §4.3). */
export interface StationPoint {
  point: V3;
  /** The bar the station landed on: a run's piece for a station on a run. */
  bar: PlacedBar;
  /** Distance along the bar from its design point a. */
  s: number;
  /** The face's outward normal, for a station on a face or groove. */
  normal?: V3;
  /** The face's u direction (§4.3): local +x on the ±y faces, local +y on the ±x faces. */
  u?: V3;
}

export interface PlacedRun {
  id: string;
  bars: PlacedBar[];
  /** The first bar's design point a and axis. */
  A: V3;
  t: V3;
  /** Each piece's design segment along the run, from the first bar's a. */
  starts: number[];
  ends: number[];
  len: number;
}

export interface PlacedPivot {
  id: string;
  /** The pivot point: base point + height along the face normal (§4.5). */
  P: V3;
  /** The base face's outward normal. */
  n: V3;
  /** The base bar's axis and the base face's u direction. */
  baseT: V3;
  baseU: V3;
  axis: "along" | "across";
  height: number;
  end: number;
  range: readonly [number, number];
}

/** A plane: a point and a unit normal. */
export interface PlaneN {
  p: V3;
  n: V3;
}

/** Slab: the points whose coordinate (q − origin) · n lies in [lo, hi]. */
export interface Slab {
  n: V3;
  origin: V3;
  lo: number;
  hi: number;
  /** Face names at lo and hi. */
  faces: readonly [string, string];
}

/** An infinite prism (a bar: two slabs) or a box (a body: three slabs). */
export interface Prism {
  owner: string;
  slabs: Slab[];
}

export type ProviderKind =
  | "default"
  | "plane-point"
  | "plane-face"
  | "plane-of"
  | "butt"
  | "butt-body"
  | "butt-end"
  | "through"
  | "miter"
  | "splice"
  | "pivot"
  | "free";

/** Providers that read another end's face (design §4.5): resolved in the second sweep. */
export const END_PROVIDERS: ReadonlySet<ProviderKind> = new Set(["plane-of", "butt-end", "free"]);

export interface Claim {
  kind: ProviderKind;
  /** The connection, for connection providers. */
  conn?: string;
  /** Through ends: cover or node. */
  mode?: "cover" | "node";
  /** How diagnostics name it: `c1` or `b2.ends.a.plane`. */
  name: string;
}

export interface EndFace {
  bar: string;
  end: "a" | "b";
  /** The provider that set the plane; undefined for the default, also after a fallback. */
  by: Claim | undefined;
  /** 1: placement providers; 2: end providers (design §4.5). */
  sweep: 1 | 2;
  /** The end face: the plane the bar is cut on, after both modifiers, with its outward normal. */
  face: PlaneN;
  /** Square to the axis within tol.ang. */
  square: boolean;
  cut?: "angle" | "square";
}

export interface BarLengths {
  /** Design length |B − A|. */
  len: number;
  /** Long point, centre line and short point (§4.5). */
  cut: number;
  centre: number;
  short: number;
  /** Along the axis from A, where each end face crosses the design line. */
  sa: number;
  sb: number;
}

export interface EndReport {
  by: string;
  /** Where the end face crosses the design line. */
  point: V3;
  normal: V3;
  /** Along the axis from the design point, positive outward (longer). */
  move: number;
  /** Between the end face's normal and the axis. */
  angle: number;
  /** For an angled end: the compound-cut components in the bar's frame. */
  mitre?: number;
  bevel?: number;
  cut?: "angle" | "square";
}
