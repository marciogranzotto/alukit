import type { Diagnostic } from "#core/diagnostics.ts";
import type { ProblemsAnswer } from "#core/problems/types.ts";
import type { Model } from "../model.ts";

/**
 * A bar's joints and its ends' state as the core judges them (docs/ux/review-editing.md M7, m12;
 * docs/ux/review-fixes-app-decisions.md). Pure.
 *
 * - **Open** is the check's word, not the inspector's: an end is open when the check's
 *   `unconnected` diagnostic counts it among the loose ends where it meets others (design §5.5),
 *   so an end nothing meets (a plate's, a cantilever's) is not called open, and the words follow
 *   the check wherever its rule goes.
 * - **Join** is offered where the problem list offers "Join with the default butt" for that
 *   corner, the fix `autoConnect` accepts by the one join rule (e1 1, 9); elsewhere the problem's
 *   own reason is said instead.
 * - **A bar's joints** are the connections that name it as the document writes them: by an end,
 *   as the bar a butt bears on, as a face joint's layer, in a butt's stack, as a pivot's base. A
 *   face joint holds the bar's body, not its ends, so its ends say "held by c36 (face joint)".
 *
 * Owner: the review fixes (app); `endWords` (words.ts) reads it.
 */

type O = Record<string, unknown>;
const isObject = (x: unknown): x is O => typeof x === "object" && x !== null && !Array.isArray(x);
const barOf = (ref: string) => ref.split(".")[0] as string;

/** The butts' seats as derive gives them (`alukit.derived/1`): each end and what it bears on. */
function seats(m: Model): Record<string, { ends: { end: string; on: string }[] }> {
  return (
    (m.derived as { butts?: Record<string, { ends: { end: string; on: string }[] }> }).butts ?? {}
  );
}

/**
 * The check's open corner at an end: its `unconnected` diagnostic, when it counts the end loose.
 * The diagnostic's refs are every end at the point; an end there that is claimed, or whose bar is
 * the one a butt at the point bears on, is not loose (check.ts's `unconnectedEnds`).
 */
export function openCorner(m: Model, ref: string): Diagnostic | undefined {
  if ((m.claims[ref] ?? []).length > 0) return undefined;
  const bar = barOf(ref);
  for (const d of m.check.diagnostics) {
    if (d.code !== "unconnected") continue;
    const here = d.refs ?? (d.entity ? [d.entity] : []);
    if (!here.includes(ref)) continue;
    const bearsOn = Object.values(seats(m)).some((b) =>
      b.ends.some((e) => here.includes(e.end) && barOf(e.on.split(" ")[0] as string) === bar),
    );
    return bearsOn ? undefined : d;
  }
  return undefined;
}

/**
 * Whether Join would join an end: the problem list's verdict on its corner. `undefined` while the
 * problems of this revision have not come (they are asked for each revision drawn).
 */
export function joinVerdict(
  m: Model,
  ref: string,
  problems: ProblemsAnswer | undefined,
): { ok: true } | { ok: false; why: string } | undefined {
  if (!openCorner(m, ref)) return { ok: false, why: "it meets no other end there" };
  if (!problems || problems.rev !== m.rev) return undefined;
  const p = problems.problems.find((x) => x.code === "unconnected" && x.targets.includes(ref));
  if (!p) return undefined;
  const join = p.fixes.some(
    (f) => f.kind === "commands" && f.commands.some((c) => c.cmd === "autoConnect"),
  );
  return join ? { ok: true } : { ok: false, why: p.detail };
}

/** How a bar takes part in a joint. */
export type JointRole = "end" | "through" | "layer" | "stack" | "base";

export interface BarJoint {
  /** The connection's id. */
  id: string;
  /** Its type as written: butt, miter, splice, pivot, face. */
  type: string;
  label?: string;
  /** How the bar takes part in it, each way it does. */
  roles: JointRole[];
  /** The bar's ends it claims. */
  ends: ("a" | "b")[];
  /** The other bars it joins this one to: their ends', a face joint's layers, a hinge's base. */
  others: string[];
  /** A butt's through bar, when it is another bar: what this bar's end bears on. */
  on?: string;
  /** A face joint's fastening stations, as derived. */
  stations?: number;
}

/** The bars a face joint's layer names: a bar, or a run's bars. */
function layerBars(m: Model, layer: unknown): string[] {
  if (typeof layer !== "string") return [];
  if (/^r\d+$/.test(layer)) return m.derived.runs[layer]?.bars ?? [];
  return [layer];
}

/** Every connection that names a bar, in id order, with how it does. */
export function barJoints(m: Model, bar: string): BarJoint[] {
  const all = isObject(m.doc.connections) ? m.doc.connections : {};
  const out: BarJoint[] = [];
  for (const [id, c] of Object.entries(all)) {
    if (!isObject(c)) continue;
    const roles = new Set<JointRole>();
    const ends = new Set<"a" | "b">();
    const others = new Set<string>();
    const endRefs = Array.isArray(c.ends)
      ? c.ends.filter((x): x is string => typeof x === "string")
      : [];
    for (const e of endRefs) {
      if (barOf(e) === bar) {
        roles.add("end");
        ends.add(e.endsWith(".b") ? "b" : "a");
      } else others.add(barOf(e));
    }
    let on: string | undefined;
    if (typeof c.through === "string") {
      if (barOf(c.through) === bar) roles.add("through");
      else on = barOf(c.through);
    }
    if (Array.isArray(c.stack) && c.stack.includes(bar)) roles.add("stack");
    if (isObject(c.base) && c.base.bar === bar) roles.add("base");
    else if (isObject(c.base) && typeof c.base.bar === "string") others.add(c.base.bar);
    if (c.type === "face" && Array.isArray(c.bars)) {
      const layers = c.bars.map((x) => layerBars(m, x));
      if (layers.some((l) => l.includes(bar))) {
        roles.add("layer");
        for (const l of layers) for (const b of l) if (b !== bar) others.add(b);
      }
    }
    if (roles.size === 0) continue;
    const stations = m.derived.fastenings[id]?.stations.length;
    out.push({
      id,
      type: typeof c.type === "string" ? c.type : "connection",
      ...(typeof c.label === "string" ? { label: c.label } : {}),
      roles: [...roles],
      ends: [...ends].sort(),
      others: [...others].filter((x) => x !== bar),
      ...(on !== undefined && roles.has("end") ? { on } : {}),
      ...(c.type === "face" && stations !== undefined ? { stations } : {}),
    });
  }
  return out;
}

/** A joint's kind as a person says it. */
export const JOINT_NOUN: Readonly<Record<string, string>> = {
  butt: "butt",
  miter: "mitre",
  splice: "splice",
  pivot: "hinge",
  face: "face joint",
};

/**
 * The joints that hold a bar by its body rather than by an end: a face joint's layer, a butt's
 * stack. A hinge's base is not one: the bar carries the hinge, the hinge does not hold the bar.
 */
export function holdingJoints(joints: readonly BarJoint[]): BarJoint[] {
  return joints.filter(
    (j) => j.ends.length === 0 && j.roles.some((r) => r === "layer" || r === "stack"),
  );
}

/**
 * One joint of a bar in words, from the bar's side: "face joint c36 (T-nut plate): with b35,
 * 2 stations", "butt c1: end b on b1", "butt c2: b3 butts on it", "mitre c5: end a with b6".
 */
export function jointLine(j: BarJoint): string {
  const name = `${JOINT_NOUN[j.type] ?? j.type} ${j.id}${j.label ? ` (${j.label})` : ""}`;
  const others = j.others.join(", ");
  const parts: string[] = [];
  if (j.roles.includes("end")) {
    const ends = `end${j.ends.length > 1 ? "s" : ""} ${j.ends.join(" and ")}`;
    parts.push(j.on ? `${ends} on ${j.on}` : others ? `${ends} with ${others}` : ends);
  } else if (j.roles.includes("through")) {
    parts.push(`${others || "an end"} ${j.others.length > 1 ? "butt" : "butts"} on it`);
  } else if (j.roles.includes("base")) {
    parts.push(others ? `its base, hinging ${others}` : "its base");
  } else if (j.roles.includes("stack")) {
    parts.push(others ? `in its stack, with ${others}` : "in its stack");
  } else if (others) {
    parts.push(`with ${others}`);
  }
  if (j.stations !== undefined) parts.push(`${j.stations} station${j.stations === 1 ? "" : "s"}`);
  return parts.length > 0 ? `${name}: ${parts.join(", ")}` : name;
}
