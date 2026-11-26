import type { P2 } from "./outline.ts";

/**
 * What meshes are built from: the parts of the view model (`alukit.view/1`) that drawing reads,
 * as JSON, so the browser draws from what the server sends and the GLB writer (§9) from the same
 * shapes. `display.ts` builds them from a derived model; `bars.ts` alone uses three's geometry
 * classes (the extrusion and its triangulation), and nothing here uses a renderer. World
 * coordinates are the design's: millimetres, right-handed, Z up (§2).
 */

export type V3 = readonly [number, number, number];

/** A bar end as `alukit.derived/1` reports it: where its plane crosses the design line. */
export interface EndJson {
  by: string;
  point: V3;
  /** The end face's outward normal. */
  normal: V3;
  move_mm: number;
  angle_deg: number;
  cut?: string;
  mitre_deg?: number;
  bevel_deg?: number;
}

/** A bar as `alukit.derived/1` reports it (the fields drawing and the panels read). */
export interface BarJson {
  item: string;
  opt: Record<string, string>;
  pattern?: string;
  a: V3;
  b: V3;
  len_mm: number;
  cut_mm: number;
  centre_mm: number;
  short_mm: number;
  frame: { x: V3; y: V3; z: V3 };
  box_mm: [P2, P2];
  ends: { a: EndJson; b: EndJson };
}

export interface PartJson {
  item: string;
  kind: string;
  opt: Record<string, string>;
  unplaced?: boolean;
  qty?: number;
  why?: string;
  pattern?: string;
  bar?: string;
  s_mm?: number;
  datum?: string;
  point?: V3;
  frame?: { x: V3; y: V3; z: V3 };
  origin?: V3;
}

export interface ViewSection {
  fidelity: string;
  /** The display outline (§3.5), one ring. */
  outline: P2[];
  holes: P2[][];
  bbox: [P2, P2];
}

export interface ViewBar {
  section: string;
  /** Section point s lands at s + shift in the bar's local x, y (anchor and offset, §4.4). */
  shift: P2;
  /** Mass by the BOM's rule (centre-line length × mass per metre, §5.4), and its source. */
  mass_kg?: number;
  mass_src?: string;
}

export interface ViewPart {
  /** The item's bounding box in its own frame (§3.2), when the catalog gives one. */
  box?: [V3, V3];
  /** Drawn translucent: a placeholder (§4.8), or an item with no box, drawn as a marker. */
  translucent: boolean;
}

/** One fastener of a face connection, drawn as a rod from its head along its axis. */
export interface ViewFastener {
  connection: string;
  k: number;
  /** The fastener item: a catalog fastener, or the bar stock it is cut from. */
  item: string;
  head: V3;
  axis: V3;
  len: number;
  d: number;
}

export interface MeshInput {
  bars: Record<string, BarJson>;
  parts: Record<string, PartJson>;
  display: {
    bars: Record<string, ViewBar>;
    sections: Record<string, ViewSection>;
    parts: Record<string, ViewPart>;
    fasteners: ViewFastener[];
  };
}
