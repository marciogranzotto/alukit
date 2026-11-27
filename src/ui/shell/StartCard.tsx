import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import skill from "../../../skills/alukit/SKILL.md?raw";
import type { CatalogTree, ItemCard, ListedEntry } from "../../server/catalog.ts";
import { get } from "../api.ts";
import { OptionSelects } from "../catalog/Card.tsx";
import { SectionThumb, sizeOf } from "../catalog/SectionThumb.tsx";
import { arm, cardOf } from "../catalog/state.ts";
import { fetchCatalogItems } from "../client/catalog.ts";
import { Errors } from "../Feedback.tsx";
import { money, plural } from "../format.ts";
import { onKey } from "../keys.ts";
import type { Model } from "../model.ts";
import { optionFields, pickedOptions } from "../options.ts";
import { busy, type CommandOutcome, model, sendCommands, summary } from "../store.ts";
import { drawState } from "../tools/state.ts";
import { exampleBatch, exampleOf, whyNotExample } from "./example.ts";
import { GUIDE_URL, helpOpen } from "./Help.tsx";
import { settingsOpen } from "./Settings.tsx";
import { dismissStart, frameWay, startShown } from "./start.ts";

/**
 * The start card (D-UX-6, D-UX-25, S2.10; U27, U13, U2): over an empty project's viewport, not a
 * modal, closed with Esc or ×. A strip names the catalogs with their counts and the currency,
 * and says so when no catalog sells a profile. Then the ways in: the box frame (S5.7's form,
 * once that module provides it), the first bar (a profile and its required options, which arm
 * the palette and become `defaults.bar` in one `setProject` step, then a coach strip that ticks
 * on what really happens), and the skill's worked example, as one step. Owner: S2.
 */

const count = (x: unknown) => (typeof x === "object" && x !== null ? Object.keys(x).length : 0);

/** The bars in the project when the coach strip started; undefined while it is not shown. */
const coachFrom = signal<number | undefined>(undefined);

// ---------------------------------------------------------------------------------------------
// The project strip

interface Catalogs {
  catalogs: { id: string; name: string; vendor?: string }[];
  tree: CatalogTree[];
}

function ProjectStrip({ m, cats }: { m: Model; cats: Catalogs | undefined }) {
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const currency = typeof m.doc.currency === "string" ? m.doc.currency : "";
  const kinds = (vendor: string) => cats?.tree.find((t) => t.vendor === vendor)?.kinds ?? [];
  const bars = (vendor: string) => kinds(vendor).find((k) => k.kind === "bar")?.count ?? 0;
  const anyBar = cats ? cats.catalogs.some((c) => bars(c.vendor ?? c.id) > 0) : true;
  const setCurrency = async (c: string) => {
    setOutcome(
      await sendCommands([{ cmd: "setProject", args: { currency: c } }], "set the currency", {
        inline: true,
      }),
    );
  };
  return (
    <div class="start-strip" data-testid="start-catalogs">
      <span>
        {!cats
          ? "Reading the catalogs…"
          : cats.catalogs.length === 0
            ? "No catalog yet."
            : cats.catalogs.map((c, i) => {
                const v = c.vendor ?? c.id;
                const items = cats.tree.find((t) => t.vendor === v)?.count ?? 0;
                return (
                  <span key={c.id}>
                    {i > 0 && " · "}
                    <strong>{c.name}</strong> ({plural(bars(v), "profile")}, {plural(items, "item")}
                    )
                  </span>
                );
              })}
      </span>
      <label>
        Currency{" "}
        <select
          data-testid="start-currency"
          value={currency}
          disabled={busy.value}
          onChange={(e) => void setCurrency((e.currentTarget as HTMLSelectElement).value)}
        >
          {currency === "" && <option value="">none</option>}
          {[...new Set([currency, "BRL", "USD", "EUR"].filter((c) => c !== ""))].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {!anyBar && (
        <span class="warn-line" data-testid="start-no-profile">
          No catalog here sells a profile to draw with.{" "}
          <button
            type="button"
            class="link"
            onClick={() => {
              settingsOpen.value = true;
            }}
          >
            Add one in Project settings
          </button>
          : a built-in catalog's id, or a folder inside the project.
        </span>
      )}
      <Errors outcome={outcome} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The first bar

/** A bar's size as a chip names it, `40 × 40`; its code when it has no section. */
const sizeText = (e: ListedEntry) => {
  const s = sizeOf(e);
  return s ? `${s[0]} × ${s[1]}` : (e.code ?? e.id);
};

/**
 * The project's profiles by size, the sizes smallest first: a chip per size, then the profiles of
 * that size to pick from. A catalog holds several profiles of one size (light, basic, V-slot), so
 * the size is the first choice and the profile the second (A F1).
 */
export function bySize(
  items: readonly ListedEntry[],
): { size: string; area: number; items: ListedEntry[] }[] {
  const groups = new Map<string, { size: string; area: number; items: ListedEntry[] }>();
  for (const e of items) {
    const s = sizeOf(e);
    const size = sizeText(e);
    const g = groups.get(size) ?? {
      size,
      area: s ? s[0] * s[1] : Number.POSITIVE_INFINITY,
      items: [],
    };
    g.items.push(e);
    groups.set(size, g);
  }
  return [...groups.values()].sort((a, b) => a.area - b.area || a.size.localeCompare(b.size));
}

function FirstBar({ m, catalogsKey }: { m: Model; catalogsKey: string }) {
  const [list, setList] = useState<ListedEntry[] | undefined>();
  const [size, setSize] = useState<string | undefined>();
  const [chosen, setChosen] = useState<string | undefined>();
  const [card, setCard] = useState<ItemCard | undefined>();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<CommandOutcome>();
  useEffect(() => {
    void fetchCatalogItems({ kind: "bar", limit: 500 }).then((r) =>
      setList(r.ok ? r.value.items : []),
    );
  }, [catalogsKey]);
  const sizes = bySize(list ?? []);
  const ofSize = sizes.find((g) => g.size === size)?.items ?? [];
  const chooseSize = (s: string) => {
    setSize(s);
    const items = sizes.find((g) => g.size === s)?.items ?? [];
    // The project's default bar when it is this size, else the first by code.
    const def = (m.defaults.bar as { item?: unknown } | undefined)?.item;
    setChosen(items.find((e) => e.id === def)?.id ?? items[0]?.id);
  };
  useEffect(() => {
    setCard(undefined);
    setPicked({});
    if (!chosen) return;
    let live = true;
    cardOf(chosen).then(
      (c) => live && setCard(c),
      () => live && setCard(undefined),
    );
    return () => {
      live = false;
    };
  }, [chosen]);
  // Each option is required, and preselected to a value an offer sells (U2): no project default
  // is offered, since the choice becomes the default.
  const fields = card ? optionFields(card.options, card.offers, undefined) : [];
  const values = Object.fromEntries(fields.map((f) => [f.name, picked[f.name] ?? f.chosen]));

  const start = async () => {
    if (!card) return;
    const opt = pickedOptions(values);
    // A merge patch: the document's options the new item does not take are removed (null).
    const doc = (m.doc.defaults as { bar?: { opt?: Record<string, string> } } | undefined)?.bar;
    const optPatch: Record<string, string | null> = { ...opt };
    for (const k of Object.keys(doc?.opt ?? {})) if (!(k in opt)) optPatch[k] = null;
    const bar = {
      item: card.entry.id,
      ...(Object.keys(optPatch).length > 0 ? { opt: optPatch } : {}),
    };
    const r = await sendCommands(
      [{ cmd: "setProject", args: { defaults: { bar } } }],
      "make it the default bar",
      { inline: true },
    );
    setOutcome(r);
    if (!r.ok) return;
    // Armed with no options of its own: the bars drawn take the default just written.
    arm(card, {});
    coachFrom.value = count(m.doc.bars);
    dismissStart();
  };

  return (
    <section class="start-way" aria-labelledby="start-bar-title" data-testid="start-first-bar">
      <h3 id="start-bar-title">Draw the first bar</h3>
      <p>Pick a size, the profile and its finish. It becomes the project's default bar.</p>
      {list === undefined ? (
        <p class="sub">Reading the profiles…</p>
      ) : list.length === 0 ? (
        <p class="sub">No profile in this project's catalogs.</p>
      ) : (
        <fieldset class="profile-chips">
          <legend class="sr-only">Sizes</legend>
          {sizes.map((g) => {
            const first = g.items[0] as ListedEntry;
            return (
              <button
                type="button"
                key={g.size}
                class="profile-chip"
                data-size={g.size}
                aria-pressed={size === g.size}
                title={`${plural(g.items.length, "profile")} of ${g.size}`}
                onClick={() => chooseSize(g.size)}
              >
                {first.thumb && <SectionThumb s={first.thumb} size={28} />}
                <span>
                  <strong>{g.size}</strong>
                  <span class="sub">{plural(g.items.length, "profile")}</span>
                </span>
              </button>
            );
          })}
        </fieldset>
      )}
      {ofSize.length > 0 && (
        <label class="cd-row">
          <span class="opt-name">Profile</span>
          <select
            data-testid="start-profile"
            value={chosen}
            onChange={(e) => setChosen((e.currentTarget as HTMLSelectElement).value)}
          >
            {ofSize.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.code ?? e.id}
                {e.from ? `, from ${money(e.from.minor)}${e.from.per === "m" ? "/m" : ""}` : ""})
              </option>
            ))}
          </select>
        </label>
      )}
      {card && (
        <OptionSelects
          fields={fields}
          picked={values}
          onPick={(name, value) => setPicked({ ...picked, [name]: value })}
        />
      )}
      <Errors outcome={outcome} />
      <div>
        <button
          type="button"
          class="btn primary"
          data-testid="start-drawing"
          disabled={!card || card.entry.id !== chosen || busy.value}
          title={!card ? "Pick a size first" : `Draw with ${card.entry.name}`}
          onClick={() => void start()}
        >
          Start drawing
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The example (D-UX-25)

let parsed: ReturnType<typeof exampleOf> | undefined;
/** The skill's example, parsed once. */
function example() {
  parsed ??= exampleOf(skill);
  return parsed;
}

function Example({ m }: { m: Model }) {
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const why = whyNotExample(m.doc);
  const load = async () => {
    const r = await sendCommands(exampleBatch(example(), m.doc), "load the example", {
      strict: true,
      inline: true,
    });
    setOutcome(r);
    if (r.ok) dismissStart();
  };
  return (
    <section
      class="start-way"
      aria-labelledby="start-example-title"
      data-testid="start-example-way"
    >
      <h3 id="start-example-title">Open an example</h3>
      <p>
        A work table, 1000 × 600 × 750, from the skill's worked example: legs, rails and brackets,
        with a taller variant. One step; Undo takes it back.
      </p>
      <Errors outcome={outcome} />
      <div>
        <button
          type="button"
          class="btn"
          data-testid="start-example"
          disabled={why !== undefined || busy.value}
          title={why}
          onClick={() => void load()}
        >
          Load the example
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

export function StartCard() {
  const shown = startShown.value;
  const m = model.value;
  const [cats, setCats] = useState<Catalogs | undefined>();
  const catalogsKey = JSON.stringify(m?.doc.catalogs ?? []);
  // Before the card paints: an Esc pressed as soon as it shows closes it.
  useLayoutEffect(() => {
    if (!shown) return;
    return onKey(
      "overlay",
      (e) => {
        if (e.key !== "Escape") return false;
        dismissStart();
        return true;
      },
      -10,
    );
  }, [shown]);
  useEffect(() => {
    if (!shown) return;
    get<Catalogs>("/api/catalog").then(setCats, () => setCats({ catalogs: [], tree: [] }));
  }, [shown, catalogsKey]);
  if (!shown || !m) return null;
  const Frame = frameWay.value;
  const readOnly = summary.value?.status.readOnly === true;
  return (
    <section class="start-card" data-testid="start-card" aria-labelledby="start-title">
      <div class="start-head">
        <h2 id="start-title">Start your project</h2>
        <button
          type="button"
          class="close"
          data-testid="start-close"
          aria-label="Close the start card (Esc)"
          title="Close (Esc). The help (?) shows it again."
          onClick={dismissStart}
        >
          ×
        </button>
      </div>
      <ProjectStrip m={m} cats={cats} />
      {readOnly ? (
        <p class="sub">The project is read-only: fix the file, or restore the last good state.</p>
      ) : (
        <div class="start-ways">
          {Frame && (
            <section class="start-way" aria-labelledby="start-frame-title">
              <h3 id="start-frame-title">A box frame</h3>
              <Frame onDone={dismissStart} />
            </section>
          )}
          <FirstBar m={m} catalogsKey={catalogsKey} />
          <Example m={m} />
        </div>
      )}
      <div class="start-links">
        <button
          type="button"
          class="link"
          onClick={() => {
            helpOpen.value = true;
          }}
        >
          Keys and shortcuts <kbd>?</kbd>
        </button>
        <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer">
          The user guide
        </a>
      </div>
    </section>
  );
}

/**
 * The coach strip after "Start drawing" (D-UX-6): three steps that tick on what happens, not on
 * clicks through it: a start point taken, a bar made, a second bar made.
 */
export function Coach() {
  const from = coachFrom.value;
  const m = model.value;
  const bars = count(m?.doc.bars);
  const made = from === undefined ? 0 : bars - from;
  const list = [
    { label: "Click where the bar starts", done: made > 0 || drawState.value.start !== undefined },
    { label: "Type its length and press Enter, or click its end", done: made > 0 },
    { label: "Draw the next bar from its end", done: made > 1 },
  ];
  const all = list.every((s) => s.done);
  useEffect(() => {
    if (!all) return;
    const t = setTimeout(() => {
      coachFrom.value = undefined;
    }, 3000);
    return () => clearTimeout(t);
  }, [all]);
  if (from === undefined) return null;
  const now = list.findIndex((s) => !s.done);
  return (
    <div class="coach" data-testid="coach" role="status">
      <ol>
        {list.map((s, i) => (
          <li key={s.label} class={s.done ? "done" : i === now ? "now" : undefined}>
            {s.done ? "✓ " : `${i + 1}. `}
            {s.label}
          </li>
        ))}
      </ol>
      <span class="note">Esc steps back</span>
      <button
        type="button"
        class="close"
        aria-label="Close the steps"
        onClick={() => {
          coachFrom.value = undefined;
        }}
      >
        ×
      </button>
    </div>
  );
}
