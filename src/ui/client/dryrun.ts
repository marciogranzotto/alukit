import type { Diagnostic } from "../model.ts";
import type { CommandError } from "../store.ts";
import { type ClientAnswer, notYet } from "./answer.ts";

/**
 * A dry run (BE-2, D-UX-11): `POST /api/commands` with `dryRun: true`, as `alukit do --dry-run`.
 * The server applies the batch in its command queue against the current revision, derives, and
 * answers what the step would do, writing, logging and broadcasting nothing. The joint preview,
 * the corner arrangements, Delete's cascade list and the box frame's numbers ask it. Owner: S1,
 * which replaces the stub with the call in S1.7; until then it answers "not available yet".
 */

/** What a step would change in what is derived. */
export interface DryRunEffects {
  /** Each bar whose cut length would move: [before, after], mm. */
  cuts: Record<string, [number, number]>;
  /** The entities the step would remove, a cascade's included. */
  removed: string[];
  /** The bar ends a connection of the step would claim (`b1.b`). */
  claimed: string[];
}

/** What the step would come to: as a real step's answer, against `rev`, or why it is refused. */
export type DryRun =
  | {
      ok: true;
      /** The revision it ran against: the newest, after any step queued before it. */
      rev: number;
      /** The ids the step would create. */
      created: string[];
      /** The diagnostics the step would add. */
      diagnostics: Diagnostic[];
      effects: DryRunEffects;
    }
  | { ok: false; why: string; errors: CommandError[] };

export async function dryRun(
  _commands: readonly { cmd: string; args?: unknown }[],
): Promise<ClientAnswer<DryRun>> {
  return notYet("POST /api/commands with dryRun", "BE-2, S1.7");
}
