import { useState } from "preact/hooks";
import { AnchorDots } from "../common/AnchorDots.tsx";
import { ROLL_WORDS } from "../edit/roll.ts";
import type { Model } from "../model.ts";
import { optionFields } from "../options.ts";
import { busy } from "../store.ts";
import { typedNumber } from "../tools/typed.ts";
import { anchorWords, useCard } from "./BarFields.tsx";
import { CommitInput, Row, RowErrors, readOnly, useSend } from "./Fields.tsx";
import {
  anchorBatch,
  labelBatch,
  labelled,
  manyBars,
  optionBatch,
  rollBatch,
  shared,
  tagBatch,
  tagsOf,
} from "./many.ts";
import { chosenOption } from "./replace.ts";
import { isObject, written } from "./words.ts";

/**
 * Fields for several selected (docs/ux/editing-audit.md E4.5, E-UX-15): for bars, their options
 * (when they share a profile), anchor and roll; for any entities of the document, their label and
 * tags. Each shows the value they share, or "varies", and a change is one step, one patch per
 * entity (many.ts). Owner: E4.
 */

const VARIES = "\u0000varies";

/** A select over several entities: their shared value, or "varies" first while they differ. */
function SharedSelect({
  testid,
  label,
  values,
  choices,
  onPick,
}: {
  testid: string;
  label: string;
  values: readonly string[];
  choices: readonly { value: string; text: string }[];
  onPick: (v: string) => void;
}) {
  const s = shared(values);
  const now = "value" in s ? s.value : VARIES;
  const list =
    "value" in s && !choices.some((c) => c.value === s.value)
      ? [{ value: s.value, text: s.value }, ...choices]
      : choices;
  return (
    <select
      class="insp-select"
      data-testid={testid}
      aria-label={label}
      value={now}
      disabled={readOnly() || busy.value}
      onChange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        if (v !== VARIES && v !== now) onPick(v);
      }}
    >
      {now === VARIES && <option value={VARIES}>varies</option>}
      {list.map((c) => (
        <option key={c.value} value={c.value}>
          {c.text}
        </option>
      ))}
    </select>
  );
}

/** The options of bars that share one profile, each a select of the item's values. */
function ManyOptions({ m, ids }: { m: Model; ids: string[] }) {
  const items = new Set(ids.map((id) => m.derived.bars[id]?.item));
  const item = items.size === 1 ? [...items][0] : undefined;
  const card = useCard(item);
  const { outcome, send } = useSend();
  if (!card) return null;
  const bar = isObject(m.defaults.bar) ? m.defaults.bar : {};
  const defaults = (isObject(bar.opt) ? bar.opt : undefined) as Record<string, string> | undefined;
  const fields = optionFields(card.options, card.offers, defaults);
  return (
    <>
      {fields.map((f) => (
        <Row
          key={f.name}
          label={f.name.charAt(0).toUpperCase() + f.name.slice(1)}
          testid={`many-row-opt-${f.name}`}
        >
          <SharedSelect
            testid={`many-opt-${f.name}`}
            label={`${f.name} of the ${ids.length} bars`}
            values={ids.map((id) => chosenOption(m, id, f.name) ?? "-")}
            choices={f.choices.map((c) => ({
              value: c.value,
              text: `${c.value === "" ? `(${c.label})` : c.label}${c.sold ? "" : " (not sold)"}`,
            }))}
            onPick={(v) =>
              void send(optionBatch(ids, f.name, v), `set the ${f.name} of ${ids.length} bars`)
            }
          />
        </Row>
      ))}
      <RowErrors outcome={outcome} />
    </>
  );
}

const ANCHORS = ["c", "-x-y", "+x-y", "+x+y", "-x+y", "-x", "+x", "-y", "+y"];

function ManyAnchor({ m, ids }: { m: Model; ids: string[] }) {
  const items = new Set(ids.map((id) => m.derived.bars[id]?.item));
  const card = useCard(items.size === 1 ? [...items][0] : undefined);
  const { outcome, send } = useSend();
  const anchors = card?.anchors ?? ANCHORS;
  const values = ids.map((id) => {
    const w = written(m, id);
    return isObject(w) && typeof w.anchor === "string" ? w.anchor : "c";
  });
  const s = shared(values);
  // The section's dots, as one bar's row shows them (e4 8), when the bars share one section:
  // the shared anchor filled, none while they vary.
  const sections = new Set(ids.map((id) => m.display.bars[id]?.section));
  const one = sections.size === 1 ? [...sections][0] : undefined;
  const section = one !== undefined ? m.display.sections[one] : undefined;
  const pick = (v: string) => void send(anchorBatch(ids, v), `anchor ${ids.length} bars`);
  return (
    <>
      <Row label="Anchor" testid="many-row-anchor">
        {section && (
          <AnchorDots
            bbox={section.bbox}
            datums={section.datums}
            anchors={anchors}
            value={"value" in s ? s.value : ""}
            disabled={readOnly() || busy.value}
            onPick={(a) => {
              if (!("value" in s) || a !== s.value) pick(a);
            }}
          />
        )}
        <SharedSelect
          testid="many-anchor"
          label={`Anchor of the ${ids.length} bars`}
          values={values}
          choices={anchors.map((a) => ({ value: a, text: anchorWords(a) }))}
          onPick={pick}
        />
      </Row>
      <RowErrors outcome={outcome} />
    </>
  );
}

function ManyRoll({ m, ids }: { m: Model; ids: string[] }) {
  const { outcome, send } = useSend();
  const [bad, setBad] = useState<string>();
  const s = shared(
    ids.map((id) => {
      const w = written(m, id);
      return isObject(w) && w.roll_deg !== undefined ? String(w.roll_deg) : "0";
    }),
  );
  return (
    <>
      <Row label="Roll" testid="many-row-roll">
        <CommitInput
          label={`Roll of the ${ids.length} bars, degrees`}
          testid="many-roll"
          size={6}
          value={"value" in s ? s.value : ""}
          placeholder="varies"
          onCommit={(text) => {
            const t = typedNumber(text.trim().replace(/^=\s*/, "") || "0", m.derived.params);
            setBad("why" in t ? t.why : undefined);
            if (!("why" in t)) void send(rollBatch(m, ids, t), `roll ${ids.length} bars`);
          }}
        />{" "}
        °<div class="sub">{ROLL_WORDS}</div>
      </Row>
      <RowErrors outcome={bad !== undefined ? { ok: false, why: bad, errors: [] } : outcome} />
    </>
  );
}

function ManyLabelTags({ m, ids }: { m: Model; ids: string[] }) {
  const { outcome, send } = useSend();
  const labels = shared(
    ids.map((id) => {
      const w = written(m, id);
      return isObject(w) && typeof w.label === "string" ? w.label : "";
    }),
  );
  const tags = tagsOf(m, ids);
  return (
    <>
      <Row label="Label" testid="many-row-label">
        <CommitInput
          label={`Label of the ${ids.length} selected`}
          testid="many-label"
          value={"value" in labels ? labels.value : ""}
          placeholder={"value" in labels ? "what they are, in a few words" : "varies"}
          onCommit={(text) => void send(labelBatch(ids, text), `label ${ids.length} entities`)}
        />
      </Row>
      <Row label="Tags" testid="many-row-tags">
        <CommitInput
          label={`Tags all ${ids.length} carry, separated by commas`}
          testid="many-tags"
          value={tags.all.join(", ")}
          placeholder={tags.some.length > 0 ? "none shared by all" : "post, base"}
          onCommit={(text) => {
            const batch = tagBatch(m, ids, text);
            if (batch.length > 0) void send(batch, `tag ${ids.length} entities`);
          }}
        />
        {tags.some.length > 0 && <div class="sub">some also carry {tags.some.join(", ")}</div>}
      </Row>
      <RowErrors outcome={outcome} />
    </>
  );
}

export function ManyFields({ m, ids }: { m: Model; ids: string[] }) {
  const own = labelled(m, ids);
  if (!own) return null;
  const bars = manyBars(m, ids);
  return (
    <section>
      <h3>{bars ? "Bars" : "Fields"}</h3>
      <table class="kv fields" data-testid="many-fields">
        <tbody>
          {bars && <ManyOptions m={m} ids={bars} />}
          {bars && <ManyAnchor m={m} ids={bars} />}
          {bars && <ManyRoll m={m} ids={bars} />}
          <ManyLabelTags m={m} ids={own} />
        </tbody>
      </table>
    </section>
  );
}
