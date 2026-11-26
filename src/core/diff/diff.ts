import type { BomLine } from "../bom/bom.ts";
import { entityIds, getEntity, type Kind, LIST_KINDS, MAP_KINDS } from "../commands/doc.ts";
import { applyVariant } from "../derive/variant.ts";
import { compareIds } from "../ids.ts";
import { diffLocks, type FieldChange, fieldChanges, type LockDiff } from "../lock/diff.ts";
import { lockHash } from "../lock/pin.ts";
import type { Lock } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import type { MoneyOut, OrderLine } from "../order/types.ts";
import type { Outputs } from "../revision/outputs.ts";

/**
 * What moved between two sides (design §4.13, §7.3 `alukit diff`): each side is a document, the
 * lock it derives with (its own: a price that changed between two commits shows as a lock change
 * and as its effect on the outputs) and its outputs for one variant. The report names the lock
 * entries, the document's entities and fields, the params' values, the bars' cut lengths and the
 * pieces cut from stock, the BOM and order lines, each supplier's status and total, and the
 * totals that moved. Pure; both sides' outputs come from `projectOutputs` or a revision's store.
 */

export const DIFF_SCHEMA = "alukit.diff/1";

export interface DiffSide {
  /** How the side was named on the command line. */
  label: string;
  /** The document as written; the variant is applied here to compare entities. */
  document: unknown;
  lock: Lock;
  outputs: Outputs;
  /** The outputs were read from a revision, not derived now. */
  stored?: boolean;
}

/** A value on side a and on side b; null where a side has none. */
export type Pair<T> = [T | null, T | null];

export interface EntityChange {
  id: string;
  change: "added" | "removed" | "changed";
  fields?: FieldChange[];
}

export interface BarMove {
  id: string;
  item: Pair<string>;
  cut_mm: Pair<number>;
  centre_mm: Pair<number>;
}

export interface PieceMove {
  source: string;
  item: Pair<string>;
  len_mm: Pair<number>;
}

export interface BomMove {
  kind: string;
  item: string;
  opt: Record<string, string>;
  qty: Pair<number>;
  length_mm: Pair<number>;
  mass_kg: Pair<number>;
}

export interface OrderMove {
  supplier: string | null;
  item: string;
  opt: Record<string, string>;
  sku: string | null;
  unit: string;
  length_mm: number | null;
  qty: Pair<number>;
  unit_price_minor: Pair<number>;
  low_minor: Pair<number>;
  likely_minor: Pair<number>;
  high_minor: Pair<number>;
  covered_by: Pair<string>;
}

export interface SupplierMove {
  supplier: string | null;
  status: Pair<string>;
  likely_minor: Pair<number>;
}

export interface TotalMove {
  /** lines, costs, subtotal, contingency or total. */
  what: string;
  low_minor: Pair<number>;
  likely_minor: Pair<number>;
  high_minor: Pair<number>;
}

export interface SideInfo {
  label: string;
  variant: string | null;
  lock: string;
  as_of: string;
  stored: boolean;
}

export interface DiffReport {
  schema: typeof DIFF_SCHEMA;
  a: SideInfo;
  b: SideInfo;
  /** True when nothing below moved. */
  same: boolean;
  lock: LockDiff;
  entities: EntityChange[];
  /** The document's other fields (defaults, costs settings, variants…), by path. */
  fields: FieldChange[];
  params: { name: string; value: Pair<number> }[];
  bars: BarMove[];
  pieces: PieceMove[];
  bom: BomMove[];
  mass_kg: Pair<number>;
  order: OrderMove[];
  suppliers: SupplierMove[];
  status: Pair<string>;
  currency: Pair<string>;
  totals: TotalMove[];
}

type Json = Record<string, unknown>;

const isObject = (x: unknown): x is Json =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function optKey(opt: Readonly<Record<string, string>> | undefined): string {
  const o = opt ?? {};
  return JSON.stringify(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
}

const or = <T>(x: T | undefined): T | null => (x === undefined ? null : x);
const differs = <T>(p: Pair<T>) => p[0] !== p[1];

/** Keyed rows of two sides, in key order: [key, a, b]. */
function join<T>(a: readonly T[], b: readonly T[], key: (x: T) => string) {
  const ma = new Map(a.map((x) => [key(x), x]));
  const mb = new Map(b.map((x) => [key(x), x]));
  const keys = [...new Set([...ma.keys(), ...mb.keys()])].sort(compareIds);
  return keys.map((k) => [k, ma.get(k), mb.get(k)] as const);
}

/** The keys a document's entities live under; everything else is a field. */
const ENTITY_KEYS = new Set<string>([...MAP_KINDS, ...LIST_KINDS, "items"]);
/** Bookkeeping, not content: the id counters and the schema tag. */
const IGNORED = new Set(["ids", "schema", "params"]);

function entityChanges(a: Json, b: Json): { entities: EntityChange[]; fields: FieldChange[] } {
  const entities: EntityChange[] = [];
  const kinds: Kind[] = [...MAP_KINDS, ...LIST_KINDS, "items"];
  for (const kind of kinds) {
    const ids = [...new Set([...entityIds(a, kind), ...entityIds(b, kind)])].sort(compareIds);
    for (const id of ids) {
      const x = getEntity(a, id);
      const y = getEntity(b, id);
      if (x === undefined) entities.push({ id, change: "added" });
      else if (y === undefined) entities.push({ id, change: "removed" });
      else {
        const fields = fieldChanges(x, y);
        if (fields.length > 0) entities.push({ id, change: "changed", fields });
      }
    }
  }
  const fields: FieldChange[] = [];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (ENTITY_KEYS.has(k) || IGNORED.has(k)) continue;
    fields.push(...fieldChanges(a[k], b[k], k));
  }
  return { entities, fields };
}

/** The document the side's variant builds (§4.10), so a variant's scope and swaps show. */
function variantDocument(s: DiffSide): Json {
  const v = applyVariant(s.document, lockItems(s.lock), s.outputs.variant);
  return isObject(v.raw) ? v.raw : {};
}

function bomLines(o: Outputs): (BomLine & { kind: string })[] {
  return (o.bom.groups ?? []).flatMap((g) => (g.lines ?? []).map((l) => ({ ...l, kind: g.kind })));
}

function orderLines(o: Outputs): (OrderLine & { supplier: string | null })[] {
  return (o.order.suppliers ?? []).flatMap((s) =>
    (s.lines ?? []).map((l) => ({ ...l, supplier: s.supplier })),
  );
}

function money(
  a: MoneyOut | undefined,
  b: MoneyOut | undefined,
  what: string,
): TotalMove | undefined {
  const m: TotalMove = {
    what,
    low_minor: [or(a?.low_minor), or(b?.low_minor)],
    likely_minor: [or(a?.likely_minor), or(b?.likely_minor)],
    high_minor: [or(a?.high_minor), or(b?.high_minor)],
  };
  return differs(m.low_minor) || differs(m.likely_minor) || differs(m.high_minor) ? m : undefined;
}

function sideInfo(s: DiffSide): SideInfo {
  return {
    label: s.label,
    variant: s.outputs.variant ?? null,
    lock: lockHash(s.lock),
    as_of: s.outputs.order.as_of,
    stored: s.stored === true,
  };
}

export function diffSides(a: DiffSide, b: DiffSide): DiffReport {
  const lock = diffLocks(a.lock, b.lock);
  const { entities, fields } = entityChanges(variantDocument(a), variantDocument(b));

  const pa = (a.outputs.derived.params ?? {}) as Record<string, number>;
  const pb = (b.outputs.derived.params ?? {}) as Record<string, number>;
  const params = [...new Set([...Object.keys(pa), ...Object.keys(pb)])]
    .sort()
    .map((name) => ({ name, value: [or(pa[name]), or(pb[name])] as Pair<number> }))
    .filter((p) => differs(p.value));

  type BarJson = { item?: string; cut_mm?: number; centre_mm?: number };
  const ba = (a.outputs.derived.bars ?? {}) as Record<string, BarJson>;
  const bb = (b.outputs.derived.bars ?? {}) as Record<string, BarJson>;
  const bars: BarMove[] = [];
  for (const id of [...new Set([...Object.keys(ba), ...Object.keys(bb)])].sort(compareIds)) {
    const x = ba[id];
    const y = bb[id];
    const m: BarMove = {
      id,
      item: [or(x?.item), or(y?.item)],
      cut_mm: [or(x?.cut_mm), or(y?.cut_mm)],
      centre_mm: [or(x?.centre_mm), or(y?.centre_mm)],
    };
    if (differs(m.item) || differs(m.cut_mm) || differs(m.centre_mm)) bars.push(m);
  }

  type PieceJson = { source: string; item: string; len_mm: number };
  const pieces: PieceMove[] = [];
  for (const [source, x, y] of join(
    (a.outputs.derived.pieces ?? []) as PieceJson[],
    (b.outputs.derived.pieces ?? []) as PieceJson[],
    (p) => p.source,
  )) {
    const m: PieceMove = {
      source,
      item: [or(x?.item), or(y?.item)],
      len_mm: [or(x?.len_mm), or(y?.len_mm)],
    };
    if (differs(m.item) || differs(m.len_mm)) pieces.push(m);
  }

  const bom: BomMove[] = [];
  for (const [, x, y] of join(bomLines(a.outputs), bomLines(b.outputs), (l) =>
    [l.kind, l.item, optKey(l.opt)].join("|"),
  )) {
    const l = (x ?? y) as BomLine & { kind: string };
    const m: BomMove = {
      kind: l.kind,
      item: l.item,
      opt: { ...l.opt },
      qty: [or(x?.qty), or(y?.qty)],
      length_mm: [or(x?.length_mm), or(y?.length_mm)],
      mass_kg: [or(x?.mass_kg), or(y?.mass_kg)],
    };
    if (differs(m.qty) || differs(m.length_mm) || differs(m.mass_kg)) bom.push(m);
  }

  const order: OrderMove[] = [];
  for (const [, x, y] of join(orderLines(a.outputs), orderLines(b.outputs), (l) =>
    [l.supplier ?? "", l.item, optKey(l.opt), l.sku ?? "", l.unit, l.length_mm ?? ""].join("|"),
  )) {
    const l = (x ?? y) as OrderLine & { supplier: string | null };
    const m: OrderMove = {
      supplier: l.supplier,
      item: l.item,
      opt: { ...l.opt },
      sku: or(l.sku),
      unit: l.unit,
      length_mm: or(l.length_mm),
      qty: [or(x?.qty), or(y?.qty)],
      unit_price_minor: [or(x?.unit_price_minor), or(y?.unit_price_minor)],
      low_minor: [or(x?.low_minor), or(y?.low_minor)],
      likely_minor: [or(x?.likely_minor), or(y?.likely_minor)],
      high_minor: [or(x?.high_minor), or(y?.high_minor)],
      covered_by: [or(x?.covered_by), or(y?.covered_by)],
    };
    const moved =
      differs(m.qty) ||
      differs(m.unit_price_minor) ||
      differs(m.low_minor) ||
      differs(m.likely_minor) ||
      differs(m.high_minor) ||
      differs(m.covered_by);
    if (moved) order.push(m);
  }

  const suppliers: SupplierMove[] = [];
  for (const [, x, y] of join(
    a.outputs.order.suppliers ?? [],
    b.outputs.order.suppliers ?? [],
    (s) => s.supplier ?? "",
  )) {
    const m: SupplierMove = {
      supplier: (x ?? y)?.supplier ?? null,
      status: [or(x?.status), or(y?.status)],
      likely_minor: [or(x?.totals.likely_minor), or(y?.totals.likely_minor)],
    };
    if (differs(m.status) || differs(m.likely_minor)) suppliers.push(m);
  }

  const ta = a.outputs.order.totals;
  const tb = b.outputs.order.totals;
  const totals = (["lines", "costs", "subtotal", "contingency", "total"] as const)
    .map((k) => money(ta?.[k], tb?.[k], k))
    .filter((m): m is TotalMove => m !== undefined);

  const mass_kg: Pair<number> = [or(a.outputs.bom.mass_kg), or(b.outputs.bom.mass_kg)];
  const status: Pair<string> = [or(a.outputs.order.status), or(b.outputs.order.status)];
  const currency: Pair<string> = [or(ta?.currency ?? undefined), or(tb?.currency ?? undefined)];
  const same =
    lock.entries.length === 0 &&
    lock.catalogs.length === 0 &&
    entities.length === 0 &&
    fields.length === 0 &&
    params.length === 0 &&
    bars.length === 0 &&
    pieces.length === 0 &&
    bom.length === 0 &&
    order.length === 0 &&
    suppliers.length === 0 &&
    totals.length === 0 &&
    !differs(mass_kg) &&
    !differs(status) &&
    !differs(currency);
  return {
    schema: DIFF_SCHEMA,
    a: sideInfo(a),
    b: sideInfo(b),
    same,
    lock,
    entities,
    fields,
    params,
    bars,
    pieces,
    bom,
    mass_kg,
    order,
    suppliers,
    status,
    currency,
    totals,
  };
}
