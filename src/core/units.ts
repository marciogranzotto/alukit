/**
 * Units by field-name suffix (design §2). A field's unit is the suffix of its name, from a fixed
 * list: `Ix_mm4`, `torque_Nm`, `regular_minor`. Values are stored as their source prints them;
 * `toBase` converts to the base units (mm, N, N·mm, MPa, kg, degrees) when a calculation needs it.
 */

export interface UnitDef {
  /** The suffix without its leading underscore: `mm4`, `kg_per_m`. */
  readonly suffix: string;
  /** What it measures. */
  readonly quantity: string;
  /** The base unit a value converts to. */
  readonly base: string;
  /** Multiply a value in this unit by this to get the base unit. */
  readonly toBase: number;
}

/**
 * The fixed list. The last four are additions to design §2's list, needed by fields §3.4 names
 * (stiffness per degree of freedom, straightness and twist tolerances); see docs/notes/m1-decisions.md.
 */
export const UNITS: readonly UnitDef[] = [
  { suffix: "mm", quantity: "length", base: "mm", toBase: 1 },
  { suffix: "m", quantity: "length", base: "mm", toBase: 1000 },
  { suffix: "km", quantity: "length", base: "mm", toBase: 1e6 },
  { suffix: "mm2", quantity: "area", base: "mm2", toBase: 1 },
  { suffix: "mm3", quantity: "volume or section modulus", base: "mm3", toBase: 1 },
  { suffix: "mm4", quantity: "second moment of area", base: "mm4", toBase: 1 },
  { suffix: "N", quantity: "force", base: "N", toBase: 1 },
  { suffix: "kN", quantity: "force", base: "N", toBase: 1000 },
  { suffix: "Nmm", quantity: "moment or torque", base: "Nmm", toBase: 1 },
  { suffix: "Nm", quantity: "moment or torque", base: "Nmm", toBase: 1000 },
  { suffix: "MPa", quantity: "stress or modulus", base: "MPa", toBase: 1 },
  { suffix: "kg", quantity: "mass", base: "kg", toBase: 1 },
  { suffix: "kg_per_m", quantity: "mass per length", base: "kg_per_mm", toBase: 1e-3 },
  { suffix: "kg_per_m3", quantity: "density", base: "kg_per_mm3", toBase: 1e-9 },
  { suffix: "deg", quantity: "angle", base: "deg", toBase: 1 },
  { suffix: "per_K", quantity: "thermal expansion", base: "per_K", toBase: 1 },
  { suffix: "J", quantity: "energy", base: "Nmm", toBase: 1000 },
  { suffix: "minor", quantity: "money in minor units", base: "minor", toBase: 1 },
  { suffix: "N_per_mm", quantity: "linear stiffness", base: "N_per_mm", toBase: 1 },
  { suffix: "Nmm_per_rad", quantity: "rotational stiffness", base: "Nmm_per_rad", toBase: 1 },
  { suffix: "mm_per_m", quantity: "straightness", base: "mm_per_mm", toBase: 1e-3 },
  { suffix: "deg_per_m", quantity: "twist", base: "deg_per_mm", toBase: 1e-3 },
];

/** Longest suffix first, so `mass_kg_per_m` is kg/m and not m. */
const BY_LENGTH = [...UNITS].sort((a, b) => b.suffix.length - a.suffix.length);

/**
 * The unit of a field name, by the longest suffix that follows an underscore, or undefined when
 * the name carries none (`nu`, `safety_factor`). An axis qualifier (`F_N.x`) is ignored.
 */
export function unitOf(name: string): UnitDef | undefined {
  const bare = name.replace(/\.[xyz]$/, "");
  return BY_LENGTH.find((u) => bare.endsWith(`_${u.suffix}`) && bare.length > u.suffix.length + 1);
}

/** The value of field `name` in base units. Throws when the name has no known unit suffix. */
export function toBase(name: string, value: number): number {
  const unit = unitOf(name);
  if (!unit) throw new RangeError(`no unit suffix in field name "${name}"`);
  return value * unit.toBase;
}

/**
 * A pattern for keys of open maps whose values are quantities (dimensions, ETA values): the key
 * must end in a known unit suffix, so an unknown suffix is a schema error (design §2).
 */
export const SUFFIXED_KEY = new RegExp(
  `^[A-Za-z][A-Za-z0-9]*(?:[_.][A-Za-z0-9]+)*?_(?:${BY_LENGTH.map((u) => u.suffix).join("|")})$`,
);

/** Millimetres per metre. Lengths are stored in mm (design §2). */
export const MM_PER_M = 1000;

/** Converts millimetres to metres. */
export function mFromMm(mm: number): number {
  return mm / MM_PER_M;
}

/** Converts metres to millimetres. */
export function mmFromM(m: number): number {
  return m * MM_PER_M;
}
