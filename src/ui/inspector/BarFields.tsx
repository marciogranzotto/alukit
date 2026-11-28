import { useEffect, useState } from "preact/hooks";
import type { ItemCard, ListedEntry } from "../../server/catalog.ts";
import { OptionSelects, useOptions } from "../catalog/Card.tsx";
import { cardOf } from "../catalog/state.ts";
import { fetchCatalogItems } from "../client/catalog.ts";
import { AnchorDots } from "../common/AnchorDots.tsx";
import { EntityChips } from "../common/EntityChip.tsx";
import { splitBatch } from "../edit/batches.ts";
import { ROLL_WORDS, rollSet } from "../edit/roll.ts";
import { Errors } from "../Feedback.tsx";
import { mm, plural } from "../format.ts";
import type { Model } from "../model.ts";
import { optionFields } from "../options.ts";
import { pointParam } from "../records/Params.tsx";
import { busy } from "../store.ts";
import { typedNumber } from "../tools/typed.ts";
import { ActionRow } from "./ActionRow.tsx";
import { useReplaceAsked } from "./actions.ts";
import { runOf, splitAsked } from "./barActions.ts";
import { contextBatch, contextOf } from "./context.ts";
import { EndRows } from "./Ends.tsx";
import { CommitInput, Row, RowErrors, readOnly, useSend, WordsRow } from "./Fields.tsx";
import { HoleRows } from "./Holes.tsx";
import { JointRows } from "./Joints.tsx";
import { type LengthEnd, lengthMode, lengthPatch } from "./length.ts";
import { barsLike, chosenOption, replaceBatch } from "./replace.ts";
import { isObject, worldAxis, written } from "./words.ts";

/**
 * A bar's fields, edited in place (docs/ux/plan.md S5.3, F5, U3): its length (or what drives
 * it), its profile with Replace (this bar, all like it), its options from the values sold, its
 * anchor and roll, what claims each end, its label and tags. Each edit is one step. Owner: S5.
 */

type O = Record<string, unknown>;

/** The fields a bar's rows show, so the rest are listed as words below them. */
const SHOWN = new Set([
  "item",
  "opt",
  "a",
  "b",
  "anchor",
  "off_mm",
  "roll_deg",
  "ends",
  "ops",
  "label",
  "tags",
  "context",
]);

/** An item's card, fetched once per item; undefined while it loads or when it cannot be had. */
export function useCard(id: string | undefined): ItemCard | undefined {
  const [card, setCard] = useState<ItemCard>();
  useEffect(() => {
    setCard(undefined);
    if (id === undefined) return;
    let live = true;
    cardOf(id).then(
      (c) => live && setCard(c),
      () => live && setCard(undefined),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return card;
}

/** Which end a typed length moves (E-UX-16): end b by default. */
const LENGTH_ENDS: readonly { value: LengthEnd; text: string }[] = [
  { value: "b", text: "moves end b" },
  { value: "a", text: "moves end a" },
  { value: "middle", text: "from the middle" },
];

function LengthRow({ m, id }: { m: Model; id: string }) {
  const [which, setWhich] = useState<LengthEnd>("b");
  const mode = lengthMode(m, id, which);
  const { outcome, send } = useSend();
  // A typed length the field cannot take is said under it, as a refusal would be.
  const [bad, setBad] = useState<string>();
  const cut = m.derived.bars[id]?.cut_mm;
  const cutText = cut !== undefined ? <span class="sub"> · cut {mm(cut)}</span> : null;
  const ends = isObject(written(m, id)) ? (
    <select
      class="insp-select"
      data-testid="field-length-end"
      aria-label="Which end a new length moves"
      value={which}
      onChange={(e) => {
        setWhich((e.currentTarget as HTMLSelectElement).value as LengthEnd);
        setBad(undefined);
      }}
    >
      {LENGTH_ENDS.map((x) => (
        <option key={x.value} value={x.value}>
          {x.text}
        </option>
      ))}
    </select>
  ) : null;
  let body: preact.ComponentChildren;
  if (mode.kind === "edit") {
    body = (
      <>
        <CommitInput
          label={`Length, mm; ${LENGTH_ENDS.find((x) => x.value === which)?.text}`}
          testid="field-length"
          size={9}
          value={mm(mode.len).replace(/\.00$/, "")}
          onCommit={(text) => {
            // D-UX-17: units and params, a leading `=` allowed; a param is written as typed.
            const t = typedNumber(text.trim().replace(/^=\s*/, ""), m.derived.params);
            const p = "why" in t ? t : lengthPatch(m, id, t, which);
            setBad("why" in p ? p.why : undefined);
            if ("set" in p) {
              void send([{ cmd: "setBar", args: { id, set: p.set } }], `set the length of ${id}`);
            }
          }}
        />{" "}
        mm {ends}
        {cutText}
        {mode.note && <div class="sub">{mode.note}</div>}
      </>
    );
  } else if (mode.kind === "driven") {
    body = (
      <>
        <span data-testid="field-length-value">{mm(mode.len)}</span> mm {ends}
        {cutText}
        <div class="sub" data-testid="length-driven">
          {mode.params.length > 0 ? (
            <>
              driven by {mode.params.join(", ")}:{" "}
              {mode.params.map((p) => (
                <button
                  key={p}
                  type="button"
                  class="link"
                  data-testid={`edit-param-${p}`}
                  onClick={() => pointParam(p)}
                >
                  edit {p}
                </button>
              ))}
            </>
          ) : (
            <>set by its expression, {mode.expr}</>
          )}
        </div>
      </>
    );
  } else if (mode.kind === "ref") {
    body = (
      <>
        {mm(mode.len)} mm {ends}
        {cutText}
        <div class="sub">
          {mode.text}, which sets it {mode.refs.length > 0 && <EntityChips ids={mode.refs} />}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <span class="sub">{mode.why}</span> {ends}
      </>
    );
  }
  return (
    <>
      <Row label="Length" fields={["b", "a"]} testid="row-length">
        {body}
      </Row>
      <RowErrors outcome={bad !== undefined ? { ok: false, why: bad, errors: [] } : outcome} />
    </>
  );
}

/** The profile, and Replace: another bar item for this bar, or for every bar like it. */
function ProfileRow({ m, id }: { m: Model; id: string }) {
  const item = m.derived.bars[id]?.item;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [id]);
  useReplaceAsked([id], () => setOpen(true));
  const name = item ? m.items[item]?.name : undefined;
  return (
    <>
      <Row label="Profile" fields={["item"]} testid="row-profile">
        <code>{item ?? "none"}</code>
        {typeof name === "string" && <span class="sub"> {name}</span>}{" "}
        <button
          type="button"
          class="btn"
          data-testid="replace-open"
          aria-expanded={open}
          disabled={readOnly()}
          onClick={() => setOpen(!open)}
        >
          Replace…
        </button>
      </Row>
      {open && item && (
        <tr>
          <td colSpan={2}>
            <ReplaceForm m={m} ids={[id]} item={item} onDone={() => setOpen(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Replace a profile: find another bar item, choose its options (a sold value preselected,
 * options.ts), and say which bars: this one, the ones selected, or every bar like it (the same
 * item and options: one line of the cut list). One step.
 */
export function ReplaceForm({
  m,
  ids,
  item,
  onDone,
}: {
  m: Model;
  ids: readonly string[];
  item: string;
  onDone: () => void;
}) {
  const current = useCard(item);
  const size = current?.entry.size_mm;
  const [q, setQ] = useState<string | undefined>(undefined);
  const query = q ?? (size ? `${size[0]}x${size[1]}` : "");
  const [found, setFound] = useState<ListedEntry[]>([]);
  const [why, setWhy] = useState<string>();
  const [chosen, setChosen] = useState<string>();
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void fetchCatalogItems({ q: query, kind: "bar", limit: 50 }).then((r) => {
        if (!live) return;
        if (r.ok) {
          setFound(r.value.items.filter((e) => e.kind === "bar"));
          setWhy(undefined);
        } else setWhy(r.why);
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  const pick = chosen ?? found.find((e) => e.id !== item)?.id;
  const card = useCard(pick);
  const opts = useOptions(card);
  const like = ids.length === 1 ? barsLike(m, ids[0] as string) : [];
  const [scope, setScope] = useState<"these" | "like">("these");
  const targets = scope === "like" ? like : [...ids];
  const { outcome, send } = useSend();
  return (
    <form
      class="replace-form"
      data-testid="replace-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pick) return;
        void send(
          replaceBatch(m, targets, pick, opts.values),
          `replace ${targets.length === 1 ? targets[0] : `${targets.length} bars`} with ${pick}`,
        ).then((o) => {
          if (o.ok) onDone();
        });
      }}
    >
      <label class="cd-row">
        <span>Find</span>
        <input
          class="insp-input"
          data-testid="replace-query"
          value={query}
          placeholder="a code, a name or a size: 40x40"
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="cd-row">
        <span>Profile</span>
        <select
          class="insp-select"
          data-testid="replace-item"
          value={pick ?? ""}
          onChange={(e) => setChosen((e.currentTarget as HTMLSelectElement).value)}
        >
          {found.length === 0 && <option value="">No bar matches</option>}
          {found.map((e) => (
            <option key={e.id} value={e.id} disabled={e.id === item}>
              {e.code ?? e.id} · {e.name}
              {e.size_mm ? ` · ${e.size_mm[0]}×${e.size_mm[1]}` : ""}
              {e.id === item ? " (now)" : ""}
            </option>
          ))}
        </select>
      </label>
      {why && <p class="warn">{why}</p>}
      <OptionSelects fields={opts.fields} picked={opts.values} onPick={opts.pick} />
      <fieldset class="replace-scope">
        <legend>Replace</legend>
        <label>
          <input
            type="radio"
            name="replace-scope"
            data-testid="replace-these"
            checked={scope === "these"}
            onChange={() => setScope("these")}
          />{" "}
          {ids.length === 1 ? `this bar, ${ids[0]}` : `these ${ids.length} bars`}
        </label>
        {like.length > 1 && (
          <label>
            <input
              type="radio"
              name="replace-scope"
              data-testid="replace-like"
              checked={scope === "like"}
              onChange={() => setScope("like")}
            />{" "}
            all {like.length} like it ({item}
            {optionWords(m, ids[0] as string)})
          </label>
        )}
      </fieldset>
      <div class="tp-row">
        <button
          type="submit"
          class="btn primary"
          data-testid="replace-apply"
          disabled={!pick || readOnly() || busy.value}
        >
          Replace {plural(targets.length, "bar")}
        </button>
        <button type="button" class="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      <Errors outcome={outcome} />
    </form>
  );
}

/** A bar's options in words, after a comma: `, finish anodised`; empty for none. */
function optionWords(m: Model, id: string): string {
  const opt = m.derived.bars[id]?.opt ?? {};
  const keys = Object.keys(opt).sort();
  return keys.length > 0 ? `, ${keys.map((k) => `${k} ${opt[k]}`).join(", ")}` : "";
}

/**
 * The bar's options, each a select of the item's values with the unsold ones marked
 * (`optionFields`, U2); "not chosen" stands first while nothing chooses one, as the order's
 * option-not-sold problem says. A choice is one step.
 */
function OptionRows({ m, id }: { m: Model; id: string }) {
  const item = m.derived.bars[id]?.item;
  const card = useCard(item);
  const { outcome, send } = useSend();
  if (!card) return null;
  const bar = isObject(m.defaults.bar) ? m.defaults.bar : {};
  const defaults = (isObject(bar.opt) ? bar.opt : undefined) as Record<string, string> | undefined;
  const fields = optionFields(card.options, card.offers, defaults);
  if (fields.length === 0) return null;
  return (
    <>
      {fields.map((f) => {
        const value = chosenOption(m, id, f.name);
        return (
          <Row
            key={f.name}
            label={f.name.charAt(0).toUpperCase() + f.name.slice(1)}
            fields={[`opt.${f.name}`, "opt"]}
            testid={`row-opt-${f.name}`}
          >
            <select
              class="insp-select"
              data-testid={`field-opt-${f.name}`}
              aria-label={f.name}
              value={value ?? "-"}
              disabled={readOnly() || busy.value}
              onChange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                if (v === "-") return;
                void send(
                  [
                    {
                      cmd: "setBar",
                      args: { id, set: { opt: { [f.name]: v === "" ? null : v } } },
                    },
                  ],
                  `set the ${f.name} of ${id}`,
                );
              }}
            >
              {value === undefined && <option value="-">not chosen</option>}
              {value !== undefined && value !== "" && !f.choices.some((c) => c.value === value) && (
                <option value={value}>{value} (not one of the item's)</option>
              )}
              {f.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value === "" ? `(${c.label})` : c.label}
                  {c.sold ? "" : " (not sold)"}
                </option>
              ))}
            </select>
          </Row>
        );
      })}
      <RowErrors outcome={outcome} />
    </>
  );
}

/** An anchor in words: the section's centre, a face's middle, a corner, or a datum by name. */
export function anchorWords(a: string): string {
  if (a === "c") return "centre";
  if (/^[+-][xy]$/.test(a)) return `middle of face ${a}`;
  if (/^[+-][xy][+-][xy]$/.test(a)) return `corner ${a.slice(0, 2)} ${a.slice(2)}`;
  return a;
}

/**
 * The offset (`off_mm`, §4.4): the section moved from its anchor along its own x and y, each
 * named by the world direction it runs in when it runs along one. A param is written as typed
 * (D-UX-17); both zero removes it. One step (E4.2).
 */
function OffsetRow({ m, id }: { m: Model; id: string }) {
  const w = written(m, id) as O;
  const { outcome, send } = useSend();
  const [bad, setBad] = useState<string>();
  const off = Array.isArray(w.off_mm) ? (w.off_mm as (number | string)[]) : [0, 0];
  const frame = m.derived.bars[id]?.frame;
  const commit = (i: 0 | 1, text: string) => {
    const t = typedNumber(text.trim().replace(/^=\s*/, "") || "0", m.derived.params);
    if ("why" in t) {
      setBad(t.why);
      return;
    }
    setBad(undefined);
    const next = [...off];
    next[i] = t.written;
    const none = next.every((x) => x === 0);
    void send(
      [{ cmd: "setBar", args: { id, set: { off_mm: none ? null : next } } }],
      `offset ${id}`,
    );
  };
  return (
    <>
      <Row label="Offset" fields={["off_mm"]} testid="row-offset">
        <span class="end-edit">
          {([0, 1] as const).map((i) => {
            const axis = i === 0 ? "x" : "y";
            const world = worldAxis(i === 0 ? frame?.x : frame?.y);
            return (
              <span key={axis}>
                {axis}
                {world ? ` (world ${world})` : ""}{" "}
                <CommitInput
                  label={`Offset along the section's ${axis}${world ? `, world ${world}` : ""}, mm`}
                  testid={`field-off-${axis}`}
                  size={6}
                  value={String(off[i] ?? 0)}
                  onCommit={(text) => commit(i, text)}
                />{" "}
                mm
              </span>
            );
          })}
        </span>
      </Row>
      <RowErrors outcome={bad !== undefined ? { ok: false, why: bad, errors: [] } : outcome} />
    </>
  );
}

function AnchorRow({ m, id }: { m: Model; id: string }) {
  const w = written(m, id) as O;
  const card = useCard(m.derived.bars[id]?.item);
  const { outcome, send } = useSend();
  const now = typeof w.anchor === "string" ? w.anchor : "c";
  const anchors = card?.anchors ?? ["c", "-x-y", "+x-y", "+x+y", "-x+y", "-x", "+x", "-y", "+y"];
  const list = anchors.includes(now) ? anchors : [now, ...anchors];
  const view = m.display.bars[id];
  const section = view ? m.display.sections[view.section] : undefined;
  const anchor = (v: string) =>
    void send(
      [{ cmd: "setBar", args: { id, set: { anchor: v === "c" ? null : v } } }],
      `anchor ${id}`,
    );
  return (
    <>
      <Row label="Anchor" fields={["anchor"]} testid="row-anchor">
        {section && (
          <>
            <AnchorDots
              bbox={section.bbox}
              datums={section.datums}
              anchors={list}
              value={now}
              disabled={readOnly() || busy.value}
              onPick={(a) => a !== now && anchor(a)}
            />{" "}
          </>
        )}
        <select
          class="insp-select"
          data-testid="field-anchor"
          aria-label="Anchor: where the section sits on the bar's line"
          value={now}
          disabled={readOnly() || busy.value}
          onChange={(e) => anchor((e.currentTarget as HTMLSelectElement).value)}
        >
          {list.map((a) => (
            <option key={a} value={a}>
              {anchorWords(a)}
            </option>
          ))}
        </select>
      </Row>
      <RowErrors outcome={outcome} />
    </>
  );
}

/**
 * The roll (§4.4), a param written as typed. A quarter turn keeps the bar on its anchor's side
 * of its line, turning the anchor and offset with it (`rollSet`); another angle rolls about the
 * anchor. One step.
 */
function RollRow({ m, id }: { m: Model; id: string }) {
  const w = written(m, id) as O;
  const { outcome, send } = useSend();
  const [bad, setBad] = useState<string>();
  const roll = w.roll_deg;
  return (
    <>
      <Row label="Roll" fields={["roll_deg", "up"]} testid="row-roll">
        <CommitInput
          label="Roll, degrees about the bar's line"
          testid="field-roll"
          size={6}
          value={roll === undefined ? "0" : String(roll)}
          onCommit={(text) => {
            const t = typedNumber(text.trim().replace(/^=\s*/, "") || "0", m.derived.params);
            setBad("why" in t ? t.why : undefined);
            if ("why" in t) return;
            void send(
              [{ cmd: "setBar", args: { id, set: rollSet(w, t, m.derived.params).set } }],
              `roll ${id}`,
            );
          }}
        />{" "}
        °<div class="sub">{ROLL_WORDS}</div>
      </Row>
      <RowErrors outcome={bad !== undefined ? { ok: false, why: bad, errors: [] } : outcome} />
    </>
  );
}

/**
 * Context (gap X11): a bar's or a placed part's checkbox. Context is drawn and checked against (a
 * wall, a floor, a bench it stands beside), but not cut, counted, bought or weighed. One step.
 */
export function ContextRow({ m, id }: { m: Model; id: string }) {
  const { outcome, send } = useSend();
  const f = contextOf(m, id);
  if (!f.can) return null;
  return (
    <>
      <Row label="Context" fields={["context"]} testid="row-context">
        <label>
          <input
            type="checkbox"
            data-testid="field-context"
            checked={f.on}
            disabled={readOnly() || busy.value}
            onChange={(e) =>
              void send(
                contextBatch(m, id, (e.currentTarget as HTMLInputElement).checked),
                `context ${id}`,
              )
            }
          />{" "}
          not built or bought: drawn and checked against
        </label>
      </Row>
      <RowErrors outcome={outcome} />
    </>
  );
}

/** A label and tags: any taggable entity's. */
export function LabelRows({ m, id }: { m: Model; id: string }) {
  const w = written(m, id);
  const o = isObject(w) ? w : {};
  const { outcome, send } = useSend();
  const tags = Array.isArray(o.tags) ? (o.tags as string[]) : [];
  return (
    <>
      <Row label="Label" fields={["label"]} testid="row-label">
        <CommitInput
          label="Label"
          testid="field-label"
          value={typeof o.label === "string" ? o.label : ""}
          placeholder="what it is, in a few words"
          onCommit={(text) =>
            void send(
              [{ cmd: "label", args: { id, label: text.trim() === "" ? null : text.trim() } }],
              `label ${id}`,
            )
          }
        />
      </Row>
      <Row label="Tags" fields={["tags"]} testid="row-tags">
        <CommitInput
          label="Tags, separated by commas"
          testid="field-tags"
          value={tags.join(", ")}
          placeholder="post, base"
          onCommit={(text) => {
            const next = [
              ...new Set(
                text
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ];
            const add = next.filter((t) => !tags.includes(t));
            const remove = tags.filter((t) => !next.includes(t));
            if (add.length + remove.length === 0) return;
            void send(
              [
                {
                  cmd: "tag",
                  args: {
                    ids: [id],
                    ...(add.length > 0 ? { add } : {}),
                    ...(remove.length > 0 ? { remove } : {}),
                  },
                },
              ],
              `tag ${id}`,
            );
          }}
        />
      </Row>
      <RowErrors outcome={outcome} />
    </>
  );
}

/**
 * Split at a typed distance (E-UX-21), as the Split at… action asks: from end a's design point,
 * an expression over params valued as typed (`splitBar` takes a number), with a splice when asked;
 * a bar in a run is always spliced. One step.
 */
function SplitForm({ m, id }: { m: Model; id: string }) {
  const run = runOf(m, id);
  const [text, setText] = useState("");
  const [splice, setSplice] = useState(false);
  const [bad, setBad] = useState<string>();
  const { outcome, send } = useSend();
  const close = () => {
    splitAsked.value = undefined;
  };
  const len = m.derived.bars[id]?.len_mm ?? 0;
  return (
    <form
      class="split-form"
      data-testid="split-form"
      onSubmit={(e) => {
        e.preventDefault();
        const t = typedNumber(text.trim().replace(/^=\s*/, ""), m.derived.params);
        const b = "why" in t ? t : splitBatch(m, id, t.value, { splice: splice || !!run });
        setBad("why" in b ? b.why : undefined);
        if ("why" in b) return;
        void send(b, `split ${id} at ${"why" in t ? "" : t.value} mm`).then((o) => {
          if (o.ok) close();
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <label>
        Split {id} at{" "}
        <input
          class="insp-input"
          data-testid="split-at"
          size={8}
          value={text}
          placeholder={mm(len / 2).replace(/\.00$/, "")}
          ref={(el) => el?.focus()}
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        />{" "}
        mm from end a
      </label>{" "}
      <label title={run ? `${id} is in run ${run}: its pieces are spliced` : undefined}>
        <input
          type="checkbox"
          data-testid="split-splice"
          checked={splice || !!run}
          disabled={!!run}
          onChange={(e) => setSplice((e.currentTarget as HTMLInputElement).checked)}
        />{" "}
        with a splice
      </label>
      <div class="tp-row">
        <button
          type="submit"
          class="btn primary"
          data-testid="split-apply"
          disabled={readOnly() || busy.value}
        >
          Split
        </button>
        <button type="button" class="btn" onClick={close}>
          Cancel
        </button>
      </div>
      <Errors outcome={bad !== undefined ? { ok: false, why: bad, errors: [] } : outcome} />
    </form>
  );
}

export function BarFields({ m, id }: { m: Model; id: string }) {
  const w = written(m, id) as O;
  const rest = Object.entries(w).filter(([k]) => !SHOWN.has(k));
  return (
    <section>
      <h3>Bar</h3>
      <ActionRow m={m} ids={[id]} groups={["bar"]} />
      {splitAsked.value === id && <SplitForm m={m} id={id} />}
      <table class="kv fields" data-testid="fields">
        <tbody>
          <LengthRow m={m} id={id} />
          <ProfileRow m={m} id={id} />
          <OptionRows m={m} id={id} />
          <AnchorRow m={m} id={id} />
          <OffsetRow m={m} id={id} />
          <RollRow m={m} id={id} />
          <EndRows m={m} id={id} />
          <JointRows m={m} id={id} />
          <HoleRows m={m} id={id} />
          <LabelRows m={m} id={id} />
          <ContextRow m={m} id={id} />
          {rest.map(([k, v]) => (
            <WordsRow key={k} label={k.replace(/_/g, " ")} v={v} fields={[k]} />
          ))}
        </tbody>
      </table>
      <p class="sub">{plural(barsLike(m, id).length, "bar")} like it in the project.</p>
    </section>
  );
}
