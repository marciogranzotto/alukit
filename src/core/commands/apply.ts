import { z } from "zod";
import { pinLock } from "../lock/pin.ts";
import { documentRefs, lockCovers } from "../lock/refs.ts";
import { makeContext } from "./helpers.ts";
import { COMMANDS } from "./registry.ts";
import type { Command, CommandEnv, CommandError, Outcome, State } from "./types.ts";
import { schemaErrors } from "./validate.ts";

/**
 * Applying a batch of commands (design §6): in order, each to the state the one before it left,
 * and atomically: when one is refused, the batch is, and the state is as it was before the
 * batch. After each command, items the document newly names are pinned into the lock from the
 * live catalogs (§4.13), so the next command, and derive, see them.
 */

export const CommandShape = z.strictObject({
  cmd: z.string().min(1),
  args: z.unknown().optional(),
});

export interface CommandResult {
  cmd: string;
  created: string[];
  removed: string[];
  changed: string[];
  /** Command-specific facts: the plan of an autoConnect, the diff of a lockUpdate. */
  info?: unknown;
}

export type BatchResult =
  | { ok: true; state: State; results: CommandResult[] }
  | { ok: false; failed: { index: number; cmd?: string; errors: CommandError[] } };

/** Pins what the document newly names, when the live catalogs are open. */
function pinNew(state: State, env: CommandEnv): State {
  if (!env.live) return state;
  const refs = documentRefs(state.doc);
  if (lockCovers(state.lock, refs)) return state;
  return { doc: state.doc, lock: pinLock(env.live, refs, state.lock, { kind: "add" }).lock };
}

/** Applies one command. Never throws: an unexpected exception becomes an `internal` error. */
export function applyCommand(
  state: State,
  command: unknown,
  env: CommandEnv,
): Outcome & { cmd?: string } {
  const shape = CommandShape.safeParse(command);
  if (!shape.success) {
    return {
      ok: false,
      errors: schemaErrors(CommandShape, command).map((e) => ({ ...e, code: "command" })),
    };
  }
  const { cmd, args } = shape.data;
  const def = COMMANDS.get(cmd);
  if (!def) {
    return { ok: false, cmd, errors: [{ code: "command", message: `unknown command "${cmd}"` }] };
  }
  const parsed = def.args.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      cmd,
      errors: schemaErrors(def.args, args ?? {}).map((e) => ({
        ...e,
        code: "args",
        field: e.field ?? "",
      })),
    };
  }
  let out: Outcome;
  try {
    out = def.apply(makeContext(state, env), parsed.data);
  } catch (e) {
    out = {
      ok: false,
      errors: [
        { code: "internal", message: `${cmd}: ${e instanceof Error ? e.message : String(e)}` },
      ],
    };
  }
  if (!out.ok) return { ...out, cmd };
  return { ...out, state: pinNew(out.state, env), cmd };
}

export function applyBatch(
  state: State,
  commands: readonly unknown[],
  env: CommandEnv,
): BatchResult {
  let current = state;
  const results: CommandResult[] = [];
  for (const [index, command] of commands.entries()) {
    const out = applyCommand(current, command, env);
    if (!out.ok) {
      return {
        ok: false,
        failed: { index, ...(out.cmd ? { cmd: out.cmd } : {}), errors: out.errors },
      };
    }
    current = out.state;
    results.push({
      cmd: out.cmd as string,
      ...out.effect,
      ...(out.info !== undefined ? { info: out.info } : {}),
    });
  }
  return { ok: true, state: current, results };
}

/** A batch as written: one command, a list of them, or `{ "commands": [...] }`. */
export function batchOf(input: unknown): unknown[] | undefined {
  if (Array.isArray(input)) return input;
  if (typeof input === "object" && input !== null) {
    const o = input as Record<string, unknown>;
    if (Array.isArray(o.commands) && Object.keys(o).length === 1) return o.commands;
    if (typeof o.cmd === "string") return [input];
  }
  return undefined;
}

export type { Command };
