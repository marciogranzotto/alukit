import type { CornerPlan, RuleArrangement } from "#core/corners/arrange.ts";
import {
  arrangeBatch as batchFor,
  CORNER_RULES,
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
 * Owner: S5.
 */

export const RULES = CORNER_RULES;
export type { CornerRule };

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

/**
 * Why the corner offers no arrangement, or undefined: a pattern copy's connection is changed
 * through its template, and a connection other than a butt (a splice, a mitre, a pivot) is not
 * one `autoConnect` makes.
 */
export function cannotArrange(m: Model, corner: Corner): string | undefined {
  const written = connections(m);
  const here = new Set(corner.ends);
  for (const id of corner.connections) {
    const copy = copyOf(id);
    if (copy) return `${id} is a pattern copy: change ${copy.template}, its template`;
    const c = written[id];
    if (c && c.type !== "butt" && endsOf(c).some((e) => here.has(e))) {
      return `${id} is a ${String(c.type)}: arrangements choose which bar a butt runs through`;
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

/** One arrangement of a corner, from the dry runs of the rules that give it. */
export interface Arrangement {
  /** The rules that give it, in RULES order: the first is the one Apply sends. */
  rules: CornerRule[];
  /** The bar that runs through. */
  through: string;
  /** The ends that butt into it. */
  ends: string[];
  /** Each bar at the corner (and any other whose cut moves): its cut after, and before, mm. */
  cuts: { bar: string; cut: number; was: number }[];
  /** It is what the corner has now. */
  current: boolean;
  /** In words: "Rail X runs through". */
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

/** Why a rule was refused, in words: the command that refused and its errors. */
function refusalWords(r: Extract<RuleArrangement, { ok: false }>): string {
  const { index, cmd, errors } = r.failed;
  return `command ${index + 1}${cmd ? ` (${cmd})` : ""}: ${errors.map((e) => e.message).join("; ")}`;
}

/**
 * The corner's arrangements from each rule's answer (`GET /api/arrangements` for this corner
 * alone), the rules that come to the same plan and the same cut lengths merged, in RULES order;
 * and the rules that were refused, with why (shown, not hidden).
 */
export function arrangementsOf(
  m: Model,
  corner: Corner,
  answers: readonly RuleArrangement[],
): { list: Arrangement[]; refused: { rule: CornerRule; why: string }[] } {
  const list: Arrangement[] = [];
  const keys = new Map<string, Arrangement>();
  const refused: { rule: CornerRule; why: string }[] = [];
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
    const bars = [...new Set([...corner.bars, ...Object.keys(moved)])].sort(compareIds);
    const cuts = bars.flatMap((bar) => {
      const was = m.derived.bars[bar]?.cut_mm;
      if (was === undefined) return [];
      return [{ bar, cut: moved[bar]?.[1] ?? was, was }];
    });
    const key = JSON.stringify([plan.through, [...plan.ends].sort(), cuts]);
    const same = keys.get(key);
    if (same) {
      same.rules.push(rule);
      continue;
    }
    const a: Arrangement = {
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
  return { list, refused };
}

/** Flip: the arrangement after the current one, round the list; none without a current one. */
export function nextArrangement(list: readonly Arrangement[]): Arrangement | undefined {
  const at = list.findIndex((a) => a.current);
  if (at < 0 || list.length < 2) return undefined;
  return list[(at + 1) % list.length];
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
  const axis = axisOf(barDir(m, a.through));
  const rule: CornerRule | undefined =
    axis === "z" ? "vertical" : axis === "x" ? "x" : axis === "y" ? "y" : undefined;
  return rule !== undefined && a.rules.includes(rule) ? rule : undefined;
}

/**
 * The corners "Apply to all matching corners" changes: those made like this one, that can be
 * arranged, and that do not have this arrangement's direction running through already.
 */
export function matchingCorners(
  m: Model,
  all: readonly Corner[],
  corner: Corner,
  a: Arrangement,
): Corner[] {
  if (directionRule(m, a) === undefined) return [];
  const key = matchKey(m, corner);
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
