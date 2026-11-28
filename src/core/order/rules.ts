import { unjoinedButts, unjoinedMessage } from "../check/joints.ts";
import type { Derived } from "../derive/derive.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import { type CostLine, ORDER_RULES, type OrderRule, type RuleAction } from "../project/schema.ts";
import { scopeName } from "../project/scope.ts";
import { rateFor } from "./pricing.ts";
import { cmp, type Key, optText, type Reason, readOf, type Work } from "./types.ts";

/**
 * What blocks the order (design §5.5). Each rule has a name, can be set to `block`, `warn` or `off`
 * in the project's `order_rules`, and concerns only some suppliers:
 *
 * | Rule | Default | Concerns |
 * |---|---|---|
 * | `check-error` | block | the suppliers of the entities an error names; all when it names none |
 * | `open-item` | block | an open item's scope, or all; a cost line's `blocks`: its supplier |
 * | `placeholder` | block | its own line's group: its supplier, else "unsourced"; no other |
 * | `missing-price` | block | the line's supplier: no offer, no exchange rate, unpriced services |
 * | `est-price` | block | the supplier whose price is an estimate (call 13), a project item's too |
 * | `out-of-stock` | block | the supplier, as read |
 * | `option-not-sold` | block | the supplier that sells the item, but not in these options |
 * | `stale-price` | warn | the supplier whose price was read more than 30 days before the order |
 * | `no-connector` | warn | butts naming no connector, with no project default: their bars' suppliers |
 * | `unconnected` | warn | an open end, the check's warning (*2.3*, review fixes, joins): its bars' suppliers |
 * | `coincident` | warn | two bars in one place, the check's warning (*2.3*, re-check N5): their suppliers |
 */

export const RULE_DEFAULTS: Readonly<Record<OrderRule, RuleAction>> = {
  "check-error": "block",
  "open-item": "block",
  placeholder: "block",
  "missing-price": "block",
  "est-price": "block",
  "out-of-stock": "block",
  "option-not-sold": "block",
  "stale-price": "warn",
  "no-connector": "warn",
  unconnected: "warn",
  coincident: "warn",
};

/** A price is stale when read more than this many days before the order's date. */
export const STALE_DAYS = 30;

export interface RuleContext {
  derived: Derived;
  works: readonly Work[];
  /** The supplier groups, in output order. */
  keys: readonly Key[];
  costs: readonly CostLine[];
  rules: Readonly<Record<OrderRule, RuleAction>>;
  /** Every diagnostic: derive's, the cut list's, the BOM's, checks', the order's own. */
  diagnostics: readonly Diagnostic[];
  asOf: string;
  currency: string | undefined;
}

/** Days from `a` to `b`, both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Every group's reasons, in rule order, then by message. */
export function orderReasons(ctx: RuleContext): Map<Key, Reason[]> {
  const { derived, works, keys, costs, rules } = ctx;
  const doc = derived.doc;
  const reasons = new Map<Key, Reason[]>(keys.map((k) => [k, []]));
  const add = (
    rule: OrderRule,
    to: Iterable<Key> | "all",
    message: string,
    entities: readonly string[] = [],
  ) => {
    const action = rules[rule];
    if (action === "off") return;
    for (const k of to === "all" ? keys : to) {
      const list = reasons.get(k);
      if (!list || list.some((r) => r.rule === rule && r.message === message)) continue;
      list.push({
        rule,
        action,
        message,
        ...(entities.length > 0 ? { entities: [...entities] } : {}),
      });
    }
  };
  const reach = reacher(derived, works, costs);

  for (const x of ctx.diagnostics) {
    if (x.severity !== "error") continue;
    const names = [...(x.entity ? [x.entity] : []), ...(x.refs ?? [])];
    add(
      "check-error",
      reach(names),
      `${x.code}${x.entity ? ` ${x.entity}` : ""}: ${x.message}`,
      names,
    );
  }
  for (const o of doc.open) {
    if (o.blocks !== "order") continue;
    const scope = o.scope ?? [];
    add("open-item", reach(scope), `${o.id}: ${o.text}`, scope);
  }
  for (const c of costs) {
    if (c.blocks === "order") {
      add(
        "open-item",
        c.supplier === undefined ? "all" : [c.supplier],
        `${c.id} (${c.label}) holds the order`,
        [c.id],
      );
    }
    if ("pct" in c) continue;
    const currency = c.currency ?? ctx.currency;
    if (rateFor(doc, currency, ctx.currency) === undefined) {
      add(
        "missing-price",
        c.supplier === undefined ? "all" : [c.supplier],
        `${c.id}: no exchange rate for ${currency}`,
        [c.id],
      );
    }
  }

  // Unpriced services, one reason per offer.
  const services = new Map<string, { key: Key; item: string; count: number }>();
  for (const w of works) {
    const at = [w.key];
    const item = w.line.item;
    const what = w.line.offer ?? item;
    const opt = optText(w.line.opt);
    const withOpt = `${item}${opt ? ` (${opt})` : ""}`;
    if (w.placeholder) {
      add("placeholder", at, `${item}: a placeholder, not a part to order`, [item]);
      continue;
    }
    if (w.missing === "no-offer") add("missing-price", at, `${withOpt}: no offer`, [item]);
    if (w.missing === "no-price") add("missing-price", at, `${item}: no price`, [item]);
    if (w.missing === "by-length")
      add("missing-price", at, `${withOpt}: no offer sells it by length`, [item]);
    if (w.missing === "rate")
      add("missing-price", at, `${what}: no exchange rate for ${w.line.currency}`, [item]);
    if (w.missing === "option") {
      // With no option chosen there is no option to name: say what is sold instead (BE-7).
      const message = opt
        ? `${item}: not sold with ${opt}`
        : `${item}: sold only with ${w.sold ?? "other options"}; choose one`;
      // It names what asks for those options too, which a fix changes (BE-3).
      add("option-not-sold", at, message, [item, ...[...w.sources].sort(compareIds)]);
    }
    for (const s of w.line.services ?? []) {
      if (s.by !== "supplier" || s.covered_by) continue;
      const k = `${w.key}\u0000${what}`;
      const e = services.get(k) ?? { key: w.key, item, count: 0 };
      e.count += s.count;
      services.set(k, e);
    }
    // A priced line: an offer's, or a project item's own price (§4.8).
    if (!w.field || w.line.covered_by) continue;
    if (w.field.src === "est") {
      const message = w.offer
        ? `${what}: the price of ${item} is an estimate`
        : `${item}: its price is an estimate`;
      add("est-price", at, message, [item]);
    }
    if (w.offer?.in_stock === false) {
      add("out-of-stock", at, `${what}: out of stock as read on ${w.offer.price.read}`, [item]);
    }
    const read = readOf(w);
    const age = read === undefined ? 0 : daysBetween(read, ctx.asOf);
    if (age > STALE_DAYS) {
      add("stale-price", at, `${what}: price read ${read}, ${age} days before ${ctx.asOf}`, [item]);
    }
  }
  // Butts that buy nothing to hold their ends (review B1), in the check's words (`joints.ts`):
  // a connection that buys nothing reaches the suppliers of the bars whose cuts it decides.
  const butts = unjoinedButts(derived);
  if (butts.length > 0) add("no-connector", reach(butts), unjoinedMessage(butts), butts);
  // Open ends (*2.3*, review fixes, joins; call 124): an end that meets a bar with nothing to
  // join it buys nothing to hold it either, so the order warns, quoting the check's warning, and
  // the problem list keeps one problem with its Join fix. The rule already says what it is and
  // the check's line names the end, so the line is quoted alone (the re-check's N8: `check-error`'s
  // "code entity:" before it said the end and the rule twice).
  // Two bars in one place (*2.3*, re-check N5) buy one bar too many, so the order warns the same
  // way, quoting the check's line alone.
  for (const x of ctx.diagnostics) {
    if (x.code !== "unconnected" && x.code !== "coincident") continue;
    const names = [...new Set([...(x.entity ? [x.entity] : []), ...(x.refs ?? [])])];
    add(x.code, reach(names), x.message, names);
  }

  for (const [k, e] of services) {
    const what = k.slice(k.indexOf("\u0000") + 1);
    add(
      "missing-price",
      [e.key],
      `${what}: no price for ${e.count} machining service${e.count === 1 ? "" : "s"}; cover them with a cost line`,
      [e.item],
    );
  }

  for (const list of reasons.values()) {
    list.sort(
      (a, b) =>
        ORDER_RULES.indexOf(a.rule) - ORDER_RULES.indexOf(b.rule) || cmp(a.message, b.message),
    );
  }
  return reasons;
}

/**
 * Which supplier groups some named entities reach: the groups of the lines that serve them. A bar
 * end names its bar; a stock piece `c23.f1` its connection; a connection reaches what it buys
 * (connectors, fasteners, stock pieces), or, buying nothing, the bars whose cuts it decides; a run
 * reaches its bars, a pattern its template and copies; an item id the lines that buy it; a
 * cost line its supplier; `supplier:<id>` that supplier. Names that reach nothing reach all
 * (§5.5: "all suppliers for a check that names none"), so a scope that misses never lets an
 * order through.
 */
function reacher(
  derived: Derived,
  works: readonly Work[],
  costs: readonly CostLine[],
): (names: readonly string[]) => Iterable<Key> | "all" {
  const doc = derived.doc;
  const entityKeys = new Map<string, Set<Key>>();
  const itemKeys = new Map<string, Set<Key>>();
  const addTo = (m: Map<string, Set<Key>>, name: string, k: Key) =>
    m.set(name, (m.get(name) ?? new Set()).add(k));
  for (const w of works) {
    for (const s of w.sources) addTo(entityKeys, s, w.key);
    for (const b of [w.line.item, ...w.line.bom.map((x) => x.item)]) addTo(itemKeys, b, w.key);
  }
  const runBars = (r: string): string[] => {
    const run = doc.runs[r];
    return run ? (Array.isArray(run) ? run : run.bars) : [r];
  };
  const keysOf = (ids: readonly string[]): Set<Key> => {
    const out = new Set<Key>();
    for (const e of ids) for (const k of entityKeys.get(e) ?? []) out.add(k);
    return out;
  };
  /** The entities a name stands for; a connection stands for itself first (its hardware). */
  const related = (entity: string, copy = ""): string[] => {
    const id = `${entity}${copy}`;
    const conn = doc.connections[entity];
    if (conn) {
      if (keysOf([id]).size > 0) return [id];
      // A connection that buys nothing of its own (a butt with no connector) stands for the bars
      // whose cuts it decides.
      const bar = (e: string) => e.replace(/\.[ab]$/, "");
      const refs: string[] = [];
      if ("ends" in conn) refs.push(...conn.ends.map(bar));
      if (conn.type === "butt" && typeof conn.through === "string") refs.push(bar(conn.through));
      if (conn.type === "pivot") refs.push(conn.base.bar);
      if (conn.type === "face") refs.push(...conn.bars);
      return refs.flatMap((r) => (/^r\d+$/.test(r) ? runBars(r) : [r]));
    }
    if (/^r\d+$/.test(id)) return runBars(id);
    const pattern = doc.patterns[id];
    if (pattern) {
      return pattern.template.flatMap((t) => [
        t,
        ...[...entityKeys.keys()].filter((e) => e.startsWith(`${t}@`)),
      ]);
    }
    return [id];
  };
  return (names) => {
    const out = new Set<Key>();
    for (const name of names) {
      const s = scopeName(name);
      if ("supplier" in s) {
        out.add(s.supplier);
        continue;
      }
      if ("item" in s) {
        for (const k of itemKeys.get(s.item) ?? []) out.add(k);
        continue;
      }
      const cost = costs.find((c) => c.id === name);
      if (cost) {
        // A cost line with no supplier is in no supplier's order; alone it reaches all.
        if (cost.supplier !== undefined) out.add(cost.supplier);
        continue;
      }
      // A bar end or a stock piece stands for its bar or connection; a copy for itself.
      for (const k of keysOf(related(s.entity, s.copy))) out.add(k);
    }
    return out.size > 0 ? out : "all";
  };
}
