import { useState } from "preact/hooks";
import { EntityChips } from "../common/EntityChip.tsx";
import { kg, mm } from "../format.ts";
import type { Model } from "../model.ts";
import { endWords, isObject, pointWords, valueWords } from "./words.ts";

/**
 * What derive says about the selection, read-only (design §8; §1, principle 3: every number
 * carries its provenance): a bar's cut, centre and design lengths, its ends and mass; a part's
 * station and datum; the catalog item's numbers, each valued field with its provenance behind a
 * click; a project item as written, with its mass. Owner: S5.
 */

type O = Record<string, unknown>;

const SRC: Record<string, string> = {
  src: "read from a source",
  meas: "measured",
  est: "estimated",
  calc: "computed",
};

export interface Prov {
  src?: string;
  ref?: string;
  read?: string;
  note?: string;
  low?: number;
  high?: number;
}

function isValued(x: unknown): x is O & { v: number } {
  return isObject(x) && typeof x.v === "number";
}

/** A plain number as the inspector writes one that has no quantity of its own. */
export const fmt = (x: number) =>
  Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000);

/** A number in its unit's form: lengths as the cut list writes them, masses as the BOM. */
function numText(value: number, unit: string | undefined): string {
  if (unit === "mm") return `${mm(value)} mm`;
  if (unit === "kg") return `${kg(value)} kg`;
  return `${fmt(value)}${unit ? ` ${unit}` : ""}`;
}

/** A number with its provenance behind a click (§3.2's valued fields). */
export function ProvNum({ value, unit, prov }: { value: number; unit?: string; prov?: Prov }) {
  const [open, setOpen] = useState(false);
  const text = numText(value, unit);
  if (!prov) return <span class="num">{text}</span>;
  return (
    <span class="num prov">
      <button
        type="button"
        class={`prov-${prov.src ?? "none"}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
        title="Where this number comes from"
      >
        {text}
      </button>
      {open && (
        <span class="popover" role="tooltip" data-testid="provenance">
          <span>{prov.src ? (SRC[prov.src] ?? prov.src) : "no provenance given"}</span>
          {prov.low !== undefined && prov.high !== undefined && (
            <span>
              range {fmt(prov.low)} to {fmt(prov.high)}
            </span>
          )}
          {prov.ref && <span>ref: {prov.ref}</span>}
          {prov.read && <span>read {prov.read}</span>}
          {prov.note && <span class="note">{prov.note}</span>}
        </span>
      )}
    </span>
  );
}

/** The unit a field's suffix names (§2), as printed: `Ix_mm4` gives mm⁴, `mass_kg_per_m` kg/m. */
export function unitOf(key: string): string | undefined {
  const m = /_(mm4|mm3|mm2|mm|m|N|kN|Nmm|Nm|MPa|kg_per_m3|kg_per_m|kg|deg|per_K|J|km)$/.exec(key);
  if (!m) return undefined;
  return (m[1] as string)
    .replace(/_?per_/, "/")
    .replace("mm4", "mm⁴")
    .replace("mm3", "mm³")
    .replace("mm2", "mm²")
    .replace("deg", "°");
}

/** A field's name in words: its unit suffix off, underscores as spaces (`Ix_mm4` → `Ix`). */
function keyWords(key: string): string {
  return key
    .replace(/_(mm4|mm3|mm2|mm|m|N|kN|Nmm|Nm|MPa|kg_per_m3|kg_per_m|kg|deg|per_K|J|km)$/, "")
    .replace(/_/g, " ");
}

/** An item's numbers, nested keys dotted, each valued field with its own provenance. */
function itemNumbers(item: O): { key: string; value: number; prov: Prov }[] {
  const base = (isObject(item.prov) ? item.prov : {}) as Prov;
  const out: { key: string; value: number; prov: Prov }[] = [];
  const walk = (o: O, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (k === "prov") continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "number") out.push({ key, value: v, prov: base });
      else if (isValued(v)) out.push({ key, value: v.v, prov: { ...base, ...(v as Prov) } });
      else if (isObject(v)) walk(v, key);
    }
  };
  walk(item, "");
  return out;
}

/** A catalog item's numbers, as the lock pins them, each with its provenance. */
export function Item({ m, id }: { m: Model; id: string }) {
  const item = m.items[id];
  if (!item) return null;
  return (
    <section>
      <h3>
        Catalog: {id}
        {typeof item.name === "string" && <span class="sub"> {item.name}</span>}
      </h3>
      <table class="kv">
        <tbody>
          {itemNumbers(item).map((r) => (
            <tr key={r.key}>
              <th scope="row" title={r.key}>
                {keyWords(r.key)}
              </th>
              <td>
                <ProvNum value={r.value} unit={unitOf(r.key)} prov={r.prov} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** How many holes a project item's `holes` holds: a plate's list, or a bent angle's per leg. */
function holeCount(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (!isObject(v)) return 0;
  return Object.values(v).reduce<number>((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
}

/**
 * A project item (§4.8) as the document writes it, with its mass: computed from its material for
 * a plate or a bent angle, entered for a placeholder or a generic item.
 */
export function ProjectItem({ m, id, part }: { m: Model; id: string; part?: string }) {
  const local = id.slice("project:".length);
  const def = ((isObject(m.doc.items) ? m.doc.items : {}) as O)[local];
  if (!isObject(def)) return null;
  const view = part !== undefined ? m.display.parts[part] : undefined;
  return (
    <section data-testid="project-item">
      <h3>
        Project item: {id}
        {typeof def.name === "string" && <span class="sub"> {def.name}</span>}
      </h3>
      <table class="kv">
        <tbody>
          {def.mass_kg === undefined && part !== undefined && (
            <tr>
              <th scope="row">mass</th>
              <td>
                {view?.mass_kg !== undefined ? (
                  <ProvNum value={view.mass_kg} unit="kg" prov={{ src: view.mass_src }} />
                ) : (
                  <span class="warn">not computed: see the problems</span>
                )}
              </td>
            </tr>
          )}
          {Object.entries(def)
            .filter(([k]) => k !== "name")
            .map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{keyWords(k)}</th>
                <td>
                  {k === "holes" ? (
                    `${holeCount(v)}, on the Machining sheet`
                  ) : typeof v === "number" ? (
                    <ProvNum value={v} unit={unitOf(k)} />
                  ) : isValued(v) ? (
                    <ProvNum value={v.v} unit={unitOf(k)} prov={v as Prov} />
                  ) : (
                    valueWords(v)
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * A bar's derived lengths, ends and mass, read-only. `ends` is false where the bar's fields
 * already say what claims each end (a pattern copy has no fields, so its derived values say it).
 */
export function BarDerived({ m, id, ends = true }: { m: Model; id: string; ends?: boolean }) {
  const b = m.derived.bars[id];
  if (!b) return <p class="warn">Does not derive: see the problems.</p>;
  const view = m.display.bars[id];
  const item = m.items[b.item] ?? {};
  const pm = item.mass_kg_per_m;
  const prov: Prov = {
    ...((isObject(item.prov) ? item.prov : {}) as Prov),
    ...(isValued(pm) ? (pm as Prov) : {}),
    ...(view?.mass_src ? { src: view.mass_src } : {}),
  };
  const kgm = typeof pm === "number" ? pm : isValued(pm) ? pm.v : undefined;
  if (kgm !== undefined) {
    prov.note = `centre-line length × ${fmt(kgm)} kg/m${prov.note ? `; ${prov.note}` : ""}`;
  }
  const end = (e: "a" | "b") => {
    const w = endWords(m, id, e);
    return (
      <>
        {w.text} {w.refs.length > 0 && <EntityChips ids={w.refs} />}
      </>
    );
  };
  return (
    <section>
      <h3>Derived</h3>
      <table class="kv" data-testid="derived">
        <tbody>
          <tr>
            <th scope="row">cut</th>
            <td>
              <ProvNum value={b.cut_mm} unit="mm" />
            </td>
          </tr>
          <tr>
            <th scope="row">centre</th>
            <td>
              <ProvNum value={b.centre_mm} unit="mm" />
            </td>
          </tr>
          {b.short_mm !== b.cut_mm && (
            <tr>
              <th scope="row">short</th>
              <td>
                <ProvNum value={b.short_mm} unit="mm" />
              </td>
            </tr>
          )}
          {b.span_mm !== undefined && b.span_mm !== b.cut_mm && (
            <tr>
              <th scope="row">span</th>
              <td>
                <ProvNum value={b.span_mm} unit="mm" />
              </td>
            </tr>
          )}
          <tr>
            <th scope="row">design length</th>
            <td>
              <ProvNum value={b.len_mm} unit="mm" />
            </td>
          </tr>
          <tr>
            <th scope="row">from</th>
            <td>
              {pointWords(b.a)} to {pointWords(b.b)}
            </td>
          </tr>
          {ends && (
            <>
              <tr>
                <th scope="row">end a</th>
                <td>{end("a")}</td>
              </tr>
              <tr>
                <th scope="row">end b</th>
                <td>{end("b")}</td>
              </tr>
            </>
          )}
          <tr>
            <th scope="row">mass</th>
            <td>
              {view?.mass_kg !== undefined ? (
                <ProvNum value={view.mass_kg} unit="kg" prov={prov} />
              ) : (
                <span class="warn">no mass per metre</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** What derive says about a part, a node, a run or a connection, in words. */
export function OtherDerived({ m, id }: { m: Model; id: string }) {
  const rows: [string, string, string[]][] = [];
  const node = m.derived.nodes[id];
  if (node) rows.push(["position", pointWords(node), []]);
  const run = m.derived.runs[id];
  if (run) rows.push(["length", `${mm(run.len_mm)} mm, bars ${run.bars.join(", ")}`, run.bars]);
  const p = m.derived.parts[id];
  if (p) {
    if (p.unplaced) rows.push(["counted, not drawn", `${p.qty ?? 1}: ${p.why ?? ""}`, []]);
    else {
      if (p.bar !== undefined && p.s_mm !== undefined) {
        rows.push(["on", `${p.bar} at ${mm(p.s_mm)} mm`, [p.bar]]);
      }
      if (p.datum !== undefined) rows.push(["datum", p.datum, []]);
      if (p.point) rows.push(["at", pointWords(p.point), []]);
    }
  }
  const f = m.derived.fastenings[id];
  if (f) {
    rows.push([
      "fastening",
      `${f.fastening}, ${f.stations.length} station${f.stations.length === 1 ? "" : "s"}`,
      [],
    ]);
  }
  for (const h of m.derived.hardware.filter((x) => x.source === id)) {
    const name = m.items[h.item]?.name;
    rows.push([
      "hardware",
      `${h.item}${typeof name === "string" ? ` ${name}` : ""} × ${h.qty}`,
      [],
    ]);
  }
  if (rows.length === 0) return null;
  return (
    <section>
      <h3>Derived</h3>
      <table class="kv" data-testid="derived">
        <tbody>
          {rows.map(([k, v, refs], i) => (
            <tr key={`${k}${i}`}>
              <th scope="row">{k}</th>
              <td>
                {v} {refs.length > 0 && <EntityChips ids={refs} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
