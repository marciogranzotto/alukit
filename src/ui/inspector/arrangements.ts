import type { CornerPlan, JointArrangement, RuleArrangement } from "#core/corners/arrange.ts";
import {
  arrangeBatch as batchFor,
  CORNER_RULES,
  JOINT_KINDS,
  type JointKind,
  jointBatch,
  lostFields as lostFor,
  takeOut as takeOutFor,
} from "#core/corners/batch.ts";
import { compareIds } from "#core/ids.ts";
import type { CornerRule } from "#core/project/schema.ts";
import type { V3 } from "../../mesh/model.ts";
import type { Corner } from "../corners.ts";
import type { Model } from "../model.ts";
import type { Command } from "./remove.ts";
import { axisOf, barDir, copyOf, isObject, listWords } from "./words.ts";

/**
 * A corner's arrangements (docs/ux/plan.md S5.5, D-UX-9, F3): which bar runs through where bar
 * ends meet, and the cut lengths each choice gives. The core decides (§4.5's rule stays in one
 * place, D-UX-11): for each corner rule an arrangement is the dry run of "take this corner's
 * butts out, then `autoConnect {at, prefer}`" (src/core/corners/arrange.ts, which builds the
 * batch and answers every rule in one request, `GET /api/arrangements`), and the rules that come
 * to the same thing are one arrangement. Applying one sends that same batch, built by the same
 * core function, so what was shown is what is built. Pure: the request is the caller's.
 *
 * A corner of two ends may also take a miter or a splice (E1.4; the editing audit's E5.5): the
 * same answer carries each joint's dry run, judged by derive, and the inspector lists it beside
 * the butts, applied by the same core batch (`jointBatch`). Owner: E5.
 */

export const RULES = CORNER_RULES;
export const JOINTS = JOINT_KINDS;
export type { CornerRule, JointKind };

type O = Record<string, unknown>;

/** The written connections, by id. */
function connections(m: Model): Record<string, O> {
  const c = m.doc.connections;
  return (isObject(c) ? c : {}) as Record<string, O>;
}

/** A written butt's ends. */
function endsOf(c: O): string[] {
  return Array.isArray(c.ends) ? c.ends.filter((x): x is string => typeof x === "string") : [];
}

/** The connections that are a corner's joint, which an arrangement takes out and remakes. */
const CORNER_JOINT = new Set<unknown>(["butt", ...JOINT_KINDS]);

/**
 * Why the corner offers no arrangement, or undefined: a pattern copy's connection is changed
 * through its template, and a pivot that carries an end here sets that end, which no corner
 * joint may take from it. A butt, a miter or a splice is the corner's joint, which any
 * arrangement replaces (E1.4, e1 15).
 */
export function cannotArrange(m: Model, corner: Corner): string | undefined {
  const written = connections(m);
  const here = new Set(corner.ends);
  for (const id of corner.connections) {
    const copy = copyOf(id);
    if (copy) return `${id} is a pattern copy: change ${copy.template}, its template`;
    const c = written[id];
    if (c && !CORNER_JOINT.has(c.type) && endsOf(c).some((e) => here.has(e))) {
      return `${id} is a ${String(c.type)} that sets an end here: change it in its fields`;
    }
  }
  if (corner.bars.length < 2) return "only one bar meets here";
  return undefined;
}

/** The commands that take the corners' butts out (the core's `takeOut`, over the drawn document). */
export function takeOut(m: Model, corners: readonly Corner[]): Command[] {
  return takeOutFor(m.doc, corners);
}

/** The fields a butt taken out whole carries that `autoConnect` does not write again. */
export function lostFields(
  m: Model,
  corners: readonly Corner[],
): { id: string; fields: string[] }[] {
  return lostFor(m.doc, corners);
}

/** The batch that arranges the corners by a rule: their butts out, one `autoConnect` each. */
export function arrangeBatch(m: Model, corners: readonly Corner[], rule: CornerRule): Command[] {
  return batchFor(m.doc, corners, rule);
}

/** One arrangement of a corner: a butt, from the dry runs of the rules that give it, or a joint. */
export interface Arrangement {
  /** A butt through one of the bars, or a miter or splice of the two ends. */
  kind: "butt" | JointKind;
  /** Which of the corner's it is: the through bar of a butt, the joint's kind. */
  key: string;
  /** The rules that give a butt, in RULES order: the first is the one Apply sends. A joint: none. */
  rules: CornerRule[];
  /** The bar that runs through; none at a joint. */
  through?: string;
  /** The ends that butt into it, or that the joint joins. */
  ends: string[];
  /** Each bar at the corner (and any other whose cut moves): its cut after, and before, mm. */
  cuts: { bar: string; cut: number; was: number }[];
  /** It is what the corner has now. */
  current: boolean;
  /** In words: "Rail X runs through", "Mitre". */
  title: string;
  /** "b3 runs through; b2 butts into it." */
  detail: string;
}

/** What a bar is called at a corner: Post, Rail X, Rail Y, or by its id when that is not enough. */
function roleAt(m: Model, corner: Corner, bar: string): string {
  const axis = axisOf(barDir(m, bar));
  const alike = corner.bars.filter((b) => axisOf(barDir(m, b)) === axis).length;
  if (axis === "z") return alike > 1 ? `Post ${bar}` : "Post";
  if (axis === "x" || axis === "y") return alike > 1 ? `Rail ${bar}` : `Rail ${axis.toUpperCase()}`;
  return `Bar ${bar}`;
}

/** How a butting bar meets the through bar: a post stands on a rail, or a rail sits on a post. */
function meets(
  m: Model,
  corner: Corner,
  through: string,
  end: string,
): "stands" | "sits" | "butts" {
  const [bar, e] = end.split(".") as [string, "a" | "b"];
  if (axisOf(barDir(m, bar)) !== "z" || axisOf(barDir(m, through)) === "z") return "butts";
  const d = m.derived.bars[bar];
  if (!d) return "butts";
  const other = e === "a" ? d.b : d.a;
  return (other[2] as number) > (corner.at[2] as number) ? "stands" : "sits";
}

/** An arrangement in words: its title and the sentence under it. */
export function arrangementWords(
  m: Model,
  corner: Corner,
  through: string,
  ends: readonly string[],
): { title: string; detail: string } {
  const by: Record<"stands" | "sits" | "butts", string[]> = { stands: [], sits: [], butts: [] };
  for (const e of ends) by[meets(m, corner, through, e)].push(e.split(".")[0] as string);
  const parts = [
    ...(by.stands.length > 0
      ? [`${listWords(by.stands)} ${by.stands.length > 1 ? "stand" : "stands"} on it`]
      : []),
    ...(by.butts.length > 0
      ? [`${listWords(by.butts)} ${by.butts.length > 1 ? "butt" : "butts"} into it`]
      : []),
    ...(by.sits.length > 0 ? [`it sits on ${listWords(by.sits)}`] : []),
  ];
  return {
    title: `${roleAt(m, corner, through)} runs through`,
    detail: `${through} runs through${parts.length > 0 ? `; ${parts.join(", ")}` : ""}.`,
  };
}

/** A joint's title and the sentence under it. */
export function jointWords(
  kind: JointKind,
  ends: readonly string[],
): { title: string; detail: string } {
  const bars = listWords(ends.map((e) => e.split(".")[0] as string));
  return kind === "miter"
    ? { title: "Mitre", detail: `${bars} are cut to meet; no bar runs through.` }
    : { title: "Splice", detail: `${bars} are joined end to end, in line.` };
}

/** Why a rule was refused, in words: the command that refused and its errors. */
function refusalWords(r: Extract<RuleArrangement, { ok: false }>): string {
  const { index, cmd, errors } = r.failed;
  return `command ${index + 1}${cmd ? ` (${cmd})` : ""}: ${errors.map((e) => e.message).join("; ")}`;
}

/** Each bar at the corner (and any other whose cut a step moves): its cut after, and before. */
function cutsOf(
  m: Model,
  corner: Corner,
  moved: Readonly<Record<string, readonly [number, number]>>,
): Arrangement["cuts"] {
  const bars = [...new Set([...corner.bars, ...Object.keys(moved)])].sort(compareIds);
  return bars.flatMap((bar) => {
    const was = m.derived.bars[bar]?.cut_mm;
    if (was === undefined) return [];
    return [{ bar, cut: moved[bar]?.[1] ?? was, was }];
  });
}

/** Whether the corner is joined now by a joint of this kind that joins exactly its ends. */
function jointedBy(m: Model, corner: Corner, kind: JointKind): boolean {
  const written = connections(m);
  const ends = [...corner.ends].sort(compareIds).join(" ");
  return corner.connections.some((id) => {
    const c = written[id];
    return c?.type === kind && [...endsOf(c)].sort(compareIds).join(" ") === ends;
  });
}

/**
 * The corner's arrangements from each rule's answer (`GET /api/arrangements` for this corner
 * alone), the rules that come to the same plan and the same cut lengths merged, in RULES order;
 * then each joint derive accepts, in JOINTS order; and the rules and joints that were refused,
 * with why (shown, not hidden).
 */
export function arrangementsOf(
  m: Model,
  corner: Corner,
  answers: readonly RuleArrangement[],
  joints: readonly JointArrangement[] = [],
): { list: Arrangement[]; refused: { rule: CornerRule | JointKind; why: string }[] } {
  const list: Arrangement[] = [];
  const keys = new Map<string, Arrangement>();
  const refused: { rule: CornerRule | JointKind; why: string }[] = [];
  for (const answer of answers) {
    const { rule } = answer;
    if (!answer.ok) {
      refused.push({ rule, why: refusalWords(answer) });
      continue;
    }
    const plan: CornerPlan | undefined = answer.plans[0];
    if (!plan) {
      refused.push({ rule, why: "nothing butts at this corner" });
      continue;
    }
    const moved = answer.effects.cuts;
    const cuts = cutsOf(m, corner, moved);
    const key = JSON.stringify([plan.through, [...plan.ends].sort(), cuts]);
    const same = keys.get(key);
    if (same) {
      same.rules.push(rule);
      continue;
    }
    const a: Arrangement = {
      kind: "butt",
      key: plan.through,
      rules: [rule],
      through: plan.through,
      ends: [...plan.ends].sort(compareIds),
      cuts,
      current:
        corner.state === "joined" &&
        corner.through === plan.through &&
        Object.keys(moved).length === 0,
      ...arrangementWords(m, corner, plan.through, plan.ends),
    };
    keys.set(key, a);
    list.push(a);
  }
  for (const j of joints) {
    if (!j.ok) {
      refused.push({ rule: j.kind, why: j.why });
      continue;
    }
    const ends = [...(j.plans[0]?.ends ?? corner.ends)].sort(compareIds);
    const moved = j.effects.cuts;
    list.push({
      kind: j.kind,
      key: j.kind,
      rules: [],
      ends,
      cuts: cutsOf(m, corner, moved),
      current: jointedBy(m, corner, j.kind) && Object.keys(moved).length === 0,
      ...jointWords(j.kind, ends),
    });
  }
  return { list, refused };
}

/**
 * The batch that gives these corners an arrangement, built by the core function the server
 * dry-ran (`arrangeBatch` by the rule, or `jointBatch`): what was shown is what is built. For
 * several corners, a butt goes by the rule named for its through bar's direction.
 */
export function arrangementBatch(m: Model, corners: readonly Corner[], a: Arrangement): Command[] {
  if (a.kind !== "butt") return jointBatch(m.doc, corners, a.kind);
  const rule = corners.length > 1 ? directionRule(m, a) : a.rules[0];
  return rule ? arrangeBatch(m, corners, rule) : [];
}

/**
 * Flip: which bar runs through, the butt after the current one, round the butts; none without a
 * current butt. A miter or splice has no bar running through, so it is not flipped to or from:
 * it is chosen, as any arrangement is.
 */
export function nextArrangement(list: readonly Arrangement[]): Arrangement | undefined {
  const butts = list.filter((a) => a.kind === "butt");
  const at = butts.findIndex((a) => a.current);
  if (at < 0 || butts.length < 2) return undefined;
  return butts[(at + 1) % butts.length];
}

/** A bar's line, as a key that ignores which way it was drawn. */
function lineKey(m: Model, bar: string): string {
  const d = barDir(m, bar);
  if (!d) return "?";
  const i = d.findIndex((c) => Math.abs(c) > 1e-6);
  const s = (d[i] as number) < 0 ? -1 : 1;
  return d.map((c) => (Math.round(c * s * 1000) / 1000 || 0).toString()).join(",");
}

/**
 * What a corner is made of, for matching: each end's bar line and each line bar's, as a sorted
 * list. Two corners match when the same lines meet in the same way (an L and a T do not).
 */
export function matchKey(m: Model, corner: Corner): string {
  const own = new Set(corner.ends.map((e) => e.split(".")[0] as string));
  return [
    ...corner.ends.map((e) => `${lineKey(m, e.split(".")[0] as string)}:end`),
    ...corner.bars.filter((b) => !own.has(b)).map((b) => `${lineKey(m, b)}:line`),
  ]
    .sort()
    .join("|");
}

/**
 * The rule that gives the same arrangement at another corner of the same make: the one named for
 * the through bar's direction (vertical for a post, x or y for a rail along it), when it is among
 * the rules that gave it here. An arrangement only `first` gives depends on ids, not directions.
 */
export function directionRule(m: Model, a: Arrangement): CornerRule | undefined {
  if (a.through === undefined) return undefined;
  const axis = axisOf(barDir(m, a.through));
  const rule: CornerRule | undefined =
    axis === "z" ? "vertical" : axis === "x" ? "x" : axis === "y" ? "y" : undefined;
  return rule !== undefined && a.rules.includes(rule) ? rule : undefined;
}

/** The items of the bars whose ends meet at a corner, as one sorted key: a joint's section pair. */
function endItems(m: Model, corner: Corner): string {
  return corner.ends
    .map((e) => m.derived.bars[e.split(".")[0] as string]?.item ?? "?")
    .sort()
    .join("|");
}

/**
 * The corners "Apply to all matching corners" changes: those made like this one, that can be
 * arranged, and that do not have the arrangement already. A butt's: this direction running
 * through. A joint's: the same pair of items at the ends too, since a miter joins one section
 * (derive judges them again before they are applied).
 */
export function matchingCorners(
  m: Model,
  all: readonly Corner[],
  corner: Corner,
  a: Arrangement,
): Corner[] {
  const key = matchKey(m, corner);
  if (a.kind !== "butt") {
    const items = endItems(m, corner);
    const kind = a.kind;
    return all.filter(
      (c) =>
        matchKey(m, c) === key &&
        endItems(m, c) === items &&
        cannotArrange(m, c) === undefined &&
        !jointedBy(m, c, kind),
    );
  }
  if (directionRule(m, a) === undefined || a.through === undefined) return [];
  const want = lineKey(m, a.through);
  return all.filter(
    (c) =>
      matchKey(m, c) === key &&
      cannotArrange(m, c) === undefined &&
      !(c.state === "joined" && c.through !== undefined && lineKey(m, c.through) === want),
  );
}

/** "Join open corners": one `autoConnect` at each open corner, by the project's rule. */
export function joinOpenBatch(corners: readonly Corner[]): Command[] {
  return corners
    .filter((c) => c.state === "open")
    .map((c) => ({ cmd: "autoConnect", args: { at: [...c.at] as V3, optional: true } }));
}
