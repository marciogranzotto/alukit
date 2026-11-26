import { useEffect, useState } from "preact/hooks";
import { endText, machiningText, railText } from "#core/cutlist/format.ts";
import {
  type CostsOutput,
  coversText,
  detailText,
  itemsText,
  money,
  priceText,
  qtyText,
  supplierName,
} from "#core/order/format.ts";
import type { MoneyOut, Order, OrderLine } from "#core/order/types.ts";
import { getAtRev } from "./api.ts";
import type { Model } from "./model.ts";
import { asOf, log, model, select, selection } from "./store.ts";

/**
 * The bottom drawer (design §8): cut list, BOM, order (status per supplier), costs, checks and
 * the log. Open items, params and decisions join it when they are built (M5). The cut list, BOM
 * and checks come with the revision's model; the order and the costs are asked of the server
 * when their tab is open, since they are judged as of a date (the stale-price rule).
 */

const TABS = ["Cut list", "BOM", "Order", "Costs", "Checks", "Log"] as const;
type Tab = (typeof TABS)[number];

const mm = (x: number) => x.toFixed(2);
const optText = (opt: Readonly<Record<string, string>>) =>
  Object.keys(opt)
    .sort()
    .map((k) => `${k} ${opt[k]}`)
    .join(", ");

function Sources({ ids }: { ids: readonly string[] }) {
  const sel = selection.value;
  return (
    <span class="sources">
      {ids.map((id) => (
        <button
          type="button"
          key={id}
          class={`link${sel.has(id) ? " selected" : ""}`}
          onClick={(e) => select([id], e.ctrlKey || e.metaKey ? "toggle" : "replace")}
        >
          {id}
        </button>
      ))}
    </span>
  );
}

function CutListTab({ m }: { m: Model }) {
  const cl = m.cutlist;
  if (cl.groups.length === 0) return <p class="panel-empty">No pieces.</p>;
  return (
    <div data-testid="cutlist">
      {cl.groups.map((g) => (
        <section key={`${g.item}${optText(g.opt)}`}>
          <h4>
            {g.item} <span class="sub">{g.name}</span>{" "}
            {optText(g.opt) && <span class="sub">({optText(g.opt)})</span>}
            <span class="sub">
              {" "}
              · {g.pieces} piece{g.pieces === 1 ? "" : "s"}, {mm(g.total_mm)} mm ·{" "}
              {g.mode === "cut"
                ? `cut to order (${g.offer})`
                : g.mode === "stock"
                  ? `from stock bars`
                  : "no offer by length"}
            </span>
          </h4>
          <table class="grid">
            <thead>
              <tr>
                <th>count</th>
                <th>cut mm</th>
                <th>centre mm</th>
                <th>ends a / b</th>
                <th>machining</th>
                <th>pieces</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={l.sources.join(",")}>
                  <td class="n">{l.count}</td>
                  <td class="n">{mm(l.cut_mm)}</td>
                  <td class="n">{l.centre_mm === undefined ? "" : mm(l.centre_mm)}</td>
                  <td>
                    {endText(l.ends.a)} / {endText(l.ends.b)}
                  </td>
                  <td>
                    {[
                      ...(l.rail ? [railText(l.rail)] : []),
                      ...l.machining.map(machiningText),
                    ].join("; ")}
                  </td>
                  <td>
                    <Sources ids={l.sources} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.stock && (
            <p class="sub">
              {g.stock.length} stock bar{g.stock.length === 1 ? "" : "s"}:{" "}
              {g.stock.map((s) => `${s.length_mm} (offcut ${mm(s.offcut_mm)})`).join(", ")}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function BomTab({ m }: { m: Model }) {
  const b = m.bom;
  return (
    <div data-testid="bom">
      <p class="sub">
        Total mass {b.mass_kg.toFixed(3)} kg
        {b.mass_unknown.length > 0 && `, without ${b.mass_unknown.join(", ")} (no mass given)`}
      </p>
      {b.groups.map((g) => (
        <section key={g.kind}>
          <h4>
            {g.kind} <span class="sub">· {g.mass_kg.toFixed(3)} kg</span>
          </h4>
          <table class="grid">
            <thead>
              <tr>
                <th>item</th>
                <th>name</th>
                <th>options</th>
                <th>qty</th>
                <th>length mm</th>
                <th>mass kg</th>
                <th>used by</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={`${l.item}${optText(l.opt)}`}>
                  <td>{l.item}</td>
                  <td>{l.name}</td>
                  <td>{optText(l.opt)}</td>
                  <td class="n">{l.qty}</td>
                  <td class="n">{l.length_mm === undefined ? "" : mm(l.length_mm)}</td>
                  <td class="n" title={l.mass_src ? `mass: ${l.mass_src}` : "no mass"}>
                    {l.mass_kg === undefined ? "" : l.mass_kg.toFixed(3)}
                  </td>
                  <td>
                    <Sources ids={l.sources} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

/** The kinds of document entity a reason or a diagnostic may name, as the tree lists them. */
const ENTITY_KINDS = ["bars", "runs", "connections", "parts", "patterns", "nodes"] as const;

/**
 * The entities among names an order reason carries, to select: an end or a stock piece (`b3.a`,
 * `c23.f1`) selects its entity; items, cost lines and suppliers are not in the scene.
 */
function entityIds(m: Model, names: readonly string[]): string[] {
  const known = (id: string) =>
    id in m.derived.bars ||
    id in m.derived.parts ||
    ENTITY_KINDS.some((k) => {
      const written = m.doc[k];
      return typeof written === "object" && written !== null && id in written;
    });
  return [...new Set(names.map((n) => n.split(".")[0] as string))].filter(known);
}

type Fetched<T> = { rev: number; value: T } | { error: string };

/**
 * An output the server computes on request, for the drawn revision: asked again when the
 * revision or the path changes. The last answer stays on screen, marked stale, until the
 * revision's own arrives, so the drawer settles on the revision the scene shows.
 */
function useOutput<T>(path: string, rev: number): Fetched<T> | undefined {
  const [got, setGot] = useState<Fetched<T>>();
  useEffect(() => {
    let live = true;
    getAtRev<T>(path).then(
      (r) => {
        if (live) setGot({ rev: r.rev, value: r.body });
      },
      (e: unknown) => {
        if (live) setGot({ error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [path, rev]);
  return got;
}

/** An output's path with the order's date, when one was picked (`?as_of=`). */
function withAsOf(path: string): string {
  const d = asOf.value;
  return d === undefined ? path : `${path}?as_of=${encodeURIComponent(d)}`;
}

/** The order's date: the server's today until one is picked; clearing it goes back to today. */
function AsOfInput({ value }: { value: string }) {
  return (
    <label class="as-of">
      as of{" "}
      <input
        type="date"
        data-testid="as-of"
        value={value}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          asOf.value = v === "" ? undefined : v;
        }}
      />
    </label>
  );
}

/** The lock an output was derived from (§4.13's stamp), shortened; the whole hash on hover. */
function Stamp({ lock }: { lock: string | undefined }) {
  if (lock === undefined) return null;
  return (
    <span class="stamp" title={`Derived from the lock ${lock}`}>
      Lock {lock.slice(0, 19)}…
    </span>
  );
}

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

function OrderTab({ m }: { m: Model }) {
  const got = useOutput<Order>(withAsOf("/api/order"), m.rev);
  if (got === undefined) return <p class="panel-empty">Pricing the order…</p>;
  if ("error" in got) return <p class="panel-empty">Cannot load the order: {got.error}</p>;
  const o = got.value;
  const stale = got.rev !== m.rev;
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
                  {r.entities && <Sources ids={entityIds(m, r.entities)} />} {r.message}
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

function CostsTab({ m }: { m: Model }) {
  const got = useOutput<CostsOutput>(withAsOf("/api/costs"), m.rev);
  if (got === undefined) return <p class="panel-empty">Pricing the costs…</p>;
  if ("error" in got) return <p class="panel-empty">Cannot load the costs: {got.error}</p>;
  const c = got.value;
  const t = c.totals;
  const stale = got.rev !== m.rev;
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
                <td class="n">{money(x.low_minor ?? 0)}</td>
                <td class="n">
                  {money(x.likely_minor ?? 0)}
                  {x.currency ? ` ${x.currency}` : ""}
                  {x.converted
                    ? ` (${money(x.converted.likely_minor)} at ${x.converted.rate})`
                    : ""}
                </td>
                <td class="n">{money(x.high_minor ?? 0)}</td>
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
              <td class="n">{money(x.low_minor)}</td>
              <td class="n">{money(x.likely_minor)}</td>
              <td class="n">{money(x.high_minor)}</td>
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

function ChecksTab({ m }: { m: Model }) {
  const ds = m.check.diagnostics;
  const count = (s: string) => ds.filter((d) => d.severity === s).length;
  return (
    <div data-testid="checks">
      <p class="sub">
        {count("error")} error{count("error") === 1 ? "" : "s"}, {count("warn")} warning
        {count("warn") === 1 ? "" : "s"}, {count("info")} note{count("info") === 1 ? "" : "s"}
      </p>
      {m.check.checks.length > 0 && (
        <table class="grid">
          <thead>
            <tr>
              <th>check</th>
              <th>text</th>
              <th>result</th>
              <th>margin</th>
            </tr>
          </thead>
          <tbody>
            {m.check.checks.map((c) => (
              <tr key={c.id} class={c.pass === false ? c.severity : ""}>
                <td>{c.id}</td>
                <td>{c.text ?? ""}</td>
                <td>
                  {c.pending
                    ? "pending"
                    : c.pass === undefined
                      ? (c.problem ?? "?")
                      : c.pass
                        ? "pass"
                        : "fail"}
                </td>
                <td class="n">{c.margin ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul class="diagnostics">
        {ds.map((d) => (
          <li key={`${d.severity}${d.code}${d.entity}${d.field}${d.message}`} class={d.severity}>
            <span class="sev">{d.severity}</span> <span class="code">{d.code}</span>{" "}
            {d.entity && <Sources ids={[d.entity.split(".")[0] as string]} />} {d.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogTab() {
  const entries = log.value;
  if (entries.length === 0) return <p class="panel-empty">No steps since the server started.</p>;
  return (
    <table class="grid" data-testid="log">
      <thead>
        <tr>
          <th>rev</th>
          <th>source</th>
          <th>what</th>
        </tr>
      </thead>
      <tbody>
        {[...entries].reverse().map((e) => (
          <tr key={e.rev}>
            <td class="n">{e.rev}</td>
            <td>{e.source}</td>
            <td>{e.what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Drawer() {
  const [tab, setTab] = useState<Tab>("Cut list");
  const [open, setOpen] = useState(true);
  const m = model.value;
  const errors = m?.check.diagnostics.filter((d) => d.severity === "error").length ?? 0;
  return (
    <section class={`drawer${open ? " open" : ""}`}>
      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            type="button"
            role="tab"
            class="tab"
            key={t}
            aria-selected={open && tab === t}
            onClick={() => {
              if (open && tab === t) setOpen(false);
              else {
                setTab(t);
                setOpen(true);
              }
            }}
          >
            {t}
            {t === "Checks" && errors > 0 && <span class="badge">{errors}</span>}
          </button>
        ))}
      </div>
      {open && m && (
        <div class="drawer-body">
          {tab === "Cut list" && <CutListTab m={m} />}
          {tab === "BOM" && <BomTab m={m} />}
          {tab === "Order" && <OrderTab m={m} />}
          {tab === "Costs" && <CostsTab m={m} />}
          {tab === "Checks" && <ChecksTab m={m} />}
          {tab === "Log" && <LogTab />}
        </div>
      )}
    </section>
  );
}
