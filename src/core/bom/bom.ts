import type { Src } from "#catalog/schema/common.ts";
import { num } from "#catalog/schema/common.ts";
import { derivedPieces } from "../cutlist/cutlist.ts";
import type { Derived } from "../derive/derive.ts";
import { type Diagnostic, Diagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import { PROJECT_KINDS } from "../project/schema.ts";
import { projectItems } from "../project-items/source.ts";
import { QUANTUM, quantize } from "../quantum.ts";

/**
 * The bill of materials (design §5.4): every item and option with its quantity, grouped by kind,
 * with mass by §3.5's authority rule. Bars give their piece count and total cut length; their
 * mass is each piece's centre-line length times the bar's mass per metre (exact for an angled end
 * on a section symmetric about its box centre). Unplaced lines (§4.7) count with the item's other
 * uses and show their `why`. Prices, offers and covering cost lines are the order list's (§5.4,
 * M3b part 3). Project items (§4.8) group by their own kinds after §3.4's: a plate's and a bent
 * angle's mass is computed from its net volume (`calc`), a placeholder's is as entered. Joint
 * recipes (§3.4) are listed apart, in no group: not bought, no mass, no mass warning.
 *
 * Each line's mass is rounded once to the 0.001 kg quantum; the total adds the rounded lines.
 */

export const BOM_SCHEMA = "alukit.bom/1";

/** Kinds in the order of design §3.4, then the project's own kinds of §4.8. */
export const KINDS = [
  "bar",
  "connector",
  "fastener",
  "carriage",
  "accessory",
  "panel",
  "generic",
  ...PROJECT_KINDS,
] as const;

export interface BomLine {
  item: string;
  name: string;
  opt: Readonly<Record<string, string>>;
  /** Units; for bars, pieces. */
  qty: number;
  /** Bars: the pieces' cut lengths added. */
  length_mm?: number;
  /** Per unit, or per metre for bars; absent when nothing gives a mass. */
  unit_mass_kg?: number;
  mass_kg?: number;
  /** Where the mass comes from: as published (`src`, `meas`, `est`) or computed (`calc`). */
  mass_src?: Src;
  /** The entities that use it: bars, connections, parts. */
  sources: string[];
  /** Unplaced lines among the uses (§4.7). */
  unplaced?: { part: string; qty: number; why: string }[];
}

export interface BomGroup {
  kind: string;
  lines: BomLine[];
  /** The lines' masses added; lines with no mass are left out and listed in `mass_unknown`. */
  mass_kg: number;
}

/**
 * A joint recipe the connections use (§3.4, acceptance gap A2): a connector with no body. It is
 * not bought and weighs nothing; the fasteners, sleeves and machining it brings are on their own
 * lines, which name its connections among their sources.
 */
export interface BomRecipe {
  item: string;
  name: string;
  /** Uses: one per butting end and unit, as a connector counts. */
  qty: number;
  /** The connections that use it. */
  sources: string[];
}

export interface Bom {
  schema: typeof BOM_SCHEMA;
  /**
   * The stamp (§5.4, §4.13): the content hash of the lock it was derived from, when it was. It
   * carries no prices, so it states no basis and no read date.
   */
  lock?: string;
  groups: BomGroup[];
  /** Present when the connections use joint recipes; they are in no group and no total. */
  recipes?: BomRecipe[];
  mass_kg: number;
  /** Items with no mass: their lines are left out of the totals. */
  mass_unknown: string[];
  diagnostics: Diagnostic[];
}

const mass = (x: number) => quantize(x, QUANTUM.mass_kg);
const len = (x: number) => quantize(x, QUANTUM.len_mm);

function optKey(opt: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.keys(opt)
      .sort()
      .map((k) => [k, opt[k]]),
  );
}

interface Acc {
  item: string;
  opt: Readonly<Record<string, string>>;
  qty: number;
  /** Bars: Σ cut and Σ centre. */
  cut: number;
  centre: number;
  sources: Set<string>;
  unplaced: { part: string; qty: number; why: string }[];
}

export interface BomInput {
  derived: Derived;
  items: ItemSource;
  /** The content hash of the lock the items come from: the BOM states it. */
  lock?: string;
}

export function bom(input: BomInput): Bom {
  const { derived, items: catalogs } = input;
  const items = projectItems(catalogs, derived.doc).source;
  const d = new Diagnostics();
  const acc = new Map<string, Acc>();
  const add = (item: string, opt: Readonly<Record<string, string>>): Acc => {
    const k = `${item}\u0000${optKey(opt)}`;
    let a = acc.get(k);
    if (!a) {
      a = { item, opt, qty: 0, cut: 0, centre: 0, sources: new Set(), unplaced: [] };
      acc.set(k, a);
    }
    return a;
  };

  for (const p of derivedPieces(derived)) {
    const a = add(p.item, p.opt);
    a.qty += 1;
    a.cut += len(p.cut);
    a.centre += p.centre;
    a.sources.add(p.source.replace(/\.[fs]\d+$/, ""));
  }
  for (const p of derived.parts.values()) {
    const a = add(p.item, p.opt);
    if (p.placed) {
      a.qty += 1;
      a.sources.add(p.id);
    } else {
      a.qty += p.qty;
      a.sources.add(p.id);
      a.unplaced.push({ part: p.id, qty: p.qty, why: p.why });
    }
  }
  for (const h of derived.hardware) {
    const a = add(h.item, h.opt);
    a.qty += h.qty;
    a.sources.add(h.source);
  }

  const byKind = new Map<string, BomLine[]>();
  const unknown = new Set<string>();
  for (const a of acc.values()) {
    const found = items.item(a.item);
    if (!found.ok) continue; // reported by derive
    const kind = found.item.kind;
    let m: { unit: number; total: number; src: Src } | undefined;
    if (kind === "bar") {
      const pm = found.bar?.mass_kg_per_m;
      if (pm) m = { unit: pm.v, total: (a.centre * pm.v) / 1000, src: pm.src };
    } else {
      const pm = (found.item as { mass_kg?: number | { v: number; src?: Src } }).mass_kg;
      if (pm !== undefined) {
        const src = (typeof pm === "object" ? pm.src : undefined) ?? found.item.prov.src;
        m = { unit: num(pm), total: a.qty * num(pm), src };
      }
    }
    if (!m) {
      unknown.add(a.item);
      d.warn("mass", a.item, `${a.item} has no mass: its line is left out of the totals`);
    }
    const line: BomLine = {
      item: a.item,
      name: found.item.name,
      opt: Object.fromEntries(Object.entries(a.opt).sort(([x], [y]) => cmp(x, y))),
      qty: a.qty,
      ...(kind === "bar" ? { length_mm: len(a.cut) } : {}),
      ...(m ? { unit_mass_kg: mass(m.unit), mass_kg: mass(m.total), mass_src: m.src } : {}),
      sources: [...a.sources].sort(compareIds),
      ...(a.unplaced.length > 0
        ? { unplaced: [...a.unplaced].sort((x, y) => compareIds(x.part, y.part)) }
        : {}),
    };
    const list = byKind.get(kind) ?? [];
    list.push(line);
    byKind.set(kind, list);
  }

  const groups: BomGroup[] = [];
  for (const kind of KINDS) {
    const lines = byKind.get(kind);
    if (!lines) continue;
    lines.sort((x, y) => compareIds(x.item, y.item) || cmp(optKey(x.opt), optKey(y.opt)));
    groups.push({ kind, lines, mass_kg: mass(lines.reduce((s, l) => s + (l.mass_kg ?? 0), 0)) });
  }

  const recipes = new Map<string, BomRecipe>();
  for (const r of derived.recipes) {
    const found = items.item(r.item);
    let e = recipes.get(r.item);
    if (!e) {
      e = { item: r.item, name: found.ok ? found.item.name : r.item, qty: 0, sources: [] };
      recipes.set(r.item, e);
    }
    e.qty += r.qty;
    if (!e.sources.includes(r.source)) e.sources.push(r.source);
  }
  const recipeList = [...recipes.values()]
    .sort((x, y) => compareIds(x.item, y.item))
    .map((r) => ({ ...r, sources: [...r.sources].sort(compareIds) }));

  return {
    schema: BOM_SCHEMA,
    ...(input.lock !== undefined ? { lock: input.lock } : {}),
    groups,
    ...(recipeList.length > 0 ? { recipes: recipeList } : {}),
    mass_kg: mass(groups.reduce((s, g) => s + g.mass_kg, 0)),
    mass_unknown: [...unknown].sort(compareIds),
    diagnostics: d.sorted(),
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
