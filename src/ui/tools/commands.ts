import { nextIdNumber } from "#core/ids.ts";
import type { V3 } from "../../mesh/model.ts";
import type { PaletteItem } from "../palette.ts";
import {
  type ConnectPick,
  type ConnectType,
  type FaceOptions,
  faceOptions,
  type PivotOptions,
  type PlaceStation,
} from "./state.ts";
import { typedValue, valueList } from "./typed.ts";

/**
 * What the connect, place and pattern tools send (design §8): each a batch of commands, or why
 * the picks make none. Pure: the tools' wiring and forms call them.
 */

/** A face connection's fields from its options, or why they make none. */
function faceFields(f: FaceOptions): { fields: Record<string, unknown> } | { why: string } {
  const gaps = valueList(f.gaps);
  if (!gaps) return { why: "the gaps are a comma-separated list, one per pair of layers" };
  const common = gaps.length > 0 ? { gaps_mm: gaps } : {};
  if (f.fastening === "none") return { fields: { fastening: "none", ...common } };
  const item = f.fastener.trim();
  if (item === "") {
    return {
      why: f.rod ? "name the bar stock the rod is cut from" : "name the fastener: an item id",
    };
  }
  let fastener: unknown = item;
  if (f.rod) {
    if (f.rodLen.trim() === "") return { why: "give the rod's length" };
    fastener = { bar: item, len_mm: typedValue(f.rodLen) };
  }
  const at = valueList(f.at);
  const across = valueList(f.across);
  if (!at || !across) return { why: "the stations are comma-separated distances in mm" };
  if (at.length === 0 && !f.railHoles) {
    return { why: "give the stations: distances along the first layer, or its rail's holes" };
  }
  const stack = f.stack
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return {
    fields: {
      fastening: f.fastening,
      fastener,
      ...(stack.length > 0 ? { stack } : {}),
      stations: {
        ...(at.length > 0 ? { at_mm: at } : {}),
        ...(across.length > 0 ? { across_mm: across } : {}),
        ...(f.railHoles ? { rail_holes: true } : {}),
      },
      ...(f.fastening === "screw" && f.tapDepth.trim() !== ""
        ? { tap_depth_mm: typedValue(f.tapDepth) }
        : {}),
      ...common,
    },
  };
}

/** The batch a connection's picks make, or why they make none. */
export function connectionCommand(
  picks: readonly ConnectPick[],
  type: ConnectType,
  opts: { pivot?: PivotOptions; face?: FaceOptions } = {},
): { cmd: string; args: Record<string, unknown> } | { why: string } {
  const bars = picks.filter((p) => p.kind === "bar").map((p) => p.ref);
  const ends = picks.filter((p) => p.kind === "end").map((p) => p.ref);
  const layers = picks.filter((p) => p.kind !== "end").map((p) => p.ref);
  switch (type) {
    case "butt": {
      if (bars.length === 1 && ends.length >= 1)
        return { cmd: "addConnection", args: { type: "butt", through: bars[0], ends } };
      if (bars.length === 0 && ends.length >= 2) {
        // An end bearing on another bar's end (§4.5, G17): the first end picked is the through.
        const [through, ...rest] = ends;
        return { cmd: "addConnection", args: { type: "butt", through, ends: rest } };
      }
      return { why: "a butt takes a through bar and the ends that butt on it" };
    }
    case "miter":
    case "splice":
      if (bars.length === 0 && ends.length === 2)
        return { cmd: "addConnection", args: { type, ends } };
      return { why: `a ${type} takes two ends` };
    case "pivot": {
      const p = opts.pivot;
      if (!p?.base) return { why: "click a station on a face for the pivot's base" };
      if (layers.length > 0 || ends.length === 0)
        return { why: "a pivot carries ends: click near each end it carries" };
      if (p.connector.trim() === "")
        return { why: "name the connector: one with pivot geometry, a hinge" };
      const b = p.base;
      return {
        cmd: "addConnection",
        args: {
          type: "pivot",
          base: {
            bar: b.bar,
            at_mm: b.at_mm,
            ...(p.from === "b" ? { from: "b" } : {}),
            ...(b.face ? { face: b.face } : {}),
          },
          axis: p.axis,
          ends,
          connector: p.connector.trim(),
        },
      };
    }
    case "face": {
      if (ends.length > 0 || layers.length < 2)
        return {
          why: "a face connection takes two or more layers, head to nut: bars, runs or plates",
        };
      const f = faceFields(opts.face ?? faceOptions.value);
      if ("why" in f) return f;
      return { cmd: "addConnection", args: { type: "face", bars: layers, ...f.fields } };
    }
  }
}

/**
 * A pivot's batch (§4.5): the connection, then each carried end's design point set to it, as a
 * pivot requires. The connection's id is the one the document gives next (`nextIdNumber`); the
 * batch is sent strict, so a step made by anyone else first refuses it instead of pointing the
 * ends at another connection.
 */
export function pivotBatch(
  command: { cmd: string; args: Record<string, unknown> },
  doc: Readonly<Record<string, unknown>>,
): { id: string; commands: { cmd: string; args: Record<string, unknown> }[] } {
  const ids = (doc.ids ?? {}) as Record<string, unknown>;
  const conns = doc.connections;
  const existing =
    typeof conns === "object" && conns !== null ? Object.keys(conns as object) : ([] as string[]);
  const id = `c${nextIdNumber(ids.c, existing, "c")}`;
  const ends = (command.args.ends as string[]) ?? [];
  return {
    id,
    commands: [
      command,
      ...ends.map((ref) => {
        const [bar, end] = ref.split(".") as [string, string];
        return { cmd: "setBar", args: { id: bar, set: { [end]: { pivot: id } } } };
      }),
    ],
  };
}

/** The run a bar is a piece of, if any: a face connection's layer may be the whole run (§4.5). */
export function runOf(doc: Readonly<Record<string, unknown>>, bar: string): string | undefined {
  const runs = doc.runs;
  if (typeof runs !== "object" || runs === null) return undefined;
  for (const [id, r] of Object.entries(runs as Record<string, unknown>)) {
    const members = Array.isArray(r)
      ? r
      : typeof r === "object" && r !== null && Array.isArray((r as { bars?: unknown }).bars)
        ? (r as { bars: unknown[] }).bars
        : [];
    if (members.includes(bar)) return id;
  }
  return undefined;
}

/** The batch the place tool's station makes. */
export function placeCommand(
  item: PaletteItem,
  st: PlaceStation,
  from: "a" | "b",
  roll: number,
): { cmd: string; args: Record<string, unknown> } {
  return {
    cmd: "addPart",
    args: {
      item: item.id,
      ...(item.opt && Object.keys(item.opt).length > 0 ? { opt: item.opt } : {}),
      on: {
        bar: st.bar,
        at_mm: st.at_mm,
        ...(from === "b" ? { from: "b" } : {}),
        ...(st.groove ? { groove: st.groove } : st.face ? { face: st.face } : {}),
      },
      ...(roll !== 0 ? { roll_deg: roll } : {}),
    },
  };
}

/** The batch the pattern tool makes, or why it makes none. */
export function patternCommand(s: {
  template: readonly string[];
  along?: string | undefined;
  pitch: string;
  count: string;
}): { cmd: string; args: Record<string, unknown> } | { why: string } {
  const template = s.template.filter((id) => !id.includes("@"));
  if (template.length === 0) return { why: "select the entities to repeat" };
  if (!s.along) return { why: "pick the bar or run to repeat along" };
  const pitch = Number(s.pitch);
  const count = Number(s.count);
  if (!(Number.isFinite(pitch) && pitch !== 0)) return { why: "the pitch is a length in mm" };
  if (!(Number.isInteger(count) && count >= 2)) return { why: "the count is 2 or more" };
  return {
    cmd: "addPattern",
    args: { template, along: s.along, pitch_mm: pitch, count },
  };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Distances between two measured points: along each axis and straight. */
export function measured(a: V3, b: V3): { d: number; dx: number; dy: number; dz: number } {
  const v = sub(b, a);
  return { d: len3(v), dx: v[0], dy: v[1], dz: v[2] };
}
