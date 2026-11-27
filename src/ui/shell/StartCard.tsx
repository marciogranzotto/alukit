import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import skill from "../../../skills/alukit/SKILL.md?raw";
import type { CatalogTree, ItemCard, ListedEntry } from "../../server/catalog.ts";
import { get } from "../api.ts";
import { OptionSelects } from "../catalog/Card.tsx";
import { SectionThumb, sizeOf } from "../catalog/SectionThumb.tsx";
import { arm, cardOf } from "../catalog/state.ts";
import { fetchCatalogItems } from "../client/catalog.ts";
import { useConnectors } from "../common/ConnectorSelect.tsx";
import { Errors } from "../Feedback.tsx";
import { money, plural } from "../format.ts";
import { onKey } from "../keys.ts";
import type { Model } from "../model.ts";
import { optionFields, pickedOptions } from "../options.ts";
import { busy, type CommandOutcome, model, sendCommands, summary } from "../store.ts";
import { activeTool, drawState, frameDraft, frameStage, lastResult } from "../tools/state.ts";
import { exampleBatch, exampleOf, whyNotExample } from "./example.ts";
import { GUIDE_URL, helpOpen } from "./Help.tsx";
import { settingsOpen } from "./Settings.tsx";
import { dismissStart, type FrameProfile, frameWay, startShown } from "./start.ts";

/**
 * The start card (D-UX-6, D-UX-25, S2.10; U27, U13, U2): over an empty project's viewport, not a
 * modal, closed with Esc or ×. A strip names the catalogs with their counts and the currency,
 * and says so when no catalog sells a profile. Then two steps (docs/ux/review-phase4.md M1):
 *
 * 1. the profile, shared by both ways: a size, the profile of that size and its required options;
 * 2. a box frame (S5.7's form: W, D, H, how it is joined, Make) or the first bar (which arms the
 *    palette, then a coach strip that ticks on what really happens).
 *
 * Either way the profile becomes `defaults.bar` in the way's own step, so nothing is written
 * until the person makes something. The skill's worked example is a one-line way beside them, as
 * one step. Owner: S2.
 */

const count = (x: unknown) => (typeof x === "object" && x !== null ? Object.keys(x).length : 0);

/** The bars in the project when the draw coach started; undefined while it is not shown. */
const coachFrom = signal<number | undefined>(undefined);

/** The box frame coach was closed, or its frame made, for this tab (review M4). */
const frameCoachDone = signal(false);

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
// Step 1: the profile

/** A bar's size as a chip names it, `40 × 40`; its code when it has no section. */
const sizeText = (e: ListedEntry) => {
  const s = sizeOf(e);
  return s ? `${s[0]} × ${s[1]}` : (e.code ?? e.id);
};

/**
 * The project's profiles by size, the sizes smallest first: a chip per size, then the profiles of
 * that size to pick from. A catalog holds several profiles of one size (light, basic, V-slot), so
 * the size is the first choice and the profile the second (A F1). Linear guides are not frame
 * profiles, so they are left out (review M8): the catalog lists them.
 */
export function bySize(
  items: readonly ListedEntry[],
): { size: string; area: number; items: ListedEntry[] }[] {
  const groups = new Map<string, { size: string; area: number; items: ListedEntry[] }>();
  for (const e of items) {
    if (e.shape === "rail") continue;
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

/**
 * The profiles of one size, the commonest first (review M8): the system the most connectors fit
 * (what most fittings are made for), then exact sections before parametric ones, then the one
 * sold in the most ways (Forseti's 40 × 40 Básico in two finishes before the Leve in one: the
 * review's two keys do not tell them apart), then by code.
 */
export function profileOrder(
  items: readonly ListedEntry[],
  fits: ReadonlyMap<string, number>,
): ListedEntry[] {
  const n = (e: ListedEntry) => (e.system ? (fits.get(e.system) ?? 0) : 0);
  return [...items].sort(
    (a, b) =>
      n(b) - n(a) ||
      Number(b.fidelity === "exact") - Number(a.fidelity === "exact") ||
      (b.offers ?? 0) - (a.offers ?? 0) ||
      (a.code ?? a.id).localeCompare(b.code ?? b.id),
  );
}

/**
 * Names with the words they all start with left out, so what differs comes first (review M8):
 * "Perfil Estrutural em Alumínio 40×40 Básico – Canal 8" reads "Básico – Canal 8".
 */
export function shortNames(names: readonly string[]): string[] {
  if (names.length < 2) return [...names];
  const words = names.map((n) => n.split(" "));
  const first = words[0] as string[];
  let k = 0;
  while (words.every((w) => w.length > k + 1 && w[k] === first[k])) k++;
  return words.map((w) =>
    w
      .slice(k)
      .join(" ")
      .replace(/^[–-]\s*/, ""),
  );
}

/** The connectors that fit each system, counted: what makes a profile the common one. */
function useFitCounts(): Map<string, number> {
  const c = useConnectors([]);
  const out = new Map<string, number>();
  for (const e of c.fit) for (const s of e.fits ?? []) out.set(s, (out.get(s) ?? 0) + 1);
  return out;
}

interface ProfileChoice {
  list: ListedEntry[] | undefined;
  sizes: ReturnType<typeof bySize>;
  size: string | undefined;
  chooseSize: (s: string) => void;
  ofSize: ListedEntry[];
  chosen: string | undefined;
  setChosen: (id: string) => void;
  card: ItemCard | undefined;
  fields: ReturnType<typeof optionFields>;
  values: Record<string, string>;
  pick: (name: string, value: string) => void;
  /** The whole choice, once its card is read; null before. */
  profile: FrameProfile | null;
}

/** Step 1's state: the size, the profile, its options; what both ways use. */
function useProfileChoice(m: Model, catalogsKey: string): ProfileChoice {
  const [list, setList] = useState<ListedEntry[] | undefined>();
  const [size, setSize] = useState<string | undefined>();
  const [chosen, setChosen] = useState<string | undefined>();
  const [card, setCard] = useState<ItemCard | undefined>();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const fits = useFitCounts();
  useEffect(() => {
    void fetchCatalogItems({ kind: "bar", limit: 500 }).then((r) =>
      setList(r.ok ? r.value.items : []),
    );
  }, [catalogsKey]);
  const sizes = bySize(list ?? []).map((g) => ({ ...g, items: profileOrder(g.items, fits) }));
  const ofSize = sizes.find((g) => g.size === size)?.items ?? [];
  const docBar = (m.doc.defaults as { bar?: { item?: unknown; opt?: Record<string, string> } })
    ?.bar;
  const def = typeof docBar?.item === "string" ? docBar.item : undefined;
  const chooseSize = (s: string) => {
    setSize(s);
    const items = sizes.find((g) => g.size === s)?.items ?? [];
    // The project's default bar when it is this size, else the commonest profile.
    setChosen(items.find((e) => e.id === def)?.id ?? items[0]?.id);
  };
  // A project with a default bar starts on it: its size and itself, its options as written.
  const defSize = sizes.find((g) => g.items.some((e) => e.id === def))?.size;
  useEffect(() => {
    if (size === undefined && defSize !== undefined) {
      setSize(defSize);
      setChosen(def);
    }
  }, [defSize]);
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
  // The default bar's options as written, where they are among the choices; else the first sold.
  const written = (name: string) => {
    const v = chosen === def ? docBar?.opt?.[name] : undefined;
    const f = fields.find((x) => x.name === name);
    return v !== undefined && f?.choices.some((c) => c.value === v) ? v : undefined;
  };
  const values = Object.fromEntries(
    fields.map((f) => [f.name, picked[f.name] ?? written(f.name) ?? f.chosen]),
  );
  let profile: FrameProfile | null = null;
  if (card && card.entry.id === chosen) {
    const opt = pickedOptions(values);
    const docOpt = docBar?.opt ?? {};
    const same =
      card.entry.id === def &&
      Object.keys(opt).length === Object.keys(docOpt).length &&
      Object.entries(opt).every(([k, v]) => docOpt[k] === v);
    // A merge patch: the document's options the new item does not take are removed (null).
    const optPatch: Record<string, string | null> = { ...opt };
    for (const k of Object.keys(docOpt)) if (!(k in opt)) optPatch[k] = null;
    profile = {
      item: card.entry.id,
      opt,
      name: card.entry.name,
      ...(same
        ? {}
        : {
            patch: {
              item: card.entry.id,
              ...(Object.keys(optPatch).length > 0 ? { opt: optPatch } : {}),
            },
          }),
    };
  }
  return {
    list,
    sizes,
    size,
    chooseSize,
    ofSize,
    chosen,
    setChosen,
    card,
    fields,
    values,
    pick: (name, value) => setPicked({ ...picked, [name]: value }),
    profile,
  };
}

function ProfileStep({ c }: { c: ProfileChoice }) {
  const short = shortNames(c.ofSize.map((e) => e.name));
  return (
    <section
      class="start-step"
      aria-labelledby="start-profile-title"
      data-testid="start-profile-step"
    >
      <h3 id="start-profile-title">1. The profile</h3>
      {c.list === undefined ? (
        <p class="sub">Reading the profiles…</p>
      ) : c.sizes.length === 0 ? (
        <p class="sub">No profile in this project's catalogs.</p>
      ) : (
        <fieldset class="profile-chips">
          <legend class="sr-only">Sizes</legend>
          {c.sizes.map((g) => {
            const first = g.items[0] as ListedEntry;
            return (
              <button
                type="button"
                key={g.size}
                class="profile-chip"
                data-size={g.size}
                aria-pressed={c.size === g.size}
                title={`${plural(g.items.length, "profile")} of ${g.size}`}
                onClick={() => c.chooseSize(g.size)}
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
      {c.ofSize.length > 0 && (
        <div class="start-profile-row">
          <label class="cd-row">
            <span class="opt-name">Profile</span>
            <select
              data-testid="start-profile"
              value={c.chosen}
              onChange={(e) => c.setChosen((e.currentTarget as HTMLSelectElement).value)}
            >
              {c.ofSize.map((e, i) => (
                <option key={e.id} value={e.id} title={`${e.name} (${e.code ?? e.id})`}>
                  {short[i] ?? e.name}
                  {e.from ? ` · ${money(e.from.minor)}${e.from.per === "m" ? "/m" : ""}` : ""}
                </option>
              ))}
            </select>
          </label>
          {c.card && <OptionSelects fields={c.fields} picked={c.values} onPick={c.pick} />}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 2: the first bar

function FirstBar({ m, c }: { m: Model; c: ProfileChoice }) {
  const [outcome, setOutcome] = useState<CommandOutcome>();
  const start = async () => {
    if (!c.profile || !c.card) return;
    // The project's default bar already: nothing to write.
    if (c.profile.patch) {
      const r = await sendCommands(
        [{ cmd: "setProject", args: { defaults: { bar: c.profile.patch } } }],
        "make it the default bar",
        { inline: true },
      );
      setOutcome(r);
      if (!r.ok) return;
    }
    // Armed with no options of its own: the bars drawn take the default just written.
    arm(c.card, {});
    coachFrom.value = count(m.doc.bars);
    dismissStart();
  };
  return (
    <section class="start-way" aria-labelledby="start-bar-title" data-testid="start-first-bar">
      <h3 id="start-bar-title">Or the first bar</h3>
      <p>Draw bar by bar, from a click, with the length typed. The profile becomes the default.</p>
      <Errors outcome={outcome} />
      <div>
        <button
          type="button"
          class="btn primary"
          data-testid="start-drawing"
          disabled={!c.profile || busy.value}
          title={c.profile ? `Draw with ${c.profile.name}` : "Pick a profile above first"}
          onClick={() => void start()}
        >
          Draw the first bar
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

/** The example, as a one-line way under the two (review m5): it fits a short card too. */
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
    <section class="start-example" aria-label="Open an example" data-testid="start-example-way">
      <span>
        Or open an example: a work table, 1000 × 600 × 750, from the skill's worked example, with
        brackets and a taller variant. One step; Undo takes it back.
      </span>
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
      <Errors outcome={outcome} />
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
  return <Card m={m} cats={cats} catalogsKey={catalogsKey} />;
}

function Card({
  m,
  cats,
  catalogsKey,
}: {
  m: Model;
  cats: Catalogs | undefined;
  catalogsKey: string;
}) {
  const choice = useProfileChoice(m, catalogsKey);
  const Frame = frameWay.value;
  const readOnly = summary.value?.status.readOnly === true;
  // A frame made here shows its cut list: the card closes and Select opens the sheets on the
  // first output (review m11; S2 decision 3).
  const frameDone = () => {
    dismissStart();
    if (activeTool.peek() !== "select") activeTool.value = "select";
    lastResult.value = undefined;
  };
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
        <>
          <ProfileStep c={choice} />
          <div class="start-ways">
            {Frame && (
              <section
                class="start-way"
                aria-labelledby="start-frame-title"
                data-testid="start-frame"
              >
                <h3 id="start-frame-title">2. A box frame</h3>
                <Frame onDone={frameDone} profile={choice.profile} />
              </section>
            )}
            <FirstBar m={m} c={choice} />
          </div>
          <Example m={m} />
        </>
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

// ---------------------------------------------------------------------------------------------
// The coaches (review M4): each tool its own steps, ticked on what happens; none for the others.

function CoachStrip({
  testid,
  steps,
  onClose,
}: {
  testid: string;
  steps: { label: string; done: boolean }[];
  onClose: () => void;
}) {
  const now = steps.findIndex((s) => !s.done);
  return (
    <div class="coach" data-testid="coach" data-coach={testid} role="status">
      <button type="button" class="close" aria-label="Close the steps" onClick={onClose}>
        ×
      </button>
      <ol>
        {steps.map((s, i) => (
          <li key={s.label} class={s.done ? "done" : i === now ? "now" : undefined}>
            {s.done ? "✓ " : `${i + 1}. `}
            {s.label}
          </li>
        ))}
      </ol>
      <span class="note">Esc steps back</span>
    </div>
  );
}

/** Hides a coach a moment after its last step ticks. */
function useDoneTimer(all: boolean, hide: () => void): void {
  useEffect(() => {
    if (!all) return;
    const t = setTimeout(hide, 3000);
    return () => clearTimeout(t);
  }, [all]);
}

/**
 * The draw coach, after "Draw the first bar" (D-UX-6): a start point taken, a bar made, a second
 * bar made. Shown only while Draw is the tool.
 */
function DrawCoach() {
  const from = coachFrom.value;
  const m = model.value;
  const made = from === undefined ? 0 : count(m?.doc.bars) - from;
  const steps = [
    { label: "Click where the bar starts", done: made > 0 || drawState.value.start !== undefined },
    // Pointing comes first (review M2): a length typed with no way to go makes nothing.
    { label: "Point the way, type the length, press Enter", done: made > 0 },
    { label: "Draw the next bar from its end", done: made > 1 },
  ];
  const all = steps.every((s) => s.done);
  useDoneTimer(all, () => {
    coachFrom.value = undefined;
  });
  if (from === undefined || activeTool.value !== "draw") return null;
  return (
    <CoachStrip
      testid="draw"
      steps={steps}
      onClose={() => {
        coachFrom.value = undefined;
      }}
    />
  );
}

/** The bars in the project when the box frame tool came on; undefined while it is off. */
const frameFrom = signal<number | undefined>(undefined);

/** The box frame coach: a corner clicked, W and D given, H given and the frame made. */
function FrameCoach() {
  const m = model.value;
  const on = activeTool.value === "frame";
  useEffect(() => {
    frameFrom.value = on ? count(model.peek()?.doc.bars) : undefined;
  }, [on]);
  const from = frameFrom.value;
  const made = from !== undefined && count(m?.doc.bars) > from;
  const stage = frameStage(frameDraft.value);
  const steps = [
    { label: "Click a corner", done: made || stage !== "corner" },
    { label: "W, D", done: made || stage === "height" || stage === "done" },
    { label: "H", done: made },
  ];
  const all = steps.every((s) => s.done);
  useDoneTimer(all, () => {
    frameCoachDone.value = true;
  });
  if (!on || frameCoachDone.value) return null;
  return (
    <CoachStrip
      testid="frame"
      steps={steps}
      onClose={() => {
        frameCoachDone.value = true;
      }}
    />
  );
}

export function Coach() {
  return (
    <>
      <DrawCoach />
      <FrameCoach />
    </>
  );
}
