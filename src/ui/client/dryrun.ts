import type { DryEffects } from "#core/commands/dry.ts";
import { post } from "../api.ts";
import type { Diagnostic } from "../model.ts";
import type { CommandError } from "../store.ts";
import type { ClientAnswer } from "./answer.ts";

/**
 * A dry run (BE-2, D-UX-11): `POST /api/commands` with `dryRun: true`, as `alukit do --dry-run`.
 * The server applies the batch in its command queue against the current revision, derives, and
 * answers what the step would do, writing, logging and broadcasting nothing. The joint preview,
 * the corner arrangements, Delete's cascade list and the box frame's numbers ask it. Owner: S1.
 */

/** What a step would change in what is derived (src/core/commands/dry.ts). */
export type DryRunEffects = DryEffects;

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
      /**
       * Each command's result, in order (`CommandResult`): what it would create, remove and
       * change (a cascade's dropped list members are changes), and its own facts (`info`: an
       * `addFrame`'s posts and rings, an `autoConnect`'s plan). Added by S5.
       */
      results: DryRunResult[];
    }
  | {
      ok: false;
      why: string;
      errors: CommandError[];
      /** The command that refused: its 0-based index in the batch, and its name. Added by S5. */
      failed?: { index: number; cmd?: string };
    };

/** One command's part of a dry run's answer (src/core/commands/apply.ts, `CommandResult`). */
export interface DryRunResult {
  cmd: string;
  created: string[];
  removed: string[];
  changed: string[];
  info?: unknown;
}

/** The server's answer to a dry run, as it sends it (`alukit.do/1` with `dry: true`). */
interface Answer {
  ok?: boolean;
  kind?: string;
  rev?: number;
  created?: string[];
  diagnostics?: { new: Diagnostic[] };
  effects?: DryRunEffects;
  results?: Partial<DryRunResult>[];
  failed?: { index: number; cmd?: string; errors: CommandError[] };
  status?: { message?: string };
  message?: string;
}

/** A server's answer as the app reads it: what the step would do, or why it would be refused. */
export function dryRunOf(status: number, body: Answer): ClientAnswer<DryRun> {
  if (body.ok === true && body.rev !== undefined && body.effects && body.diagnostics) {
    return {
      ok: true,
      value: {
        ok: true,
        rev: body.rev,
        created: body.created ?? [],
        diagnostics: body.diagnostics.new,
        effects: body.effects,
        results: (body.results ?? []).map((r) => ({
          cmd: r.cmd ?? "",
          created: r.created ?? [],
          removed: r.removed ?? [],
          changed: r.changed ?? [],
          ...(r.info !== undefined ? { info: r.info } : {}),
        })),
      },
    };
  }
  if (body.kind === "refused" && body.failed) {
    const { index, cmd, errors } = body.failed;
    const why = `command ${index + 1}${cmd ? ` (${cmd})` : ""}: ${errors.map((e) => e.message).join("; ")}`;
    return {
      ok: true,
      value: { ok: false, why, errors, failed: { index, ...(cmd !== undefined ? { cmd } : {}) } },
    };
  }
  const why =
    body.kind === "read-only"
      ? `the project is read-only: ${body.status?.message ?? "its files are not valid"}`
      : (body.message ?? `the server answered ${status}`);
  return { ok: false, why };
}

export async function dryRun(
  commands: readonly { cmd: string; args?: unknown }[],
): Promise<ClientAnswer<DryRun>> {
  try {
    const r = await post<Answer>("/api/commands", { commands, source: "ui", dryRun: true });
    return dryRunOf(r.status, r.body);
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}
