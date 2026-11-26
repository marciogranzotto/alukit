import type { HoleType } from "#core/project-items/resolve.ts";
import type { P2 } from "./outline.ts";

/**
 * What meshes are built from: the parts of the view model (`alukit.view/1`) that drawing reads,
 * as JSON, so the browser draws from what the server sends and the GLB writer (§9) from the same
 * shapes. `display.ts` builds them from a derived model. Of three.js, `bars.ts` uses the
 * geometry classes (a section's extrusion and its triangulation) and `items.ts` the triangulator
 * alone (a plate's outline); nothing here uses a renderer. World coordinates are the design's:
 * millimetres, right-handed, Z up (§2).
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
  /** The item's bounding box in its own frame (§3.2), when its catalog or the project gives one. */
  box?: [V3, V3];
  /** Drawn translucent: a placeholder (§4.8), or an item with no box, drawn as a marker. */
  translucent: boolean;
  /** A placeholder (§4.8): its box drawn translucent and outlined. */
  placeholder?: boolean;
  /** A plate or a bent angle of the project's own (§4.8): drawn from its shape, not its box. */
  shape?: ViewShape;
  /** A project item's mass, computed from its material or entered, and its source (§3.3). */
  mass_kg?: number;
  mass_src?: string;
}

/**
 * A hole of a project plate or bent angle, in the terms of the machining sheet (M6): `at` from
 * the part's datum (a plate's outline origin; on a leg, [x, distance from the heel]).
 */
export interface ViewHole {
  /** `h1` … on a plate; `a1` …, `b1` … on a bent angle's legs, as the machining sheet names it. */
  id: string;
  type: HoleType;
  at: P2;
  leg?: "a" | "b";
  /** The drill: a threaded hole's tap drill. */
  d: number;
  /** A blind hole's depth from its face; absent: through. */
  depth?: number;
  /** A countersink's or a counterbore's diameter at the face, and how deep it reaches. */
  mouth?: { d: number; depth: number };
  /** The face it is drilled from: a plate's face away from its mounting face, or a leg's inside. */
  face: "front" | "back";
}

/**
 * A project item's shape in its own frame (§3.2, +z away from the mounting face, +x along the
 * bar). A plate: its outline in x and y, from z = 0 to its thickness. A bent angle: its heel on
 * the x axis, leg a lying on the mounting face along +y, leg b rising along +z, each leg measured
 * to the outside of the other, with one 90° bend of inside radius `radius`.
 */
export type ViewShape =
  | { kind: "plate"; thickness: number; outline: P2[]; holes: ViewHole[] }
  | {
      kind: "bent-angle";
      thickness: number;
      /** Legs a and b. */
      legs: P2;
      length: number;
      radius: number;
      holes: ViewHole[];
    };

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
