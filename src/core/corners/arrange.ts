import type { CatalogSet } from "#catalog/link.ts";
import { applyBatchLive, type BatchResult, type CommandResult } from "../commands/apply.ts";
import { type DryEffects, effectsOf } from "../commands/dry.ts";
import type { Command, CommandEnv, CommandError, State } from "../commands/types.ts";
import { type Derived, derive } from "../derive/derive.ts";
import { jsonText } from "../derive/output.ts";
import { compareIds } from "../ids.ts";
import { lockItems } from "../lock/source.ts";
import { CornerRule } from "../project/schema.ts";
import { TOL } from "../tolerances.ts";
import type { V3 } from "../vec.ts";
import { buttsAt, CORNER_RULES, type CornerSpec, joinBatch, takeOut } from "./batch.ts";

/**
 * A corner's arrangements (D-UX-9, docs/ux/plan.md S5.5): where bar ends meet, which bar runs
 * through and what cut lengths each choice gives. For each corner rule an arrangement is the
 * batch "take these corners' butts out, then `autoConnect {at, prefer: rule}` at each"
 * (batch.ts), run as a dry run: applied and derived, never written. §4.5's rule stays in the core
 * (D-UX-11), and what the app applies is the batch it was shown.
 *
 * `arrange` answers every rule at once, for one corner or many, and shares what the rules have
 * in common: the catalogs are opened once, the butts are taken out once, and the state they
 * leave is derived once for every rule's `autoConnect` (`CommandEnv.derived`). Each rule then
 * costs its own `autoConnect` and one derive of what it builds (docs/ux/integration-decisions.md).
 * The server's `GET /api/arrangements` and `alukit arrangements` are this function.
 */

export { CORNER_RULES, type CornerSpec };

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The bar ends whose design points lie at a point, within the core's length tolerance, as
 * `autoConnect` finds them: the document's bars (a pattern copy's ends are its template's to
 * change), claimed or not, in id order.
 */
export function endsAt(derived: Derived, at: V3): string[] {
  const out: string[] = [];
  for (const [id, b] of derived.bars) {
    if (id.includes("@")) continue;
    if (b.placed.A && dist(b.placed.A, at) <= TOL.len) out.push(`${id}.a`);
    if (b.placed.B && dist(b.placed.B, at) <= TOL.len) out.push(`${id}.b`);
  }
  return out.sort(compareIds);
}

/** A corner of the answer: its point, the ends there, and the written butts that hold them. */
export interface ArrangedCorner extends CornerSpec {
  butts: string[];
}

/** How one corner comes out under a rule: the bar that runs through, the ends that butt. */
export interface CornerPlan {
  at: V3;
  through: string;
  ends: string[];
}

/** One rule's answer: what its batch would build, or why it is refused. */
export type RuleArrangement =
  | {
      rule: CornerRule;
      ok: true;
      /** The batch, as the app applies it. */
      commands: Command[];
      /** Each corner's plan, in the corners' order. */
      plans: CornerPlan[];
      /** What the batch would do to what is derived, against the current state. */
      effects: DryEffects;
    }
  | {
      rule: CornerRule;
      ok: false;
      commands: Command[];
      /** The command that refused (its 0-based index in `commands`) and why. */
      failed: { index: number; cmd?: string; errors: CommandError[] };
    };

export interface Arrangements {
  corners: ArrangedCorner[];
  rules: RuleArrangement[];
}

export const ARRANGEMENTS_SCHEMA = "alukit.arrangements/1";

/** How many corners one request may name. */
export const MAX_CORNERS = 1000;

/**
 * The corners and rules a request names, as the server's `at` and `rule` parameters and the
 * CLI's `--at` and `--rule` write them: each point `x,y,z` in millimetres, each rule by name.
 */
export function arrangeQuery(
  at: readonly string[],
  rules: readonly string[],
): { at: V3[]; rules?: CornerRule[] } | { error: string } {
  if (at.length === 0) return { error: "name a corner: at=x,y,z (mm)" };
  if (at.length > MAX_CORNERS) return { error: `at most ${MAX_CORNERS} corners at once` };
  const points: V3[] = [];
  for (const text of at) {
    const xs = text.split(",").map((s) => (s.trim() === "" ? Number.NaN : Number(s)));
    if (xs.length !== 3 || !xs.every(Number.isFinite)) {
      return { error: `at=${text}: a corner is x,y,z, three numbers in mm` };
    }
    points.push(xs as unknown as V3);
  }
  const chosen: CornerRule[] = [];
  for (const r of rules) {
    const p = CornerRule.safeParse(r);
    if (!p.success) return { error: `rule=${r}: one of ${CORNER_RULES.join(", ")}` };
    if (!chosen.includes(p.data)) chosen.push(p.data);
  }
  return { at: points, ...(chosen.length > 0 ? { rules: chosen } : {}) };
}

/** The answer as JSON, as `GET /api/arrangements` and `alukit arrangements --json` write it. */
export function arrangementsText(rev: number, a: Arrangements): string {
  return jsonText({ schema: ARRANGEMENTS_SCHEMA, rev, ...a });
}

export interface ArrangeInput {
  /** The state, and its derive (the server's snapshot holds it already). */
  state: State;
  derived: Derived;
  /** The corners' points; each is taken as the bar ends there (`endsAt`). */
  at: readonly V3[];
  /** The rules to answer, in order; all of them when absent. */
  rules?: readonly CornerRule[];
  env: CommandEnv;
  /** Opens the live catalogs of a list, should a command change it (`applyBatchLive`). */
  open: (catalogs: readonly string[]) => Promise<CatalogSet>;
}

/** The plan an `autoConnect` reports (`info`): which bar runs through and which ends butt. */
function planOf(at: V3, r: CommandResult | undefined): CornerPlan | undefined {
  const info = r?.info as { through?: unknown; ends?: unknown } | undefined;
  if (!info || typeof info.through !== "string" || !Array.isArray(info.ends)) return undefined;
  return {
    at,
    through: info.through,
    ends: info.ends.filter((e): e is string => typeof e === "string"),
  };
}

/** The derive of a state, as a command and the host make it. */
const deriveOf = (s: State) => derive(s.doc, lockItems(s.lock));

/**
 * Every rule's arrangement of the corners at once. The butts come out in one batch for every
 * rule; a refusal there refuses every rule at that command. Each rule's `autoConnect`s then run
 * from the state the butts left, which is derived once for all of them.
 */
export async function arrange(input: ArrangeInput): Promise<Arrangements> {
  const { state, derived, env, open } = input;
  const rules = input.rules ?? CORNER_RULES;
  const corners: ArrangedCorner[] = input.at.map((at) => {
    const ends = endsAt(derived, at);
    return { at, ends, butts: buttsAt(state.doc, ends) };
  });
  const out = takeOut(state.doc, corners);
  const batch = (rule: CornerRule) => [...out, ...joinBatch(state.doc, corners, rule)];
  const taken: BatchResult = await applyBatchLive(state, out, env, open);
  if (!taken.ok) {
    return {
      corners,
      rules: rules.map((rule) => ({
        rule,
        ok: false,
        commands: batch(rule),
        failed: taken.failed,
      })),
    };
  }
  // The state the butts left, derived once: every rule's first `autoConnect` reads it.
  const shared = taken.state;
  let sharedDerived: Derived | undefined;
  const withShared: CommandEnv = {
    ...env,
    derived: (s) => {
      if (s !== shared) return env.derived?.(s);
      sharedDerived ??= deriveOf(shared);
      return sharedDerived;
    },
  };
  const answers: RuleArrangement[] = [];
  for (const rule of rules) {
    const join = joinBatch(state.doc, corners, rule);
    const commands = [...out, ...join];
    const r = await applyBatchLive(shared, join, withShared, open);
    if (!r.ok) {
      answers.push({
        rule,
        ok: false,
        commands,
        failed: { ...r.failed, index: out.length + r.failed.index },
      });
      continue;
    }
    const plans = corners.map((c, i) => planOf(c.at, r.results[i]));
    const results = [...taken.results, ...r.results];
    answers.push({
      rule,
      ok: true,
      commands,
      plans: plans.filter((p): p is CornerPlan => p !== undefined),
      effects: effectsOf(derived, deriveOf(r.state), results),
    });
  }
  return { corners, rules: answers };
}
