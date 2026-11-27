import { useEffect, useState } from "preact/hooks";
import type { CardValue, ItemCard, OfferCard } from "../../server/catalog.ts";
import { Errors } from "../Feedback.tsx";
import { selection } from "../focus.ts";
import { kgPerM, money } from "../format.ts";
import { type OptionField, optionFields, pickedOptions } from "../options.ts";
import { busy, type CommandOutcome, model, sendCommands, summary } from "../store.ts";
import { SectionThumb } from "./SectionThumb.tsx";
import { arm, cardOf, closeCatalog, pin } from "./state.ts";

/**
 * An item's card in the catalog overlay (S2.3): what it is, in words (U45: the card used to speak
 * schema, `mass_kg_per_m`, `Ix_mm4`), its options with a sold value chosen (options.ts, U2), its
 * offers and prices, and what to do with it: Use for drawing (or placing), Add to bin, Replace the
 * selected bars or parts, and, for a bar, make it the project's default. Owner: S2.
 */

/** A profile's shape in words (review m10: the card said "shape tslot"). */
const SHAPES: Readonly<Record<string, string>> = {
  tslot: "T-slot",
  vslot: "V-slot",
  rail: "linear guide",
  flat: "flat bar",
  tube: "tube",
  angle: "angle",
};

/** A system in words: `forseti:s40-c8` reads "Forseti 40 series, 8 mm slot". */
function systemWords(v: string): string {
  const m = /^(?:([^:]+):)?s(\d+)-c(\d+)$/.exec(v);
  if (!m) return v;
  const vendor = m[1] ? `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ` : "";
  return `${vendor}${m[2]} series, ${m[3]} mm slot`;
}

const FIDELITY: Readonly<Record<string, string>> = {
  exact: "exact, from the vendor's drawing",
  parametric: "parametric, drawn from its sizes",
};

/** A card's values in words: what the key means, its unit, and its value said plainly. */
const WORDS: Readonly<
  Record<
    string,
    { label: string; unit?: string; fmt?: (v: number) => string; say?: (v: string) => string }
  >
> = {
  shape: { label: "Shape", say: (v) => SHAPES[v] ?? v },
  system: { label: "System", say: systemWords },
  fidelity: { label: "Section", say: (v) => FIDELITY[v] ?? v },
  mass_kg_per_m: { label: "Mass", unit: "kg/m", fmt: (v) => kgPerM(v) },
  area_mm2: { label: "Section area", unit: "mm²" },
  Ix_mm4: { label: "Second moment of area, x", unit: "mm⁴" },
  Iy_mm4: { label: "Second moment of area, y", unit: "mm⁴" },
  mass_kg: { label: "Mass", unit: "kg" },
  length_mm: { label: "Length", unit: "mm" },
  thread: { label: "Thread" },
  material: { label: "Material" },
};

const SRC: Readonly<Record<string, string>> = {
  src: "read from a source",
  meas: "measured",
  est: "estimated",
  calc: "computed",
};

function Value({ d }: { d: CardValue }) {
  const w = WORDS[d.key];
  const text =
    typeof d.value === "number" && w?.fmt
      ? w.fmt(d.value)
      : typeof d.value === "string" && w?.say
        ? w.say(d.value)
        : String(d.value);
  return (
    <tr>
      <th scope="row">{w?.label ?? d.key.replace(/_/g, " ")}</th>
      <td title={d.src ? (SRC[d.src] ?? d.src) : undefined} class={d.src ? `prov-${d.src}` : ""}>
        {text}
        {w?.unit && <span class="unit"> {w.unit}</span>}
        {d.src === "est" && <span class="sub"> (estimated)</span>}
      </td>
    </tr>
  );
}

/** How an offer sells: cut to length, stock bars, a kit, a pack, each. */
function sellsText(o: OfferCard): string {
  if (o.sale?.mode === "cut")
    return `cut to length, ${o.sale.min_mm ?? ""}–${o.sale.max_mm ?? ""} mm`;
  if (o.sale?.mode === "stock") return `${o.sale.length_mm} mm stock bars`;
  if (o.kit) return "a kit";
  if (o.pack > 1) return `a pack of ${o.pack}`;
  return "each";
}

/** The options' fields, as selects: a value no offer sells is marked. */
export function OptionSelects({
  fields,
  picked,
  onPick,
}: {
  fields: readonly OptionField[];
  picked: Readonly<Record<string, string>>;
  onPick: (name: string, value: string) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <label key={f.name} class="cd-row">
          <span class="opt-name">
            {f.name.charAt(0).toUpperCase() + f.name.slice(1)}
            <span class="req" title="Required: every bar needs one">
              {" "}
              (required)
            </span>
          </span>
          <select
            data-testid={`option-${f.name}`}
            value={picked[f.name] ?? f.chosen}
            onChange={(e) => onPick(f.name, (e.target as HTMLSelectElement).value)}
          >
            {f.choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value === "" ? `(${c.label})` : c.label}
                {c.sold ? "" : " (not sold)"}
              </option>
            ))}
          </select>
        </label>
      ))}
    </>
  );
}

/** The project's `defaults.bar.opt`. */
function barDefaults(): Record<string, string> | undefined {
  const bar = model.value?.defaults.bar as { opt?: Record<string, string> } | undefined;
  return bar?.opt;
}

/** The fields and the values picked for an item: the preselection until the person picks. */
export function useOptions(card: ItemCard | undefined) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  useEffect(() => setPicked({}), [card?.entry.id]);
  const fields = card
    ? optionFields(card.options, card.offers, card.entry.kind === "bar" ? barDefaults() : undefined)
    : [];
  const values = Object.fromEntries(fields.map((f) => [f.name, picked[f.name] ?? f.chosen]));
  return {
    fields,
    values,
    pick: (name: string, value: string) => setPicked({ ...picked, [name]: value }),
  };
}

/** The selected entities a card's item can replace the item of: bars for a bar, parts else. */
function replaceable(card: ItemCard): string[] {
  const m = model.value;
  if (!m) return [];
  const map = card.entry.kind === "bar" ? m.doc.bars : m.doc.parts;
  const own =
    typeof map === "object" && map !== null ? (map as Record<string, Record<string, unknown>>) : {};
  return [...selection.value].filter((id) => id in own);
}

/**
 * The batch that replaces the item of the selected entities, as one step: each takes the item and
 * the options picked; an option the new item has not (or the project's default) is removed.
 */
function replaceCommands(card: ItemCard, ids: readonly string[], values: Record<string, string>) {
  const m = model.value;
  const isBar = card.entry.kind === "bar";
  const map = ((isBar ? m?.doc.bars : m?.doc.parts) ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  return ids.map((id) => {
    const was = (map[id]?.opt ?? {}) as Record<string, unknown>;
    const opt: Record<string, string | null> = {};
    for (const k of Object.keys(was)) opt[k] = null;
    for (const [k, v] of Object.entries(values)) opt[k] = v === "" ? null : v;
    return {
      cmd: isBar ? "setBar" : "setPart",
      args: { id, set: { item: card.entry.id, ...(Object.keys(opt).length > 0 ? { opt } : {}) } },
    };
  });
}

export function Card({
  id,
  project,
  onClose,
}: {
  id: string;
  /** One of the document's own items (§4.8). */
  project: boolean;
  onClose: () => void;
}) {
  const [card, setCard] = useState<ItemCard | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const [pinned, setPinned] = useState(false);
  // A project item (§4.8) changes with the document, so its card follows each revision.
  const rev = project ? model.value?.rev : undefined;
  useEffect(() => {
    setCard(undefined);
    setError(undefined);
    setOutcome(undefined);
    setPinned(false);
    let live = true;
    cardOf(id).then(
      (c) => live && setCard(c),
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [id, rev]);
  const opts = useOptions(card);
  if (error) return <div class="card-detail">{error}</div>;
  if (!card)
    return (
      <div class="card-detail" aria-busy="true">
        Loading the card…
      </div>
    );
  const e = card.entry;
  const isBar = e.kind === "bar";
  const chosen = pickedOptions(opts.values);
  const targets = replaceable(card);
  const readOnly = summary.value?.status.readOnly === true;
  const send = async (commands: { cmd: string; args?: unknown }[], what: string) => {
    setOutcome(await sendCommands(commands, what, { inline: true }));
  };
  const resolved = Object.fromEntries(
    Object.entries(opts.values).map(([k, v]) => [k, v === "" ? (barDefaults()?.[k] ?? "") : v]),
  );
  return (
    <div class="card-detail" data-testid="catalog-card" data-id={e.id}>
      <div class="card-head">
        {card.section && <SectionThumb s={card.section} size={96} />}
        <div>
          <strong class="card-name">{e.name}</strong>
          <div class="sub">
            <code>{e.code ?? e.id}</code> · {e.vendor} · {e.kind} · {e.family}
          </div>
          <div class="sub">
            {!e.live && "Known from the lock: the catalog no longer holds it. "}
            {e.project && "the project's own, read only"}
          </div>
        </div>
        <button
          type="button"
          class="close"
          onClick={onClose}
          aria-label="Close the card"
          title="Close"
        >
          ×
        </button>
      </div>
      <table class="grid card-data">
        <tbody>
          {card.data.map((d) => (
            <Value key={d.key} d={d} />
          ))}
        </tbody>
      </table>
      <OptionSelects fields={opts.fields} picked={opts.values} onPick={opts.pick} />
      <div class="card-actions">
        <button
          type="button"
          class="btn primary"
          data-testid="palette-set"
          onClick={() => {
            arm(card, chosen);
            closeCatalog();
          }}
        >
          {isBar ? "Use for drawing" : "Use for placing"} <kbd>{isBar ? "B" : "P"}</kbd>
        </button>
        <button
          type="button"
          class="btn"
          data-testid="bin-add"
          disabled={pinned}
          onClick={() => {
            pin({
              id: e.id,
              ...(Object.keys(chosen).length > 0 ? { opt: chosen } : {}),
              name: e.name,
            });
            setPinned(true);
          }}
        >
          {pinned ? "In the bin" : "Add to bin"}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="replace-selected"
          disabled={targets.length === 0 || readOnly || busy.value}
          title={
            targets.length === 0
              ? `Select the ${isBar ? "bars" : "parts"} to replace first`
              : `Make ${targets.join(", ")} ${e.code ?? e.id}, as one step`
          }
          onClick={() =>
            void send(replaceCommands(card, targets, opts.values), `replace with ${e.code ?? e.id}`)
          }
        >
          Replace selected{targets.length > 0 ? ` (${targets.length})` : ""}
        </button>
        {isBar && (
          <button
            type="button"
            class="btn"
            data-testid="make-default"
            disabled={readOnly || busy.value}
            title="New bars that name no item are drawn with it (defaults.bar), as one step"
            onClick={() =>
              void send(
                [{ cmd: "setProject", args: { defaults: { bar: { item: e.id, opt: resolved } } } }],
                "make it the default",
              )
            }
          >
            Make it the default
          </button>
        )}
      </div>
      <Errors outcome={outcome} />
      {outcome?.ok && (
        <p class="note" role="status">
          Done: one step, which Undo takes back.
        </p>
      )}
      {card.offers.length > 0 && (
        <table class="grid offers" data-testid="catalog-offers">
          <thead>
            <tr>
              <th scope="col">Offer</th>
              <th scope="col">Sells</th>
              <th scope="col" class="n">
                Price
              </th>
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
                <td>{sellsText(o)}</td>
                <td class="n">
                  {money(o.price.regular_minor)} {o.currency ?? ""}/{o.price.per}
                  {o.price.sale_minor !== null && (
                    <div class="sub">
                      sale {money(o.price.sale_minor)} {o.currency ?? ""}
                    </div>
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
