import type { z } from "zod";
import type { CatalogSet } from "#catalog/link.ts";
import type { Derived } from "../derive/derive.ts";
import type { ItemSource } from "../items.ts";
import type { Lock } from "../lock/schema.ts";

/**
 * Commands (design §6): every edit is `{ "cmd": "addBar", "args": {…} }`, a pure function from
 * the project's state to a new state. The state is the document and its lock, both treated as
 * immutable: a command copies what it changes and shares the rest, so a snapshot costs little
 * and undo restores it exactly (review m1). A command never throws; a refusal is a list of
 * structured errors and leaves the state as it was.
 */

/** The document as JSON. Commands work on the document as written, not on its parsed form. */
export type RawDoc = Readonly<Record<string, unknown>>;

export interface State {
  doc: RawDoc;
  lock: Lock;
}

export interface Command {
  cmd: string;
  args?: unknown;
}

/** Why a command was refused: the shape of a diagnostic, always an error. */
export interface CommandError {
  code: string;
  message: string;
  entity?: string;
  field?: string;
  refs?: string[];
}

/** What a command did, by id. */
export interface Effect {
  created: string[];
  removed: string[];
  changed: string[];
}

/** The world a command runs in. Everything it reads besides the state comes from here. */
export interface CommandEnv {
  /** Today's date, YYYY-MM-DD: records (decisions) are dated with it. */
  today: string;
  /**
   * The live catalogs, when open. New references are pinned into the lock from them after each
   * command (§4.13: "a save adds items the document newly references"), and `lockUpdate` reads
   * them. Without them, the lock is all a command sees.
   */
  live?: CatalogSet;
}

/** What a command reads while it runs: the state, the env, and lazily derived views of them. */
export interface CommandContext {
  readonly state: State;
  readonly env: CommandEnv;
  /** Catalog items from the state's lock. */
  items(): ItemSource;
  /** The current document derived from its lock (§5), computed once per command. */
  derived(): Derived;
}

export type Outcome =
  | {
      ok: true;
      state: State;
      effect: Effect /** Command-specific facts for the answer. */;
      info?: unknown;
    }
  | { ok: false; errors: CommandError[] };

export interface CommandDef<A = unknown> {
  name: string;
  /** The group of design §6's table. */
  group: string;
  /** One line: what it does. The skill's command reference is generated from these (§7.5). */
  summary: string;
  args: z.ZodType<A>;
  apply(ctx: CommandContext, args: A): Outcome;
}

export function refuse(code: string, message: string, extra: Partial<CommandError> = {}): Outcome {
  return { ok: false, errors: [{ code, message, ...extra }] };
}

export function done(state: State, effect: Partial<Effect> = {}, info?: unknown): Outcome {
  return {
    ok: true,
    state,
    effect: {
      created: effect.created ?? [],
      removed: effect.removed ?? [],
      changed: effect.changed ?? [],
    },
    ...(info !== undefined ? { info } : {}),
  };
}
