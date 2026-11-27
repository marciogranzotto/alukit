import { EntityChips } from "../common/EntityChip.tsx";
import type { Model } from "../model.ts";
import { typedNumber } from "../tools/typed.ts";
import { LabelRows } from "./BarFields.tsx";
import { explodePattern } from "./edit-actions.ts";
import { Row, WordsRow } from "./Fields.tsx";
import { patternEdit } from "./pattern.ts";
import { EditErrors, editOff, SelectRow, TextRow, useEdit } from "./rows.tsx";
import { isObject, labelOf, listWords, pointWords, written } from "./words.ts";

/**
 * A live pattern's fields, edited in place (docs/ux/editing-audit.md E5.3, E-UX-13): what it
 * repeats, along which bar or run, its pitch and count (or its offsets), and the copies it leaves
 * out, each one `setPattern`; Explode, one step that turns the copies into plain entities and
 * selects them. A pitch or an offset takes expressions, written as typed when it reads a param
 * (D5). Owner: E5.
 */

type O = Record<string, unknown>;

/** The fields the rows show; any other is listed in words below them. */
const SHOWN = new Set([
  "template",
  "along",
  "pitch_mm",
  "count",
  "offsets_mm",
  "skip",
  "label",
  "tags",
]);

/** A bar or run as an option reads: its id and label. */
function optionOf(m: Model, id: string): { value: string; label: string } {
  const label = labelOf(m, id);
  return { value: id, label: label ? `${id} · ${label}` : id };
}

/** What a written length comes to, after its field: ` = 150 mm` for an expression, else nothing. */
function comesTo(v: unknown, params: Readonly<Record<string, number>>): string {
  if (typeof v !== "string") return "";
  const n = typedNumber(v, params);
  return "why" in n ? "" : ` = ${n.value} mm`;
}

const text = (v: unknown) =>
  Array.isArray(v) ? v.map(String).join(", ") : v === undefined ? "" : String(v);

export function PatternFields({ m, id }: { m: Model; id: string }) {
  const w = written(m, id);
  const p: O = isObject(w) ? w : {};
  const params = m.derived.params;
  const template = Array.isArray(p.template) ? (p.template as string[]) : [];
  const count = typeof p.count === "number" ? p.count : undefined;
  const along = p.along;
  const docBars = Object.keys(isObject(m.doc.bars) ? m.doc.bars : {});
  const docRuns = Object.keys(isObject(m.doc.runs) ? m.doc.runs : {});
  const alongOptions = (ids: string[]) =>
    (typeof along === "string" && !ids.includes(along) ? [along, ...ids] : ids).map((x) =>
      optionOf(m, x),
    );
  return (
    <section>
      <h3>Pattern</h3>
      <table class="kv fields" data-testid="fields">
        <tbody>
          <Row label="Repeats" fields={["template"]} testid="row-template">
            {listWords(template)} <EntityChips ids={template} />
          </Row>
          {typeof along === "string" ? (
            <SelectRow
              label="Along"
              name="along"
              fields={["along"]}
              value={along}
              options={alongOptions([...docBars, ...docRuns])}
              title="The bar or run the copies repeat along"
              what={`repeat ${id} along another bar`}
              toEdit={(v) => patternEdit(id, "along", v, params)}
            />
          ) : (
            <Row label="Along" fields={["along"]} testid="row-along">
              {isObject(along) && Array.isArray(along.dir)
                ? `the direction ${pointWords(along.dir.map(Number))}`
                : ""}
            </Row>
          )}
          {Array.isArray(p.offsets_mm) ? (
            <TextRow
              label="Offsets"
              name="offsets"
              fields={["offsets_mm"]}
              value={text(p.offsets_mm)}
              title="Each copy's offset from the template, mm: numbers or expressions"
              what={`offsets of ${id}`}
              toEdit={(t) => patternEdit(id, "offsets_mm", t, params)}
              size={14}
              after=" mm"
            />
          ) : (
            <>
              <TextRow
                label="Pitch"
                name="pitch"
                fields={["pitch_mm"]}
                value={text(p.pitch_mm)}
                title="The distance between copies, mm: a number or an expression"
                what={`pitch of ${id}`}
                toEdit={(t) => patternEdit(id, "pitch_mm", t, params)}
                after={` mm${comesTo(p.pitch_mm, params)}`}
              />
              <TextRow
                label="Count"
                name="count"
                fields={["count"]}
                value={text(count)}
                title="How many in all, the template included"
                what={`count of ${id}`}
                toEdit={(t) => patternEdit(id, "count", t, params)}
                size={4}
                after=" in all"
              />
            </>
          )}
          <TextRow
            label="Leave out"
            name="skip"
            fields={["skip"]}
            value={text(p.skip)}
            title="The copies to leave out, by number, comma-separated"
            what={`copies ${id} leaves out`}
            toEdit={(t) => patternEdit(id, "skip", t, params)}
            placeholder="none"
            size={9}
            after={count !== undefined && count > 1 ? ` of copies 1 to ${count - 1}` : ""}
          />
          <LabelRows m={m} id={id} />
          {Object.entries(p)
            .filter(([k]) => !SHOWN.has(k))
            .map(([k, v]) => (
              <WordsRow key={k} label={k.replace(/_/g, " ")} v={v} fields={[k]} />
            ))}
          <ExplodeRows id={id} />
        </tbody>
      </table>
    </section>
  );
}

/** Explode, with its refusal under it. */
function ExplodeRows({ id }: { id: string }) {
  const { outcome, edit } = useEdit();
  return (
    <>
      <Row label="Copies" testid="row-explode">
        <button
          type="button"
          class="btn"
          data-testid="pattern-explode"
          disabled={editOff()}
          title="Turn the copies into entities of their own, as one step; they stop following the pattern"
          onClick={() => void explodePattern(id, edit)}
        >
          Explode into plain entities
        </button>
      </Row>
      <EditErrors outcome={outcome} name="explode" />
    </>
  );
}
