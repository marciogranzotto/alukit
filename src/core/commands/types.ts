import type { z } from "zod";
import type { CatalogSet } from "#catalog/link.ts";
import type { Derived } from "../derive/derive.ts";
import type { ItemSource } from "../items.ts";
import type { Lock } from "../lock/schema.ts";
import type { Phrase } from "./words.ts";

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

/** What a command did, as its answer gives it: by id, and its own facts. */
export interface Did extends Effect {
  info?: unknown;
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
  /**
   * Where catalogs may come from, for a command that names new ones (`setProject`, BE-1): the
   * built-in ids, and a check of a folder path against the project's folder. Without it a
   * command accepts any built-in id and refuses every folder: it cannot confine a path it
   * cannot resolve (§7.2).
   */
  catalogs?: CatalogPlaces;
}

/** Where a catalog the document newly names may come from (§3.1, §7.2). */
export interface CatalogPlaces {
  /** The ids of the built-in catalogs. */
  builtin: readonly string[];
  /**
   * Why a folder, as the document writes it (relative to the project), may not be added: it
   * resolves outside the project's folder (symbolic links followed), is missing, or holds no
   * catalog. Undefined when it may.
   */
  folder(path: string): string | undefined;
}

/** What a command reads while it runs: the state, the env, and lazily derived views of them. */
export interface CommandContext {
  readonly state: State;
  readonly env: CommandEnv;
  /** Catalog items from the state's lock, and the document's project items (§4.8). */
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
  /**
   * What it did, in words (BE-4): a phrase for the log, the undo button and the history, from
   * its arguments and what it did. Undefined when it did nothing worth saying (an
   * `autoConnect` that found nothing to join).
   */
  describe(args: A, did: Did): Phrase | undefined;
  /**
   * For a command that changes the catalogs the document names: the list it leaves, from its
   * arguments alone. A batch run with the catalogs at hand (`applyBatchLive`) opens that list
   * before the command runs, so the command checks the items it names against it, and what it
   * names is pinned from it (§4.13).
   */
  catalogsAfter?(args: A, doc: RawDoc): readonly string[] | undefined;
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
