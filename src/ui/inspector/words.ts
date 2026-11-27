import type { V3 } from "../../mesh/model.ts";
import { mm } from "../format.ts";
import type { Model } from "../model.ts";

/**
 * The inspector's words (docs/ux/plan.md S5.3, U12, U18, U19): what a ref in the selection is,
 * what an entity is called, what claims a bar's end, and which way a bar runs, so the inspector
 * reads as words rather than as the document's JSON. Pure. Owner: S5.
 */

type O = Record<string, unknown>;

export const isObject = (x: unknown): x is O =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** What a ref in the selection stands for. */
export type RefKind =
  | "bar"
  | "part"
  | "connection"
  | "node"
  | "run"
  | "pattern"
  | "copy"
  | "end"
  | "corner"
  | "item"
  | "open-item"
  | "supplier"
  | "record"
  | "unknown";

/** The document map each entity prefix lives in (§2). */
const MAP_OF: Readonly<Record<string, string>> = {
  b: "bars",
  p: "parts",
  c: "connections",
  n: "nodes",
  r: "runs",
  pt: "patterns",
};

const KIND_OF_MAP: Readonly<Record<string, RefKind>> = {
  bars: "bar",
  parts: "part",
  connections: "connection",
  nodes: "node",
  runs: "run",
  patterns: "pattern",
};

/** The document map an entity id lives in, by its prefix (`b7` → `bars`), or undefined. */
export function mapOf(id: string): string | undefined {
  const m = /^([a-z]+)\d+$/.exec(id);
  return m ? MAP_OF[m[1] as string] : undefined;
}

/** An entity as the document writes it, or undefined. */
export function written(m: Model, id: string): unknown {
  const map = mapOf(id);
  if (map === undefined) return undefined;
  const all = m.doc[map];
  return isObject(all) ? all[id] : undefined;
}

/**
 * What a ref is (U12): an id with `@` is a pattern copy, and only that; an item ref
 * (`forseti:PF40-01`, `test:TS40`, `project:plate-a`) is an item; a corner, an end, an open item,
 * a supplier or a record is said as such; an entity id is its kind when the document or the
 * derived model holds it, else unknown.
 */
export function refKind(m: Model, ref: string): RefKind {
  if (ref.startsWith("corner:")) return "corner";
  if (ref.startsWith("supplier:")) return "supplier";
  if (ref.includes("@")) return "copy";
  if (/^b\d+\.[ab]$/.test(ref)) return "end";
  if (/^[a-z][a-z0-9-]*:/.test(ref)) return "item";
  if (/^O\d+$/.test(ref)) return "open-item";
  if (/^[KCD]\d+$/.test(ref)) return "record";
  const map = mapOf(ref);
  if (map === undefined) return "unknown";
  if (written(m, ref) !== undefined) return KIND_OF_MAP[map] ?? "unknown";
  if (map === "bars" && m.derived.bars[ref]) return "bar";
  if (map === "parts" && m.derived.parts[ref]) return "part";
  return "unknown";
}

/** The kind's noun, as a sentence names it. */
export const NOUN: Readonly<Record<RefKind, string>> = {
  bar: "bar",
  part: "part",
  connection: "connection",
  node: "point",
  run: "run",
  pattern: "pattern",
  copy: "pattern copy",
  end: "bar end",
  corner: "corner",
  item: "item",
  "open-item": "open item",
  supplier: "supplier",
  record: "record",
  unknown: "entity",
};

/** A copy's template id and copy number: `b26@3` → `b26`, 3. */
export function copyOf(id: string): { template: string; k: number } | undefined {
  const m = /^(.+)@(\d+)$/.exec(id);
  return m ? { template: m[1] as string, k: Number(m[2]) } : undefined;
}

/** The pattern that makes a copy: the derived model says for bars and parts, the templates else. */
export function patternOf(m: Model, id: string): string | undefined {
  const c = copyOf(id);
  if (!c) return undefined;
  const fromDerived = m.derived.bars[id]?.pattern ?? m.derived.parts[id]?.pattern;
  if (fromDerived) return fromDerived;
  const patterns = isObject(m.doc.patterns) ? m.doc.patterns : {};
  for (const [pid, p] of Object.entries(patterns)) {
    if (isObject(p) && Array.isArray(p.template) && p.template.includes(c.template)) return pid;
  }
  return undefined;
}

/** An entity's label as written, when it has one. */
export function labelOf(m: Model, id: string): string | undefined {
  const w = written(m, copyOf(id)?.template ?? id);
  return isObject(w) && typeof w.label === "string" ? w.label : undefined;
}

/** A connection's type, from the document (a copy's from its template's). */
export function connectionType(m: Model, id: string): string | undefined {
  const w = written(m, copyOf(id)?.template ?? id);
  return isObject(w) && typeof w.type === "string" ? w.type : undefined;
}

/** A bar's unit direction, a to b, from its design points. */
export function barDir(m: Model, id: string): V3 | undefined {
  const b = m.derived.bars[id];
  if (!b) return undefined;
  const d: V3 = [b.b[0] - b.a[0], b.b[1] - b.a[1], b.b[2] - b.a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len === 0) return undefined;
  return [d[0] / len, d[1] / len, d[2] / len];
}

/** The world axis a direction runs along, either way, when it runs along one. */
export function axisOf(d: V3 | undefined): "x" | "y" | "z" | undefined {
  if (!d) return undefined;
  const near = (i: number) => Math.hypot(...d.filter((_, j) => j !== i)) < 1e-6;
  return near(0) ? "x" : near(1) ? "y" : near(2) ? "z" : undefined;
}

/** What a bar is by the way it runs: a post stands, a rail lies along X or Y, any other a bar. */
export function barRole(m: Model, id: string): "post" | "rail along X" | "rail along Y" | "bar" {
  const a = axisOf(barDir(m, id));
  return a === "z" ? "post" : a === "x" ? "rail along X" : a === "y" ? "rail along Y" : "bar";
}

/** An entity in words: `bar b7 (top rail, left)`, `butt c1`, `pattern copy b26@2`. */
export function entityName(m: Model, id: string): string {
  const kind = refKind(m, id);
  const noun = kind === "connection" ? (connectionType(m, id) ?? "connection") : NOUN[kind];
  const label = labelOf(m, id);
  return `${noun} ${id}${label ? ` (${label})` : ""}`;
}

/** A point as the inspector writes it: `(0, 600, 900)`, each coordinate to 0.01 mm. */
export function pointWords(p: readonly number[]): string {
  return `(${p.map((x) => mm(x).replace(/\.00$/, "")).join(", ")})`;
}

/** A written coordinate list, expressions kept: `(0, 0, H)`. */
export function writtenPoint(v: readonly unknown[]): string {
  return `(${v.map((x) => String(x)).join(", ")})`;
}

/** The derived butts (`alukit.derived/1`), which the view model carries beyond `Model`'s types. */
export interface DerivedButt {
  ends: { end: string; on: string }[];
}

export function buttsOf(m: Model): Record<string, DerivedButt> {
  const b = (m.derived as { butts?: Record<string, DerivedButt> }).butts;
  return b ?? {};
}

/** A sentence with the entities it names, for chips beside it. */
export interface Words {
  text: string;
  refs: string[];
}

/** A bar end or a bar as a sentence names it: `b7.b` is "b7's end b", `b7` is "b7". */
function placeWords(x: string): string {
  const [bar, e] = x.split(".") as [string, string | undefined];
  return e ? `${bar}'s end ${e}` : bar;
}

/** A ref with its pattern copy's number dropped, as a template writes it: `b26@2.a` → `b26.a`. */
const bare = (ref: string) => ref.replace(/@\d+/, "");

/**
 * A plane an end is written with (`ends.<e>.plane`, §4.5), in words: stopped at a face, flush with
 * another end, or a plane of its own.
 */
export function planeWords(plane: unknown): Words {
  if (isObject(plane) && isObject(plane.face) && typeof plane.face.bar === "string") {
    const bar = plane.face.bar;
    return { text: `stops at ${bar}'s face ${String(plane.face.face)}`, refs: [bar] };
  }
  if (isObject(plane) && typeof plane.of === "string") {
    return { text: `flush with ${placeWords(plane.of)}`, refs: [plane.of.split(".")[0] as string] };
  }
  return { text: "cut on a plane of its own", refs: [] };
}

/**
 * What one claim on an end says (derive's claims, `Model.claims`): a connection and what it joins
 * the end to, the end's own plane, or a free end counted from end a's cut. A butt names the bar it
 * bears on, the words the end handles use ("butts on b5 (c1)"); the through bar's own end at a
 * corner names the ends that bear on it.
 */
function claimWords(m: Model, ref: string, name: string): Words {
  const [bar, e] = ref.split(".") as [string, "a" | "b"];
  if (name.endsWith(".plane")) {
    const w = written(m, copyOf(bar)?.template ?? bar);
    const ends = isObject(w) && isObject(w.ends) ? w.ends : {};
    return planeWords(isObject(ends[e]) ? ends[e].plane : undefined);
  }
  if (name.includes("free end")) return { text: "free, counted from end a's cut", refs: [] };
  const w = written(m, copyOf(name)?.template ?? name);
  const type = isObject(w) && typeof w.type === "string" ? w.type : undefined;
  const ends =
    isObject(w) && Array.isArray(w.ends)
      ? (w.ends as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  if (type === "butt" && isObject(w)) {
    if (ends.includes(bare(ref))) {
      // Where the end bears, as derive seats it (a copy's own through bar), else as written.
      const seat = buttsOf(m)[name]?.ends.find((x) => x.end === ref);
      const on = seat ? (seat.on.split(" ")[0] as string) : w.through;
      if (typeof on !== "string") return { text: `butts on a body (${name})`, refs: [name] };
      return {
        text: `butts on ${placeWords(on)} (${name})`,
        refs: [name, on.split(".")[0] as string],
      };
    }
    // The through bar's own end at a corner: the butting ends bear on it.
    return {
      text: `${listWords(ends)} ${ends.length === 1 ? "butts" : "butt"} on it (${name})`,
      refs: [name, ...ends.map((x) => x.split(".")[0] as string)],
    };
  }
  const others = ends.filter((x) => x !== bare(ref));
  const verb =
    type === "miter"
      ? "mitred with"
      : type === "splice"
        ? "spliced to"
        : type === "pivot"
          ? "hinged"
          : "joined";
  return {
    text: `${verb}${others.length > 0 ? ` ${others.join(", ")}` : ""} (${name})`,
    refs: [name, ...others.map((x) => x.split(".")[0] as string)],
  };
}

/**
 * What claims a bar's end, in words, then its cut and how far the claim moved it: `b7.a` "butts on
 * b5 (c1), square, shorter by 20.00 mm". The claims are derive's (`Model.claims`), the rule
 * `autoConnect` applies, so an end a joint claims is never called open: when the joint fails (an
 * angled end that declares no cut, two joints on one end, a miter of two sections), its plane falls
 * back to the default, and the words still name the joint, then say it fails (D2). An end no
 * provider claims is open, unless a butt bears on it as on a bar's end.
 */
export function endWords(m: Model, bar: string, e: "a" | "b"): Words & { open: boolean } {
  const d = m.derived.bars[bar];
  if (!d) return { text: "does not derive", refs: [], open: false };
  const end = d.ends[e];
  const ref = `${bar}.${e}`;
  const how = [
    end.angle_deg === 0 ? "square" : `cut at ${mm(end.angle_deg).replace(/\.00$/, "")}°`,
    ...(end.move_mm !== 0
      ? [`${end.move_mm > 0 ? "longer" : "shorter"} by ${mm(Math.abs(end.move_mm))} mm`]
      : []),
  ].join(", ");
  const claims = m.claims?.[ref] ?? [];
  const by = end.by;
  if (by === "free") return { text: `free, ${how}`, refs: [], open: false };
  if (by !== "default") {
    // The claim that resolved: a connection, or the end's own plane.
    const name = by === "plane" ? claims.find((c) => c.endsWith(".plane")) : by;
    const w = name ? claimWords(m, ref, name) : planeWords(undefined);
    return { text: `${w.text}, ${how}`, refs: w.refs, open: false };
  }
  if (claims.length > 0) {
    const ws = claims.map((c) => claimWords(m, ref, c));
    const fails =
      claims.length === 1
        ? "the joint fails"
        : `${claims.length === 2 ? "two" : claims.length} joints claim it`;
    return {
      text: `${listWords(ws.map((w) => w.text))}; ${fails}, so it is ${how}`,
      refs: [...new Set(ws.flatMap((w) => w.refs))],
      open: false,
    };
  }
  // The end a butt bears on as on a bar's end (`through: "b7.b"`): it runs on, and it is joined.
  for (const [cid, butt] of Object.entries(buttsOf(m))) {
    const on = butt.ends.filter((x) => x.on.split(" ")[0] === ref).map((x) => x.end);
    if (on.length > 0) {
      return {
        text: `${listWords(on)} ${on.length === 1 ? "bears" : "bear"} on it (${cid}), ${how}`,
        refs: [cid],
        open: false,
      };
    }
  }
  return { text: `open: nothing joins it, ${how}`, refs: [], open: true };
}

/** A list in words: `a`, `a and b`, `a, b and c`. */
export function listWords(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/**
 * A written value in words, never as JSON: a number or a string as it is, a list of plain
 * values as `(a, b, c)`, an object as `key value; key value`.
 */
export function valueWords(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== "object" || x === null)) return `(${v.join(", ")})`;
    return v.map(valueWords).join("; ");
  }
  if (isObject(v)) {
    return Object.entries(v)
      .map(([k, x]) => `${k.replace(/_/g, " ")} ${valueWords(x)}`)
      .join("; ");
  }
  return String(v);
}
