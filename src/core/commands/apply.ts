import { z } from "zod";
import type { CatalogSet } from "#catalog/link.ts";
import { pinLock } from "../lock/pin.ts";
import { documentRefs, lockCovers } from "../lock/refs.ts";
import { makeContext } from "./helpers.ts";
import { COMMANDS } from "./registry.ts";
import type {
  Command,
  CommandDef,
  CommandEnv,
  CommandError,
  Outcome,
  RawDoc,
  State,
} from "./types.ts";
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

/** A command read: its definition and parsed arguments, or why it cannot run. */
type Parsed =
  | { ok: true; cmd: string; def: CommandDef<unknown>; args: unknown }
  | { ok: false; cmd?: string; errors: CommandError[] };

function parse(command: unknown): Parsed {
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
  return { ok: true, cmd, def, args: parsed.data };
}

/** Runs a parsed command and pins what it newly names. Never throws. */
function run(
  state: State,
  p: Extract<Parsed, { ok: true }>,
  env: CommandEnv,
): Outcome & { cmd: string } {
  let out: Outcome;
  try {
    out = p.def.apply(makeContext(state, env), p.args);
  } catch (e) {
    out = {
      ok: false,
      errors: [
        { code: "internal", message: `${p.cmd}: ${e instanceof Error ? e.message : String(e)}` },
      ],
    };
  }
  if (!out.ok) return { ...out, cmd: p.cmd };
  return { ...out, state: pinNew(out.state, env), cmd: p.cmd };
}

/** Applies one command. Never throws: an unexpected exception becomes an `internal` error. */
export function applyCommand(
  state: State,
  command: unknown,
  env: CommandEnv,
): Outcome & { cmd?: string } {
  const p = parse(command);
  return p.ok ? run(state, p, env) : p;
}

/** Which command of a batch was refused, and why. */
type Failed = { index: number; cmd?: string; errors: CommandError[] };

function failure(index: number, out: { cmd?: string; errors: CommandError[] }): Failed {
  return { index, ...(out.cmd ? { cmd: out.cmd } : {}), errors: out.errors };
}

/** The next command's outcome folded into the batch: its result recorded, or the refusal. */
function fold(
  results: CommandResult[],
  index: number,
  out: Outcome & { cmd?: string },
): Failed | State {
  if (!out.ok) return failure(index, out);
  results.push({
    cmd: out.cmd as string,
    ...out.effect,
    ...(out.info !== undefined ? { info: out.info } : {}),
  });
  return out.state;
}

export function applyBatch(
  state: State,
  commands: readonly unknown[],
  env: CommandEnv,
): BatchResult {
  let current = state;
  const results: CommandResult[] = [];
  for (const [index, command] of commands.entries()) {
    const next = fold(results, index, applyCommand(current, command, env));
    if (!("doc" in next)) return { ok: false, failed: next };
    current = next;
  }
  return { ok: true, state: current, results };
}

/** The catalogs a document names, as written. */
export function namedCatalogs(doc: RawDoc): readonly string[] {
  return Array.isArray(doc.catalogs)
    ? doc.catalogs.filter((c): c is string => typeof c === "string")
    : [];
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * `applyBatch` with the catalogs at hand, as the server and the CLI run a batch: before a
 * command that changes the catalogs the document names (`catalogsAfter`), `open` gives the live
 * catalogs of the new list, so the command checks what it names against them and the lock pins
 * from them (§3.1, §4.13); the commands after it see them too. Answers the live catalogs the
 * batch ended with.
 */
export async function applyBatchLive(
  state: State,
  commands: readonly unknown[],
  env: CommandEnv,
  open: (catalogs: readonly string[]) => Promise<CatalogSet>,
): Promise<BatchResult & { live?: CatalogSet }> {
  let current = state;
  let e = env;
  const results: CommandResult[] = [];
  for (const [index, command] of commands.entries()) {
    const p = parse(command);
    if (!p.ok) return { ok: false, failed: failure(index, p) };
    const after = p.def.catalogsAfter?.(p.args, current.doc);
    if (after && !sameList(after, namedCatalogs(current.doc)))
      e = { ...e, live: await open(after) };
    const next = fold(results, index, run(current, p, e));
    if (!("doc" in next)) return { ok: false, failed: next };
    current = next;
  }
  return { ok: true, state: current, results, ...(e.live ? { live: e.live } : {}) };
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
