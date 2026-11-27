import type { Command, RawDoc } from "../commands/types.ts";
import { compareIds } from "../ids.ts";
import type { CornerRule } from "../project/schema.ts";
import type { V3 } from "../vec.ts";

/**
 * The batch that arranges corners by a corner rule (D-UX-9, docs/ux/plan.md S5.5): take the
 * corners' butts out, then one `autoConnect {at, prefer: rule}` at each, keeping each corner's
 * connector. Or join each corner's two ends by a miter or a splice instead (E1.4,
 * `jointBatch`). Taking out removes the corner's joint whatever it is: its butts (or their ends
 * there) and a miter or splice of its ends, so any arrangement can follow any other. The server dry-runs it for every rule at once (`arrange`, arrange.ts) and the corner
 * inspector applies it, both from these functions, so what was shown is what is built. Pure, and
 * light: it reads the document as written and imports no schema, so the app's chunk for the
 * corner inspector carries no Zod.
 */

/** The corner rules, in the order they are tried and listed (the schema's `CornerRule`). */
export const CORNER_RULES = [
  "vertical",
  "x",
  "y",
  "first",
] as const satisfies readonly CornerRule[];

/** The joints of two ends a corner may take instead of the default butt (E1.4). */
export const JOINT_KINDS = ["miter", "splice"] as const;

export type JointKind = (typeof JOINT_KINDS)[number];

/** A corner as the batches read it: its point and the bar ends that meet there. */
export interface CornerSpec {
  at: V3;
  ends: readonly string[];
}

type O = Record<string, unknown>;

const isObject = (x: unknown): x is O => typeof x === "object" && x !== null && !Array.isArray(x);

/** The written connections, by id. */
function connections(doc: RawDoc): Record<string, O> {
  const c = doc.connections;
  return (isObject(c) ? c : {}) as Record<string, O>;
}

/** A written connection's ends. */
function endsOf(c: O): string[] {
  return Array.isArray(c.ends) ? c.ends.filter((x): x is string => typeof x === "string") : [];
}

/** The written butts that claim one of these ends, in id order. */
export function buttsAt(doc: RawDoc, ends: readonly string[]): string[] {
  const here = new Set(ends);
  return Object.entries(connections(doc))
    .filter(([, c]) => c.type === "butt" && endsOf(c).some((e) => here.has(e)))
    .map(([id]) => id)
    .sort(compareIds);
}

/** The written miters and splices that join one of these ends, in id order (E1.4). */
export function jointsAt(doc: RawDoc, ends: readonly string[]): string[] {
  const here = new Set(ends);
  return Object.entries(connections(doc))
    .filter(
      ([, c]) =>
        (JOINT_KINDS as readonly unknown[]).includes(c.type) && endsOf(c).some((e) => here.has(e)),
    )
    .map(([id]) => id)
    .sort(compareIds);
}

/**
 * The commands that take the corners' joints out: a butt whose ends are all at these corners is
 * removed; one that also has ends elsewhere loses only these corners' ends (`setConnection`). A
 * miter or splice of a corner's ends goes whole: its two ends meet there (E1.4).
 */
export function takeOut(doc: RawDoc, corners: readonly CornerSpec[]): Command[] {
  const drop = new Map<string, Set<string>>();
  for (const corner of corners) {
    for (const id of [...buttsAt(doc, corner.ends), ...jointsAt(doc, corner.ends)]) {
      const set = drop.get(id) ?? new Set<string>();
      for (const e of corner.ends) set.add(e);
      drop.set(id, set);
    }
  }
  const written = connections(doc);
  const out: Command[] = [];
  for (const id of [...drop.keys()].sort(compareIds)) {
    const gone = drop.get(id) as Set<string>;
    const c = written[id] as O;
    const kept = c.type === "butt" ? endsOf(c).filter((e) => !gone.has(e)) : [];
    out.push(
      kept.length === 0
        ? { cmd: "removeEntity", args: { id } }
        : { cmd: "setConnection", args: { id, set: { ends: kept } } },
    );
  }
  return out;
}

/** The connector (and its quantity) of the corner's first butt that names one: kept on Apply. */
export function keptConnector(
  doc: RawDoc,
  corner: CornerSpec,
): { connector?: string; qty?: number } {
  const written = connections(doc);
  for (const id of buttsAt(doc, corner.ends)) {
    const c = written[id] as O;
    if (typeof c.connector === "string") {
      return { connector: c.connector, ...(typeof c.qty === "number" ? { qty: c.qty } : {}) };
    }
  }
  return {};
}

/**
 * The fields a connection taken out whole carries that `autoConnect` does not write again: a
 * butt's beyond its through bar, ends and connector, which the corner keeps; all of a miter's or
 * splice's but its type and ends.
 */
export function lostFields(
  doc: RawDoc,
  corners: readonly CornerSpec[],
): { id: string; fields: string[] }[] {
  const keepButt = new Set(["type", "through", "ends", "connector", "qty"]);
  const keepJoint = new Set(["type", "ends"]);
  const written = connections(doc);
  return takeOut(doc, corners)
    .filter((c) => c.cmd === "removeEntity")
    .map((c) => (c.args as { id: string }).id)
    .map((id) => {
      const c = written[id] ?? {};
      const keep = c.type === "butt" ? keepButt : keepJoint;
      return { id, fields: Object.keys(c).filter((k) => !keep.has(k)) };
    })
    .filter((x) => x.fields.length > 0);
}

/** One `autoConnect` per corner by a rule, each keeping its corner's connector. */
export function joinBatch(
  doc: RawDoc,
  corners: readonly CornerSpec[],
  rule: CornerRule,
): Command[] {
  return corners.map((c) => ({
    cmd: "autoConnect",
    args: { at: [...c.at], prefer: rule, ...keptConnector(doc, c) },
  }));
}

/** One `addConnection` per corner: a miter or a splice of its two ends, in id order (E1.4). */
export function jointAdds(corners: readonly CornerSpec[], kind: JointKind): Command[] {
  return corners.map((c) => ({
    cmd: "addConnection",
    args: { type: kind, ends: [...c.ends].sort(compareIds) },
  }));
}

/** The batch that joins each corner's two ends by a miter or a splice: its joint out first. */
export function jointBatch(
  doc: RawDoc,
  corners: readonly CornerSpec[],
  kind: JointKind,
): Command[] {
  return [...takeOut(doc, corners), ...jointAdds(corners, kind)];
}

/** The batch that arranges the corners by a rule: their butts out, one `autoConnect` each. */
export function arrangeBatch(
  doc: RawDoc,
  corners: readonly CornerSpec[],
  rule: CornerRule,
): Command[] {
  return [...takeOut(doc, corners), ...joinBatch(doc, corners, rule)];
}
