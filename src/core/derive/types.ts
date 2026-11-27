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

/**
 * The face a butting end bears on, as stage 3 found it (§4.5): a side of the through bar's box,
 * the through bar's end face, or a face of a through body's box (its prism's slab and side). Its
 * seat is measured on it (after acceptance run 4).
 */
export type ButtFace =
  | { kind: "side"; bar: string; face: "+x" | "-x" | "+y" | "-y" }
  | { kind: "end"; bar: string; end: "a" | "b" }
  | { kind: "body"; item: string; prism: Prism; slab: number; side: 0 | 1; face: string };

/**
 * One bar of a butt's stack (§4.5, after the alternative frame's acceptance, X2), at one butting
 * end: where it lies along the face's outward normal, from the face the butt bears on, and its
 * faces toward the face (`inner`) and toward the butting end (`outer`).
 */
export interface StackLayer {
  bar: string;
  from: number;
  to: number;
  inner: string;
  outer: string;
}

/**
 * A butting end's seat on the face it bears on (§4.5, after acceptance run 4), both seen along
 * the face's normal: the end face's area, how far past the face's outline it reaches and how much
 * of it lies past it, and how far the butting bar goes into the receiving body beyond the face.
 */
export interface ButtSeat {
  /** The butting end, `b2.a`. */
  end: string;
  /** The face: `b1 +y`, `b1.b`, or a body's `<item> +x`. */
  on: string;
  area: number;
  overhang: number;
  overhang_area: number;
  overlap: number;
}

export interface BarLengths {
  /** Design length |B − A|. */
  len: number;
  /**
   * Long point, centre line and short point (§4.5): the longest, the box-centre and the shortest
   * of the lengths between the end faces along the box's edges.
   */
  cut: number;
  centre: number;
  short: number;
  /**
   * The span (§5.3, *2.3*): along the axis from end a's long point to end b's, the length of
   * straight stock the piece is cut from. It is `cut` when the two cuts lean opposite ways (a
   * trapezoid), and longer when they lean the same way, as parallel cuts do.
   */
  span: number;
  /** Along the axis from A, each end's long point: the farthest its end face reaches outward. */
  la: number;
  lb: number;
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

// ---------------------------------------------------------------------------------------------
// Stage 4: attach and generate (design §5.1)

/** A rail's hole layout (§4.7). Positions are along the axis from design point A. */
export interface RailLayout {
  /** How it was set: from a factory end, drilled to order and centred, or an end distance given. */
  how: "factory" | "drilled" | "E_a" | "E_b";
  /** The factory end, for `factory`. */
  factory?: "a" | "b";
  /** The stock length the piece is cut from, when nesting must keep it there (§4.7, §5.3). */
  stock_mm?: number;
  pitch: number;
  /** Hole centres along the axis from design point A, ascending. */
  holes: number[];
  /** End distances along the box centre line, from each end face to the nearest hole. */
  E_a: number;
  E_b: number;
}

/** A hole in a run or a rail, numbered along it from its start (§4.7). */
export interface RailHole {
  /** The piece that holds it. */
  bar: string;
  /** Along that piece's axis from its design point A. */
  s: number;
  /** Along the run (or the bar) from its first design point A. */
  r: number;
}

/** A part laid on a station or at a pose (§4.7), in world terms. */
export interface PlacedPart {
  placed: true;
  id: string;
  item: string;
  kind: string;
  opt: Readonly<Record<string, string>>;
  /** On a station: the bar it landed on (a run's piece) and the distance from that bar's A. */
  bar?: string;
  s?: number;
  /** The datum that landed on the station or pose (`run`, `mount`), or `origin`. */
  datum: string;
  point: V3;
  /** The item's own axes in world terms (§3.2, §4.7), and where its origin lands. */
  frame: { x: V3; y: V3; z: V3 };
  origin: V3;
  /** A copy's pattern. */
  pattern?: string;
  /** Context, not part of the build (gap X11): drawn and checked against, not counted. */
  context?: true;
}

/** A part entry that is counted, not drawn (§4.7). */
export interface UnplacedPart {
  placed: false;
  id: string;
  item: string;
  kind: string;
  opt: Readonly<Record<string, string>>;
  qty: number;
  why: string;
}

export type DerivedPart = PlacedPart | UnplacedPart;

/** A length cut from bar stock that is not a bar of the document: a fastener or a sleeve (§4.5). */
export interface StockPiece {
  /** `<connection>.f<k>` for a fastener, `<connection>.s<k>` for a sleeve. */
  source: string;
  item: string;
  opt: Readonly<Record<string, string>>;
  len: number;
  /** Cut for a connection whose every member is context (gap X11): the context's own, not cut. */
  context?: true;
}

/** A count of an item the BOM lists, and the entity it came from (§5.4). */
export interface HardwareUse {
  item: string;
  opt: Readonly<Record<string, string>>;
  qty: number;
  source: string;
  /**
   * Not counted (gap X11): brought by a connection whose every member is context (the context's
   * own), or a butt's through body marked context.
   */
  context?: true;
  /** A butt's through body (§4.5), counted with its connection, not a connector it brings. */
  body?: true;
}

/** Where a fastener passes one layer: the body and its interval along the axis from the head. */
export interface StationLayer {
  /** The bar (a run's piece) or part. */
  id: string;
  from: number;
  to: number;
}

/** One fastener of a face connection (§4.5). */
export interface FaceStation {
  /** 1-based, in the order the stations are written. */
  k: number;
  /** The first layer's piece and the distance along it from its design point A. */
  bar: string;
  s: number;
  /** The offset across the first layer's face, in §4.3's u. */
  across: number;
  /** On the first layer's face toward the second, and the axis from head to nut. */
  point: V3;
  axis: V3;
  layers: StationLayer[];
  /**
   * The layers' depths and the declared gaps (§4.5): for a tnut the last layer only to its
   * groove's lip; for a screw without its tapped layer.
   */
  grip: number;
  /** A fastener cut from bar stock: its piece. */
  piece?: string;
  /** Sleeves cut from bar stock: their pieces and lengths. */
  sleeves: { piece: string; len: number }[];
  /** What the fastener's head and its nut bear on (after acceptance run 4), where checked. */
  seats: HeadSeat[];
}

/**
 * A head's or a nut's seat on the face it bears on (§4.5, after acceptance run 4): its bearing
 * annulus, from the hole (or a washer's bore) out to its bearing diameter (a washer's outside
 * diameter where one is under it), and the fraction of that annulus on the face's material.
 */
export interface HeadSeat {
  side: "head" | "nut";
  /** The part that bears: the fastener, a nut, or a washer under either. */
  item: string;
  d_in: number;
  d_out: number;
  /** The face: `b1 +y`, an inner face's name, or a part's `p1 +z`. */
  on: string;
  bearing: number;
}

/**
 * A butt connector's screw head, seated (after the alternative frame's acceptance, F2b): the
 * butting end whose tap the screw goes into, the tap's position where the connector gives one,
 * and its seat: on the through bar's far face, or under the lips of its near face's groove.
 */
export interface ButtHead extends HeadSeat {
  end: string;
  at?: readonly [number, number];
  /**
   * Under a groove's lips (after the round-3 acceptance, X8): the depth left between the head's
   * top and the groove's floor, and the least room between the head and the chamber's wall, per
   * side, over the head's height (where the groove gives them).
   */
  room?: { depth?: number; side?: number };
}

/** A face connection's contacts and fastenings (§4.5). */
export interface FaceResult {
  fastening: "none" | "bolt" | "tnut" | "screw" | "blind";
  layers: string[];
  /** Each adjacent pair of layers: the faces in contact and their declared gap. */
  contacts: { faces: [string, string]; gap: number }[];
  stations: FaceStation[];
  /** The fastener at each station: a catalog item, or a length of bar stock. */
  fastener?: { item: string; len?: number };
  /** The loose hardware from head to nut at each station; sleeves are in `stations`. */
  stack: { item: string; qty: number }[];
  /** Every layer is context (gap X11): the context's own joint, its fasteners not counted. */
  context?: true;
}
