import { buttSystems, ConnectorSelect } from "../common/ConnectorSelect.tsx";
import { EntityChips } from "../common/EntityChip.tsx";
import { cornersOf } from "../corners.ts";
import type { Model } from "../model.ts";
import { busy } from "../store.ts";
import { typedValue } from "../tools/typed.ts";
import { LabelRows } from "./BarFields.tsx";
import { CommitInput, Row, RowErrors, readOnly, useSend, WordsRow } from "./Fields.tsx";
import { pointRefWords } from "./length.ts";
import { isObject, labelOf, listWords, pointWords, written } from "./words.ts";

/**
 * The fields of a part, a connection, a node, a run and a pattern (docs/ux/plan.md S5.3): a
 * part's station (its bar, face or groove), distance and roll; a butt's through bar, connector
 * and quantity; the rest in words. Each edit is one step. Owner: S5.
 */

type O = Record<string, unknown>;

/** A bar or a run in a list: its id and label. */
function memberOption(m: Model, id: string): string {
  const label = labelOf(m, id);
  return label ? `${id} · ${label}` : id;
}

/** The faces and grooves of the section a station's bar (or a run's first bar) is made of. */
function facesOf(m: Model, bar: string): string[] {
  const first = bar.startsWith("r") ? (m.derived.runs[bar]?.bars[0] ?? bar) : bar;
  const section = m.display.bars[first]?.section;
  const grooves = (section ? m.display.sections[section]?.grooves : undefined) ?? [];
  const named: string[] = [];
  for (const face of ["+x", "-x", "+y", "-y"] as const) {
    // Numbered by increasing section coordinate on their face (§4.3).
    const n = grooves.filter((g) => g.face === face).length;
    for (let i = 1; i <= n; i++) named.push(`${face}.${i}`);
  }
  return ["+x", "-x", "+y", "-y", ...named];
}

function StationRows({ m, id, on }: { m: Model; id: string; on: O }) {
  const { outcome, send } = useSend();
  const bar = String(on.bar);
  const bars = [
    ...Object.keys((isObject(m.doc.bars) ? m.doc.bars : {}) as O),
    ...Object.keys((isObject(m.doc.runs) ? m.doc.runs : {}) as O),
  ];
  const where =
    typeof on.groove === "string" ? on.groove : typeof on.face === "string" ? on.face : "";
  const set = (patch: O, what: string) =>
    void send([{ cmd: "setPart", args: { id, set: { on: patch } } }], what);
  return (
    <>
      <Row label="On" fields={["on.bar", "on"]} testid="row-station-bar">
        <select
          class="insp-select"
          data-testid="field-station-bar"
          aria-label="The bar or run it sits on"
          value={bar}
          disabled={readOnly() || busy.value}
          onChange={(e) => set({ bar: (e.currentTarget as HTMLSelectElement).value }, `move ${id}`)}
        >
          {(bars.includes(bar) ? bars : [bar, ...bars]).map((b) => (
            <option key={b} value={b}>
              {memberOption(m, b)}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Face" fields={["on.face", "on.groove"]} testid="row-station-face">
        <select
          class="insp-select"
          data-testid="field-station-face"
          aria-label="The face or groove it sits on"
          value={where}
          disabled={readOnly() || busy.value}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            set(
              v === ""
                ? { face: null, groove: null }
                : v.includes(".")
                  ? { groove: v, face: null }
                  : { face: v, groove: null },
              `move ${id}`,
            );
          }}
        >
          <option value="">on the bar's line</option>
          {facesOf(m, bar).map((f) => (
            <option key={f} value={f}>
              {f.includes(".") ? `groove ${f}` : `face ${f}`}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Distance" fields={["on.at_mm", "on.from"]} testid="row-station-at">
        <CommitInput
          label="Distance along the bar, mm: a number or an expression"
          testid="field-station-at"
          size={9}
          value={String(on.at_mm)}
          onCommit={(text) => set({ at_mm: typedValue(text) }, `move ${id}`)}
        />{" "}
        mm from{" "}
        <select
          class="insp-select"
          data-testid="field-station-from"
          aria-label="Counted from"
          value={typeof on.from === "string" ? on.from : "a"}
          disabled={readOnly() || busy.value}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            set({ from: v === "a" ? null : v }, `move ${id}`);
          }}
        >
          <option value="a">end a</option>
          <option value="b">end b</option>
          <option value="a.cut">end a's cut</option>
          <option value="b.cut">end b's cut</option>
        </select>
      </Row>
      <RowErrors outcome={outcome} />
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

const PART_SHOWN = new Set(["item", "on", "roll_deg", "label", "tags"]);

export function PartFields({ m, id }: { m: Model; id: string }) {
  const w = written(m, id) as O;
  const item = typeof w.item === "string" ? w.item : "";
  const name = m.items[item]?.name;
  return (
    <section>
      <h3>Part</h3>
      <table class="kv fields" data-testid="fields">
        <tbody>
          <Row label="Item" fields={["item"]}>
            <code>{item}</code>
            {typeof name === "string" && <span class="sub"> {name}</span>}
          </Row>
          {isObject(w.on) && <StationRows m={m} id={id} on={w.on} />}
          {isObject(w.on) && <RollRow m={m} id={id} cmd="setPart" />}
          {isObject(w.at) && (
            <Row label="At" fields={["at"]}>
              {Array.isArray(w.at.pos) ? pointWords(w.at.pos.map(Number)) : ""}
              {Array.isArray(w.at.rot_deg) && `, turned ${w.at.rot_deg.join("°, ")}°`}
            </Row>
          )}
          <LabelRows m={m} id={id} />
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
          disabled={readOnly() || busy.value}
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

function ButtRows({ m, id, w }: { m: Model; id: string; w: O }) {
  const { outcome, send } = useSend();
  const ends = Array.isArray(w.ends) ? (w.ends as string[]) : [];
  const through = typeof w.through === "string" ? w.through : "";
  const butt = isObject(m.defaults.butt) ? m.defaults.butt : {};
  const set = (patch: O, what: string) =>
    void send([{ cmd: "setConnection", args: { id, set: patch } }], what);
  const throughList = throughChoices(m, ends, through);
  return (
    <>
      <Row label="Ends" fields={["ends"]} testid="row-ends">
        {listWords(ends)} butt into it{" "}
        <EntityChips ids={ends.map((e) => e.split(".")[0] as string)} />
      </Row>
      <Row label="Through" fields={["through"]} testid="row-through">
        {typeof w.through === "string" ? (
          <select
            class="insp-select"
            data-testid="field-through"
            aria-label="The bar the ends butt into"
            value={through}
            disabled={readOnly() || busy.value}
            onChange={(e) =>
              set({ through: (e.currentTarget as HTMLSelectElement).value }, `butt ${id}`)
            }
          >
            {throughList.map((b) => (
              <option key={b} value={b}>
                {b.includes(".")
                  ? `${b.split(".")[0]}'s end ${b.split(".")[1]}`
                  : memberOption(m, b)}
              </option>
            ))}
          </select>
        ) : (
          (pointRefWords(w.through)?.text ?? "a body")
        )}
      </Row>
      <ButtConnector m={m} butts={[id]} />
      <Row label="Quantity" fields={["qty"]} testid="row-qty">
        <CommitInput
          label="Connectors per end"
          testid="field-qty"
          size={4}
          value={typeof w.qty === "number" ? String(w.qty) : ""}
          placeholder={typeof butt.qty === "number" ? String(butt.qty) : "1"}
          onCommit={(text) => {
            const t = text.trim();
            set({ qty: t === "" ? null : Number(t) }, `quantity of ${id}`);
          }}
        />{" "}
        per end
      </Row>
      <RowErrors outcome={outcome} />
    </>
  );
}

const CONN_SHOWN = new Set(["type", "through", "ends", "connector", "qty", "label", "tags"]);

const TYPE_WORDS: Readonly<Record<string, string>> = {
  butt: "Butt: ends bear on a bar's face",
  miter: "Mitre: two ends cut to meet",
  splice: "Splice: two ends joined in line",
  pivot: "Pivot: ends hinged on a bar",
  face: "Face joint: layers held face to face",
};

export function ConnectionFields({ m, id }: { m: Model; id: string }) {
  const w = written(m, id) as O;
  const type = String(w.type);
  return (
    <section>
      <h3>{TYPE_WORDS[type] ?? type}</h3>
      <table class="kv fields" data-testid="fields">
        <tbody>
          {type === "butt" ? (
            <ButtRows m={m} id={id} w={w} />
          ) : (
            <>
              {Array.isArray(w.ends) && (
                <Row label="Ends" fields={["ends"]}>
                  {listWords(w.ends as string[])}{" "}
                  <EntityChips ids={(w.ends as string[]).map((e) => e.split(".")[0] as string)} />
                </Row>
              )}
              {typeof w.connector === "string" && (
                <Row label="Connector" fields={["connector"]}>
                  <code>{w.connector}</code>
                  {typeof m.items[w.connector]?.name === "string" && (
                    <span class="sub"> {String(m.items[w.connector]?.name)}</span>
                  )}
                  {typeof w.qty === "number" && ` × ${w.qty}`}
                </Row>
              )}
            </>
          )}
          <LabelRows m={m} id={id} />
          {Object.entries(w)
            .filter(([k]) => !CONN_SHOWN.has(k))
            .map(([k, v]) => (
              <WordsRow key={k} label={k.replace(/_/g, " ")} v={v} fields={[k]} />
            ))}
        </tbody>
      </table>
    </section>
  );
}

/** A node, a run or a pattern: its fields in words, with its label and tags. */
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
