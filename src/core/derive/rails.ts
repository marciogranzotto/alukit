import { num } from "#catalog/schema/common.ts";
import type { BarItem } from "#catalog/schema/items.ts";
import type { OfferInfo } from "../items.ts";
import type { RailHolesSel } from "../project/schema.ts";
import { snapFloor } from "../quantum.ts";
import { TOL } from "../tolerances.ts";
import { add, addScaled, dot, scale, sub, type V3 } from "../vec.ts";
import type { Ctx } from "./context.ts";
import type { DerivedBar } from "./derive.ts";
import { boxCentre } from "./place.ts";
import type { EndReport, PlacedRun, RailHole, RailLayout } from "./types.ts";

/**
 * Rails' holes (design §4.7). A rail's layout follows how it is sold:
 *
 * - `{ factory: "a" | "b" }`: cut from a stock length at its other end. The factory end keeps the
 *   stock offer's `factory_E_mm`; holes follow at the pitch toward the cut end while the end
 *   distance there stays at least `E_min_mm`. When the stock lengths differ in `factory_E_mm`,
 *   `stock_mm` names the one the piece comes from, and nesting keeps it there (§5.3).
 * - `{ drilled: true }`: drilled to order: the most holes that keep both ends at least
 *   `E_min_mm`, centred.
 * - `{ E_a_mm }` or `{ E_b_mm }`: a rail in hand: that end's distance, the layout phased from it.
 * - absent: `factory: "a"` when an offer sells it in stock lengths (with a warning), else drilled.
 *
 * End distances are measured along the rail's box centre line, which its holes stand on.
 */

/** Where an end face crosses the bar's box centre line, as a distance along the axis from A. */
function centreCrossing(b: DerivedBar, e: EndReport): number {
  const bar = b.placed;
  const [cx, cy] = boxCentre(bar.box);
  const C = add(bar.A, add(scale(bar.frame.x, cx), scale(bar.frame.y, cy)));
  return dot(sub(e.point, C), e.normal) / dot(bar.frame.t, e.normal);
}

function optionsMatch(o: OfferInfo, opt: Readonly<Record<string, string>>): boolean {
  return Object.entries(o.options).every(([k, v]) => opt[k] === v);
}

const fmt = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

/** Lays out every rail's holes, on `DerivedBar.rail`. */
export function layoutRails(ctx: Ctx, bars: ReadonlyMap<string, DerivedBar>): void {
  for (const [id, b] of bars) {
    const layout = railLayout(ctx, id, b);
    if (layout) b.rail = layout;
  }
}

function railLayout(ctx: Ctx, id: string, b: DerivedBar): RailLayout | undefined {
  const { d } = ctx;
  const spec = ctx.bars.get(id)?.spec;
  const holes = spec?.holes;
  const report = !b.placed.copy; // a pattern copy repeats its template's problems
  const found = ctx.items.item(b.placed.item.id);
  const item = found.ok ? (found.item as BarItem) : undefined;
  if (item?.shape !== "rail" || !item.rail) {
    if (holes && report) {
      d.error("rail", id, `holes: ${b.placed.item.id} is not a rail with a hole layout`, {
        field: "holes",
      });
    }
    return undefined;
  }
  const pitch = num(item.rail.pitch_mm);
  const eMin = num(item.rail.E_min_mm);
  const eMax = num(item.rail.E_max_mm);
  const ca = centreCrossing(b, b.ends.a);
  const cb = centreCrossing(b, b.ends.b);
  const offers = ctx.items.offers(b.placed.item.id).filter((o) => optionsMatch(o, b.placed.opt));
  const stock = offers.filter((o) => o.sale?.mode === "stock");

  let mode = holes;
  if (mode === undefined) {
    if (stock.length > 0) {
      mode = { factory: "a" };
      if (report) {
        d.warn(
          "rail",
          id,
          "a rail sold in stock lengths with no factory end named: its holes are laid out from end a",
          { field: "holes" },
        );
      }
    } else mode = { drilled: true };
  }

  const fromEnd = (end: "a" | "b", E: number): number[] | undefined => {
    // Holes at E, E + pitch, … from the given end while the far end keeps at least E_min.
    const n = snapFloor((cb - ca - E - eMin) / pitch);
    if (n < 0) {
      d.error(
        "rail",
        id,
        `the rail is ${fmt(cb - ca)} mm: too short for a hole at ${fmt(E)} from end ${end} and ${fmt(eMin)} from the other`,
      );
      return undefined;
    }
    const out: number[] = [];
    for (let k = 0; k <= n; k++) out.push(end === "a" ? ca + E + k * pitch : cb - E - k * pitch);
    return out.sort((x, y) => x - y);
  };
  const drilled = (): number[] | undefined => {
    const span = cb - ca - 2 * eMin;
    if (span < -TOL.len) {
      d.error(
        "rail",
        id,
        `the rail is ${fmt(cb - ca)} mm: too short for a hole ${fmt(eMin)} from each end`,
      );
      return undefined;
    }
    const n = Math.max(0, snapFloor(span / pitch));
    const E = eMin + (span - n * pitch) / 2;
    return Array.from({ length: n + 1 }, (_, k) => ca + E + k * pitch);
  };

  let out: Omit<RailLayout, "holes" | "E_a" | "E_b"> & { holes?: number[] };
  if ("factory" in mode) {
    const end = mode.factory;
    if (b.ends[end].mitre !== undefined && report) {
      d.error("rail", `${id}.${end}`, "a rail's factory end must be square");
    }
    const pick = factoryStock(ctx, id, b, stock, mode.stock_mm, ca, cb, report);
    if (pick) {
      out = {
        how: "factory",
        factory: end,
        ...(pick.stock_mm !== undefined ? { stock_mm: pick.stock_mm } : {}),
        pitch,
        holes: fromEnd(end, pick.E),
      };
    } else out = { how: "drilled", pitch, holes: drilled() };
  } else if ("drilled" in mode) {
    out = { how: "drilled", pitch, holes: drilled() };
  } else {
    const end = "E_a_mm" in mode ? "a" : "b";
    const E = ctx.num(id, `holes/E_${end}_mm`, "E_a_mm" in mode ? mode.E_a_mm : mode.E_b_mm);
    out = {
      how: end === "a" ? "E_a" : "E_b",
      pitch,
      holes: E === undefined ? undefined : fromEnd(end, E),
    };
  }
  const hs = out.holes;
  if (!hs || hs.length === 0) return undefined;
  const layout: RailLayout = {
    ...out,
    holes: hs,
    E_a: (hs[0] as number) - ca,
    E_b: cb - (hs[hs.length - 1] as number),
  };
  for (const [end, E] of [
    ["a", layout.E_a],
    ["b", layout.E_b],
  ] as const) {
    if ((E < eMin - TOL.len || E > eMax + TOL.len) && report) {
      d.error(
        "rail",
        `${id}.${end}`,
        `the end distance E at end ${end} is ${fmt(E)} mm, outside ${b.placed.item.id}'s range ${fmt(eMin)}–${fmt(eMax)} mm`,
      );
    }
  }
  return layout;
}

/**
 * The factory end distance and, when nesting must keep the piece to one stock length, that
 * length. Undefined (with an error) when no stock offer gives one; the rail is then laid out as
 * drilled to order.
 */
function factoryStock(
  ctx: Ctx,
  id: string,
  b: DerivedBar,
  stock: readonly OfferInfo[],
  stockMm: number | undefined,
  ca: number,
  cb: number,
  report: boolean,
): { E: number; stock_mm?: number } | undefined {
  const { d } = ctx;
  const item = b.placed.item.id;
  const withE = stock.filter((o) => o.sale?.factory_E_mm !== undefined);
  if (withE.length === 0) {
    if (report) {
      d.error(
        "rail",
        id,
        `holes: a factory end needs a stock offer of ${item} that gives its factory_E_mm; its holes are centred instead`,
        { field: "holes" },
      );
    }
    return undefined;
  }
  const len = (o: OfferInfo) => o.sale?.length_mm as number;
  const E = (o: OfferInfo) => o.sale?.factory_E_mm as number;
  if (stockMm !== undefined) {
    const o = withE.find((x) => Math.abs(len(x) - stockMm) <= TOL.len);
    if (o) return { E: E(o), stock_mm: len(o) };
    if (report) {
      d.error(
        "rail",
        id,
        `holes/stock_mm: ${item} is not sold in a stock length of ${stockMm} mm`,
        {
          field: "holes/stock_mm",
        },
      );
    }
    return undefined;
  }
  const values = [...new Set(withE.map(E))];
  if (values.length === 1) return { E: values[0] as number };
  // The stock lengths drill their ends differently: the piece's holes depend on which one it is
  // cut from, which nesting must then never change. Take the shortest that holds it.
  const sorted = [...withE].sort((x, y) => len(x) - len(y));
  const o =
    sorted.find((x) => len(x) >= cb - ca - TOL.len) ?? (sorted[sorted.length - 1] as OfferInfo);
  if (report) {
    const list = sorted.map((x) => `${len(x)}: ${fmt(E(x))}`).join(", ");
    d.error(
      "rail",
      id,
      `holes: ${item}'s stock lengths differ in factory_E_mm (${list}); name stock_mm. Laid out from the ${len(o)} mm length`,
      { field: "holes/stock_mm" },
    );
  }
  return { E: E(o), stock_mm: len(o) };
}

// ---------------------------------------------------------------------------------------------
// Selections (§4.7): every n-th hole from the first, plus the first, the last and those beside
// each joint of a run.

/** Every hole of a rail or a run of rails, numbered from its start; undefined with an error. */
export function railHoles(
  ctx: Ctx,
  owner: string,
  field: string,
  along: string,
  bars: ReadonlyMap<string, DerivedBar>,
  runs: ReadonlyMap<string, PlacedRun>,
): { holes: RailHole[]; joints: number[] } | undefined {
  const pieces: { bar: DerivedBar; start: number }[] = [];
  let joints: number[] = [];
  if (along.startsWith("r")) {
    const run = runs.get(along);
    if (!run) {
      if (!Object.hasOwn(ctx.doc.runs, along)) {
        ctx.d.error("ref", owner, `${field}: no run ${along}`, { field, refs: [along] });
      } else ctx.depFailed(owner, field, along);
      return undefined;
    }
    for (const [i, pb] of run.bars.entries()) {
      const b = bars.get(pb.id);
      if (!b) {
        ctx.depFailed(owner, field, pb.id);
        return undefined;
      }
      pieces.push({ bar: b, start: run.starts[i] as number });
    }
    joints = run.ends.slice(0, -1);
  } else {
    const b = bars.get(along);
    if (!b) {
      if (!ctx.bars.has(along)) {
        ctx.d.error("ref", owner, `${field}: no bar ${along}`, { field, refs: [along] });
      } else ctx.depFailed(owner, field, along);
      return undefined;
    }
    pieces.push({ bar: b, start: 0 });
  }
  const holes: RailHole[] = [];
  for (const { bar, start } of pieces) {
    if (!bar.rail) {
      ctx.d.error("rail", owner, `${field}: ${bar.placed.id} has no hole layout`, {
        field,
        refs: [bar.placed.id],
      });
      return undefined;
    }
    for (const s of bar.rail.holes) holes.push({ bar: bar.placed.id, s, r: start + s });
  }
  return { holes, joints };
}

/** The holes a selection takes, in order along the rail or run. */
export function selectHoles(
  ctx: Ctx,
  owner: string,
  field: string,
  sel: true | RailHolesSel,
  along: string,
  bars: ReadonlyMap<string, DerivedBar>,
  runs: ReadonlyMap<string, PlacedRun>,
): RailHole[] | undefined {
  const all = railHoles(ctx, owner, field, sel === true ? along : sel.along, bars, runs);
  if (!all) return undefined;
  if (sel === true) return all.holes;
  const { holes, joints } = all;
  const every = sel.every ?? 1;
  const keep = new Set<number>();
  for (let i = 0; i < holes.length; i += every) keep.add(i);
  const plus = new Set(sel.plus ?? []);
  if (holes.length > 0) {
    if (plus.has("first")) keep.add(0);
    if (plus.has("last")) keep.add(holes.length - 1);
  }
  if (plus.has("joint")) {
    for (const j of joints) {
      let before = -1;
      let after = -1;
      holes.forEach((h, i) => {
        if (h.r < j) before = i;
        else if (after < 0) after = i;
      });
      if (before >= 0) keep.add(before);
      if (after >= 0) keep.add(after);
    }
  }
  return [...keep].sort((x, y) => x - y).map((i) => holes[i] as RailHole);
}

/** A hole's point on its rail's design line. */
export function holePoint(b: DerivedBar, s: number): V3 {
  return addScaled(b.placed.A, b.placed.frame.t, s);
}
