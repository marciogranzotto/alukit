import { applyBatch, type BatchResult, type CommandResult } from "./apply.ts";
import { COMMANDS } from "./registry.ts";
import type { CommandEnv, State } from "./types.ts";
import { joinPhrases } from "./words.ts";

/**
 * Undo and redo by snapshots (design §6, review m1): each step keeps the state before it, so undo
 * restores it exactly and no command needs an inverse. The history is linear and lives in
 * memory (call 18): M4a's server holds one per project and tags each step with its source (`ui`,
 * `cli:<name>`, `agent:<name>`, `file`, §7.1); the CLI without a server makes one per process.
 */

export interface Step {
  /** The revision this step produced. */
  rev: number;
  source: string;
  /** The commands, or undefined for a direct file edit taken in as a step. */
  commands?: unknown[];
  results?: CommandResult[];
  before: State;
  after: State;
}

export interface LogEntry {
  rev: number;
  /** Who made the step; for an undo or redo, who asked for it. */
  source: string;
  /** The step's commands by name, as scripts read them (`addBar, autoConnect`). */
  what: string;
  /** The step in words, as a person reads it (`add bar b12, joined at 1 end`, BE-4). */
  text: string;
  /** For undo and redo entries: the revision of the step undone or redone. */
  of?: number;
}

export type UndoResult = { ok: true; step: Step; rev: number } | { ok: false; message: string };

export class History {
  private past: Step[] = [];
  private future: Step[] = [];
  private readonly entries: LogEntry[] = [];
  private state: State;
  private revision = 0;

  constructor(initial: State) {
    this.state = initial;
  }

  get current(): State {
    return this.state;
  }

  /** Moves on with every change, undo and redo included, so a client can tell it is stale. */
  get rev(): number {
    return this.revision;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Applies a batch; on success it is one step, and the redo line is dropped. */
  apply(
    commands: readonly unknown[],
    env: CommandEnv,
    source = "cli",
  ): BatchResult & { rev?: number } {
    const r = applyBatch(this.state, commands, env);
    if (!r.ok) return r;
    return { ...r, rev: this.commit(commands, r.results, r.state, source) };
  }

  /**
   * Takes in a batch that `applyBatch` already applied to the current state, as one step. The
   * server applies, writes the files, and only then commits, so a failed write leaves no step.
   */
  commit(
    commands: readonly unknown[],
    results: CommandResult[],
    state: State,
    source: string,
  ): number {
    this.push({ source, commands: [...commands], results, before: this.state, after: state });
    return this.revision;
  }

  /** Takes in a state that came from elsewhere (a valid direct edit of the file) as one step. */
  record(state: State, source = "file"): number {
    this.push({ source, before: this.state, after: state });
    return this.revision;
  }

  /** The step `undo` would take back, without taking it: the state it restores is its `before`. */
  get undoStep(): Step | undefined {
    return this.past[this.past.length - 1];
  }

  /** The step `redo` would apply again: the state it restores is its `after`. */
  get redoStep(): Step | undefined {
    return this.future[this.future.length - 1];
  }

  /**
   * Takes back the latest step, whoever made it (§7.1). `source` is who asks: the log names
   * them, and the step taken back by its revision; without one, the step's own source.
   */
  undo(source?: string): UndoResult {
    const step = this.past.pop();
    if (!step) return { ok: false, message: "nothing to undo" };
    this.future.push(step);
    this.state = step.before;
    this.revision++;
    this.entries.push({
      rev: this.revision,
      source: source ?? step.source,
      what: `undo ${stepText(step)}`,
      text: `undo ${stepWords(step)}`,
      of: step.rev,
    });
    return { ok: true, step, rev: this.revision };
  }

  redo(source?: string): UndoResult {
    const step = this.future.pop();
    if (!step) return { ok: false, message: "nothing to redo" };
    this.past.push(step);
    this.state = step.after;
    this.revision++;
    this.entries.push({
      rev: this.revision,
      source: source ?? step.source,
      what: `redo ${stepText(step)}`,
      text: `redo ${stepWords(step)}`,
      of: step.rev,
    });
    return { ok: true, step, rev: this.revision };
  }

  /** What happened, in order: steps, undos and redos (`alukit log`, §7.1). */
  log(): readonly LogEntry[] {
    return this.entries;
  }

  private push(step: Omit<Step, "rev">): void {
    this.revision++;
    const s: Step = { ...step, rev: this.revision };
    this.past.push(s);
    this.future = [];
    this.state = step.after;
    this.entries.push({
      rev: this.revision,
      source: s.source,
      what: stepText(s),
      text: stepWords(s),
    });
  }
}

/** A step in a few words: its commands' names, or "file edit". */
export function stepText(step: Step): string {
  if (!step.commands) return "file edit";
  const names = step.commands.map((c) =>
    typeof c === "object" && c !== null && typeof (c as { cmd?: unknown }).cmd === "string"
      ? (c as { cmd: string }).cmd
      : "?",
  );
  return names.join(", ");
}

/**
 * A step in words (BE-4): each command's own phrase (`CommandDef.describe`) from its arguments
 * and what it did, put together by `joinPhrases`; "edit the files by hand" for a direct edit.
 */
export function stepWords(step: Pick<Step, "commands" | "results">): string {
  if (!step.commands) return "edit the files by hand";
  return joinPhrases(
    step.commands.map((c, i) => {
      const { cmd, args } = c as { cmd: string; args?: unknown };
      const def = COMMANDS.get(cmd);
      const did = step.results?.[i];
      const parsed = def?.args.safeParse(args ?? {});
      return {
        cmd,
        phrase: def && did && parsed?.success ? def.describe(parsed.data, did) : cmd,
      };
    }),
  );
}
