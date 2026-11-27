import { compareIds } from "../ids.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar } from "./derive.ts";
import { type GenOut, generateFaces } from "./fastenings.ts";
import { connectorHardware } from "./hardware.ts";
import { placeParts } from "./parts.ts";
import { layoutRails } from "./rails.ts";
import type { DerivedPart, FaceResult, HardwareUse, PlacedRun, StockPiece } from "./types.ts";

/**
 * Stage 4, attach (design §5.1): on the trimmed bars of stage 3,
 *
 * 1. rail holes, from each rail's cut and how it is sold (§4.7);
 * 2. parts and part patterns, which may measure from cut ends and stand at rail holes (§4.7);
 * 3. face contacts, stations, fasteners and sleeves cut from bar stock, grips, and the holes a
 *    `bolt` or `screw` needs (§4.5);
 * 4. connectors' hardware sets by system and their machining (§3.4).
 *
 * Generated machining is appended to each bar's `ops`, after the holes a person wrote, in a fixed
 * order: by connection id, then station. Nothing here moves a bar or changes a cut.
 */

export interface Attached {
  parts: Map<string, DerivedPart>;
  fastenings: Map<string, FaceResult>;
  pieces: StockPiece[];
  hardware: HardwareUse[];
  recipes: HardwareUse[];
}

export function attach(
  ctx: Ctx,
  bars: ReadonlyMap<string, DerivedBar>,
  runs: ReadonlyMap<string, PlacedRun>,
): Attached {
  layoutRails(ctx, bars);
  const parts = placeParts(ctx, bars, runs);
  const out: GenOut = { fastenings: new Map(), pieces: [], hardware: [], recipes: [] };
  generateFaces(ctx, bars, runs, parts, out);
  connectorHardware(ctx, bars, out);
  return {
    parts,
    fastenings: out.fastenings,
    pieces: [...out.pieces].sort((a, b) => compareIds(a.source, b.source)),
    hardware: out.hardware,
    recipes: out.recipes,
  };
}
