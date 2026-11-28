import { useRef, useState } from "preact/hooks";
import { barSystem, buttSystems, ConnectorSelect, type Joins } from "../common/ConnectorSelect.tsx";
import { EntityChips } from "../common/EntityChip.tsx";
import { cornersOf } from "../corners.ts";
import type { Model } from "../model.ts";
import { typedValue } from "../tools/typed.ts";
import { ContextRow, LabelRows } from "./BarFields.tsx";
import {
  connectionSet,
  holeFaceCode,
  holeFacesEdit,
  lengthEdit,
  offsetEdit,
  quantityEdit,
  stationAtEdit,
  stationEdit,
  stationFacePatch,
  THROUGH_END_CHOICES,
  throughEndCode,
  throughEndEdit,
} from "./connection.ts";
import { replaceable, useAsked } from "./edit-actions.ts";
import { FaceEdit } from "./FaceEdit.tsx";
import { CommitInput, Row, RowErrors, useSend, WordsRow } from "./Fields.tsx";
import { pointRefWords } from "./length.ts";
import { PartReplaceForm } from "./PartReplace.tsx";
import { EditErrors, editOff, SelectRow, TextRow, useEdit } from "./rows.tsx";
import { faceWords, isObject, labelOf, listWords, pointWords, written } from "./words.ts";

/**
 * The fields of a part, a connection, a node and a run (docs/ux/plan.md S5.3; the editing
 * audit's E5.1, E5.2, E5.4): a part's item with Replace, its station (bar, face or groove,
 * distance, offset) and roll; a butt's through bar, connector, quantity, spacer and through end;
 * a mitre's and a splice's connector, quantity and gap; a pivot's base station, axis and
 * connector; a face joint's form; and, on every connection with butting ends, the face each end's
 * cross holes go in from. Each edit is one step, and its refusal shows under its own row. Owner:
 * E5.
 */

type O = Record<string, unknown>;

/** A bar or a run in a list: its id and label. */
function memberOption(m: Model, id: string): string {
  const label = labelOf(m, id);
  return label ? `${id} · ${label}` : id;
}

/**
 * The faces of the section a station's bar (or a run's first bar) is made of, then its grooves
 * unless `grooves` is false (a pivot's base sits on a face, §4.5).
 */
/** A station's bar: itself, or a run's first bar, whose faces the run's are. */
function barOfMember(m: Model, bar: string): string {
  return bar.startsWith("r") ? (m.derived.runs[bar]?.bars[0] ?? bar) : bar;
}

function facesOf(m: Model, bar: string, grooves = true): string[] {
  const first = bar.startsWith("r") ? (m.derived.runs[bar]?.bars[0] ?? bar) : bar;
  const section = m.display.bars[first]?.section;
  const all = (section ? m.display.sections[section]?.grooves : undefined) ?? [];
  const named: string[] = [];
  if (grooves) {
    for (const face of ["+x", "-x", "+y", "-y"] as const) {
      // Numbered by increasing section coordinate on their face (§4.3).
      const n = all.filter((g) => g.face === face).length;
      for (let i = 1; i <= n; i++) named.push(`${face}.${i}`);
    }
  }
  return ["+x", "-x", "+y", "-y", ...named];
}

const FROM: readonly { value: string; label: string }[] = [
  { value: "a", label: "end a" },
  { value: "b", label: "end b" },
  { value: "a.cut", label: "end a's cut" },
  { value: "b.cut", label: "end b's cut" },
];

/**
 * A station's rows, a part's `on` or a pivot's `base` (§4.3): the bar or run, the face or groove,
 * the distance and where it is counted from, and a part's offset. Each one step.
 */
function StationRows({
  m,
  cmd,
  id,
  at,
  on,
}: {
  m: Model;
  cmd: "setPart" | "setConnection";
  id: string;
  at: "on" | "base";
  on: O;
}) {
  const params = m.derived.params;
  const bar = String(on.bar);
  const bars = [
    ...Object.keys((isObject(m.doc.bars) ? m.doc.bars : {}) as O),
    ...Object.keys((isObject(m.doc.runs) ? m.doc.runs : {}) as O),
  ];
  const where =
    typeof on.groove === "string" ? on.groove : typeof on.face === "string" ? on.face : "";
  const faces = facesOf(m, bar, at === "on");
  const what = at === "on" ? `move ${id}` : `move ${id}'s base`;
  const off = Array.isArray(on.off_mm) ? on.off_mm.map(String).join(", ") : "";
  return (
    <>
      <SelectRow
        label={at === "on" ? "On" : "Base on"}
        name="station-bar"
        fields={[`${at}.bar`, at]}
        value={bar}
        options={(bars.includes(bar) ? bars : [bar, ...bars]).map((b) => ({
          value: b,
          label: memberOption(m, b),
        }))}
        title={at === "on" ? "The bar or run it sits on" : "The bar the pivot's base is on"}
        what={what}
        toEdit={(v) => stationEdit(cmd, id, at, { bar: v })}
      />
      <SelectRow
        label="Face"
        name="station-face"
        fields={[`${at}.face`, `${at}.groove`]}
        value={where}
        options={[
          { value: "", label: "on the bar's line" },
          ...(where !== "" && !faces.includes(where) ? [where] : []).map((f) => ({
            value: f,
            label: f,
          })),
          ...faces.map((f) => ({
            value: f,
            label: f.includes(".") ? `groove ${f}` : faceWords(m, barOfMember(m, bar), f),
          })),
        ]}
        title={at === "on" ? "The face or groove it sits on" : "The face the base is on"}
        what={what}
        toEdit={(v) => stationEdit(cmd, id, at, stationFacePatch(v))}
      />
      <DistanceRow m={m} cmd={cmd} id={id} at={at} on={on} what={what} />
      {at === "on" && (
        <TextRow
          label="Offset"
          name="station-off"
          fields={[`${at}.off_mm`]}
          value={off}
          placeholder="0, 0"
          title="Offset, mm: u across the face, then v out from it"
          what={what}
          toEdit={(t) => offsetEdit(cmd, id, at, t, params)}
          size={9}
          after=" mm, across and out"
        />
      )}
    </>
  );
}

/** A station's distance and the end it is counted from: one row, one outcome. */
function DistanceRow({
  m,
  cmd,
  id,
  at,
  on,
  what,
}: {
  m: Model;
  cmd: "setPart" | "setConnection";
  id: string;
  at: "on" | "base";
  on: O;
  what: string;
}) {
  const { outcome, edit } = useEdit();
  return (
    <>
      <Row label="Distance" fields={[`${at}.at_mm`, `${at}.from`]} testid="row-station-at">
        <CommitInput
          label="Distance along the bar, mm: a number or an expression"
          testid="field-station-at"
          size={9}
          value={String(on.at_mm)}
          onCommit={(text) => void edit(stationAtEdit(cmd, id, at, text, m.derived.params), what)}
        />{" "}
        mm from{" "}
        <select
          class="insp-select"
          data-testid="field-station-from"
          aria-label="Counted from"
          value={typeof on.from === "string" ? on.from : "a"}
          disabled={editOff()}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            void edit(stationEdit(cmd, id, at, { from: v === "a" ? null : v }), what);
          }}
        >
          {FROM.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Row>
      <EditErrors outcome={outcome} name="station-at" />
    </>
  );
}

function RollRow({ m, id, cmd }: { m: Model; id: string; cmd: string }) {
  const w = written(m, id) as O;
  const { outcome, send } = useSend();
  return (
    <>
      <Row label="Roll" fields={["roll_deg"]} testid="row-roll">
        <CommitInput
          label="Roll, degrees"
          testid="field-roll"
          size={6}
          value={w.roll_deg === undefined ? "0" : String(w.roll_deg)}
          onCommit={(text) => {
            const v = typedValue(text);
            void send(
              [{ cmd, args: { id, set: { roll_deg: v === 0 || v === "" ? null : v } } }],
              `roll ${id}`,
            );
          }}
        />{" "}
        °
      </Row>
      <RowErrors outcome={outcome} />
    </>
  );
}

const PART_SHOWN = new Set(["item", "opt", "on", "roll_deg", "label", "tags", "context"]);

/** A part's item, with Replace (E5.4): the form opens from the row or the Replace part action. */
function ItemRow({ m, id, item }: { m: Model; id: string; item: string }) {
  const [open, setOpen] = useState(false);
  const name = m.items[item]?.name;
  useAsked(id, "replace", () => setOpen(true));
  return (
    <>
      <Row label="Item" fields={["item", "opt"]} testid="row-item">
        <code>{item}</code>
        {typeof name === "string" && <span class="sub"> {name}</span>}{" "}
        {replaceable(m, id) && (
          <button
            type="button"
            class="btn"
            data-testid="part-replace-open"
            aria-expanded={open}
            disabled={editOff()}
            onClick={() => setOpen(!open)}
          >
            Replace…
          </button>
        )}
      </Row>
      {open && (
        <tr class="part-replace-row">
          <td colSpan={2}>
            <PartReplaceForm m={m} id={id} item={item} onDone={() => setOpen(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

export function PartFields({ m, id }: { m: Model; id: string }) {
  const w = written(m, id) as O;
  const item = typeof w.item === "string" ? w.item : "";
  const opt = isObject(w.opt) ? w.opt : {};
  return (
    <section>
      <h3>Part</h3>
      <table class="kv fields" data-testid="fields">
        <tbody>
          <ItemRow m={m} id={id} item={item} />
          {Object.keys(opt).length > 0 && (
            <Row label="Options" fields={["opt"]}>
              {Object.entries(opt)
                .map(([k, v]) => `${k} ${String(v)}`)
                .join(", ")}
            </Row>
          )}
          {isObject(w.on) && <StationRows m={m} cmd="setPart" id={id} at="on" on={w.on} />}
          {isObject(w.on) && <RollRow m={m} id={id} cmd="setPart" />}
          {isObject(w.at) && (
            <Row label="At" fields={["at"]}>
              {Array.isArray(w.at.pos) ? pointWords(w.at.pos.map(Number)) : ""}
              {Array.isArray(w.at.rot_deg) && `, turned ${w.at.rot_deg.join("°, ")}°`}
            </Row>
          )}
          <LabelRows m={m} id={id} />
          <ContextRow m={m} id={id} />
          {Object.entries(w)
            .filter(([k]) => !PART_SHOWN.has(k) && k !== "at")
            .map(([k, v]) => (
              <WordsRow key={k} label={k.replace(/_/g, " ")} v={v} fields={[k]} />
            ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The Connector field of one butt or several (docs/ux/review-phase4.md B1): the connectors that
 * fit the joined bars first, the others after; the project's default, or none, leads. A change is
 * one step, a `setConnection` per butt.
 */
export function ButtConnector({ m, butts }: { m: Model; butts: readonly string[] }) {
  const { outcome, send } = useSend();
  const conns = (isObject(m.doc.connections) ? m.doc.connections : {}) as Record<string, O>;
  const own = butts.map((id) =>
    typeof conns[id]?.connector === "string" ? conns[id]?.connector : "",
  );
  const same = own.every((c) => c === own[0]);
  const butt = isObject(m.defaults.butt) ? m.defaults.butt : {};
  const fallback = typeof butt.connector === "string" ? butt.connector : undefined;
  const one = butts.length === 1;
  return (
    <>
      <Row label="Connector" fields={["connector"]} testid="row-connector">
        <ConnectorSelect
          testid="field-connector"
          label={one ? "The connector that holds each end" : "The connector of every selected butt"}
          value={same ? String(own[0] ?? "") : "-mixed"}
          systems={buttSystems(m, butts)}
          lead={[
            ...(same ? [] : [{ value: "-mixed", label: "several: keep each", disabled: true }]),
            {
              value: "",
              label: fallback ? `the project's default: ${fallback}` : "none named",
            },
          ]}
          others
          disabled={editOff()}
          onChange={(v) =>
            void send(
              butts.map((id) => ({
                cmd: "setConnection",
                args: { id, set: { connector: v === "" ? null : v } },
              })),
              one ? `connector of ${butts[0]}` : `connector of ${butts.length} butts`,
            )
          }
        />
      </Row>
      <RowErrors outcome={outcome} />
    </>
  );
}

/** The bars a butt may run through instead: the others where its ends meet bars. */
function throughChoices(m: Model, ends: readonly string[], now: string): string[] {
  const own = new Set(ends.map((e) => e.split(".")[0] as string));
  const at = new Set<string>();
  for (const c of cornersOf(m)) {
    if (!c.ends.some((e) => ends.includes(e))) continue;
    for (const b of c.bars) if (!own.has(b) && !b.includes("@")) at.add(b);
  }
  return [...new Set([now, ...at])];
}

/** The systems of the bars a connection joins: its ends' bars, a pivot's base, a butt's through. */
function connectionSystems(m: Model, w: O): string[] {
  const refs = [
    ...(Array.isArray(w.ends) ? (w.ends as string[]) : []),
    ...(typeof w.through === "string" ? [w.through] : []),
    ...(isObject(w.base) && typeof w.base.bar === "string" ? [w.base.bar] : []),
  ];
  const out = new Set<string>();
  for (const r of refs) {
    const s = barSystem(m, r.replace(/\.[ab]$/, ""));
    if (s) out.add(s);
  }
  return [...out].sort();
}

/** The connector of a mitre, a splice or a pivot, among the connectors that join that way. */
function JointConnector({
  m,
  id,
  w,
  joins,
  required,
}: {
  m: Model;
  id: string;
  w: O;
  joins: Joins;
  required: boolean;
}) {
  const { outcome, edit } = useEdit();
  const value = typeof w.connector === "string" ? w.connector : "";
  return (
    <>
      <Row label="Connector" fields={["connector"]} testid="row-connector">
        <ConnectorSelect
          testid="field-connector"
          label={
            joins === "hinge" ? "The hinge the pivot turns on" : "The connector that joins the ends"
          }
          value={value}
          systems={connectionSystems(m, w)}
          lead={required ? [] : [{ value: "", label: "none named" }]}
          others
          joins={joins}
          disabled={editOff()}
          onChange={(v) =>
            void edit(connectionSet(id, { connector: v === "" ? null : v }), `connector of ${id}`)
          }
        />
      </Row>
      <EditErrors outcome={outcome} name="connector" />
    </>
  );
}

/** A connection's quantity of connectors: empty leaves it to the default. */
function QuantityRow({
  id,
  w,
  per,
  placeholder,
}: {
  id: string;
  w: O;
  per: string;
  placeholder: string;
}) {
  return (
    <TextRow
      label="Quantity"
      name="qty"
      fields={["qty"]}
      value={typeof w.qty === "number" ? String(w.qty) : ""}
      placeholder={placeholder}
      title={`Connectors ${per}`}
      what={`quantity of ${id}`}
      toEdit={(t) => quantityEdit(id, t)}
      size={4}
      after={` ${per}`}
    />
  );
}

const FACES: readonly { value: string; label: string }[] = ["+x", "-x", "+y", "-y"].map((f) => ({
  value: f,
  label: `from ${f}`,
}));

/**
 * The face each butting end's cross holes go in from (F12's `hole_faces`): AluKit's choice, or one
 * face for every hole in that bar's side at that end. An end that names a face per hole shows the
 * list in words; choosing one face replaces it. Derive judges a face as it judges the catalog's,
 * and says so under Problems when no hole can take it.
 */
function HoleFaceRows({ id, w, ends }: { id: string; w: O; ends: readonly string[] }) {
  const hf = w.hole_faces;
  return (
    <>
      {ends.map((end) => {
        const code = holeFaceCode(hf, end);
        const list = isObject(hf) && Array.isArray(hf[end]) ? (hf[end] as unknown[]) : undefined;
        return (
          <SelectRow
            key={end}
            label={`Cross holes, ${end}`}
            name={`hole-${end}`}
            fields={["hole_faces"]}
            value={code}
            options={[
              { value: "", label: "AluKit's choice" },
              ...(list
                ? [
                    {
                      value: "-list",
                      label: `per hole: ${list
                        .map((x) =>
                          isObject(x) && Array.isArray(x.at_mm)
                            ? `(${x.at_mm.join(", ")}) ${String(x.face)}`
                            : String(x),
                        )
                        .join("; ")}`,
                      disabled: true,
                    },
                  ]
                : []),
              ...FACES,
            ]}
            title={`The face ${end}'s cross holes go in from`}
            what={`cross holes of ${end}`}
            toEdit={(v) => holeFacesEdit(id, hf, end, v)}
          />
        );
      })}
    </>
  );
}

/** Whether a connector holds the connection's ends: its own, or a butt's from the project. */
function connectorOf(m: Model, w: O): string | undefined {
  if (typeof w.connector === "string") return w.connector;
  const butt = isObject(m.defaults.butt) ? m.defaults.butt : {};
  return w.type === "butt" && typeof butt.connector === "string" ? butt.connector : undefined;
}

function ButtRows({ m, id, w }: { m: Model; id: string; w: O }) {
  const ends = Array.isArray(w.ends) ? (w.ends as string[]) : [];
  const through = typeof w.through === "string" ? w.through : "";
  const butt = isObject(m.defaults.butt) ? m.defaults.butt : {};
  const throughList = throughChoices(m, ends, through);
  // A through end is named only where the butt runs through a bar, not through an end (§4.5).
  const throughBar = through !== "" && !through.includes(".");
  const code = throughEndCode(w.through_end);
  return (
    <>
      <Row label="Ends" fields={["ends"]} testid="row-ends">
        {listWords(ends)} butt into it{" "}
        <EntityChips ids={ends.map((e) => e.split(".")[0] as string)} />
      </Row>
      {typeof w.through === "string" ? (
        <SelectRow
          label="Through"
          name="through"
          fields={["through"]}
          value={through}
          options={throughList.map((b) => ({
            value: b,
            label: b.includes(".")
              ? `${b.split(".")[0]}'s end ${b.split(".")[1]}`
              : memberOption(m, b),
          }))}
          title="The bar the ends butt into"
          what={`butt ${id}`}
          toEdit={(v) => connectionSet(id, { through: v })}
        />
      ) : (
        <Row label="Through" fields={["through"]} testid="row-through">
          {pointRefWords(w.through)?.text ?? "a body"}
        </Row>
      )}
      <ButtConnector m={m} butts={[id]} />
      <QuantityRow
        id={id}
        w={w}
        per="per end"
        placeholder={typeof butt.qty === "number" ? String(butt.qty) : "1"}
      />
      <TextRow
        label="Spacer"
        name="spacer"
        fields={["spacer_mm"]}
        value={w.spacer_mm === undefined ? "" : String(w.spacer_mm)}
        placeholder="the connector's"
        title="A layer between the through face and the ends, mm: a number or an expression"
        what={`spacer of ${id}`}
        toEdit={(t) => lengthEdit(id, "spacer_mm", t, m.derived.params, "spacer")}
        size={6}
        after=" mm"
      />
      {throughBar && (
        <SelectRow
          label="Through end"
          name="through-end"
          fields={["through_end"]}
          value={code}
          options={[
            ...(THROUGH_END_CHOICES.some((c) => c.value === code)
              ? []
              : [{ value: code, label: String(code), disabled: true }]),
            ...THROUGH_END_CHOICES,
          ]}
          title={`How ${through}'s own end is cut where the ends meet it`}
          what={`through end of ${id}`}
          toEdit={(v) => throughEndEdit(id, v)}
        />
      )}
      {connectorOf(m, w) !== undefined && <HoleFaceRows id={id} w={w} ends={ends} />}
    </>
  );
}

function JointRows({ m, id, w, type }: { m: Model; id: string; w: O; type: "miter" | "splice" }) {
  const ends = Array.isArray(w.ends) ? (w.ends as string[]) : [];
  return (
    <>
      <Row label="Ends" fields={["ends"]} testid="row-ends">
        {listWords(ends)} {type === "miter" ? "cut to meet" : "joined in line"}{" "}
        <EntityChips ids={ends.map((e) => e.split(".")[0] as string)} />
      </Row>
      <JointConnector
        m={m}
        id={id}
        w={w}
        joins={type === "splice" ? "splice" : "any"}
        required={false}
      />
      <QuantityRow id={id} w={w} per="in all" placeholder="1" />
      {type === "splice" && (
        <TextRow
          label="Gap"
          name="gap"
          fields={["gap_mm"]}
          value={w.gap_mm === undefined ? "" : String(w.gap_mm)}
          placeholder="0"
          title="The gap between the two ends, mm: a number or an expression"
          what={`gap of ${id}`}
          toEdit={(t) => lengthEdit(id, "gap_mm", t, m.derived.params, "gap")}
          size={6}
          after=" mm"
        />
      )}
      {connectorOf(m, w) !== undefined && <HoleFaceRows id={id} w={w} ends={ends} />}
    </>
  );
}

function PivotRows({ m, id, w }: { m: Model; id: string; w: O }) {
  const ends = Array.isArray(w.ends) ? (w.ends as string[]) : [];
  const base = isObject(w.base) ? w.base : undefined;
  return (
    <>
      <Row label="Ends" fields={["ends"]} testid="row-ends">
        {listWords(ends)} hinged here{" "}
        <EntityChips ids={ends.map((e) => e.split(".")[0] as string)} />
      </Row>
      {base && <StationRows m={m} cmd="setConnection" id={id} at="base" on={base} />}
      <SelectRow
        label="Axis"
        name="axis"
        fields={["axis"]}
        value={typeof w.axis === "string" ? w.axis : "across"}
        options={[
          { value: "across", label: "across the base bar" },
          { value: "along", label: "along the base bar" },
        ]}
        title="The hinge axis"
        what={`axis of ${id}`}
        toEdit={(v) => connectionSet(id, { axis: v })}
      />
      <JointConnector m={m} id={id} w={w} joins="hinge" required />
      <QuantityRow id={id} w={w} per="in all" placeholder="1" />
      <HoleFaceRows id={id} w={w} ends={ends} />
    </>
  );
}

/** The written fields each connection type's rows show; any other is listed in words. */
const SHOWN: Readonly<Record<string, ReadonlySet<string>>> = {
  butt: new Set([
    "type",
    "through",
    "ends",
    "connector",
    "qty",
    "spacer_mm",
    "through_end",
    "hole_faces",
  ]),
  miter: new Set(["type", "ends", "connector", "qty", "hole_faces"]),
  splice: new Set(["type", "ends", "connector", "qty", "gap_mm", "hole_faces"]),
  pivot: new Set(["type", "base", "axis", "ends", "connector", "qty", "hole_faces"]),
  face: new Set([
    "type",
    "bars",
    "fastening",
    "fastener",
    "stack",
    "stations",
    "gaps_mm",
    "tap_depth_mm",
  ]),
};

const TYPE_WORDS: Readonly<Record<string, string>> = {
  butt: "Butt: ends bear on a bar's face",
  miter: "Mitre: two ends cut to meet",
  splice: "Splice: two ends joined in line",
  pivot: "Pivot: ends hinged on a bar",
  face: "Face joint: layers held face to face",
};

/** Focuses the first control inside `host` that matches, and brings it into view. */
function focusIn(host: HTMLElement | null, selector: string): void {
  const el = host?.querySelector<HTMLElement>(selector);
  el?.scrollIntoView({ block: "nearest" });
  el?.focus();
}

export function ConnectionFields({ m, id }: { m: Model; id: string }) {
  const w = written(m, id) as O;
  const type = String(w.type);
  const host = useRef<HTMLElement>(null);
  // The Edit and Change connector actions (E5.6) take the inspector to the field.
  useAsked(id, "edit", () => focusIn(host.current, "select:not(:disabled), input:not(:disabled)"));
  useAsked(id, "connector", () => focusIn(host.current, '[data-testid="field-connector"]'));
  const shown = SHOWN[type] ?? new Set(["type"]);
  return (
    <section ref={host}>
      <h3>{TYPE_WORDS[type] ?? type}</h3>
      <table class="kv fields" data-testid="fields">
        <tbody>
          {type === "butt" && <ButtRows m={m} id={id} w={w} />}
          {(type === "miter" || type === "splice") && <JointRows m={m} id={id} w={w} type={type} />}
          {type === "pivot" && <PivotRows m={m} id={id} w={w} />}
          {type === "face" && <FaceEdit m={m} id={id} w={w} />}
          <LabelRows m={m} id={id} />
          {Object.entries(w)
            .filter(([k]) => !shown.has(k) && k !== "label" && k !== "tags")
            .map(([k, v]) => (
              <WordsRow key={k} label={k.replace(/_/g, " ")} v={v} fields={[k]} />
            ))}
        </tbody>
      </table>
    </section>
  );
}

/** A node or a run: its fields in words, with its label and tags. */
export function PlainFields({ m, id, title }: { m: Model; id: string; title: string }) {
  const w = written(m, id);
  const o: O = isObject(w)
    ? w
    : Array.isArray(w)
      ? { [id.startsWith("n") ? "at" : "bars"]: w }
      : {};
  return (
    <section>
      <h3>{title}</h3>
      <table class="kv fields" data-testid="fields">
        <tbody>
          {Object.entries(o)
            .filter(([k]) => k !== "label" && k !== "tags")
            .map(([k, v]) => {
              const ref = pointRefWords(v);
              return ref ? (
                <Row key={k} label={k} fields={[k]}>
                  {ref.text} <EntityChips ids={ref.refs} />
                </Row>
              ) : (
                <WordsRow key={k} label={k.replace(/_/g, " ")} v={v} fields={[k]} />
              );
            })}
          <LabelRows m={m} id={id} />
        </tbody>
      </table>
    </section>
  );
}
