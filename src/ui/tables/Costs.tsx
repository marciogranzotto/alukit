import { type CostsOutput, coversText } from "#core/order/format.ts";
import type { MoneyOut } from "#core/order/types.ts";
import { money } from "../format.ts";
import type { Model } from "../model.ts";
import { registerSheet } from "../sheets/registry.ts";
import { AsOfInput, Stamp, useOutput, withAsOf } from "./common.tsx";

/**
 * The costs (design §8; `alukit costs`): the cost lines, then the totals low, likely and high, in
 * each currency and by provenance, judged as of a date as the order is, so asked of the server
 * when shown. Owner: S4.
 */
export function CostsSheet({ m }: { m: Model }) {
  const got = useOutput<CostsOutput>(withAsOf("/api/costs"), m.rev);
  if (got === undefined) return <p class="panel-empty">Pricing the costs…</p>;
  if ("error" in got) return <p class="panel-empty">Cannot load the costs: {got.error}</p>;
  const c = got.value;
  const t = c.totals;
  const stale = got.stale;
  const rows: [string, MoneyOut][] = [
    ["Order lines", t.lines],
    ["Cost lines", t.costs],
    ["Subtotal", t.subtotal],
    ["Contingency", t.contingency],
    ["Total", t.total],
  ];
  return (
    <div
      data-testid="costs"
      data-rev={got.rev}
      class={stale ? "stale" : undefined}
      aria-busy={stale}
    >
      <p class="sub">
        Prices on the {c.price_basis} basis{c.currency ? ` in ${c.currency}` : ""},{" "}
        <AsOfInput value={c.as_of} />. <Stamp lock={c.lock} />
      </p>
      {c.costs.length > 0 && (
        <table class="grid" data-testid="cost-lines">
          <thead>
            <tr>
              <th>id</th>
              <th>label</th>
              <th>kind</th>
              <th>supplier</th>
              <th class="n">low</th>
              <th class="n">likely</th>
              <th class="n">high</th>
              <th>src</th>
              <th>covers</th>
            </tr>
          </thead>
          <tbody>
            {c.costs.map((x) => (
              <tr
                key={x.id}
                title={
                  [x.ref, x.read && `read ${x.read}`, x.note].filter(Boolean).join("; ") ||
                  undefined
                }
              >
                <td>{x.id}</td>
                <td>{x.label}</td>
                <td>{x.kind}</td>
                <td>{x.supplier ?? ""}</td>
                <td class="n">{money(x.low_minor ?? 0, { table: true })}</td>
                <td class="n">
                  {money(x.likely_minor ?? 0, { table: true })}
                  {x.currency ? ` ${x.currency}` : ""}
                  {x.converted
                    ? ` (${money(x.converted.likely_minor)} at ${x.converted.rate})`
                    : ""}
                </td>
                <td class="n">{money(x.high_minor ?? 0, { table: true })}</td>
                <td>{x.src}</td>
                <td>
                  {[coversText(x), x.blocks === "order" ? "holds the order" : ""]
                    .filter((s) => s !== "")
                    .join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4>Totals{t.currency ? ` (${t.currency})` : ""}</h4>
      <table class="grid totals" data-testid="totals">
        <thead>
          <tr>
            <th />
            <th class="n">low</th>
            <th class="n">likely</th>
            <th class="n">high</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, x]) => (
            <tr key={label} class={label === "Total" ? "total" : undefined}>
              <td>{label}</td>
              <td class="n">{money(x.low_minor, { table: true })}</td>
              <td class="n">{money(x.likely_minor, { table: true })}</td>
              <td class="n">{money(x.high_minor, { table: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {t.by_currency.length > 1 && (
        <p class="sub">
          In each currency:{" "}
          {t.by_currency
            .map(
              (x) =>
                `${x.currency} ${money(x.likely_minor)} (${money(x.low_minor)} to ${money(x.high_minor)})`,
            )
            .join("; ")}
          .
        </p>
      )}
      {t.share.length > 0 && (
        <p class="sub">
          Share of the likely total by provenance:{" "}
          {t.share.map((x) => `${x.src} ${x.pct.toFixed(2)} %`).join(", ")}.
        </p>
      )}
      {t.unpriced > 0 && (
        <p class="warn">
          {t.unpriced} order line{t.unpriced === 1 ? " has" : "s have"} no price and{" "}
          {t.unpriced === 1 ? "is" : "are"} left out.
        </p>
      )}
    </div>
  );
}

registerSheet({ id: "costs", title: "Costs", order: 50, Body: CostsSheet });
