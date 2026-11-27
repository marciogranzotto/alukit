import { useState } from "preact/hooks";
import type { Model } from "./model.ts";
import { model, selection } from "./store.ts";

/**
 * Properties of the selection (design §8, right): the entity's fields as written, its derived
 * values (read-only: cut, centre, end angles, mass), and its catalog item's numbers, each with a
 * provenance popover (§1, principle 3: every number carries its provenance). A part made from
 * one of the project's own items (§4.8) shows that item as written, and its mass.
 */

type O = Record<string, unknown>;

const SRC: Record<string, string> = {
  src: "read from a source",
  meas: "measured",
  est: "estimated",
  calc: "computed",
};

interface Prov {
  src?: string;
  ref?: string;
  read?: string;
  note?: string;
  low?: number;
  high?: number;
}

function isObject(x: unknown): x is O {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isValued(x: unknown): x is O & { v: number } {
  return isObject(x) && typeof x.v === "number";
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));

/** A number with its provenance behind a click (§3.2's valued fields). */
function Num({ value, unit, prov }: { value: number; unit?: string; prov?: Prov }) {
  const [open, setOpen] = useState(false);
  const text = `${fmt(value)}${unit ? ` ${unit}` : ""}`;
  if (!prov) return <span class="num">{text}</span>;
  return (
    <span class="num prov">
      <button
        type="button"
        class={`prov-${prov.src ?? "none"}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
        title="provenance"
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
function unitOf(key: string): string | undefined {
  const m = /_(mm4|mm3|mm2|mm|m|N|kN|Nmm|Nm|MPa|kg_per_m3|kg_per_m|kg|deg|per_K|J|km)$/.exec(key);
  if (!m) return undefined;
  return (m[1] as string)
    .replace(/_?per_/, "/")
    .replace("mm4", "mm⁴")
    .replace("mm3", "mm³")
    .replace("mm2", "mm²")
    .replace("deg", "°");
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

function Value({ v }: { v: unknown }) {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return <code>{String(v)}</code>;
  return <code>{JSON.stringify(v)}</code>;
}

/** The document map an id lives in, by its letter prefix (§2). */
const KIND_OF_PREFIX: Readonly<Record<string, string>> = {
  n: "nodes",
  b: "bars",
  r: "runs",
  c: "connections",
  p: "parts",
  pt: "patterns",
};

function kindOf(id: string): string {
  if (id.startsWith("project:")) return "items";
  return KIND_OF_PREFIX[/^([A-Za-z]+)\d/.exec(id)?.[1] ?? ""] ?? "";
}

function Item({ m, id }: { m: Model; id: string }) {
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
              <th>{r.key}</th>
              <td>
                <Num value={r.value} unit={unitOf(r.key)} prov={r.prov} />
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
function ProjectItem({ m, id, part }: { m: Model; id: string; part: string }) {
  const local = id.slice("project:".length);
  const def = ((isObject(m.doc.items) ? m.doc.items : {}) as O)[local];
  if (!isObject(def)) return null;
  const view = m.display.parts[part];
  return (
    <section data-testid="project-item">
      <h3>
        Project item: {id}
        {typeof def.name === "string" && <span class="sub"> {def.name}</span>}
      </h3>
      <table class="kv">
        <tbody>
          {def.mass_kg === undefined && (
            <tr>
              <th>mass</th>
              <td>
                {view?.mass_kg !== undefined ? (
                  <Num value={view.mass_kg} unit="kg" prov={{ src: view.mass_src }} />
                ) : (
                  <span class="warn">not computed: see the checks</span>
                )}
              </td>
            </tr>
          )}
          {Object.entries(def)
            .filter(([k]) => k !== "name")
            .map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>
                  {k === "holes" ? (
                    `${holeCount(v)}, on the Machining tab`
                  ) : typeof v === "number" ? (
                    <Num value={v} unit={unitOf(k)} />
                  ) : isValued(v) ? (
                    <Num value={v.v} unit={unitOf(k)} prov={v as Prov} />
                  ) : (
                    <Value v={v} />
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}

function BarDerived({ m, id }: { m: Model; id: string }) {
  const b = m.derived.bars[id];
  if (!b) return <p class="warn">Does not derive: see the checks.</p>;
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
    const x = b.ends[e];
    return `${x.angle_deg === 0 ? "square" : `${fmt(x.angle_deg)}°`}, by ${x.by}${x.move_mm !== 0 ? `, moved ${fmt(x.move_mm)} mm` : ""}`;
  };
  return (
    <section>
      <h3>Derived</h3>
      <table class="kv" data-testid="derived">
        <tbody>
          <tr>
            <th>cut</th>
            <td>
              <Num value={b.cut_mm} unit="mm" />
            </td>
          </tr>
          <tr>
            <th>centre</th>
            <td>
              <Num value={b.centre_mm} unit="mm" />
            </td>
          </tr>
          {b.short_mm !== b.cut_mm && (
            <tr>
              <th>short</th>
              <td>
                <Num value={b.short_mm} unit="mm" />
              </td>
            </tr>
          )}
          {b.span_mm !== undefined && b.span_mm !== b.cut_mm && (
            <tr>
              <th>span</th>
              <td>
                <Num value={b.span_mm} unit="mm" />
              </td>
            </tr>
          )}
          <tr>
            <th>design length</th>
            <td>
              <Num value={b.len_mm} unit="mm" />
            </td>
          </tr>
          <tr>
            <th>end a</th>
            <td>{end("a")}</td>
          </tr>
          <tr>
            <th>end b</th>
            <td>{end("b")}</td>
          </tr>
          <tr>
            <th>mass</th>
            <td>
              {view?.mass_kg !== undefined ? (
                <Num value={view.mass_kg} unit="kg" prov={prov} />
              ) : (
                <span class="warn">no mass per metre</span>
              )}
            </td>
          </tr>
          {b.pattern && (
            <tr>
              <th>copy of</th>
              <td>{b.pattern}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function OtherDerived({ m, id }: { m: Model; id: string }) {
  const kind = kindOf(id);
  const rows: [string, unknown][] = [];
  if (kind === "nodes" && m.derived.nodes[id]) rows.push(["position", m.derived.nodes[id]]);
  if (kind === "runs" && m.derived.runs[id])
    rows.push(["length", `${m.derived.runs[id]?.len_mm} mm`]);
  const p = m.derived.parts[id];
  if (p) {
    if (p.unplaced) rows.push(["counted, not drawn", `${p.qty} (${p.why})`]);
    else {
      if (p.bar !== undefined) rows.push(["on", `${p.bar} at ${p.s_mm} mm`]);
      rows.push(["datum", p.datum], ["point", p.point]);
    }
  }
  const f = m.derived.fastenings[id];
  if (f) rows.push(["fastening", f.fastening], ["stations", f.stations.length]);
  for (const h of m.derived.hardware.filter((x) => x.source === id))
    rows.push([h.item, `× ${h.qty}`]);
  if (rows.length === 0) return null;
  return (
    <section>
      <h3>Derived</h3>
      <table class="kv">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>
                <Value v={v} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Properties() {
  const m = model.value;
  const sel = [...selection.value];
  if (!m) return <div class="panel-empty">No model yet.</div>;
  if (sel.length === 0)
    return (
      <div class="panel-empty">
        Select a bar, part or connection: click it, Shift-drag a box, or pick it in the tree.
      </div>
    );
  if (sel.length > 1) {
    return (
      <div class="props" data-testid="properties">
        <h2>{sel.length} selected</h2>
        <p class="ids">{sel.join(", ")}</p>
      </div>
    );
  }
  const id = sel[0] as string;
  const kind = kindOf(id);
  const written = ((m.doc[kind] ?? {}) as O)[id];
  const fields = isObject(written)
    ? written
    : written === undefined
      ? undefined
      : { value: written };
  const barItem = m.derived.bars[id]?.item ?? m.derived.parts[id]?.item;
  return (
    <div class="props" data-testid="properties">
      <h2>
        {id}
        {isObject(written) && typeof written.label === "string" && (
          <span class="sub"> {written.label}</span>
        )}
      </h2>
      {fields ? (
        <section>
          <h3>Fields</h3>
          <table class="kv">
            <tbody>
              {Object.entries(fields).map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>
                    <Value v={v} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p class="sub">A pattern copy: derive makes it from its template.</p>
      )}
      {kind === "bars" ? <BarDerived m={m} id={id} /> : <OtherDerived m={m} id={id} />}
      {barItem && <Item m={m} id={barItem} />}
      {barItem?.startsWith("project:") && <ProjectItem m={m} id={barItem} part={id} />}
    </div>
  );
}
