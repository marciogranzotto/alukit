import type { Bom } from "../bom/bom.ts";
import type { CutList } from "../cutlist/cutlist.ts";
import { machiningText } from "../cutlist/format.ts";
import type { Derived } from "../derive/derive.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import type { HoleType, ResolvedHole, ResolvedProjectItem } from "../project-items/resolve.ts";
import { projectItems } from "../project-items/source.ts";
import { QUANTUM, quantize } from "../quantum.ts";

/**
 * The machining sheet (M6, design §4.8): per custom part the BOM uses (a plate, a bent angle), its
 * stock and blank, and every hole with its position from the part's named datum, its type and its
 * size. A fabricator works from it. A bar's machining is on the cut list, measured from a named
 * end (§5.3); the sheet lists the cut-list lines that carry some, each with its machining in the
 * cut list's words, which name the face a hole in a bar's side is drilled from (after the round-4
 * acceptance, X9: the face is what the shop reads).
 *
 * Datums: a plate's is its outline's origin, (0, 0), with x and y as the outline is drawn. A bent
 * angle's is its heel at end 0: x along its length, y from the heel's outside face up each leg;
 * on its flat blank, from leg a's free edge. A hole's `face` is the one it is drilled from: front
 * is a plate's face away from its mounting face, or a leg's inside face.
 *
 * Lengths are quantised to 0.01 mm, angles to 0.01° (§2).
 */

export const MACHINING_SCHEMA = "alukit.machining/1";

/** The datums the sheet measures from. */
export const DATUMS = {
  plate: "the outline's origin (0, 0); x and y as the outline is drawn",
  "bent-angle": "the heel at end 0; x along the length, y from the heel's outside face up the leg",
  blank: "leg a's free edge at end 0; x along the length, y across the blank",
} as const;

export interface SheetHole {
  /** `h1` … on a plate; `a1` …, `b1` … on a bent angle's legs. */
  id: string;
  leg?: "a" | "b";
  /** From the part's datum. */
  at_mm: [number, number];
  /** A bent angle's: on its flat blank, from the blank's datum. */
  flat_mm?: [number, number];
  type: HoleType;
  /** The drill: a threaded hole's tap drill. */
  d_mm: number;
  thread?: string;
  /** Absent: through. */
  depth_mm?: number;
  csk?: { d_mm: number; angle_deg: number; depth_mm: number };
  cbore?: { d_mm: number; depth_mm: number };
  face: "front" | "back";
}

export interface SheetPart {
  item: string;
  name: string;
  kind: "plate" | "bent-angle";
  /** Units the BOM counts, and the entities that use them. */
  qty: number;
  sources: string[];
  /** Who makes it: a fabricator, or `local`. */
  supplier: string;
  material: string;
  thickness_mm: number;
  /** The datum the holes' `at_mm` count from. */
  datum: string;
  /** A plate's outline, from its datum. */
  outline_mm?: [number, number][];
  /** A bent angle's legs (each to the outside of the other) and length. */
  legs_mm?: [number, number];
  length_mm?: number;
  /** A bent angle's flat blank: [length, developed length], and its datum. */
  blank_mm?: [number, number];
  blank_datum?: string;
  /** A bent angle's bend: radius, K-factor, allowance, and where the bend zone runs on the blank. */
  bend?: {
    angle_deg: number;
    radius_mm: number;
    k_factor: number;
    allowance_mm: number;
    from_mm: number;
    to_mm: number;
  };
  holes: SheetHole[];
}

/** A cut-list line that carries machining, and what it is, in the cut list's words (§5.3). */
export interface SheetBarRef {
  item: string;
  opt: Readonly<Record<string, string>>;
  cut_mm: number;
  count: number;
  /** Operations per piece, as the cut list lists them. */
  ops: number;
  /** Each operation in the cut list's words: a hole in a bar's side names its face (X9). */
  machining: string[];
  sources: string[];
}

export interface MachiningSheet {
  schema: typeof MACHINING_SCHEMA;
  /**
   * The stamp (§5.4, §4.13): the content hash of the lock it was derived from, when it was. It
   * carries no prices, so it states no basis and no read date.
   */
  lock?: string;
  parts: SheetPart[];
  /** The bars' machining is on the cut list: these lines carry some. */
  bars: SheetBarRef[];
  diagnostics: Diagnostic[];
}

export interface MachiningInput {
  derived: Derived;
  items: ItemSource;
  bom: Bom;
  cutList: CutList;
  /** The content hash of the lock the items come from: the sheet states it. */
  lock?: string;
}

const len = (x: number) => quantize(x, QUANTUM.len_mm);
const ang = (x: number) => quantize(x, QUANTUM.ang_deg);
const p2 = (p: readonly [number, number]): [number, number] => [len(p[0]), len(p[1])];

function holeOut(h: ResolvedHole): SheetHole {
  return {
    id: h.id,
    ...(h.leg ? { leg: h.leg } : {}),
    at_mm: p2(h.at),
    ...(h.flat ? { flat_mm: p2(h.flat) } : {}),
    type: h.type,
    d_mm: len(h.d),
    ...(h.thread !== undefined ? { thread: h.thread } : {}),
    ...(h.depth !== undefined ? { depth_mm: len(h.depth) } : {}),
    ...(h.csk
      ? { csk: { d_mm: len(h.csk.d), angle_deg: ang(h.csk.angle), depth_mm: len(h.csk.depth) } }
      : {}),
    ...(h.cbore ? { cbore: { d_mm: len(h.cbore.d), depth_mm: len(h.cbore.depth) } } : {}),
    face: h.face,
  };
}

function partOut(r: ResolvedProjectItem, qty: number, sources: string[]): SheetPart {
  const head = {
    item: r.id,
    name: r.name,
    kind: r.kind as SheetPart["kind"],
    qty,
    sources,
    supplier: r.supplier as string,
    material: r.material as string,
    thickness_mm: len(r.thickness as number),
  };
  if (r.plate) {
    return {
      ...head,
      datum: DATUMS.plate,
      outline_mm: r.plate.outline.map(p2),
      holes: r.holes.map(holeOut),
    };
  }
  const a = r.angle as NonNullable<ResolvedProjectItem["angle"]>;
  return {
    ...head,
    datum: DATUMS["bent-angle"],
    legs_mm: p2(a.legs),
    length_mm: len(a.length),
    blank_mm: [len(a.length), len(a.developed)],
    blank_datum: DATUMS.blank,
    bend: {
      angle_deg: 90,
      radius_mm: len(a.radius),
      k_factor: a.k,
      allowance_mm: len(a.allowance),
      from_mm: len(a.bendFrom),
      to_mm: len(a.bendTo),
    },
    holes: r.holes.map(holeOut),
  };
}

export function machiningSheet(input: MachiningInput): MachiningSheet {
  const { resolved } = projectItems(input.items, input.derived.doc);
  const parts: SheetPart[] = [];
  for (const g of input.bom.groups) {
    if (g.kind !== "plate" && g.kind !== "bent-angle") continue;
    for (const l of g.lines) {
      const r = resolved.get(l.item);
      if (r) parts.push(partOut(r, l.qty, l.sources));
    }
  }
  parts.sort((a, b) => compareIds(a.item, b.item));
  const bars: SheetBarRef[] = input.cutList.groups.flatMap((g) =>
    g.lines
      .filter((l) => l.machining.length > 0)
      .map((l) => ({
        item: g.item,
        opt: g.opt,
        cut_mm: l.cut_mm,
        count: l.count,
        ops: l.machining.length,
        machining: l.machining.map(machiningText),
        sources: l.sources,
      })),
  );
  return {
    schema: MACHINING_SCHEMA,
    ...(input.lock !== undefined ? { lock: input.lock } : {}),
    parts,
    bars,
    diagnostics: [],
  };
}
