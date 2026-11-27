import type { Bom } from "../bom/bom.ts";
import {
  type CutGroup,
  type CutLine,
  type CutList,
  type Machining,
  namesOffer,
  offerMatches,
} from "../cutlist/cutlist.ts";
import type { Derived } from "../derive/derive.ts";
import type { Diagnostics } from "../diagnostics.ts";
import { compareIds } from "../ids.ts";
import type { ItemSource, OfferInfo } from "../items.ts";
import { PROJECT_ITEM } from "../project/parse.ts";
import { type CostLine, servicesOnSuppliers } from "../project/schema.ts";
import { projectItems } from "../project-items/source.ts";
import { cheapestCover } from "./cover.ts";
import { amount, type Basis, basisPrice, fieldMoney, times } from "./price.ts";
import {
  cmp,
  type ItemQty,
  keyOf,
  type OrderLine,
  optKey,
  type PiecesOut,
  type ServiceOut,
  sortedOpt,
  UNSOURCED,
  type Work,
} from "./types.ts";

/**
 * The order lines (design §5.4): how each BOM line is bought, before prices are banded and
 * converted.
 *
 * - Bars as the cut list sells them: one line per supplier-cut piece length (billed in the offer's
 *   steps, with a line minimum where the offer bills by line), or per stock SKU of whole bars.
 * - Everything else by the project's explicit choice in `order`, else the cheapest cover of packs.
 *   Kits only when chosen, or when the item has no other offer; a kit's contents are credited
 *   against the other needs, and its surplus reported. Explicit kits are bought first, then
 *   kit-only items, then packs, so a kit's contents count before anything is chosen for them.
 * - A line a cost line `covers` by item keeps its quantity and names the cost line, with no offer.
 * - Generated machining on a bar becomes services, priced by the cost lines that cover them.
 */

export interface LineContext {
  derived: Derived;
  items: ItemSource;
  bom: Bom;
  cutList: CutList;
  basis: Basis;
  d: Diagnostics;
  /** In id order. */
  costs: readonly CostLine[];
  /** An offer's price in the project's currency, to compare offers; undefined without a rate. */
  comparable: (o: OfferInfo, minor: number) => number | undefined;
}

interface Need {
  item: string;
  name: string;
  kind: string;
  opt: Record<string, string>;
  qty: number;
  remaining: number;
  sources: string[];
}

const mm = (x: number) => x.toFixed(2);

export const ANGLED_CUT = "angled cut";

/** A service's name: what is done, not where (the cut list says where; a price depends on what). */
export function serviceName(m: Machining): string {
  const depth = m.depth_mm === undefined ? "" : `, ${mm(m.depth_mm)} deep`;
  if (m.op === "end-tap") return `tap ${m.thread} in an end${depth}`;
  const what = m.thread ? `tapped hole ${m.thread}` : `hole Ø${mm(m.d_mm ?? 0)}`;
  if (m.op === "end-hole") {
    return `${what} into an end, along the axis${m.depth_mm === undefined ? ", through" : depth}`;
  }
  const cbore = m.cbore ? `, counterbore Ø${mm(m.cbore.d_mm)} × ${mm(m.cbore.depth_mm)}` : "";
  const csk = m.csk ? `, countersink Ø${mm(m.csk.d_mm)} at ${m.csk.angle_deg.toFixed(2)}°` : "";
  return `${what}${depth}${cbore}${csk}`;
}

/** The services one piece of a cut-list line needs: its machining and its angled ends. */
function pieceServices(l: CutLine): string[] {
  const out = l.machining.map(serviceName);
  for (const e of [l.ends.a, l.ends.b]) if (e !== "square") out.push(ANGLED_CUT);
  return out;
}

function lineServices(l: CutLine, count: number): string[] {
  return Array.from({ length: count }, () => pieceServices(l)).flat();
}

function countServices(names: readonly string[], by: ServiceOut["by"]): ServiceOut[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([what, count]) => ({ what, count, by }));
}

function withServices(s: ServiceOut[]): { services?: ServiceOut[] } {
  return s.length > 0 ? { services: s } : {};
}

function piecesOf(ls: readonly CutLine[]): PiecesOut[] {
  return ls.map((l) => ({ count: l.count, cut_mm: l.cut_mm, sources: [...l.sources] }));
}

/** The entities pieces serve: a stock piece `c23.f1` serves its connection `c23`. */
function sourcesOf(pieces: Iterable<string>): Set<string> {
  return new Set([...pieces].map((s) => s.replace(/\.[fs]\d+$/, "")));
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  m.set(k, [...(m.get(k) ?? []), v]);
}

export function orderLines(ctx: LineContext): Work[] {
  const { derived, items, bom, cutList, basis, d } = ctx;
  const doc = derived.doc;
  const works: Work[] = [];

  // --- What cost lines cover (§4.11) --------------------------------------------------------
  const itemCover = new Map<string, CostLine[]>();
  const servicesBy = new Map<string, CostLine[]>();
  const servicesOn = new Map<string, CostLine[]>();
  for (const c of ctx.costs) {
    const cov = "covers" in c ? c.covers : undefined;
    if (!cov) continue;
    for (const it of cov.items ?? []) push(itemCover, it, c);
    if (cov.services && cov.supplier) push(servicesBy, cov.supplier, c);
    for (const s of servicesOnSuppliers(cov)) push(servicesOn, s, c);
  }
  /** The cost line that covers something, with an error naming both when two do. */
  /**
   * The cost line that covers something, with an error naming both when two do. The error also
   * names the item covered, so it holds the order of whoever sells that item (§5.5).
   */
  const oneCover = (cs: readonly CostLine[], item: string, what = item): CostLine => {
    const ids = [...new Set(cs.map((c) => c.id))].sort(compareIds);
    if (ids.length > 1) {
      d.error("covers", ids[0], `${ids.join(" and ")} both cover ${what}`, {
        refs: [...ids, item],
      });
    }
    return cs.find((c) => c.id === ids[0]) as CostLine;
  };
  const covered = (c: CostLine) => ({ key: keyOf(c.supplier), covered_by: c.id });

  const priced = (o: OfferInfo, f: (minor: number) => number) => {
    const field = basisPrice(o.price, basis);
    return { field, one: fieldMoney(field, f) };
  };

  // --- Bars, as the cut list sells them (§5.3) ----------------------------------------------
  const lineOf = new Map<string, CutLine>();
  for (const g of cutList.groups) {
    for (const l of g.lines) for (const s of l.sources) lineOf.set(s, l);
  }

  const barLines = (g: CutGroup): void => {
    const found = items.item(g.item);
    const opt = sortedOpt(g.opt);
    const base = {
      item: g.item,
      name: found.ok ? found.item.name : g.name,
      kind: "bar",
      opt,
    };
    const bomOf = (qty: number): ItemQty[] => [{ item: g.item, opt, qty }];
    const all = g.lines.flatMap((l) => l.sources);

    const cover = itemCover.get(g.item);
    if (cover) {
      const k = oneCover(cover, g.item);
      const names = g.lines.flatMap((l) => lineServices(l, l.count));
      works.push({
        key: covered(k).key,
        sources: sourcesOf(all),
        line: {
          ...base,
          qty: g.pieces,
          unit: "piece",
          covered_by: k.id,
          bom: bomOf(g.pieces),
          pieces: piecesOf(g.lines),
          ...withServices(
            countServices(names, "supplier").map((s) => ({ ...s, covered_by: k.id })),
          ),
        },
      });
      return;
    }

    if (g.mode === "cut") {
      const o = items.offers(g.item).find((x) => x.sku === g.offer) as OfferInfo;
      const sale = o.sale;
      for (const l of g.lines) {
        const billed = l.billed_mm as number;
        const { field, one: piece } = priced(o, (x) => amount(x, o.price.per, billed));
        // A line minimum (`bill: "line"`): the line's pieces together bill at least min_bill_mm.
        const lineMin =
          sale?.bill === "line" &&
          sale.min_bill_mm !== undefined &&
          l.count * billed < sale.min_bill_mm
            ? sale.min_bill_mm
            : undefined;
        const money =
          lineMin === undefined
            ? { ...times(piece, l.count), quoted: piece.quoted }
            : fieldMoney(field, (x) => amount(x, o.price.per, lineMin));
        works.push({
          key: keyOf(o.supplier),
          offer: o,
          field,
          money,
          sources: sourcesOf(l.sources),
          line: {
            ...base,
            offer: o.sku,
            sku: o.code,
            qty: l.count,
            unit: "piece",
            length_mm: l.ordered_mm as number,
            billed_mm: billed,
            ...(lineMin !== undefined ? { line_billed_mm: lineMin } : {}),
            per: o.price.per,
            list_minor: field.v,
            unit_price_minor: piece.likely,
            bom: bomOf(l.count),
            pieces: piecesOf([l]),
            ...withServices(countServices(lineServices(l, l.count), "supplier")),
          },
        });
      }
      return;
    }

    if (g.mode === "stock") {
      const offers = items.offers(g.item);
      const stock = g.stock ?? [];
      for (const sku of [...new Set(stock.map((b) => b.sku))].sort(cmp)) {
        const o = offers.find((x) => x.sku === sku) as OfferInfo;
        const bars = stock.filter((b) => b.sku === sku);
        const len = o.sale?.length_mm as number;
        const { field, one: bar } = priced(o, (x) => amount(x, o.price.per, len));
        const inBars = new Set(bars.flatMap((b) => b.pieces.map((p) => p.source)));
        const ls = g.lines.flatMap((l) => {
          const sources = l.sources.filter((s) => inBars.has(s));
          return sources.length > 0 ? [{ ...l, count: sources.length, sources }] : [];
        });
        const names = [...inBars].flatMap((s) => {
          const l = lineOf.get(s);
          return l ? pieceServices(l) : [];
        });
        works.push({
          key: keyOf(o.supplier),
          offer: o,
          field,
          money: { ...times(bar, bars.length), quoted: bar.quoted },
          sources: sourcesOf(inBars),
          line: {
            ...base,
            offer: o.sku,
            sku: o.code,
            qty: bars.length,
            unit: "bar",
            length_mm: len,
            per: o.price.per,
            list_minor: field.v,
            unit_price_minor: bar.likely,
            bom: bomOf(inBars.size),
            pieces: piecesOf(ls),
            ...withServices(countServices(names, "buyer")),
          },
        });
      }
      return;
    }

    // Nothing sells it by length: no offer at all, none in these options, or none with a sale.
    const offers = items.offers(g.item);
    const matching = offers.filter((o) => offerMatches(o, g.opt));
    const missing: Work["missing"] =
      offers.length === 0 ? "no-offer" : matching.length === 0 ? "option" : "by-length";
    works.push({
      key: missing === "option" ? keyOf((offers[0] as OfferInfo).supplier) : UNSOURCED,
      missing,
      sources: sourcesOf(all),
      line: {
        ...base,
        qty: g.pieces,
        unit: "piece",
        bom: bomOf(g.pieces),
        pieces: piecesOf(g.lines),
      },
    });
  };
  for (const g of cutList.groups) barLines(g);

  // --- Everything else (§5.4) ----------------------------------------------------------------
  const needs: Need[] = [];
  const needOf = new Map<string, Need>();
  for (const grp of bom.groups) {
    if (grp.kind === "bar") continue;
    for (const l of grp.lines) {
      const n: Need = {
        item: l.item,
        name: l.name,
        kind: grp.kind,
        opt: sortedOpt(l.opt),
        qty: l.qty,
        remaining: l.qty,
        sources: l.sources,
      };
      needs.push(n);
      needOf.set(`${l.item}\u0000${optKey(l.opt)}`, n);
    }
  }
  const used = new Set([...needs.map((n) => n.item), ...cutList.groups.map((g) => g.item)]);
  for (const item of Object.keys(doc.order).sort(compareIds)) {
    if (!used.has(item)) d.warn("order", item, `order: ${item} is not used`);
  }
  const unitBase = (n: Need) => ({ item: n.item, name: n.name, kind: n.kind, opt: n.opt });
  const bomOf = (n: Need, qty: number): ItemQty[] => [{ item: n.item, opt: n.opt, qty }];

  // Covered by a cost line: no offer is chosen.
  for (const n of needs) {
    const cover = itemCover.get(n.item);
    if (!cover) continue;
    const k = oneCover(cover, n.item);
    works.push({
      key: covered(k).key,
      sources: new Set(n.sources),
      line: { ...unitBase(n), qty: n.qty, unit: "unit", covered_by: k.id, bom: bomOf(n, n.qty) },
    });
    n.remaining = 0;
  }

  /** The explicit choice for a need, when it names an offer that sells the need's options. */
  const chosenFor = (n: Need): OfferInfo | undefined => {
    const choice = doc.order[n.item]?.offer;
    if (choice === undefined) return undefined;
    const o = items.offers(n.item).find((x) => namesOffer(x, choice));
    if (!o || !offerMatches(o, n.opt)) {
      d.error("order", n.item, `order: no offer "${choice}" of ${n.item} for these options`);
      return undefined;
    }
    return o;
  };

  /** A kit's units of the need's own item (its main entry, as a rule). */
  const mainQty = (n: Need, o: OfferInfo): number =>
    (o.kit ?? []).find((c) => c.item === n.item)?.qty ?? (o.kit?.[0]?.qty as number);

  /** Buys `count` kits for a need, crediting every content against the needs. */
  const buyKits = (n: Need, o: OfferInfo, count: number): void => {
    const kit = o.kit ?? [];
    const optOf = (c: { item: string; opt: Readonly<Record<string, string>> }) =>
      c.item === n.item ? n.opt : sortedOpt(c.opt);
    const sources = new Set<string>();
    const served: ItemQty[] = [];
    const surplus: ItemQty[] = [];
    for (const c of kit) {
      const opt = optOf(c);
      const target = needOf.get(`${c.item}\u0000${optKey(opt)}`);
      const provided = count * c.qty;
      const take = target ? Math.min(provided, target.remaining) : 0;
      if (target && take > 0) {
        target.remaining -= take;
        served.push({ item: c.item, opt, qty: take });
        for (const s of target.sources) sources.add(s);
      }
      if (provided > take) surplus.push({ item: c.item, opt, qty: provided - take });
    }
    const { field, one } = priced(o, (x) => x);
    works.push({
      key: keyOf(o.supplier),
      offer: o,
      field,
      money: { ...times(one, count), quoted: one.quoted },
      sources,
      line: {
        ...unitBase(n),
        offer: o.sku,
        sku: o.code,
        qty: count,
        unit: "kit",
        kit: kit.map((c) => ({ item: c.item, opt: optOf(c), qty: c.qty })),
        per: o.price.per,
        list_minor: field.v,
        unit_price_minor: one.likely,
        bom: served,
        ...(surplus.length > 0 ? { surplus } : {}),
      },
    });
  };

  /**
   * The cheapest cover among the offers comparable in the project's currency; offers with no
   * exchange rate are used only when nothing else is offered (their lines then lack a rate).
   */
  const coverOf = (
    need: number,
    offers: readonly OfferInfo[],
    size: (o: OfferInfo) => number,
  ): { offer: OfferInfo; count: number }[] => {
    const withPrice = offers.map((o) => ({ o, v: basisPrice(o.price, basis).v }));
    const comparable = withPrice.flatMap(({ o, v }) => {
      const c = ctx.comparable(o, v);
      return c === undefined ? [] : [{ o, c }];
    });
    const pool = comparable.length > 0 ? comparable : withPrice.map(({ o, v }) => ({ o, c: v }));
    const bySku = new Map(pool.map((p) => [p.o.sku, p.o]));
    const c = cheapestCover(
      need,
      pool.map((p) => ({ sku: p.o.sku, size: size(p.o), cost: p.c })),
    );
    return (c?.lines ?? []).map((l) => ({
      offer: bySku.get(l.offer.sku) as OfferInfo,
      count: l.count,
    }));
  };

  // Kits chosen explicitly.
  const choices = new Map<Need, OfferInfo | undefined>();
  for (const n of needs) {
    if (n.remaining === 0) continue;
    const o = chosenFor(n);
    choices.set(n, o);
    if (o?.kit && n.remaining > 0) buyKits(n, o, Math.ceil(n.remaining / mainQty(n, o)));
  }
  // Items sold only in kits: the cheapest cover of kits.
  for (const n of needs) {
    if (n.remaining === 0 || choices.get(n)) continue;
    const offers = items.offers(n.item).filter((o) => offerMatches(o, n.opt));
    if (offers.length === 0 || offers.some((o) => !o.kit)) continue;
    for (const { offer, count } of coverOf(n.remaining, offers, (o) => mainQty(n, o))) {
      buyKits(n, offer, count);
    }
  }
  // Packs and units for whatever is left.
  for (const n of needs) {
    if (n.remaining === 0) continue;
    if (n.item.startsWith(PROJECT_ITEM)) {
      works.push(projectLine(ctx, n));
      n.remaining = 0;
      continue;
    }
    // A kit chosen above has bought all of its own item; a pack or unit chosen is bought here.
    const choice = choices.get(n);
    const chosen = choice && !choice.kit ? choice : undefined;
    const offers = items.offers(n.item);
    const candidates = chosen ? [chosen] : offers.filter((o) => !o.kit && offerMatches(o, n.opt));
    if (candidates.length === 0) {
      const option = offers.length > 0 && !offers.some((o) => offerMatches(o, n.opt));
      works.push({
        key: option ? keyOf((offers[0] as OfferInfo).supplier) : UNSOURCED,
        missing: option ? "option" : "no-offer",
        sources: new Set(n.sources),
        line: { ...unitBase(n), qty: n.remaining, unit: "unit", bom: bomOf(n, n.remaining) },
      });
      n.remaining = 0;
      continue;
    }
    const bought = chosen
      ? [{ offer: chosen, count: Math.ceil(n.remaining / chosen.pack) }]
      : coverOf(n.remaining, candidates, (o) => o.pack);
    // Each line serves what it can, in SKU order; the last carries the surplus.
    let left = n.remaining;
    bought.forEach(({ offer: o, count }, i) => {
      const units = count * o.pack;
      const take = i === bought.length - 1 ? left : Math.min(left, units);
      left -= take;
      const { field, one } = priced(o, (x) => x);
      works.push({
        key: keyOf(o.supplier),
        offer: o,
        field,
        money: { ...times(one, count), quoted: one.quoted },
        sources: new Set(n.sources),
        line: {
          ...unitBase(n),
          offer: o.sku,
          sku: o.code,
          qty: count,
          unit: o.pack > 1 ? "pack" : "unit",
          ...(o.pack > 1 ? { pack: o.pack } : {}),
          per: o.price.per,
          list_minor: field.v,
          unit_price_minor: one.likely,
          bom: bomOf(n, take),
          ...(units > take ? { surplus: bomOf(n, units - take) } : {}),
        },
      });
    });
    n.remaining = 0;
  }

  // --- Services: priced by the cost lines that cover them (§4.11, §5.4) ------------------------
  for (const w of works) {
    if (!w.line.services || w.line.covered_by || !w.offer) continue;
    const s = w.offer.supplier;
    for (const sv of w.line.services) {
      const cs = [
        ...(sv.by === "supplier" ? (servicesBy.get(s) ?? []) : []),
        ...(servicesOn.get(s) ?? []),
      ];
      if (cs.length > 0) {
        sv.covered_by = oneCover(cs, w.line.item, `the machining on ${w.offer.sku}`).id;
      }
    }
  }
  return works;
}

/**
 * A project item (§4.8) on the order: one line under its supplier (a plate or a bent angle that
 * names none is made `local`; a placeholder or a generic item that names none is unsourced),
 * priced per unit by its own `price_minor`, in the project's currency. A placeholder blocks its own
 * line's group and no other (§5.5); an item with no price is a missing price there.
 */
function projectLine(ctx: LineContext, n: Need): Work {
  const r = projectItems(ctx.items, ctx.derived.doc).resolved.get(n.item);
  const placeholder = r?.kind === "placeholder";
  const field = r?.price;
  const one = field && fieldMoney(field, (x) => x);
  const line: OrderLine = {
    item: n.item,
    name: r?.name ?? n.name,
    kind: n.kind,
    opt: n.opt,
    qty: n.remaining,
    unit: "unit",
    ...(one ? { unit_price_minor: one.likely } : {}),
    bom: [{ item: n.item, opt: n.opt, qty: n.remaining }],
  };
  return {
    key: keyOf(r?.supplier),
    sources: new Set(n.sources),
    ...(placeholder ? { placeholder } : {}),
    ...(field?.read !== undefined ? { read: field.read } : {}),
    ...(field && one
      ? { field, money: { ...times(one, n.remaining), quoted: one.quoted } }
      : { missing: placeholder ? "placeholder" : "no-price" }),
    line,
  };
}
