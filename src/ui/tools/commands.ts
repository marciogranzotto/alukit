import { len } from "#core/commands/numbers.ts";
import { nextIdNumber } from "#core/ids.ts";
import type { V3 } from "../../mesh/model.ts";
import type { PaletteItem } from "../palette.ts";
import {
  type ConnectPick,
  type ConnectType,
  type FaceOptions,
  type FrameDraft,
  type FrameOptions,
  faceOptions,
  JOIN_NONE,
  type PivotOptions,
  type PlaceStation,
} from "./state.ts";
import { typedNumber, typedValue, valueList } from "./typed.ts";

/**
 * What the connect, place and pattern tools send (design §8): each a batch of commands, or why
 * the picks make none. Pure: the tools' wiring and forms call them.
 */

/**
 * A face connection's fields from its options, or why they make none. `stationsElsewhere`: the
 * joint's stations are given another way the form does not show (a pattern's copies), so the form
 * need not give any.
 */
function faceFields(
  f: FaceOptions,
  opts: { stationsElsewhere?: boolean } = {},
): { fields: Record<string, unknown> } | { why: string } {
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
  if (at.length === 0 && !f.railHoles && !opts.stationsElsewhere) {
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

type O = Record<string, unknown>;

const isObject = (x: unknown): x is O => typeof x === "object" && x !== null && !Array.isArray(x);

/** A stack entry in words: an item, a count of one, or a sleeve cut from bar stock. */
function stackWords(e: unknown): string {
  if (typeof e === "string") return e;
  if (!isObject(e)) return String(e);
  if (typeof e.inside === "string") return `a ${String(e.item)} sleeve in ${e.inside}`;
  return typeof e.qty === "number" ? `${e.qty} × ${String(e.item)}` : String(e.item);
}

/** A rail-hole selection in words: `along r2, every 2, plus first, last, joint`. */
function railHolesWords(s: O): string {
  const plus = Array.isArray(s.plus) ? s.plus.map(String) : [];
  return [
    `along ${String(s.along)}`,
    ...(typeof s.every === "number" ? [`every ${s.every}`] : []),
    ...(plus.length > 0 ? [`plus ${plus.join(", ")}`] : []),
  ].join(", ");
}

/** A written list as the form types it, or undefined when a member holds a comma it would split. */
function listText(v: unknown): string | undefined {
  if (!Array.isArray(v)) return "";
  const parts = v.map(String);
  return parts.some((p) => p.includes(",")) ? undefined : parts.join(", ");
}

/**
 * The face form filled from a written face connection (the editing audit's E5.1, E-UX-14): the
 * options the Connect tool's form would need to write it, and the fields written in a form the
 * form cannot show (a sleeve in the stack, a rail-hole selection, a list member with a comma),
 * each in words, to be shown read only and kept as written.
 */
export function faceOptionsOf(c: O): {
  options: FaceOptions;
  fixed: Partial<Record<keyof FaceOptions, string>>;
} {
  const fixed: Partial<Record<keyof FaceOptions, string>> = {};
  const st = isObject(c.stations) ? c.stations : {};
  const fastener = c.fastener;
  const rod = isObject(fastener);
  const stack = Array.isArray(c.stack) ? c.stack : [];
  const stackText = stack.map(stackWords).join(", ");
  if (stack.some((e) => typeof e !== "string")) fixed.stack = stackText;
  const rail = st.rail_holes;
  if (isObject(rail)) fixed.railHoles = railHolesWords(rail);
  const list = (k: "at" | "across" | "gaps", v: unknown): string => {
    const t = listText(v);
    if (t !== undefined) return t;
    const words = (v as unknown[]).map(String).join("; ");
    fixed[k] = words;
    return words;
  };
  const fastening = typeof c.fastening === "string" ? c.fastening : "none";
  return {
    options: {
      fastening: (["none", "bolt", "tnut", "screw", "blind"].includes(fastening)
        ? fastening
        : "none") as FaceOptions["fastening"],
      fastener: rod ? String(fastener.bar) : typeof fastener === "string" ? fastener : "",
      rod,
      rodLen: rod && fastener.len_mm !== undefined ? String(fastener.len_mm) : "",
      stack: stackText,
      at: list("at", st.at_mm),
      across: list("across", st.across_mm),
      railHoles: rail !== undefined,
      gaps: list("gaps", c.gaps_mm),
      tapDepth: c.tap_depth_mm === undefined ? "" : String(c.tap_depth_mm),
    },
    fixed,
  };
}

/**
 * A JSON merge patch (RFC 7396) that takes `from` to `to`: each changed key, nested objects
 * patched in turn, and a key `to` drops written as null.
 */
function mergeDiff(from: O, to: O): O {
  const out: O = {};
  for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const a = from[k];
    const b = to[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (b === undefined) out[k] = null;
    else if (isObject(a) && isObject(b)) out[k] = mergeDiff(a, b);
    else out[k] = b;
  }
  return out;
}

/**
 * The one `setConnection` that edits a written face connection to the form's options (E-UX-14):
 * the difference between what the form wrote when filled from the joint and what it writes now,
 * as a merge patch, so a field the person did not touch, or one the form cannot show, stays as
 * written. `layers`, when given, are the joint's layers re-picked in Connect. `same` when nothing
 * changed.
 */
export function faceEditCommand(
  id: string,
  c: O,
  edited: FaceOptions,
  layers?: readonly string[],
): { cmd: "setConnection"; args: { id: string; set: O } } | { why: string } | { same: true } {
  const opts = {
    stationsElsewhere: isObject(c.stations) && typeof c.stations.pattern === "string",
  };
  const before = faceFields(faceOptionsOf(c).options, opts);
  const after = faceFields(edited, opts);
  if ("why" in after) return after;
  const set = mergeDiff("why" in before ? {} : before.fields, after.fields);
  const was = Array.isArray(c.bars) ? c.bars : [];
  const bars =
    layers && JSON.stringify([...layers]) !== JSON.stringify(was) ? { bars: [...layers] } : {};
  const patch = { ...bars, ...set };
  if (Object.keys(patch).length === 0) return { same: true };
  return { cmd: "setConnection", args: { id, set: patch } };
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

/**
 * The batch the place tool's station makes: at the station's own distance from end a, or at
 * `at` (a typed distance, a number or an expression) from end `from`.
 */
export function placeCommand(
  item: PaletteItem,
  st: PlaceStation,
  from: "a" | "b",
  roll: number,
  at: number | string = st.at_mm,
): { cmd: string; args: Record<string, unknown> } {
  return {
    cmd: "addPart",
    args: {
      item: item.id,
      ...(item.opt && Object.keys(item.opt).length > 0 ? { opt: item.opt } : {}),
      on: {
        bar: st.bar,
        at_mm: at,
        ...(from === "b" ? { from: "b" } : {}),
        ...(st.groove ? { groove: st.groove } : st.face ? { face: st.face } : {}),
      },
      ...(roll !== 0 ? { roll_deg: roll } : {}),
    },
  };
}

/**
 * The batch the pattern tool makes, or why it makes none. The pitch is typed as every other
 * length is (D-UX-17; the editing audit's D5): units and expressions over the project's
 * `params`, written as the number it comes to when it reads no param and as typed when it does,
 * so the param keeps driving it.
 */
export function patternCommand(
  s: {
    template: readonly string[];
    along?: string | undefined;
    pitch: string;
    count: string;
  },
  params: Readonly<Record<string, number>> = {},
): { cmd: string; args: Record<string, unknown> } | { why: string } {
  const template = s.template.filter((id) => !id.includes("@"));
  if (template.length === 0) return { why: "select the entities to repeat" };
  const r = patternRepeat(s, params);
  if ("why" in r) return r;
  return { cmd: "addPattern", args: { template, ...r } };
}

/** How a pattern repeats, whatever it repeats: along a bar or run, a pitch and a count. */
export interface Repeat {
  along: string;
  pitch_mm: number | string;
  count: number;
}

/** The Pattern form's along, pitch and count as a pattern takes them, or why not. */
export function patternRepeat(
  s: { along?: string | undefined; pitch: string; count: string },
  params: Readonly<Record<string, number>> = {},
): Repeat | { why: string } {
  if (!s.along) return { why: "pick the bar or run to repeat along" };
  const pitch = typedNumber(s.pitch, params);
  if ("why" in pitch) return { why: `the pitch: ${pitch.why}` };
  if (pitch.value === 0) return { why: "the pitch is a length in mm, not 0" };
  const count = Number(s.count);
  if (!(Number.isInteger(count) && count >= 2)) return { why: "the count is 2 or more" };
  return { along: s.along, pitch_mm: pitch.written, count };
}

/**
 * The draw step with its pattern (Pattern's "Draw the bar to repeat",
 * docs/ux/polish-editing-ui-decisions.md 4): the bar and its joins as the draw tool sends them,
 * then `addPattern` of that bar, one step. The bar's id is the one the document gives next
 * (`nextIdNumber`), as a pivot's batch predicts its connection's; the batch is sent strict.
 */
export function repeatBatch(
  drawn: readonly { cmd: string; args?: unknown }[],
  doc: Readonly<Record<string, unknown>>,
  repeat: Repeat,
): { cmd: string; args?: unknown }[] {
  const ids = (doc.ids ?? {}) as Record<string, unknown>;
  const bars = doc.bars;
  const existing =
    typeof bars === "object" && bars !== null ? Object.keys(bars as object) : ([] as string[]);
  const id = `b${nextIdNumber(ids.b, existing, "b")}`;
  return [...drawn, { cmd: "addPattern", args: { template: [id], ...repeat } }];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Distances between two measured points: along each axis and straight. */
export function measured(a: V3, b: V3): { d: number; dx: number; dy: number; dz: number } {
  const v = sub(b, a);
  return { d: len3(v), dx: v[0], dy: v[1], dz: v[2] };
}

/**
 * Whether a connection of `type` takes `pick` beside the picks it has, and why not (S5.9, U38):
 * the tool says so by the pointer and leaves the pick out, instead of accepting it and
 * explaining after Apply. A pick already made is always taken: a second click drops it.
 */
export function pickRefusal(
  type: ConnectType,
  picks: readonly ConnectPick[],
  pick: ConnectPick,
): string | undefined {
  if (picks.some((p) => p.ref === pick.ref)) return undefined;
  const bars = picks.filter((p) => p.kind === "bar").length;
  const ends = picks.filter((p) => p.kind === "end").length;
  switch (type) {
    case "butt":
      if (pick.kind === "bar" && bars >= 1)
        return "a butt has one through bar: drop the other first";
      if (pick.kind === "part" || pick.kind === "run") return "a butt joins bars and their ends";
      return undefined;
    case "miter":
    case "splice":
      if (pick.kind !== "end") return `a ${type} joins two ends: click near an end`;
      if (ends >= 2) return `a ${type} joins two ends: drop one first`;
      return undefined;
    case "pivot":
      if (pick.kind !== "end") return "a pivot carries ends: click near each end it carries";
      return undefined;
    case "face":
      if (pick.kind === "end")
        return "a face connection takes layers: click along a bar's middle, or a plate";
      return undefined;
  }
}

/**
 * Where a typed distance puts a part on a station's bar (D-UX-16): from the end nearer the
 * station under the pointer, so the number reads as "this far from the end I am near".
 */
export function placeFrom(st: PlaceStation, barLen: number): "a" | "b" {
  return st.at_mm > barLen / 2 ? "b" : "a";
}

/** What the box frame needs to know of the project: its default bar and default butt connector. */
export interface FrameProject {
  hasDefaultBar: boolean;
  /** `defaults.butt.connector`, which every butt that names none takes. */
  defaultButt?: string | undefined;
}

/** Connectors per butting end, as typed: empty for one. */
function perEnd(text: string): { value: number } | { why: string } {
  const t = text.trim();
  if (t === "") return { value: 1 };
  const n = Number(t);
  return Number.isInteger(n) && n >= 1
    ? { value: n }
    : { why: "connectors per end: a whole number, 1 or more" };
}

/** Why a frame is not made while its corners' joint is still to be chosen. */
export const JOINT_UNCHOSEN = "choose how the corners are joined";

/**
 * The connector the box frame offers as one click beside its full list
 * (docs/ux/polish-editing-ui-decisions.md 3): among those that fit the frame's bar, a bracket (a
 * corner held from outside, no machining asked), the one that fits the most systems, the
 * catalog's order between equals. It ranks connectors as review M8 ranks profiles: what is made
 * for the most of the catalog is the common piece. Offered, never chosen: the corners' joint is
 * still the person's choice (review B1). Undefined when no bracket fits.
 */
export function suggestedJoint<E extends { family: string; fits?: readonly string[] }>(
  fit: readonly E[],
): E | undefined {
  let best: E | undefined;
  for (const e of fit) {
    if (e.family !== "bracket") continue;
    if (!best || (e.fits?.length ?? 0) > (best.fits?.length ?? 0)) best = e;
  }
  return best;
}

/**
 * The box frame's `addFrame` (BE-6) from the draft and the options, or why it makes none. The
 * size takes expressions with params, as typed, and is sent as the numbers they come to
 * (`addFrame` takes numbers; with `params` it writes W, D and H itself). The bars are the
 * palette's bar, else the project's `defaults.bar` (left out, so `addFrame` reads it).
 *
 * How the corners are joined is asked, never left to chance (docs/ux/review-phase4.md B1): a
 * connector, or "nothing", said in so many words. With no project default yet, the connector
 * chosen becomes it (`frameBatch`); one other than the project's default is the frame's own.
 */
export function frameCommand(
  d: FrameDraft,
  o: FrameOptions,
  bar: PaletteItem | undefined,
  project: FrameProject,
  params: Readonly<Record<string, number>>,
): { cmd: "addFrame"; args: Record<string, unknown> } | { why: string } {
  if (!bar && !project.hasDefaultBar) return { why: "pick the frame's profile first" };
  if (!d.at) return { why: "click the frame's corner, or type [x, y, z]" };
  const size: number[] = [];
  for (const [name, text] of [
    ["the width W", d.w],
    ["the depth D", d.d],
    ["the height H", d.h],
  ] as const) {
    if (text.trim() === "") return { why: `give ${name}` };
    const n = typedNumber(text, params);
    if ("why" in n) return { why: `${name}: ${n.why}` };
    if (!(n.value > 0)) return { why: `${name} is more than 0` };
    size.push(n.value);
  }
  if (!o.rings.base && !o.rings.top) return { why: "keep the base ring, the top ring or both" };
  let shelf: number | undefined;
  if (o.shelf.trim() !== "") {
    const n = typedNumber(o.shelf, params);
    if ("why" in n) return { why: `the shelf: ${n.why}` };
    shelf = n.value;
  }
  const rings = [...(o.rings.base ? ["base"] : []), ...(o.rings.top ? ["top"] : [])];
  if (o.joint === "" && project.defaultButt === undefined) return { why: JOINT_UNCHOSEN };
  const qty = perEnd(o.qty);
  if ("why" in qty) return qty;
  // The frame's own connector: one other than the project's default, which exists.
  const own =
    o.joint !== "" &&
    o.joint !== JOIN_NONE &&
    project.defaultButt !== undefined &&
    o.joint !== project.defaultButt;
  return {
    cmd: "addFrame",
    args: {
      at: d.at.map((c) => len(c)),
      size,
      ...(bar ? { item: bar.id } : {}),
      ...(bar?.opt && Object.keys(bar.opt).length > 0 ? { opt: bar.opt } : {}),
      ...(o.corner ? { corner: o.corner } : {}),
      ...(rings.length < 2 ? { rings } : {}),
      ...(shelf !== undefined ? { shelf_mm: shelf } : {}),
      ...(own ? { connector: o.joint, ...(qty.value > 1 ? { qty: qty.value } : {}) } : {}),
      ...(o.params ? { params: true } : {}),
    },
  };
}

/**
 * The box frame's one step (review B1): its `addFrame`, after the project's defaults it sets in
 * the same batch, so Undo takes them back together; `addFrame` is last.
 *
 * - The default butt connector, when the project has none and a connector was chosen: the
 *   frame's butts and every bar drawn later join with it.
 * - The default bar, when the start card's profile is given (`defaultBar`, a merge patch of
 *   `defaults.bar`; review M1): the frame's bars take it, as the bars drawn later do.
 */
export function frameBatch(
  d: FrameDraft,
  o: FrameOptions,
  bar: PaletteItem | undefined,
  project: FrameProject,
  params: Readonly<Record<string, number>>,
  defaultBar?: Record<string, unknown>,
): { commands: { cmd: string; args: Record<string, unknown> }[] } | { why: string } {
  const c = defaultBar
    ? frameCommand(d, o, undefined, { ...project, hasDefaultBar: true }, params)
    : frameCommand(d, o, bar, project, params);
  if ("why" in c) return c;
  const qty = perEnd(o.qty);
  const defaults: Record<string, unknown> = defaultBar ? { bar: defaultBar } : {};
  if (o.joint !== "" && o.joint !== JOIN_NONE && project.defaultButt === undefined) {
    defaults.butt = {
      connector: o.joint,
      ...(!("why" in qty) && qty.value > 1 ? { qty: qty.value } : {}),
    };
  }
  return Object.keys(defaults).length === 0
    ? { commands: [c] }
    : { commands: [{ cmd: "setProject", args: { defaults } }, c] };
}

/**
 * What the frame form asks the dry run, and whether the joint is still to be chosen (review N4).
 * The cut lengths come from the size, not the joint, so they are shown as soon as W, D and H are
 * known: while the joint is the only thing missing, the batch is asked as if it were "Nothing",
 * and `pending` says the real one is not made until a joint is chosen. Anything else missing is
 * what `frameBatch` says.
 */
export function frameSizing(
  d: FrameDraft,
  o: FrameOptions,
  bar: PaletteItem | undefined,
  project: FrameProject,
  params: Readonly<Record<string, number>>,
  defaultBar?: Record<string, unknown>,
): { batch: ReturnType<typeof frameBatch>; pending: boolean } {
  const real = frameBatch(d, o, bar, project, params, defaultBar);
  if ("why" in real && real.why === JOINT_UNCHOSEN) {
    const sized = frameBatch(d, { ...o, joint: JOIN_NONE }, bar, project, params, defaultBar);
    if (!("why" in sized)) return { batch: sized, pending: true };
  }
  return { batch: real, pending: false };
}
