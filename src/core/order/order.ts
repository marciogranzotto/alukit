import type { Bom } from "../bom/bom.ts";
import { KINDS } from "../bom/bom.ts";
import type { CutList } from "../cutlist/cutlist.ts";
import type { Derived } from "../derive/derive.ts";
import { type Diagnostic, Diagnostics, sortDiagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource } from "../items.ts";
import { ORDER_RULES, type OrderRule, type RuleAction } from "../project/schema.ts";
import { orderLines } from "./lines.ts";
import { addMoney, convert, type Money, ZERO } from "./price.ts";
import { priceLines, projectCurrency, rateFor } from "./pricing.ts";
import { orderReasons, RULE_DEFAULTS } from "./rules.ts";
import { costsAndTotals } from "./totals.ts";
import {
  cmp,
  type Key,
  lineOut,
  moneyOut,
  ORDER_SCHEMA,
  type Order,
  optKey,
  type SupplierOrder,
  supplierOf,
  UNSOURCED,
  type Work,
} from "./types.ts";

/**
 * The order list (design §5.4), what blocks it (§5.5), and the costs and totals (§4.11), from the
 * BOM and the cut list. Stage 5 of the pipeline (§5.1), with the order rules of stage 6.
 *
 * 1. Lines (`lines.ts`): how each BOM line is bought, by explicit choice, cheapest pack cover,
 *    kit, the cut list's supplier cuts and stock bars, or a covering cost line.
 * 2. Pricing (`pricing.ts`): on the project's basis; low and high from a quoted range or a price
 *    band; converted per line into the project's currency.
 * 3. Groups, one per supplier and one for the unsourced lines, each READY or BLOCKED with every
 *    reason (`rules.ts`).
 * 4. Cost lines and totals (`totals.ts`).
 *
 * Every number is an integer of minor units, rounded once where it is made (§5.2).
 */

export { RULE_DEFAULTS, STALE_DAYS } from "./rules.ts";
export {
  type CostOut,
  type ItemQty,
  type MoneyOut,
  ORDER_SCHEMA,
  type Order,
  type OrderLine,
  optText,
  type Reason,
  type ServiceOut,
  type SupplierOrder,
  type Totals,
} from "./types.ts";

export interface OrderInput {
  derived: Derived;
  items: ItemSource;
  bom: Bom;
  cutList: CutList;
  /** Every problem found so far (derive, cut list, BOM, checks): errors feed `check-error`. */
  diagnostics: readonly Diagnostic[];
  /** The order's date, YYYY-MM-DD: prices read more than 30 days before it are stale. */
  asOf: string;
}

export function order(input: OrderInput): Order {
  const { derived, asOf } = input;
  const doc = derived.doc;
  const d = new Diagnostics();
  const rules = Object.fromEntries(
    ORDER_RULES.map((r) => [r, doc.order_rules[r] ?? RULE_DEFAULTS[r]]),
  ) as Record<OrderRule, RuleAction>;
  const costs = [...doc.costs].sort((a, b) => compareIds(a.id, b.id));

  const works = orderLines({
    derived,
    items: input.items,
    bom: input.bom,
    cutList: input.cutList,
    basis: doc.price_basis,
    d,
    costs,
    // Offers compare in the currency the project names (or as they are, when it names none).
    comparable: (o, minor) => {
      const r = rateFor(doc, o.currency, doc.currency);
      return r === undefined ? undefined : r === 1 ? minor : convert(minor, r);
    },
  });
  const pc = projectCurrency(doc, works, costs, d);
  priceLines(works, doc, pc, d);

  const groups = new Map<Key, Work[]>();
  for (const w of works) groups.set(w.key, [...(groups.get(w.key) ?? []), w]);
  for (const c of costs) {
    if (c.supplier !== undefined && !groups.has(c.supplier)) groups.set(c.supplier, []);
  }
  const keys = [...groups.keys()]
    .filter((k) => k !== UNSOURCED)
    .sort(compareIds)
    .concat(groups.has(UNSOURCED) ? [UNSOURCED] : []);

  const diagnostics = sortDiagnostics([...input.diagnostics, ...d.list]);
  const reasons = orderReasons({
    derived,
    works,
    keys,
    costs,
    rules,
    diagnostics,
    asOf,
    currency: pc,
  });
  const result = costsAndTotals(doc, works, costs, pc);

  const suppliers: SupplierOrder[] = keys.map((k) => {
    const ws = [...(groups.get(k) ?? [])].sort(lineOrder);
    const rs = reasons.get(k) ?? [];
    const own = costs.filter((c) => c.supplier === k).map((c) => c.id);
    let t: Money = ZERO;
    for (const w of ws) if (w.conv) t = addMoney(t, w.conv);
    for (const id of own) t = addMoney(t, result.converted.get(id) ?? ZERO);
    return {
      supplier: supplierOf(k),
      status: rs.some((r) => r.action === "block") ? "BLOCKED" : "READY",
      reasons: rs,
      lines: ws.map((w) => lineOut(w.line)),
      costs: own,
      totals: moneyOut(t),
    };
  });

  const reads = works.flatMap((w) => (w.offer && w.money ? [w.offer.price.read] : [])).sort(cmp);
  return {
    schema: ORDER_SCHEMA,
    currency: pc ?? null,
    price_basis: doc.price_basis,
    as_of: asOf,
    oldest_read: reads[0] ?? null,
    status: suppliers.some((s) => s.status === "BLOCKED") ? "BLOCKED" : "READY",
    rules,
    suppliers,
    costs: result.costs,
    totals: result.totals,
    diagnostics,
  };
}

/** Lines in a group: by kind (§3.4's order), item, options, offer, longest first, source. */
function lineOrder(a: Work, b: Work): number {
  const rank = (k: string) => {
    const i = (KINDS as readonly string[]).indexOf(k);
    return i < 0 ? KINDS.length : i;
  };
  return (
    rank(a.line.kind) - rank(b.line.kind) ||
    compareIds(a.line.item, b.line.item) ||
    cmp(optKey(a.line.opt), optKey(b.line.opt)) ||
    cmp(a.line.offer ?? "", b.line.offer ?? "") ||
    (b.line.length_mm ?? 0) - (a.line.length_mm ?? 0) ||
    compareIds(firstSource(a), firstSource(b))
  );
}

function firstSource(w: Work): string {
  return w.line.pieces?.[0]?.sources[0] ?? [...w.sources].sort(compareIds)[0] ?? "";
}
