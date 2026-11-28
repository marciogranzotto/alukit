import { useEffect, useState } from "preact/hooks";
import type { ListedEntry } from "../../server/catalog.ts";
import { fetchCatalogItems } from "../client/catalog.ts";
import type { Model } from "../model.ts";
import { model } from "../store.ts";

/**
 * Choosing a butt's connector (docs/ux/review-phase4.md B1): the catalogs' connectors that can
 * hold a butt, those that fit the joined bars' systems first ("Fits these bars"), the others
 * after. The box frame's Joined with, a problem's fix, Settings' default butt connector and the
 * inspector's Connector field all choose with it, so they list the same connectors in the same
 * order. A connector fits when its `fits` holds every system the bars have, as derive judges a
 * butting bar (`hardware.ts`); a splice or a hinge joins ends another way, so it is not offered.
 *
 * The other connections choose with it too (the editing audit's E5.2), by what their connector
 * joins (`joins`): a splice's among the splices, a pivot's among the hinges, a mitre's among
 * every connector, since no subtype names a mitre's.
 */

/** Connector subtypes that join ends some other way than a butt. */
const NOT_BUTT = new Set(["splice", "hinge"]);

/** What a connection's connector joins, and so which connectors it is chosen among. */
export type Joins = "butt" | "splice" | "hinge" | "any";

const JOINS: Readonly<Record<Joins, (family: string) => boolean>> = {
  butt: (f) => !NOT_BUTT.has(f),
  splice: (f) => f === "splice",
  hinge: (f) => f === "hinge",
  any: () => true,
};

/** The catalogs' connectors, read once per set of catalogs the project names. */
let cache: { key: string; list: Promise<ListedEntry[]> } | undefined;

function catalogsKey(m: Model | undefined): string {
  return JSON.stringify(m?.doc.catalogs ?? []);
}

function catalogConnectors(key: string): Promise<ListedEntry[]> {
  if (cache?.key !== key) {
    const list = fetchCatalogItems({ kind: "connector", limit: 200 }).then((r) =>
      r.ok ? r.value.items : [],
    );
    cache = { key, list };
    // A failed read is not kept: the next picker asks again.
    void list.then((l) => {
      if (l.length === 0 && cache?.list === list) cache = undefined;
    });
  }
  return cache.list;
}

/**
 * Whether a connector fits bars of these systems: its `fits` holds each. Bars of no system (a
 * tube, a flat) give nothing to judge by, so every connector is offered as fitting them.
 */
export function fitsAll(e: ListedEntry, systems: readonly string[]): boolean {
  return systems.every((s) => e.fits?.includes(s) === true);
}

export interface Connectors {
  /** Read yet. */
  ready: boolean;
  /** Those that fit every system, by the catalog's order. */
  fit: ListedEntry[];
  /** The other connectors of the kind. */
  other: ListedEntry[];
}

/**
 * The project's connectors that join as `joins` says (butts unless it says), split by whether
 * they fit bars of `systems`.
 */
export function useConnectors(systems: readonly string[], joins: Joins = "butt"): Connectors {
  const key = catalogsKey(model.value);
  const [list, setList] = useState<ListedEntry[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void catalogConnectors(key).then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [key]);
  const all = (list ?? []).filter((e) => JOINS[joins](e.family));
  return {
    ready: list !== undefined,
    fit: all.filter((e) => fitsAll(e, systems)),
    other: all.filter((e) => !fitsAll(e, systems)),
  };
}

/** A connector as an option reads: its code, then what differs, the name, cut short by CSS. */
export function connectorLabel(e: Pick<ListedEntry, "id" | "code" | "name">): string {
  return `${e.code ?? e.id}${e.name ? ` · ${e.name}` : ""}`;
}

/** The full id of a bar's system, from the item the lock pins for it; undefined with none. */
export function barSystem(m: Model, bar: string): string | undefined {
  const item = m.derived.bars[bar]?.item;
  const sys = item ? m.items[item]?.system : undefined;
  if (typeof sys !== "string" || !item) return undefined;
  return sys.includes(":") ? sys : `${item.slice(0, item.indexOf(":"))}:${sys}`;
}

/** The systems of the bars some butt connections join (their through bars and butting ends). */
export function buttSystems(m: Model, butts: readonly string[]): string[] {
  const conns = (m.doc.connections ?? {}) as Record<string, Record<string, unknown>>;
  const out = new Set<string>();
  for (const id of butts) {
    const c = conns[id];
    if (!c) continue;
    const refs = [
      ...(typeof c.through === "string" ? [c.through] : []),
      ...(Array.isArray(c.ends) ? (c.ends as string[]) : []),
    ];
    for (const r of refs) {
      const s = barSystem(m, r.replace(/\.[ab]$/, ""));
      if (s) out.add(s);
    }
  }
  return [...out].sort();
}

export interface ConnectorSelectProps {
  value: string;
  onChange: (v: string) => void;
  /** The systems a connector should fit: the joined bars'. */
  systems: readonly string[];
  /** Choices before the connectors: the project's default, "nothing", "choose…". */
  lead: readonly { value: string; label: string; disabled?: boolean }[];
  /** List the connectors that do not fit too, after the ones that do. */
  others?: boolean;
  label: string;
  testid: string;
  disabled?: boolean;
  id?: string;
  /** What the connector joins: butts unless it says. */
  joins?: Joins;
  /**
   * A corner's joint (the box frame's): the connectors that fit and make a corner (brackets, end
   * connectors) first, the other fitting ones (plates, shoes, extenders) after (review m13).
   */
  corner?: boolean;
}

/** The families whose connectors hold a butt corner: a bracket outside, an end connector inside. */
export const CORNER_FAMILIES: ReadonlySet<string> = new Set(["bracket", "end-connector"]);

/**
 * The select: the caller's lead choices, then "Fits these bars" (for a corner, "Corner joints
 * that fit", then "Other connectors that fit"), then "Other connectors".
 */
export function ConnectorSelect(p: ConnectorSelectProps) {
  const c = useConnectors(p.systems, p.joins);
  const known = [...c.fit, ...c.other].some((e) => e.id === p.value);
  const leading = p.lead.some((l) => l.value === p.value);
  const corners = p.corner ? c.fit.filter((e) => CORNER_FAMILIES.has(e.family)) : [];
  const rest = p.corner ? c.fit.filter((e) => !CORNER_FAMILIES.has(e.family)) : c.fit;
  return (
    <select
      class="insp-select connector-select"
      data-testid={p.testid}
      aria-label={p.label}
      id={p.id}
      value={p.value}
      disabled={p.disabled}
      data-fit={c.fit.length}
      onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value)}
    >
      {p.lead.map((l) => (
        <option key={`lead-${l.value}`} value={l.value} disabled={l.disabled}>
          {l.label}
        </option>
      ))}
      {!known && !leading && p.value !== "" && <option value={p.value}>{p.value}</option>}
      {!c.ready ? (
        <option disabled value="-reading">
          reading the connectors…
        </option>
      ) : (
        <>
          {corners.length > 0 && (
            <optgroup label={p.systems.length === 0 ? "Corner joints" : "Corner joints that fit"}>
              {corners.map((e) => (
                <option key={e.id} value={e.id} data-fits="yes" data-corner="yes" title={e.name}>
                  {connectorLabel(e)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup
            label={
              p.systems.length === 0
                ? corners.length > 0
                  ? "Other connectors"
                  : "Connectors"
                : c.fit.length === 0
                  ? `None here fits ${p.systems.join(", ")}`
                  : corners.length > 0
                    ? "Other connectors that fit"
                    : "Fits these bars"
            }
          >
            {rest.map((e) => (
              <option key={e.id} value={e.id} data-fits="yes" title={e.name}>
                {connectorLabel(e)}
              </option>
            ))}
          </optgroup>
          {(p.others ?? false) && c.other.length > 0 && (
            <optgroup label="Other connectors">
              {c.other.map((e) => (
                <option key={e.id} value={e.id} title={e.name}>
                  {connectorLabel(e)}
                </option>
              ))}
            </optgroup>
          )}
        </>
      )}
    </select>
  );
}
