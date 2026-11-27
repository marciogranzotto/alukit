import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { CatalogTree, ListedEntry } from "../../server/catalog.ts";
import { get } from "../api.ts";
import { type CatalogItems, fetchCatalogItems } from "../client/catalog.ts";
import { kgPerM, money } from "../format.ts";
import { chord, describeKeys, onKey } from "../keys.ts";
import { model } from "../store.ts";
import { activeTool } from "../tools/state.ts";
import { Card } from "./Card.tsx";
import { SectionThumb, sizeOf } from "./SectionThumb.tsx";
import {
  type CatalogFilter,
  catalogChosen,
  catalogFilter,
  catalogOpen,
  catalogQuery,
  chooseFilter,
  closeCatalog,
  forgetCards,
  openCatalog,
  toolKind,
} from "./state.ts";

/**
 * The catalog, wide (D-UX-1, S2.3, A F2): an overlay over the left column and the canvas, opened
 * with `/` or the bin's "Browse catalog…", closed with Esc or ×. A search, the facets (vendor ›
 * kind › family, and a kind row that follows the active tool), the results with their whole
 * names, size, mass per metre and lowest price, and the open item's card. Everything it shows
 * stays as it was while it is closed (U15). It reads the server's catalog API, over the live
 * catalogs, the lock and the document's own items (§4.8). Owner: S2.
 *
 * The ranking is the server's (`alukit catalog search`'s): `prefer` names the kind the active
 * tool wants, which ranks first within each rank (BE-8; a server before BE-8 ignores it).
 */

const tree = signal<{ rev: number; tree: CatalogTree[] } | undefined>(undefined);
const results = signal<CatalogItems | undefined>(undefined);
const loadError = signal<string | undefined>(undefined);

/** Kinds in words, for the kind row. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  bar: "Profiles",
  connector: "Connectors",
  fastener: "Fasteners",
  carriage: "Carriages",
  accessory: "Accessories",
  panel: "Panels",
  generic: "Other items",
  plate: "Plates",
  "bent-angle": "Bent angles",
  placeholder: "Placeholders",
};

const same = (a: CatalogFilter, b: CatalogFilter) =>
  a.vendor === b.vendor && a.kind === b.kind && a.family === b.family;

function Facets() {
  const f = catalogFilter.value;
  const t = tree.value?.tree ?? [];
  const pick = (next: CatalogFilter) => chooseFilter(same(next, f) ? {} : next);
  return (
    <nav class="cat-facets" aria-label="Browse by vendor, kind and family">
      <ul class="cat-list ctree">
        {t.map((v) => (
          <li key={v.vendor}>
            <button
              type="button"
              class={`cat-node${same({ vendor: v.vendor }, f) ? " on" : ""}`}
              aria-pressed={same({ vendor: v.vendor }, f)}
              onClick={() => pick({ vendor: v.vendor })}
            >
              {v.vendor} <span class="count">{v.count}</span>
            </button>
            {f.vendor === v.vendor && (
              <ul class="cat-list">
                {v.kinds.map((k) => (
                  <li key={k.kind}>
                    <button
                      type="button"
                      class={`cat-node${same({ vendor: v.vendor, kind: k.kind }, f) ? " on" : ""}`}
                      aria-pressed={same({ vendor: v.vendor, kind: k.kind }, f)}
                      onClick={() => pick({ vendor: v.vendor, kind: k.kind })}
                    >
                      {KIND_WORDS[k.kind] ?? k.kind} <span class="count">{k.count}</span>
                    </button>
                    {f.kind === k.kind && (
                      <ul class="cat-list">
                        {k.families.map((fam) => (
                          <li key={fam.family}>
                            <button
                              type="button"
                              class={`cat-leaf${f.family === fam.family ? " selected" : ""}`}
                              aria-pressed={f.family === fam.family}
                              onClick={() =>
                                pick({ vendor: v.vendor, kind: k.kind, family: fam.family })
                              }
                            >
                              <span class="cat-name">{fam.family}</span>
                              <span class="count">{fam.count}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The kind row: any, or one kind, across vendors. */
function KindRow() {
  const f = catalogFilter.value;
  const kinds = [...new Set((tree.value?.tree ?? []).flatMap((v) => v.kinds.map((k) => k.kind)))];
  return (
    <fieldset class="kind-row">
      <legend class="sr-only">Kind</legend>
      <button
        type="button"
        class={`chip${f.kind === undefined ? " on" : ""}`}
        aria-pressed={f.kind === undefined}
        onClick={() => chooseFilter({ ...(f.vendor ? { vendor: f.vendor } : {}) })}
      >
        Any kind
      </button>
      {kinds.map((k) => (
        <button
          type="button"
          key={k}
          class={`chip${f.kind === k ? " on" : ""}`}
          aria-pressed={f.kind === k}
          data-kind={k}
          onClick={() => chooseFilter({ ...(f.vendor ? { vendor: f.vendor } : {}), kind: k })}
        >
          {KIND_WORDS[k] ?? k}
        </button>
      ))}
    </fieldset>
  );
}

function ResultRow({ e }: { e: ListedEntry }) {
  const chosen = catalogChosen.value?.id === e.id;
  const size = e.kind === "bar" ? sizeOf(e) : undefined;
  const facts = [
    e.code ?? e.id,
    size ? `${size[0]} × ${size[1]}` : undefined,
    e.mass_kg_per_m !== undefined ? `${kgPerM(e.mass_kg_per_m)} kg/m` : undefined,
    e.from
      ? `from ${money(e.from.minor)}${e.from.currency ? ` ${e.from.currency}` : ""}/${e.from.per === "m" ? "m" : "unit"}`
      : undefined,
    e.fidelity ? `${e.fidelity} section` : undefined,
    e.pinned ? "in use" : undefined,
    e.project ? "the project's own" : undefined,
  ].filter((x) => x !== undefined);
  return (
    <li>
      <button
        type="button"
        class={`card${chosen ? " selected" : ""}`}
        data-id={e.id}
        aria-pressed={chosen}
        onClick={() => {
          catalogChosen.value = { id: e.id, project: e.project === true };
        }}
      >
        {e.thumb ? <SectionThumb s={e.thumb} /> : <span class="thumb none">{e.kind[0]}</span>}
        <span class="card-text">
          <strong>{e.name}</strong>
          <span class="sub">{facts.join(" · ")}</span>
        </span>
      </button>
    </li>
  );
}

export function CatalogOverlay() {
  const open = catalogOpen.value;
  const search = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const rev = model.value?.rev;
  const q = catalogQuery.value;
  const f = catalogFilter.value;
  const prefer = toolKind(activeTool.value) ?? "bar";

  useEffect(() => {
    const offs = [
      onKey("app", (e) => {
        if (chord(e) || e.key !== "/") return false;
        openCatalog();
        return true;
      }),
      onKey("overlay", (e) => {
        if (e.key !== "Escape" || !catalogOpen.value) return false;
        closeCatalog();
        return true;
      }),
      describeKeys({
        id: "catalog",
        title: "Catalog",
        order: 30,
        rows: [
          { keys: ["/"], does: "Open the catalog, with the search ready" },
          { keys: ["Esc"], does: "Close the catalog; the search and the card stay as they were" },
        ],
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  // Focus the search on opening; give focus back to what opened it on closing.
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      search.current?.focus();
    } else if (opener.current instanceof HTMLElement && opener.current.isConnected) {
      opener.current.focus();
      opener.current = null;
    }
  }, [open]);

  // Each revision may add or remove a project item (§4.8), so the tree and the list follow it.
  useEffect(() => {
    if (!open || rev === undefined || tree.peek()?.rev === rev) return;
    forgetCards();
    get<{ tree: CatalogTree[] }>("/api/catalog").then(
      (r) => {
        tree.value = { rev, tree: r.tree };
      },
      (e) => {
        loadError.value = (e as Error).message;
      },
    );
  }, [open, rev]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      void fetchCatalogItems({ q: q.trim(), ...f, prefer, limit: 80 }).then((r) => {
        if (r.ok) {
          results.value = r.value;
          loadError.value = undefined;
        } else loadError.value = r.why;
      });
    }, 120);
    return () => clearTimeout(t);
  }, [open, q, f.vendor, f.kind, f.family, prefer, rev]);

  if (!open) return null;
  const list = results.value;
  const chosen = catalogChosen.value;
  return (
    <section class="catalog-overlay" data-testid="catalog" aria-label="Catalog">
      <header class="cat-head">
        <h2>Catalog</h2>
        <input
          ref={search}
          type="search"
          data-testid="catalog-search"
          aria-label="Search the catalog"
          placeholder="Search: a size (40x40), a code, a name, a family"
          value={q}
          onInput={(e) => {
            catalogQuery.value = (e.target as HTMLInputElement).value;
          }}
        />
        <button
          type="button"
          class="close"
          onClick={closeCatalog}
          aria-label="Close the catalog"
          title="Close (Esc)"
        >
          ×
        </button>
      </header>
      <KindRow />
      <div class="cat-body">
        <Facets />
        <div class="cat-results">
          {loadError.value && <p class="msg-error">{loadError.value}</p>}
          <p class="sub list-count" data-testid="catalog-count" role="status">
            {list ? `${list.total} item${list.total === 1 ? "" : "s"}` : "Searching…"}
            {list && list.total > list.items.length ? `, the first ${list.items.length}` : ""}
          </p>
          <ul class="cat-list cards">
            {list?.items.map((e) => (
              <ResultRow key={e.id} e={e} />
            ))}
          </ul>
        </div>
        <div class="cat-card">
          {chosen ? (
            <Card
              id={chosen.id}
              project={chosen.project}
              onClose={() => {
                catalogChosen.value = undefined;
              }}
            />
          ) : (
            <p class="panel-empty">
              Choose an item to see its card: its section, options and prices.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
