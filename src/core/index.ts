// The document model, commands and derivation arrive in M3 (design §4, §5). M1 brings the
// conventions of §2 and section properties. This module imports no three.js and nothing from
// src/ui.
export { compareIds, isIntegerLike } from "./ids.ts";
export { QUANTUM, quantize, roundHalfAway, snapCeil, snapFloor, snapInt } from "./quantum.ts";
export {
  type Region,
  type Ring,
  ringArea,
  type SectionProperties,
  sectionProperties,
  type Vec2,
} from "./section-properties.ts";
export { TOL } from "./tolerances.ts";
export { atan2Deg, cosDeg, reduceDeg, sinDeg } from "./trig.ts";
export {
  MM_PER_M,
  mFromMm,
  mmFromM,
  SUFFIXED_KEY,
  toBase,
  UNITS,
  type UnitDef,
  unitOf,
} from "./units.ts";
