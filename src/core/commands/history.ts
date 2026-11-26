import { applyBatch, type BatchResult, type CommandResult } from "./apply.ts";
import type { CommandEnv, State } from "./types.ts";

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
  source: string;
  what: string;
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
    this.push({
      source,
      commands: [...commands],
      results: r.results,
      before: this.state,
      after: r.state,
    });
    return { ...r, rev: this.revision };
  }

  /** Takes in a state that came from elsewhere (a valid direct edit of the file) as one step. */
  record(state: State, source = "file"): number {
    this.push({ source, before: this.state, after: state });
    return this.revision;
  }

  undo(): UndoResult {
    const step = this.past.pop();
    if (!step) return { ok: false, message: "nothing to undo" };
    this.future.push(step);
    this.state = step.before;
    this.revision++;
    this.entries.push({
      rev: this.revision,
      source: step.source,
      what: `undo ${stepText(step)}`,
      of: step.rev,
    });
    return { ok: true, step, rev: this.revision };
  }

  redo(): UndoResult {
    const step = this.future.pop();
    if (!step) return { ok: false, message: "nothing to redo" };
    this.past.push(step);
    this.state = step.after;
    this.revision++;
    this.entries.push({
      rev: this.revision,
      source: step.source,
      what: `redo ${stepText(step)}`,
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
    this.entries.push({ rev: this.revision, source: s.source, what: stepText(s) });
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
