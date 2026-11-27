import { useState } from "preact/hooks";
import {
  type CostsOutput,
  coversText,
  detailText,
  itemsText,
  qtyText,
  supplierName,
} from "#core/order/format.ts";
import type { MoneyOut, Order, OrderLine, Reason, SupplierOrder } from "#core/order/types.ts";
import type { Fix, Problem, ProblemsAnswer } from "#core/problems/types.ts";
import { DrawABar, EmptyState, OpenCatalog } from "../common/EmptyState.tsx";
import { ItemSwatch } from "../common/ItemSwatch.tsx";
import { Num } from "../common/Num.tsx";
import { StatusGlyph, StatusMark } from "../common/StatusGlyph.tsx";
import { date, money, plural } from "../format.ts";
import type { Model } from "../model.ts";
import { ProblemList, ProblemRow } from "../problems/ProblemRow.tsx";
import { problemList } from "../problems/source.ts";
import { openItems } from "../records/OpenItems.tsx";
import { selectionOnly } from "../sheets/registry.ts";
import { blocks, thingsToResolve } from "./badges.tsx";
import {
  AsOfInput,
  anySelected,
  Clip,
  type Col,
  optText,
  Row,
  Sheet,
  SheetBar,
  SheetTable,
  Stamp,
  useOutput,
  withAsOf,
} from "./common.tsx";

/**
 * Order & costs (design §8; `alukit order`, `alukit costs`; docs/ux/visual-design.md §6.2): the
 * order's verdict first, as a strip: whether it can be sent, what holds it, what it comes to. Then
 * a card per supplier, blocked ones first: its status as a glyph and a word, its total with the
 * range around it, and a to-resolve list whose every row has its action; a ready supplier folds to
 * its head. Then the costs: cost lines, the totals, and how much of the total rests on read
 * prices. One date drives both, so both are asked of the server when shown, in the tab's variant.
 * Owner: S4.
 */

// ---------------------------------------------------------------------------------------------
// What holds a supplier, as problems

const RESOLVE = /^(\S+?): /;

/** The fixes an order reason has by its rule (the problem model's, when the server has not said). */
function fixesFor(m: Model, r: Reason): Fix[] {
  const item = r.entities?.[0];
  switch (r.rule) {
    case "open-item": {
      const id = RESOLVE.exec(r.message)?.[1];
      return id !== undefined && openItems(m).some((o) => o.id === id)
        ? [{ label: `Resolve ${id}…`, kind: "resolve-open", open: id }]
        : [];
    }
    case "missing-price":
      return item !== undefined && /: (no price|no offer)$/.test(r.message)
        ? [{ label: "Set a price…", kind: "set-price", item }]
        : [];
    case "est-price":
      return item !== undefined ? [{ label: "Set a sourced price…", kind: "set-price", item }] : [];
    case "stale-price":
      return item !== undefined ? [{ label: "Update the price…", kind: "lock-update", item }] : [];
    default:
      return [];
  }
}

/**
 * An order reason as a problem. The server's problem for it (BE-3) is used when it has one, its
 * words and fixes included; matched by the message the CLI prints and the supplier it holds.
 */
function reasonProblem(
  m: Model,
  s: SupplierOrder,
  r: Reason,
  served: ProblemsAnswer | undefined,
): Problem {
  const hit = served?.problems.find(
    (p) => p.raw === r.message && (p.suppliers ?? []).includes(s.supplier),
  );
  if (hit) return hit;
  const open = r.rule === "open-item" ? RESOLVE.exec(r.message)?.[1] : undefined;
  const targets = r.entities && r.entities.length > 0 ? r.entities : open ? [open] : [];
  return {
    id: `${r.rule}/${r.message}/${s.supplier ?? ""}`,
    code: r.rule,
    rule: r.rule,
    group: r.action === "block" ? "blocks-order" : "warning",
    title: r.message,
    detail: "",
    raw: r.message,
    suppliers: [s.supplier],
    targets,
    fixes: fixesFor(m, r),
    from: ["order"],
  };
}

// ---------------------------------------------------------------------------------------------
// Pieces

function rangeText(x: MoneyOut): string {
  return `${money(x.low_minor, { table: true })} to ${money(x.high_minor, { table: true })}`;
}

/** A range as a whisker: a bar from low to high with a tick at the likely figure. */
function Whisker({ x }: { x: MoneyOut }) {
  if (x.high_minor <= x.low_minor) return null;
  const at = ((x.likely_minor - x.low_minor) / (x.high_minor - x.low_minor)) * 100;
  return (
    <span class="range" title={`Likely ${money(x.likely_minor)}, from ${rangeText(x)}`}>
      <span class="whisker" aria-hidden="true">
        <i style={{ left: `${Math.min(100, Math.max(0, at))}%` }} />
      </span>
      <span class="range-n">{rangeText(x)}</span>
    </span>
  );
}

/** A line's price source in words: where it was read, and a triangle when it is an estimate. */
function PriceSource({ l }: { l: OrderLine }) {
  if (l.covered_by) return <span class="sub">In {l.covered_by}</span>;
  if (l.likely_minor === undefined) {
    return (
      <span class="source warn">
        <StatusGlyph status="warn" size={12} /> No price
      </span>
    );
  }
  const src = l.price_src ?? "src";
  const word = { src: "Quoted", meas: "Measured", est: "Estimate", calc: "Calculated" }[src] ?? src;
  const parts = [`price ${src}`];
  if (l.read) parts.push(`read ${l.read}`);
  if (l.on_sale) parts.push("on sale");
  if (l.range) parts.push(l.range === "quote" ? "range quoted" : `band ${l.band}`);
  return (
    <span class={src === "est" ? "source warn" : "source"} title={parts.join(", ")}>
      {src === "est" && <StatusGlyph status="warn" size={12} />}
      {word}
      {l.read && <span class="sub"> {date(l.read).replace(/ \d{4}$/, "")}</span>}
    </span>
  );
}

function lineKey(l: OrderLine): string {
  return [
    l.item,
    optText(l.opt),
    l.offer ?? "",
    l.length_mm ?? "",
    l.pieces?.[0]?.sources[0] ?? "",
    l.covered_by ?? "",
  ].join("|");
}

/** The entities an order line serves: its pieces' bars, and the BOM lines it covers. */
function lineIds(m: Model, l: OrderLine): string[] {
  const ids = new Set<string>(l.pieces?.flatMap((p) => p.sources) ?? []);
  const wanted = new Set(l.bom.map((b) => `${b.item}|${optText(b.opt)}`));
  for (const g of m.bom.groups) {
    for (const b of g.lines) {
      if (wanted.has(`${b.item}|${optText(b.opt)}`)) for (const s of b.sources) ids.add(s);
    }
  }
  return [...ids];
}

function lineCols(currency: string | null): Col[] {
  return [
    { id: "item", head: "Item" },
    { id: "supplied", head: "Supplied as", w: "210px" },
    { id: "qty", head: "Quantity", w: "150px" },
    {
      id: "unit",
      head: "Unit price",
      ...(currency ? { unit: currency } : {}),
      w: "118px",
      align: "right",
    },
    {
      id: "likely",
      head: "Likely",
      ...(currency ? { unit: currency } : {}),
      w: "128px",
      align: "right",
    },
    { id: "source", head: "Price source", w: "128px" },
    { id: "for", head: "For", w: "190px" },
  ];
}

function Lines({ m, o, s }: { m: Model; o: Order; s: SupplierOrder }) {
  const cols = lineCols(o.currency);
  return (
    <SheetTable cols={cols}>
      <tbody>
        {s.lines.map((l) => {
          const unit = l.covered_by
            ? `see ${l.covered_by}`
            : l.likely_minor === undefined
              ? "no price"
              : `${money(l.unit_price_minor ?? 0, { table: true })}${l.currency && l.currency !== o.currency ? ` ${l.currency}` : ""}`;
          const priced = l.likely_minor !== undefined && !l.covered_by;
          return (
            <Row key={lineKey(l)} ids={lineIds(m, l)} data-line={l.item}>
              <td>
                <span class="item-cell">
                  <ItemSwatch item={l.item} />
                  <b>{l.item}</b> <span class="sub">{l.name}</span>
                </span>
                {Object.keys(l.opt).length > 0 && <div class="second">{optText(l.opt)}</div>}
              </td>
              <td>
                <div class="supplied">
                  {l.sku && <span class="sku">{l.sku}</span>}
                  <Clip text={detailText(l)} />
                </div>
              </td>
              <td>{qtyText(l)}</td>
              <td class="n">{priced ? <Num text={unit} /> : <span class="sub">{unit}</span>}</td>
              <td class="n">
                {priced && <Num text={money(l.likely_minor ?? 0, { table: true })} />}
                {priced && l.high_minor !== l.low_minor && (
                  <div class="second">
                    {money(l.low_minor ?? 0, { table: true })} to{" "}
                    {money(l.high_minor ?? 0, { table: true })}
                  </div>
                )}
              </td>
              <td>
                <PriceSource l={l} />
              </td>
              <td>
                <Clip text={itemsText(l.bom)} />
              </td>
            </Row>
          );
        })}
      </tbody>
    </SheetTable>
  );
}

/** One supplier: its head, what holds it (each with its action), and its lines. */
function SupplierCard({
  m,
  o,
  s,
  served,
}: {
  m: Model;
  o: Order;
  s: SupplierOrder;
  served: ProblemsAnswer | undefined;
}) {
  const blocked = s.status === "BLOCKED";
  const nBlocks = blocks(s).length;
  const [open, setOpen] = useState(false);
  const ids = s.lines.flatMap((l) => lineIds(m, l));
  if (
    selectionOnly.value &&
    !anySelected(ids) &&
    !s.reasons.some((r) => anySelected(r.entities ?? []))
  ) {
    return null;
  }
  const word = blocked ? `Blocked, ${nBlocks} to resolve` : "Ready";
  // A ready supplier folds to its head; selection only opens the lines that are about the selection.
  const showLines = blocked || open || selectionOnly.value;
  return (
    <section
      class={`card ${blocked ? "blocked" : "ready"}`}
      data-supplier={s.supplier ?? ""}
      data-status={s.status}
      data-reasons={s.reasons.length}
    >
      <header class="card-head">
        <h4 class="card-name">{supplierName(s)}</h4>
        <StatusMark status={blocked ? "blocked" : "ready"} word={word} />
        <span class="card-total">
          <b class="figure">
            <Num text={money(s.totals.likely_minor, { table: true })} />
          </b>
          {o.currency && <span class="sub"> {o.currency}</span>}
          <Whisker x={s.totals} />
        </span>
      </header>
      {s.reasons.length > 0 && (
        <ProblemList label={`What holds ${supplierName(s)}`}>
          {s.reasons.map((r) => (
            <ProblemRow key={`${r.rule}${r.message}`} p={reasonProblem(m, s, r, served)} compact />
          ))}
        </ProblemList>
      )}
      {s.lines.length > 0 && !blocked && (
        <button type="button" class="btn fold" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"} {plural(s.lines.length, "line")}
        </button>
      )}
      {showLines && s.lines.length > 0 && <Lines m={m} o={o} s={s} />}
      {s.costs.length > 0 && <p class="sub card-note">Cost lines: {s.costs.join(", ")}.</p>}
    </section>
  );
}

/**
 * What the order warns about while it can be sent: each warning reason once, however many
 * suppliers it reaches, in the problem model's words when the server has them.
 */
function orderWarnings(m: Model, o: Order, served: ProblemsAnswer | undefined): Problem[] {
  const seen = new Map<string, Problem>();
  for (const s of o.suppliers) {
    for (const r of s.reasons) {
      const key = `${r.rule}|${r.message}`;
      if (r.action === "warn" && !seen.has(key)) seen.set(key, reasonProblem(m, s, r, served));
    }
  }
  return [...seen.values()];
}

/**
 * The verdict strip: can the order be sent, what holds it, what it comes to, as of when. Ready
 * with warnings (docs/ux/review-phase4.md B1) reads in the warning's look and names each.
 */
function Verdict({ m, o, served }: { m: Model; o: Order; served: ProblemsAnswer | undefined }) {
  const blocked = o.status === "BLOCKED";
  const nBlocked = o.suppliers.filter((s) => s.status === "BLOCKED").length;
  const nReady = o.suppliers.length - nBlocked;
  const things = thingsToResolve(o);
  const warnings = blocked ? [] : orderWarnings(m, o, served);
  const look = blocked ? "blocked" : warnings.length > 0 ? "warn" : "ready";
  const t = o.totals.total;
  return (
    <div
      class={`verdict ${look}`}
      data-testid="verdict"
      data-status={o.status}
      data-warnings={warnings.length}
    >
      <div class="verdict-status">
        <StatusGlyph status={look} size={22} />
        <span class="verdict-word">
          {blocked
            ? "Not ready to order"
            : warnings.length > 0
              ? "Ready, but check first"
              : "Ready to order"}
        </span>
      </div>
      <div class="verdict-text">
        {blocked ? (
          <p>
            {nBlocked} of {plural(o.suppliers.length, "supplier")} {nBlocked === 1 ? "is" : "are"}{" "}
            blocked by {plural(things, "thing")} to resolve.{" "}
            {nReady > 0 && `${plural(nReady, "supplier")} ${nReady === 1 ? "is" : "are"} ready.`}
          </p>
        ) : warnings.length > 0 ? (
          <>
            <p>
              Every one of {plural(o.suppliers.length, "supplier")} can be ordered from, but the
              order warns:
            </p>
            <ul class="verdict-warnings" data-testid="verdict-warnings">
              {warnings.map((p) => (
                <li key={p.id}>{p.title}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            Every one of {plural(o.suppliers.length, "supplier")} can be ordered from as it stands.
          </p>
        )}
        <p class="sub">
          Prices on the {o.price_basis} basis{o.currency ? ` in ${o.currency}` : ""},{" "}
          <AsOfInput value={o.as_of} />; the oldest was read{" "}
          {o.oldest_read ? date(o.oldest_read) : "(none)"}. <Stamp lock={o.lock} />
        </p>
      </div>
      <div class="verdict-total">
        <span class="display">
          <Num text={money(t.likely_minor, { table: true })} />
        </span>
        {o.currency && <span class="sub"> {o.currency}</span>}
        <div class="sub">Likely, from {rangeText(t)}</div>
      </div>
    </div>
  );
}

function OrderPart({ m, o, stale, rev }: { m: Model; o: Order; stale: boolean; rev: number }) {
  const served = problemList.value?.served ? problemList.value.answer : undefined;
  if (o.suppliers.length === 0) {
    return (
      <Sheet testid="order" rev={rev} stale={stale}>
        <EmptyState
          title="Nothing to order yet"
          actions={
            <>
              <DrawABar />
              <OpenCatalog />
            </>
          }
        >
          The order lists what to buy from each supplier, with what holds it. Draw bars and place
          parts, and they appear here.
        </EmptyState>
      </Sheet>
    );
  }
  // Blocked suppliers first, then ready ones; each keeps the CLI's order within its kind.
  const suppliers = o.suppliers
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) => Number(b.s.status === "BLOCKED") - Number(a.s.status === "BLOCKED") || a.i - b.i,
    )
    .map((x) => x.s);
  return (
    <Sheet testid="order" rev={rev} stale={stale}>
      <SheetBar />
      <Verdict m={m} o={o} served={served} />
      <div class="cards">
        {suppliers.map((s) => (
          <SupplierCard key={s.supplier ?? ""} m={m} o={o} s={s} served={served} />
        ))}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// The costs

const COST_COLS: readonly Col[] = [
  { id: "id", head: "Cost", w: "64px" },
  { id: "label", head: "What" },
  { id: "kind", head: "Kind", w: "96px" },
  { id: "supplier", head: "Supplier", w: "128px" },
  { id: "low", head: "Low", w: "112px", align: "right" },
  { id: "likely", head: "Likely", w: "128px", align: "right" },
  { id: "high", head: "High", w: "112px", align: "right" },
  { id: "src", head: "Source", w: "72px" },
  { id: "covers", head: "Covers", w: "200px" },
];

const TOTAL_COLS: readonly Col[] = [
  { id: "what", head: "", w: "160px" },
  { id: "low", head: "Low", w: "128px", align: "right" },
  { id: "likely", head: "Likely", w: "144px", align: "right" },
  { id: "high", head: "High", w: "128px", align: "right" },
];

const SRC_WORDS: Readonly<Record<string, string>> = {
  src: "Read from a source",
  meas: "Measured",
  est: "Estimated",
  calc: "Calculated",
};

function CostsPart({ c, stale, rev }: { c: CostsOutput; stale: boolean; rev: number }) {
  const t = c.totals;
  const rows: [string, MoneyOut][] = [
    ["Order lines", t.lines],
    ["Cost lines", t.costs],
    ["Subtotal", t.subtotal],
    ["Contingency", t.contingency],
    ["Total", t.total],
  ];
  return (
    <Sheet testid="costs" rev={rev} stale={stale}>
      <h3 class="part-head">Costs</h3>
      {c.costs.length > 0 && (
        <SheetTable cols={COST_COLS} testid="cost-lines">
          <tbody>
            {c.costs.map((x) => (
              <Row
                key={x.id}
                data-cost={x.id}
                title={
                  [x.ref, x.read && `read ${x.read}`, x.note].filter(Boolean).join("; ") ||
                  undefined
                }
              >
                <td>
                  <b>{x.id}</b>
                </td>
                <td>
                  <Clip text={x.label} />
                </td>
                <td>{x.kind}</td>
                <td>{x.supplier ?? ""}</td>
                <td class="n">
                  <Num text={money(x.low_minor ?? 0, { table: true })} />
                </td>
                <td class="n">
                  <Num text={money(x.likely_minor ?? 0, { table: true })} />
                  {x.currency ? <span class="sub"> {x.currency}</span> : ""}
                  {x.converted && (
                    <div class="second">
                      {money(x.converted.likely_minor, { table: true })} at {x.converted.rate}
                    </div>
                  )}
                </td>
                <td class="n">
                  <Num text={money(x.high_minor ?? 0, { table: true })} />
                </td>
                <td>{x.src}</td>
                <td>
                  <Clip
                    text={[coversText(x), x.blocks === "order" ? "holds the order" : ""]
                      .filter((s) => s !== "")
                      .join("; ")}
                  />
                </td>
              </Row>
            ))}
          </tbody>
        </SheetTable>
      )}
      <h4 class="block-head">
        <span class="figure">Totals</span>
        {t.currency && <span class="sub">in {t.currency}</span>}
      </h4>
      <SheetTable cols={TOTAL_COLS} testid="totals" class="totals">
        <tbody>
          {rows.map(([label, x]) => (
            <tr key={label} class={label === "Total" ? "total" : undefined}>
              <th scope="row">{label}</th>
              <td class="n">
                <Num text={money(x.low_minor, { table: true })} />
              </td>
              <td class="n">
                <Num text={money(x.likely_minor, { table: true })} />
              </td>
              <td class="n">
                <Num text={money(x.high_minor, { table: true })} />
              </td>
            </tr>
          ))}
        </tbody>
      </SheetTable>
      {t.by_currency.length > 1 && (
        <p class="sub pad">
          In each currency:{" "}
          {t.by_currency
            .map(
              (x) =>
                `${x.currency} ${money(x.likely_minor, { table: true })} (${money(x.low_minor, { table: true })} to ${money(x.high_minor, { table: true })})`,
            )
            .join("; ")}
          .
        </p>
      )}
      {t.share.length > 0 && (
        <div class="share" data-testid="share">
          <div class="share-title sub">Share of the likely total by how its prices are known</div>
          <div class="share-bar" role="img" aria-label="Share of the likely total by provenance">
            {t.share.map((x) => (
              <span
                key={x.src}
                class={`share-seg ${x.src}`}
                style={{ width: `${x.pct}%` }}
                title={`${SRC_WORDS[x.src] ?? x.src} ${x.pct.toFixed(2)} %`}
              />
            ))}
          </div>
          <div class="share-legend">
            {t.share.map((x) => (
              <span key={x.src} class="share-key">
                <i class={`share-swatch ${x.src}`} aria-hidden="true" />
                {SRC_WORDS[x.src] ?? x.src} <b>{x.pct.toFixed(2)} %</b>
              </span>
            ))}
          </div>
        </div>
      )}
      {t.unpriced > 0 && (
        <p class="pad warn">
          <StatusGlyph status="warn" size={12} /> {plural(t.unpriced, "order line")}{" "}
          {t.unpriced === 1 ? "has" : "have"} no price and {t.unpriced === 1 ? "is" : "are"} left
          out.
        </p>
      )}
    </Sheet>
  );
}

function Skeleton({ rev, what }: { rev: number; what: string }) {
  return (
    <div class="skeleton" role="status" aria-busy="true">
      <i />
      <i />
      <i />
      <p class="sub">
        {what} step {rev}…
      </p>
    </div>
  );
}

export function OrderCostsSheet({ m }: { m: Model }) {
  const order = useOutput<Order>(withAsOf("/api/order"), m.rev);
  const costs = useOutput<CostsOutput>(withAsOf("/api/costs"), m.rev);
  if (order === undefined) return <Skeleton rev={m.rev} what="Pricing" />;
  if ("error" in order) return <p class="panel-empty">Cannot load the order: {order.error}</p>;
  return (
    <div class="order-costs">
      <OrderPart m={m} o={order.value} stale={order.stale} rev={order.rev} />
      {costs === undefined ? (
        <Skeleton rev={m.rev} what="Costing" />
      ) : "error" in costs ? (
        <p class="panel-empty">Cannot load the costs: {costs.error}</p>
      ) : (
        <CostsPart c={costs.value} stale={costs.stale} rev={costs.rev} />
      )}
    </div>
  );
}
