import { useEffect, useState } from "preact/hooks";
import { compareIds } from "#core/ids.ts";
import { ItemSwatch } from "../common/ItemSwatch.tsx";
import type { Model } from "../model.ts";
import { beyondDefaults, optionsText } from "../options.ts";
import { type PaletteItem, palette } from "../palette.ts";
import { model, summary } from "../store.ts";
import {
  arm,
  type BinItem,
  cardOf,
  loadPins,
  openCatalog,
  pins,
  recent,
  sameBinItem,
  unpin,
} from "./state.ts";

/**
 * The parts bin (D-UX-1, S2.3; A §5.2, after SketchUp's "In Model"): the small set a project
 * works with, above the outline. What is armed for the draw and place tools; the items the
 * project uses, with the options it uses them in; the ones pinned in this browser; and the ones
 * armed lately in this tab. A click arms one; "Browse catalog…" (`/`) opens the whole catalog,
 * wide. Owner: S2.
 */

/** The items a model uses, by item and options, most used first: its BOM's lines. */
export function usedItems(m: Model): { item: BinItem; name: string; kind: string; qty: number }[] {
  const defaults = (m.defaults.bar as { opt?: Record<string, string> } | undefined)?.opt;
  const out: { item: BinItem; name: string; kind: string; qty: number }[] = [];
  for (const g of m.bom.groups) {
    for (const l of g.lines) {
      const opt = g.kind === "bar" ? beyondDefaults(l.opt, defaults) : { ...l.opt };
      out.push({
        item: { id: l.item, ...(Object.keys(opt).length > 0 ? { opt } : {}) },
        name: l.name,
        kind: g.kind,
        qty: l.qty,
      });
    }
  }
  // Profiles first, what draws the frame; then by how many the project uses.
  const bars = (x: { kind: string }) => (x.kind === "bar" ? 0 : 1);
  return out.sort((a, b) => bars(a) - bars(b) || b.qty - a.qty || compareIds(a.item.id, b.item.id));
}

function Armed({ which, p }: { which: "bar" | "part"; p: PaletteItem | undefined }) {
  const key = which === "bar" ? "B" : "P";
  return (
    <li class="bin-armed" data-testid={`armed-${which}`} data-id={p?.id ?? ""}>
      <span class="bin-role">{which === "bar" ? "Draws" : "Places"}</span>
      {p ? (
        <span class="bin-name" title={p.id}>
          {p.name}
          {p.opt && <span class="sub"> · {optionsText(p.opt)}</span>}
        </span>
      ) : (
        <span class="bin-name sub">{which === "bar" ? "no profile yet" : "no part yet"}</span>
      )}
      <kbd>{key}</kbd>
      {p && (
        <button
          type="button"
          class="bin-x"
          aria-label={`Disarm ${p.name}`}
          title="Disarm"
          onClick={() => {
            palette.value = { ...palette.value, [which]: undefined };
          }}
        >
          ×
        </button>
      )}
    </li>
  );
}

/** One entry: a click arms it; a pinned one can be unpinned. */
function Entry({
  b,
  name,
  note,
  pinned,
}: {
  b: BinItem;
  name: string;
  note?: string;
  pinned?: boolean;
}) {
  const [error, setError] = useState<string | undefined>();
  const armIt = async () => {
    try {
      arm(await cardOf(b.id), b.opt ?? {});
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <li class="bin-entry">
      <button
        type="button"
        class="bin-arm"
        data-id={b.id}
        title={`Arm ${b.id}${b.opt ? ` (${optionsText(b.opt)})` : ""}`}
        onClick={() => void armIt()}
      >
        <ItemSwatch item={b.id} />
        <span class="bin-name">
          {name}
          {b.opt && <span class="sub"> · {optionsText(b.opt)}</span>}
        </span>
        {note && <span class="count">{note}</span>}
      </button>
      {pinned && (
        <button
          type="button"
          class="bin-x"
          aria-label={`Unpin ${name}`}
          title="Unpin"
          onClick={() => unpin(b)}
        >
          ×
        </button>
      )}
      {error && <p class="msg-error">{error}</p>}
    </li>
  );
}

export function PartsBin() {
  const m = model.value;
  const p = palette.value;
  const name = summary.value?.name;
  useEffect(() => loadPins(), [name]);
  const used = m ? usedItems(m) : [];
  const names = new Map(used.map((u) => [u.item.id, u.name]));
  const extra = (list: readonly BinItem[]) =>
    list.filter((b) => !used.some((u) => sameBinItem(u.item, b)));
  const pinned = extra(pins.value);
  const lately = extra(recent.value).filter((b) => !pinned.some((x) => sameBinItem(x, b)));
  return (
    <section class="bin" aria-label="Parts bin" data-testid="parts-bin">
      <div class="bin-head">
        <h2>Parts</h2>
        <button
          type="button"
          class="btn"
          data-testid="left-catalog"
          title="Open the whole catalog (/)"
          onClick={() => openCatalog()}
        >
          Browse catalog… <kbd>/</kbd>
        </button>
      </div>
      <ul class="bin-list">
        <Armed which="bar" p={p.bar} />
        <Armed which="part" p={p.part} />
      </ul>
      {used.length > 0 && (
        <>
          <h3>In this project</h3>
          <ul class="bin-list">
            {used.map((u) => (
              <Entry
                key={`${u.item.id}${optionsText(u.item.opt)}`}
                b={u.item}
                name={u.name}
                note={`× ${u.qty}`}
              />
            ))}
          </ul>
        </>
      )}
      {pinned.length > 0 && (
        <>
          <h3>Pinned</h3>
          <ul class="bin-list">
            {pinned.map((b) => (
              <Entry
                key={`${b.id}${optionsText(b.opt)}`}
                b={b}
                name={b.name ?? names.get(b.id) ?? b.id}
                pinned
              />
            ))}
          </ul>
        </>
      )}
      {lately.length > 0 && (
        <>
          <h3>Lately</h3>
          <ul class="bin-list">
            {lately.map((b) => (
              <Entry
                key={`${b.id}${optionsText(b.opt)}`}
                b={b}
                name={b.name ?? names.get(b.id) ?? b.id}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
