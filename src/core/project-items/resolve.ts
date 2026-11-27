import type { Src } from "#catalog/schema/common.ts";
import { isValuedObject, num } from "#catalog/schema/common.ts";
import type { Diagnostic, DiagnosticCode } from "../diagnostics.ts";
import type { ItemSource, MassInfo, PriceField, ProjectItemView } from "../items.ts";
import type {
  BentAngleItem,
  HoleFeature,
  PlaceholderItem,
  PlateItem,
  ProjectGenericItem,
  ProjectItem,
} from "../project/schema.ts";
import { tapDrill, threadDiameter } from "../threads.ts";
import { TOL } from "../tolerances.ts";
import type { V3 } from "../vec.ts";
import {
  bendAllowance90,
  circleArea,
  cskDepth,
  developedLength,
  distToBoundary,
  frustumVolume,
  insidePolygon,
  type P2,
  selfCrossing,
  signedArea,
} from "./geometry.ts";
import { LOCAL } from "./supplier.ts";

/**
 * A project item resolved (design §4.8): its holes valued, its blank and mass computed, its box in
 * its own frame, who makes or sells it and at what price. Problems are diagnostics on
 * `project:<id>`; an item with a problem still resolves as far as it can (§5.1), and a mass that
 * cannot be computed is left out, so the BOM says so.
 *
 * - **Mass**: the net volume times the material's density: a plate's outline area, or a bent
 *   angle's developed length times its length, times the thickness, less the material each hole
 *   removes (its drill, a counterbore's ring, a countersink's cone). Tagged `calc`. A placeholder
 *   or a generic item takes its `mass_kg`, an estimate unless it says otherwise.
 * - **A bent angle**: one 90° bend; its developed length is A + B − 2 (R + T) + BA with the bend
 *   allowance BA = (π / 2)(R + K T) (geometry.ts).
 * - **Holes**: a threaded hole is drilled at its tap drill (major diameter minus pitch, unless it
 *   names `d_mm`); a hole must lie inside its plate's outline, or on the flat of its leg, and not
 *   overlap another.
 */

/** How the machining sheet names a hole's kind. */
export type HoleType = "through" | "blind" | "threaded" | "countersunk" | "counterbored";

export interface ResolvedHole {
  /** `h1`, `h2` … on a plate; `a1` … and `b1` … on a bent angle's legs, in the order written. */
  id: string;
  leg?: "a" | "b";
  /** On the part, from its datum: a plate's outline coordinates, a leg's [x, distance from the heel]. */
  at: P2;
  /** A bent angle's hole on its flat blank: [x, distance from leg a's free edge]. */
  flat?: P2;
  type: HoleType;
  /** The drill: a threaded hole's tap drill. */
  d: number;
  thread?: string;
  /** A blind hole's or a thread's depth; undefined: through. */
  depth?: number;
  csk?: { d: number; angle: number; depth: number };
  cbore?: { d: number; depth: number };
  face: "front" | "back";
  /** The widest radius along the hole: a countersink's or counterbore's, else the drill's. */
  r: number;
  /** The material it removes, mm³. */
  volume: number;
}

export interface ResolvedPlate {
  /** The outline as written, and its area (mm²). */
  outline: P2[];
  area: number;
}

export interface ResolvedAngle {
  legs: P2;
  length: number;
  radius: number;
  k: number;
  /** The bend allowance and the developed length of the flat blank. */
  allowance: number;
  developed: number;
  /** Where the bend zone runs on the blank, from leg a's free edge. */
  bendFrom: number;
  bendTo: number;
}

export interface ResolvedProjectItem {
  /** `project:<id>`. */
  id: string;
  def: ProjectItem;
  kind: ProjectItem["kind"];
  name: string;
  view: ProjectItemView;
  /** Who makes or sells it; undefined: unsourced. Plates and bent angles default to `local`. */
  supplier?: string;
  /** Its price per unit in the project's currency, with the date it was read. */
  price?: PriceField & { read?: string };
  material?: string;
  thickness?: number;
  holes: ResolvedHole[];
  plate?: ResolvedPlate;
  angle?: ResolvedAngle;
}

class Problems {
  readonly list: Diagnostic[] = [];
  readonly entity: string;
  constructor(entity: string) {
    this.entity = entity;
  }
  error(code: DiagnosticCode, field: string, message: string): void {
    this.list.push({ severity: "error", code, entity: this.entity, field, message });
  }
}

const mm = (x: number) => `${Number(x.toFixed(2))}`;

/** A price as a valued field (§2): a bare number is an estimate (M3b order decisions #33). */
export function projectPrice(
  p: ProjectItem["price_minor"],
): (PriceField & { read?: string }) | undefined {
  if (p === undefined) return undefined;
  if (typeof p === "number") return { v: p, src: "est" };
  return {
    v: p.v,
    ...(p.low !== undefined ? { low: p.low } : {}),
    ...(p.high !== undefined ? { high: p.high } : {}),
    src: p.src ?? "est",
    ...(p.read !== undefined ? { read: p.read } : {}),
  };
}

/** An entered mass: a bare number is an estimate. */
function enteredMass(m: PlaceholderItem["mass_kg"]): MassInfo | undefined {
  if (m === undefined) return undefined;
  return { v: num(m), src: ((isValuedObject(m) ? m.src : undefined) ?? "est") as Src };
}

/** One hole valued in a part of thickness `T`: its drill, depths, widest radius and volume. */
function valueHole(
  h: HoleFeature,
  id: string,
  field: string,
  T: number,
  p: Problems,
): Omit<ResolvedHole, "at" | "flat" | "leg"> | undefined {
  let ok = true;
  let d = h.d_mm;
  if (h.thread !== undefined) {
    const major = threadDiameter(h.thread);
    d ??= tapDrill(h.thread);
    if (d === undefined) {
      p.error("hole", field, `${id}: no tap drill known for ${h.thread}: give it as d_mm`);
      return undefined;
    }
    if (major !== undefined && d >= major) {
      p.error("hole", field, `${id}: tap drill Ø${mm(d)} is not smaller than ${h.thread}`);
      ok = false;
    }
  }
  const drill = d as number;
  const depth = h.depth_mm;
  if (depth !== undefined && depth >= T - TOL.len) {
    p.error(
      "hole",
      field,
      `${id}: depth ${mm(depth)} reaches through the ${mm(T)} mm thickness: leave depth_mm out for a through hole`,
    );
    ok = false;
  }
  const along = depth ?? T;
  let volume = circleArea(drill) * along;
  let r = drill / 2;
  let csk: ResolvedHole["csk"];
  let cbore: ResolvedHole["cbore"];
  if (h.csk) {
    const D = h.csk.d_mm;
    if (D <= drill) {
      p.error(
        "hole",
        field,
        `${id}: countersink Ø${mm(D)} is not wider than the hole, Ø${mm(drill)}`,
      );
      ok = false;
    } else {
      const cd = cskDepth(D, drill, h.csk.angle_deg);
      if (cd > along + TOL.len) {
        p.error(
          "hole",
          field,
          `${id}: the countersink is ${mm(cd)} deep, more than the hole's ${mm(along)}`,
        );
        ok = false;
      }
      csk = { d: D, angle: h.csk.angle_deg, depth: cd };
      volume += frustumVolume(D, drill, cd) - circleArea(drill) * cd;
      r = D / 2;
    }
  }
  if (h.cbore) {
    const D = h.cbore.d_mm;
    if (D <= drill) {
      p.error(
        "hole",
        field,
        `${id}: counterbore Ø${mm(D)} is not wider than the hole, Ø${mm(drill)}`,
      );
      ok = false;
    } else if (h.cbore.depth_mm >= along - TOL.len) {
      p.error(
        "hole",
        field,
        `${id}: the counterbore is ${mm(h.cbore.depth_mm)} deep, not less than the hole's ${mm(along)}`,
      );
      ok = false;
    } else {
      cbore = { d: D, depth: h.cbore.depth_mm };
      volume += (circleArea(D) - circleArea(drill)) * h.cbore.depth_mm;
      r = D / 2;
    }
  }
  if (!ok) return undefined;
  const type: HoleType = h.thread
    ? "threaded"
    : csk
      ? "countersunk"
      : cbore
        ? "counterbored"
        : depth !== undefined
          ? "blind"
          : "through";
  return {
    id,
    type,
    d: drill,
    ...(h.thread !== undefined ? { thread: h.thread } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(csk ? { csk } : {}),
    ...(cbore ? { cbore } : {}),
    face: h.face ?? "front",
    r,
    volume,
  };
}

/** Holes that overlap, in the order written: an error on each pair. */
function overlaps(holes: readonly ResolvedHole[], field: string, p: Problems): boolean {
  let bad = false;
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i] as ResolvedHole;
      const b = holes[j] as ResolvedHole;
      if (a.leg !== b.leg) continue;
      const gap = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) - a.r - b.r;
      if (gap < -TOL.len) {
        p.error("hole", field, `${a.id} and ${b.id} overlap`);
        bad = true;
      }
    }
  }
  return bad;
}

/** The mass of a net volume (mm³) of a material, or undefined with an error when it has none. */
function massOf(
  volume: number | undefined,
  material: string,
  items: ItemSource,
  p: Problems,
): MassInfo | undefined {
  const m = items.material(material);
  if (!m) {
    p.error("item", "material", `no material ${material} (in the lock, or the project's catalogs)`);
    return undefined;
  }
  if (m.density_kg_per_m3 === undefined) {
    p.error(
      "item",
      "material",
      `${material} gives no density_kg_per_m3: its mass cannot be computed`,
    );
    return undefined;
  }
  return volume === undefined
    ? undefined
    : { v: (volume * m.density_kg_per_m3) / 1e9, src: "calc" };
}

function resolvePlate(
  id: string,
  def: PlateItem,
  items: ItemSource,
  p: Problems,
): ResolvedProjectItem {
  const T = def.thickness_mm;
  const pts = def.outline as P2[];
  let good = true;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as P2;
    const b = pts[(i + 1) % pts.length] as P2;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= TOL.len) {
      p.error("outline", "outline", `corners ${i} and ${(i + 1) % pts.length} coincide`);
      good = false;
    }
  }
  const crossing = good ? selfCrossing(pts) : undefined;
  if (crossing) {
    p.error(
      "outline",
      "outline",
      `edges ${crossing[0]} and ${crossing[1]} cross: the outline must not cross itself`,
    );
    good = false;
  }
  const area = Math.abs(signedArea(pts));
  if (good && area <= TOL.len * TOL.len) {
    p.error("outline", "outline", "the outline encloses no area");
    good = false;
  }

  const holes: ResolvedHole[] = [];
  let holesOk = true;
  (def.holes ?? []).forEach((h, i) => {
    const hid = `h${i + 1}`;
    const field = `holes[${i}]`;
    const v = valueHole(h, hid, field, T, p);
    if (!v) {
      holesOk = false;
      return;
    }
    const hole: ResolvedHole = { ...v, at: h.at };
    if (good) {
      const inside = insidePolygon(h.at, pts);
      const clear = distToBoundary(h.at, pts);
      if (!inside || clear < hole.r - TOL.len) {
        p.error(
          "hole",
          field,
          inside
            ? `${hid} at [${h.at.map(mm).join(", ")}] reaches ${mm(hole.r - clear)} past the outline`
            : `${hid} at [${h.at.map(mm).join(", ")}] is outside the outline`,
        );
        holesOk = false;
      }
    }
    holes.push(hole);
  });
  if (overlaps(holes, "holes", p)) holesOk = false;

  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const bbox: [V3, V3] = [
    [Math.min(...xs), Math.min(...ys), 0],
    [Math.max(...xs), Math.max(...ys), T],
  ];
  const volume = good && holesOk ? area * T - holes.reduce((s, h) => s + h.volume, 0) : undefined;
  const mass = massOf(volume, def.material, items, p);
  return {
    ...common(id, def, mass, bbox),
    supplier: def.supplier ?? LOCAL,
    material: def.material,
    thickness: T,
    holes,
    plate: { outline: pts.map((q) => [q[0], q[1]] as P2), area },
  };
}

function resolveAngle(
  id: string,
  def: BentAngleItem,
  items: ItemSource,
  p: Problems,
): ResolvedProjectItem {
  const T = def.thickness_mm;
  const R = def.bend_radius_mm;
  const K = def.k_factor;
  const [A, B] = def.legs_mm;
  const L = def.length_mm;
  let good = true;
  for (const [leg, len] of [
    ["a", A],
    ["b", B],
  ] as const) {
    if (len <= R + T + TOL.len) {
      p.error(
        "bend",
        "legs_mm",
        `leg ${leg} (${mm(len)}) is not longer than the bend's outside setback, R + T = ${mm(R + T)}: it has no flat`,
      );
      good = false;
    }
  }
  const allowance = bendAllowance90(R, T, K);
  const developed = developedLength(A, B, R, T, K);
  const bendFrom = A - (R + T);
  const flatStart = R + T;

  const holes: ResolvedHole[] = [];
  let holesOk = true;
  for (const leg of ["a", "b"] as const) {
    const legLen = leg === "a" ? A : B;
    (def.holes?.[leg] ?? []).forEach((h, i) => {
      const hid = `${leg}${i + 1}`;
      const field = `holes/${leg}[${i}]`;
      const v = valueHole(h, hid, field, T, p);
      if (!v) {
        holesOk = false;
        return;
      }
      const [x, y] = h.at;
      const flat: P2 = [x, leg === "a" ? A - y : developed - (B - y)];
      const hole: ResolvedHole = { ...v, leg, at: h.at, flat };
      const r = hole.r;
      if (good) {
        if (y - r < flatStart - TOL.len) {
          p.error(
            "hole",
            field,
            `${hid} reaches into the bend: its edge is ${mm(y - r)} from the heel, the flat starts at ${mm(flatStart)}`,
          );
          holesOk = false;
        } else if (y + r > legLen + TOL.len || x - r < -TOL.len || x + r > L + TOL.len) {
          p.error("hole", field, `${hid} at [${h.at.map(mm).join(", ")}] runs off leg ${leg}`);
          holesOk = false;
        }
      }
      holes.push(hole);
    });
  }
  if (overlaps(holes, "holes", p)) holesOk = false;

  const bbox: [V3, V3] = [
    [0, 0, 0],
    [L, A, B],
  ];
  const volume =
    good && holesOk ? developed * L * T - holes.reduce((s, h) => s + h.volume, 0) : undefined;
  const mass = massOf(volume, def.material, items, p);
  return {
    ...common(id, def, mass, bbox),
    supplier: def.supplier ?? LOCAL,
    material: def.material,
    thickness: T,
    holes,
    angle: {
      legs: [A, B],
      length: L,
      radius: R,
      k: K,
      allowance,
      developed,
      bendFrom,
      bendTo: bendFrom + allowance,
    },
  };
}

function resolveBought(
  id: string,
  def: PlaceholderItem | ProjectGenericItem,
  items: ItemSource,
  p: Problems,
): ResolvedProjectItem {
  const material = def.kind === "generic" ? def.material : undefined;
  if (material !== undefined && !items.material(material)) {
    p.error("item", "material", `no material ${material} (in the lock, or the project's catalogs)`);
  }
  const box = def.bbox_mm as readonly [V3, V3] | undefined;
  return {
    ...common(id, def, enteredMass(def.mass_kg), box),
    ...(def.supplier !== undefined ? { supplier: def.supplier } : {}),
    ...(material !== undefined ? { material } : {}),
    holes: [],
  };
}

function common(
  id: string,
  def: ProjectItem,
  mass: MassInfo | undefined,
  bbox: readonly [V3, V3] | undefined,
): Omit<ResolvedProjectItem, "holes"> {
  const price = projectPrice(def.price_minor);
  const material = def.kind === "placeholder" ? undefined : def.material;
  const view: ProjectItemView = {
    kind: def.kind,
    name: def.name,
    ...(material !== undefined ? { material } : {}),
    prov: { src: "est" },
    ...(mass ? { mass_kg: mass } : {}),
    ...(bbox ? { bbox_mm: bbox } : {}),
    ...(def.datums ? { datums: def.datums as Record<string, V3> } : {}),
  };
  return {
    id,
    def,
    kind: def.kind,
    name: def.name,
    view,
    ...(price ? { price } : {}),
  };
}

/** Resolves one project item; its problems go to `out`, on `project:<id>`. */
export function resolveProjectItem(
  id: string,
  def: ProjectItem,
  items: ItemSource,
  out: Diagnostic[],
): ResolvedProjectItem {
  const p = new Problems(id);
  const r =
    def.kind === "plate"
      ? resolvePlate(id, def, items, p)
      : def.kind === "bent-angle"
        ? resolveAngle(id, def, items, p)
        : resolveBought(id, def, items, p);
  out.push(...p.list);
  return r;
}
