import { useEffect, useState } from "preact/hooks";
import type { CatalogTree, ItemCard, ListedEntry, Thumb } from "../server/catalog.ts";
import { get } from "./api.ts";
import { model } from "./store.ts";
import { activeTool, type PaletteItem, palette } from "./tools.ts";

/**
 * The catalog browser (design §8, left): vendor › kind › family, a search, item cards with a
 * section thumbnail, fidelity and key data, and the chosen item's options and offers. "Set as
 * palette" makes a bar what the draw tool draws with, any other item what the place tool places.
 * Everything comes from the server's catalog API, over the live catalogs and the lock.
 */

interface Filter {
  vendor?: string;
  kind?: string;
  family?: string;
}

const SRC: Readonly<Record<string, string>> = {
  src: "read from a source",
  meas: "measured",
  est: "estimated",
  calc: "computed",
};

/** A section drawn small, y up, fitted to its box. */
export function SectionThumb({
  s,
  size = 44,
}: {
  s: Pick<Thumb, "outline" | "holes" | "bbox">;
  size?: number;
}) {
  const [[x0, y0], [x1, y1]] = s.bbox;
  const w = x1 - x0;
  const h = y1 - y0;
  const pad = Math.max(w, h) * 0.06;
  const path = (r: readonly (readonly [number, number])[]) =>
    `${r.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${-y}`).join(" ")} Z`;
  return (
    <svg
      class="thumb"
      width={size}
      height={size}
      viewBox={`${x0 - pad} ${-y1 - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      role="img"
      aria-label="section"
    >
      <path d={[s.outline, ...s.holes].map(path).join(" ")} fill-rule="evenodd" />
    </svg>
  );
}

function money(minor: number, currency?: string): string {
  return `${currency ?? ""} ${(minor / 100).toFixed(2)}`.trim();
}

function Card({ id, onClose }: { id: string; onClose: () => void }) {
  const [card, setCard] = useState<ItemCard | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [opt, setOpt] = useState<Record<string, string>>({});
  useEffect(() => {
    setCard(undefined);
    setError(undefined);
    setOpt({});
    get<ItemCard>(`/api/catalog/item?id=${encodeURIComponent(id)}`).then(setCard, (e) =>
      setError((e as Error).message),
    );
  }, [id]);
  if (error) return <div class="card-detail">{error}</div>;
  if (!card) return <div class="card-detail">…</div>;
  const isBar = card.entry.kind === "bar";
  const set = () => {
    const chosen = Object.fromEntries(Object.entries(opt).filter(([, v]) => v !== ""));
    const item: PaletteItem = {
      id: card.entry.id,
      kind: card.entry.kind,
      name: card.entry.name,
      ...(Object.keys(chosen).length > 0 ? { opt: chosen } : {}),
      ...(card.section ? { section: card.section } : {}),
      ...(card.anchors ? { anchors: card.anchors } : {}),
    };
    palette.value = isBar ? { ...palette.value, bar: item } : { ...palette.value, part: item };
    if (isBar && activeTool.value !== "draw") activeTool.value = "draw";
    if (!isBar && activeTool.value !== "place") activeTool.value = "place";
  };
  return (
    <div class="card-detail" data-testid="catalog-card" data-id={card.entry.id}>
      <div class="card-head">
        {card.section && <SectionThumb s={card.section} size={96} />}
        <div>
          <strong>{card.entry.code ?? card.entry.id}</strong>
          <div class="sub">{card.entry.name}</div>
          <div class="sub">
            {card.entry.vendor} › {card.entry.kind} › {card.entry.family}
            {!card.entry.live && " · from the lock"}
          </div>
        </div>
        <button type="button" class="close" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <table class="grid">
        <tbody>
          {card.data.map((d) => (
            <tr key={d.key}>
              <th>{d.key}</th>
              <td
                title={d.src ? (SRC[d.src] ?? d.src) : undefined}
                class={d.src ? `prov-${d.src}` : ""}
              >
                {String(d.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.entries(card.options).map(([name, values]) => (
        <label key={name} class="cd-row">
          {name}{" "}
          <select
            data-testid={`option-${name}`}
            value={opt[name] ?? ""}
            onChange={(e) => setOpt({ ...opt, [name]: (e.target as HTMLSelectElement).value })}
          >
            <option value="">(the project's default)</option>
            {values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="button" class="cd-primary" data-testid="palette-set" onClick={set}>
        Set as palette ({isBar ? "draw" : "place"})
      </button>
      {card.offers.length > 0 && (
        <table class="grid offers" data-testid="catalog-offers">
          <thead>
            <tr>
              <th>offer</th>
              <th>sells</th>
              <th>price</th>
            </tr>
          </thead>
          <tbody>
            {card.offers.map((o) => (
              <tr key={o.sku}>
                <td>
                  <code>{o.code}</code>
                  <div class="sub">
                    {o.supplier}
                    {Object.keys(o.options).length > 0 &&
                      ` · ${Object.entries(o.options)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(", ")}`}
                  </div>
                </td>
                <td>
                  {o.sale?.mode === "cut"
                    ? `cut ${o.sale.min_mm ?? ""}–${o.sale.max_mm ?? ""} mm`
                    : o.sale?.mode === "stock"
                      ? `${o.sale.length_mm} mm bars`
                      : o.kit
                        ? "kit"
                        : o.pack > 1
                          ? `pack of ${o.pack}`
                          : "each"}
                </td>
                <td>
                  {money(o.price.regular_minor, o.currency)}/{o.price.per}
                  {o.price.sale_minor !== null && (
                    <div class="sub">sale {money(o.price.sale_minor, o.currency)}</div>
                  )}
                  <div class="sub">read {o.price.read}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Catalog() {
  const [tree, setTree] = useState<CatalogTree[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [list, setList] = useState<{ total: number; items: ListedEntry[] } | undefined>();
  const [chosen, setChosen] = useState<string | undefined>();
  const rev = model.value?.rev;

  useEffect(() => {
    get<{ tree: CatalogTree[] }>("/api/catalog").then(
      (r) => setTree(r.tree),
      (e) => setError((e as Error).message),
    );
  }, [rev === undefined]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    for (const k of ["vendor", "kind", "family"] as const) {
      const v = filter[k];
      if (v !== undefined) params.set(k, v);
    }
    params.set("limit", "60");
    const t = setTimeout(() => {
      get<{ total: number; items: ListedEntry[] }>(`/api/catalog/items?${params}`).then(
        setList,
        (e) => setError((e as Error).message),
      );
    }, 120);
    return () => clearTimeout(t);
  }, [q, filter.vendor, filter.kind, filter.family]);

  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };
  const same = (f: Filter) =>
    f.vendor === filter.vendor && f.kind === filter.kind && f.family === filter.family;
  const pickFilter = (f: Filter) => setFilter(same(f) ? {} : f);

  return (
    <nav class="catalog" data-testid="catalog">
      <div class="tree-tools">
        <input
          type="search"
          data-testid="catalog-search"
          placeholder="Search: code, name, family"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
      </div>
      {error && <p class="panel-empty">{error}</p>}
      <ul class="cat-list ctree">
        {tree?.map((v) => (
          <li key={v.vendor}>
            <button
              type="button"
              class={`cat-node${same({ vendor: v.vendor }) ? " on" : ""}`}
              onClick={() => {
                toggle(v.vendor);
                pickFilter({ vendor: v.vendor });
              }}
            >
              {open.has(v.vendor) ? "▾" : "▸"} {v.vendor} <span class="count">{v.count}</span>
            </button>
            {open.has(v.vendor) && (
              <ul class="cat-list">
                {v.kinds.map((k) => {
                  const kk = `${v.vendor}/${k.kind}`;
                  return (
                    <li key={kk}>
                      <button
                        type="button"
                        class={`cat-node${same({ vendor: v.vendor, kind: k.kind }) ? " on" : ""}`}
                        onClick={() => {
                          toggle(kk);
                          pickFilter({ vendor: v.vendor, kind: k.kind });
                        }}
                      >
                        {open.has(kk) ? "▾" : "▸"} {k.kind} <span class="count">{k.count}</span>
                      </button>
                      {open.has(kk) && (
                        <ul class="cat-list">
                          {k.families.map((f) => (
                            <li key={f.family}>
                              <button
                                type="button"
                                class={`cat-leaf${same({ vendor: v.vendor, kind: k.kind, family: f.family }) ? " selected" : ""}`}
                                onClick={() =>
                                  pickFilter({ vendor: v.vendor, kind: k.kind, family: f.family })
                                }
                              >
                                <span class="cat-name">{f.family}</span>
                                <span class="count">{f.count}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {chosen && <Card id={chosen} onClose={() => setChosen(undefined)} />}
      <p class="sub list-count" data-testid="catalog-count">
        {list ? `${list.total} item${list.total === 1 ? "" : "s"}` : ""}
        {list && list.total > list.items.length ? `, the first ${list.items.length}` : ""}
      </p>
      <ul class="cat-list cards">
        {list?.items.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              class={`card${chosen === e.id ? " selected" : ""}`}
              data-id={e.id}
              onClick={() => setChosen(e.id)}
            >
              {e.thumb ? <SectionThumb s={e.thumb} /> : <span class="thumb none">{e.kind[0]}</span>}
              <span class="card-text">
                <strong>{e.code ?? e.id}</strong>
                <span class="sub">{e.name}</span>
                <span class="sub">
                  {e.kind} · {e.family}
                  {e.fidelity ? ` · ${e.fidelity}` : ""}
                  {e.mass_kg_per_m !== undefined ? ` · ${e.mass_kg_per_m} kg/m` : ""}
                  {e.pinned ? " · in use" : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
