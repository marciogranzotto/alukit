import { detailText, itemsText, priceText, qtyText, supplierName } from "#core/order/format.ts";
import type { MoneyOut, Order, OrderLine } from "#core/order/types.ts";
import { EntityChips } from "../common/EntityChip.tsx";
import { money } from "../format.ts";
import type { Model } from "../model.ts";
import { registerSheet } from "../sheets/registry.ts";
import { resolveTargets } from "../targets.ts";
import { AsOfInput, optText, Stamp, useOutput, withAsOf } from "./common.tsx";

/**
 * The order (design §8; `alukit order`): its status, and each supplier's status, reasons, total and
 * lines, judged as of a date (the stale-price rule), so asked of the server when shown, in the
 * tab's variant. A reason's entities select in the scene. Owner: S4.
 */

function rangeText(m: MoneyOut, currency: string | null): string {
  return `${money(m.likely_minor)}${currency ? ` ${currency}` : ""} (${money(m.low_minor)} to ${money(m.high_minor)})`;
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

/** Where a line's price came from (principle 3): its provenance and the date it was read. */
function priceTitle(l: OrderLine): string | undefined {
  if (l.likely_minor === undefined) return undefined;
  const parts = [`price ${l.price_src ?? "src"}`];
  if (l.read) parts.push(`read ${l.read}`);
  if (l.on_sale) parts.push("on sale");
  if (l.range) parts.push(l.range === "quote" ? "range quoted" : `band ${l.band}`);
  return parts.join(", ");
}

export function OrderSheet({ m }: { m: Model }) {
  const got = useOutput<Order>(withAsOf("/api/order"), m.rev);
  if (got === undefined) return <p class="panel-empty">Pricing the order…</p>;
  if ("error" in got) return <p class="panel-empty">Cannot load the order: {got.error}</p>;
  const o = got.value;
  const stale = got.stale;
  return (
    <div
      data-testid="order"
      data-rev={got.rev}
      class={stale ? "stale" : undefined}
      aria-busy={stale}
    >
      <p class="sub">
        <span class={`status ${o.status}`}>{o.status}</span>. Prices on the {o.price_basis} basis
        {o.currency ? ` in ${o.currency}` : ""}, <AsOfInput value={o.as_of} />; the oldest was read{" "}
        {o.oldest_read ?? "(none)"}. <Stamp lock={o.lock} />
      </p>
      {o.suppliers.map((s) => (
        <section key={s.supplier ?? ""} data-supplier={s.supplier ?? ""}>
          <h4>
            {supplierName(s)} <span class={`status ${s.status}`}>{s.status}</span>
            <span class="sub"> · {rangeText(s.totals, o.currency)}</span>
          </h4>
          {s.reasons.length > 0 && (
            <ul class="diagnostics">
              {s.reasons.map((r) => (
                <li key={`${r.rule}${r.message}`} class={r.action === "block" ? "error" : "warn"}>
                  <span class="sev">{r.action}</span> <span class="code">{r.rule}</span>{" "}
                  {r.entities && <EntityChips ids={resolveTargets(m, r.entities).ids} />}{" "}
                  {r.message}
                </li>
              ))}
            </ul>
          )}
          {s.lines.length > 0 && (
            <table class="grid">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>item</th>
                  <th>name</th>
                  <th>options</th>
                  <th>quantity</th>
                  <th class="n">unit price</th>
                  <th class="n">low</th>
                  <th class="n">likely</th>
                  <th class="n">high</th>
                  <th>details</th>
                  <th>for</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l) => {
                  const [unit, low, likely, high] = priceText(l);
                  return (
                    <tr key={lineKey(l)}>
                      <td>{l.sku ?? ""}</td>
                      <td>{l.item}</td>
                      <td>{l.name}</td>
                      <td>{optText(l.opt)}</td>
                      <td>{qtyText(l)}</td>
                      <td class="n" title={priceTitle(l)}>
                        {unit}
                      </td>
                      <td class="n">{low}</td>
                      <td class="n">{likely}</td>
                      <td class="n">{high}</td>
                      <td>{detailText(l)}</td>
                      <td>{itemsText(l.bom)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {s.costs.length > 0 && <p class="sub">Cost lines: {s.costs.join(", ")}.</p>}
        </section>
      ))}
    </div>
  );
}

registerSheet({ id: "order", title: "Order", order: 40, Body: OrderSheet });
