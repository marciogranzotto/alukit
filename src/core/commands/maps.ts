import type { BuiltSection } from "#catalog/link.ts";
import type { Expr, Face } from "../project/schema.ts";
import { ang, minus, negate } from "./numbers.ts";
import { refusal } from "./rewrite.ts";
import {
  flipsU,
  type Map2,
  mapAnchor,
  mapFace,
  mapGroove,
  mapOffset,
  type Sym,
} from "./sections.ts";

/**
 * Where a bar's stations, faces and own fields land when the bar is reversed, mirrored, or left
 * where it is under a mirror that maps it onto itself (design §4.3, §4.4).
 */

type O = Record<string, unknown>;

export interface BarMap {
  /** The bar (or run) the image lands on. */
  to: string;
  /** Distances from end a become distances from end b. */
  reversed: boolean;
  /** How the section turns over. */
  m: Map2;
  section: BuiltSection;
}

const FROM_SWAP: Record<string, string> = { a: "b", b: "a", "a.cut": "b.cut", "b.cut": "a.cut" };

export function swapEnd(ref: string): string {
  return ref.endsWith(".a") ? `${ref.slice(0, -2)}.b` : `${ref.slice(0, -2)}.a`;
}

/** A station (§4.3) on a mapped bar: its bar, end, face or groove, and offsets. */
export function mapStation(st: O, bm: BarMap, where: string): O {
  const out: O = { ...st, bar: bm.to };
  if (bm.reversed) {
    const from = FROM_SWAP[(st.from as string | undefined) ?? "a"] as string;
    if (from === "a") delete out.from;
    else out.from = from;
  }
  let face = st.face as Face | undefined;
  if (typeof st.groove === "string") {
    const g = mapGroove(bm.m, bm.section, st.groove);
    if (!g) {
      throw refusal(
        "geometry",
        `${where}: groove ${st.groove} of ${st.bar} has no groove where it lands`,
        {
          entity: where.split("/")[0],
        },
      );
    }
    out.groove = g;
    face = st.groove.slice(0, 2) as Face;
  } else if (face) out.face = mapFace(bm.m, face);
  if (Array.isArray(st.off_mm)) {
    const [u, v] = st.off_mm as [Expr, Expr];
    out.off_mm = face ? [flipsU(bm.m, face) ? negate(u) : u, v] : mapOffset(bm.m, [u, v]);
  }
  return out;
}

/** A roll `c − r`, reduced into [0°, 360°) when numeric, and absent when 0 (§4.4). */
export function turnedRoll(c: number, r: Expr | undefined): Expr | undefined {
  const r0 = r ?? 0;
  if (typeof r0 === "string") return minus(c, r0, ang);
  let v = ang((((c - r0) % 360) + 360) % 360);
  if (v >= 360) v -= 360;
  return v === 0 ? undefined : v;
}

/** A roll `r + c`, the same way. */
export function addedRoll(r: Expr | undefined, c: number): Expr | undefined {
  const r0 = r ?? 0;
  if (typeof r0 === "string") return `${r0} + ${c}`;
  let v = ang((((r0 + c) % 360) + 360) % 360);
  if (v >= 360) v -= 360;
  return v === 0 ? undefined : v;
}

/** A bar's own anchor, offset and roll, so its body is the image of the old one (§4.4). */
export function mapBarFields(id: string, b: O, m: Sym, section: BuiltSection, rollC: number): O {
  const out: O = { ...b };
  const anchor = (b.anchor as string | undefined) ?? "c";
  const a = mapAnchor(m, section, anchor);
  if (a === undefined) {
    throw refusal(
      "geometry",
      `${id}: anchor "${anchor}" of section ${section.id} has no named point where it lands`,
      {
        entity: id,
        field: "anchor",
      },
    );
  }
  if (a === "c") delete out.anchor;
  else out.anchor = a;
  if (Array.isArray(b.off_mm)) out.off_mm = mapOffset(m, b.off_mm as [Expr, Expr]);
  const roll = turnedRoll(rollC, b.roll_deg as Expr | undefined);
  if (roll === undefined) delete out.roll_deg;
  else out.roll_deg = roll;
  return out;
}

/** A bar's ops (§4.4) under a map: faces renamed, and measured from the other end if reversed. */
export function mapOps(ops: unknown, m: Map2, reversed: boolean): unknown {
  if (!Array.isArray(ops)) return ops;
  return ops.map((op) => {
    if (typeof op !== "object" || op === null) return op;
    const o = { ...(op as O) };
    if (typeof o.face === "string") o.face = mapFace(m, o.face as Face);
    if (reversed) {
      if ((o.from ?? "a") === "a") o.from = "b";
      else delete o.from;
    }
    return o;
  });
}
