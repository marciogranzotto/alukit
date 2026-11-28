import { createHash } from "node:crypto";
import { type FSWatcher, unwatchFile, watch, watchFile } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogSet } from "#catalog/link.ts";
import { type CheckOutput, checkModel } from "#core/check/check.ts";
import { type ModelOutputs, modelOutputs, outputAccessors } from "#core/check/outputs.ts";
import { applyBatchLive, type CommandResult } from "#core/commands/apply.ts";
import { type DryEffects, effectsOf } from "#core/commands/dry.ts";
import { sharedDerives } from "#core/commands/helpers.ts";
import { History, type LogEntry, type Step, stepText, stepWords } from "#core/commands/history.ts";
import type { CatalogPlaces, CommandEnv, State } from "#core/commands/types.ts";
import { type Arrangements, arrange, type JointKind } from "#core/corners/arrange.ts";
import { localDate } from "#core/dates.ts";
import { type Derived, derive } from "#core/derive/derive.ts";
import { type Diagnostic, sortDiagnostics } from "#core/diagnostics.ts";
import type { ItemSource } from "#core/items.ts";
import { lockHash, pinLock } from "#core/lock/pin.ts";
import { documentRefs, lockCovers } from "#core/lock/refs.ts";
import { LOCK_FILE, type Lock, lockText } from "#core/lock/schema.ts";
import { lockItems } from "#core/lock/source.ts";
import { projectText } from "#core/project/canonical.ts";
import { gitStamp } from "#core/project/git.ts";
import { catalogPlaces, DOCUMENT, openLiveCatalogs } from "#core/project/open.ts";
import { parseProject } from "#core/project/parse.ts";
import type { CornerRule } from "#core/project/schema.ts";
import { keepRejected, readDocument, readLock, writeAtomic } from "#core/project/store.ts";
import { type SaveResult, saveRevision } from "#core/revision/files.ts";
import type { V3 } from "#core/vec.ts";

/**
 * The server owns the document (design §7.1, review M1). One `ProjectHost` per project holds the
 * document and its lock in memory with one command queue: commands from tabs and the CLI, undo,
 * redo, and direct edits of the files, each in turn. A step is applied, its files are written
 * (the lock, then the document, each atomically), and only then is it committed to the history
 * and broadcast, so a failed write leaves no step behind.
 *
 * A direct edit is read by the watcher; the server's own writes are recognised by hash. A valid
 * edit enters the log as one `file` step. An invalid one makes the project read-only: every
 * client is told why, commands are refused, until the file is valid again or someone chooses
 * "restore last good", which writes the last good state back.
 *
 * Valid means what §7.4 says: the document is strict JSON that validates against the document
 * schema, and the lock, if there is one, against the lock schema. Cross-reference problems are
 * not invalidity: derive draws a half-edited document with diagnostics (§1, principle 8), as it
 * does for one a command left.
 */

export type Status =
  | { readOnly: false }
  | {
      readOnly: true;
      /** `file`: the files on disk are not valid; `write`: the server could not write them. */
      reason: "file" | "write";
      message: string;
      diagnostics: Diagnostic[];
    };

/** A step in a few words, for the undo and redo buttons and the log. */
export interface StepInfo {
  rev: number;
  source: string;
  /** Its commands by name. */
  what: string;
  /** In words, as a person reads it (BE-4). */
  text: string;
}

export interface DiagnosticsDelta {
  new: Diagnostic[];
  resolved: Diagnostic[];
  counts: { error: number; warn: number; info: number };
}

/** What the event stream carries (design §7.1: each revision is broadcast). */
export type HostEvent =
  | {
      type: "rev";
      rev: number;
      source: string;
      what: string;
      /** The step in words (BE-4); for an undo or redo, "undo …" or "redo …". */
      text: string;
      /** For an undo or redo: the revision of the step taken back or applied again. */
      of?: number;
      changes?: { created: string[]; removed: string[]; changed: string[] };
      diagnostics: DiagnosticsDelta;
      undo: StepInfo | null;
      redo: StepInfo | null;
    }
  | { type: "status"; rev: number; status: Status };

export interface Summary {
  rev: number;
  name?: string;
  status: Status;
  undo: StepInfo | null;
  redo: StepInfo | null;
}

/** One revision's derived model, its outputs and its checks, each computed once. */
export interface Snapshot {
  rev: number;
  state: State;
  items: ItemSource;
  derived: Derived;
  /** What every output states (§5.4): the content hash of the lock it derives from. */
  stamp: { lock: string };
  /** The cut list, the BOM and the priced order (§5.1 stage 5), each on first use, stamped. */
  outputs: ModelOutputs;
  /** The checks of `alukit check`, whose `mass()` and `cost()` read the outputs (§4.9). */
  check: CheckOutput;
  /** Problems with the catalogs the project names, as last opened. */
  catalogs: Diagnostic[];
}

export interface CommandsRequest {
  commands: readonly unknown[];
  source: string;
  /** Makes a retry harmless: the server remembers recent ids and their answers (§7.1). */
  id?: string;
  /** Advisory; with `strict`, a stale base revision is refused. */
  baseRev?: number;
  strict?: boolean;
}

export type CommandsAnswer =
  | {
      ok: true;
      rev: number;
      source: string;
      results: CommandResult[];
      diagnostics: DiagnosticsDelta;
      /** The steps made since `baseRev`, by others, before this one. */
      between: LogEntry[];
    }
  | { ok: false; kind: "refused"; failed: unknown; rev: number }
  | { ok: false; kind: "read-only"; status: Status; rev: number }
  | { ok: false; kind: "stale"; rev: number; between: LogEntry[] }
  | { ok: false; kind: "write"; message: string; rev: number };

/** A dry run's answer (BE-2): what the step would do; `rev` is the revision it ran against. */
export type DryRunAnswer =
  | {
      ok: true;
      rev: number;
      source: string;
      results: CommandResult[];
      /** Every id the step would create, in order. */
      created: string[];
      diagnostics: DiagnosticsDelta;
      effects: DryEffects;
    }
  | { ok: false; kind: "refused"; failed: unknown; rev: number }
  | { ok: false; kind: "read-only"; status: Status; rev: number };

/** The corners' arrangements (S5.5): every rule's, against `rev`; or why there are none. */
export type ArrangementsAnswer =
  | ({ ok: true; rev: number } & Arrangements)
  | { ok: false; kind: "read-only"; status: Status; rev: number };

export type HistoryAnswer =
  | { ok: true; rev: number; step: StepInfo; undo: StepInfo | null; redo: StepInfo | null }
  | { ok: false; kind: "nothing" | "read-only" | "write"; message: string; rev: number };

export interface HostOptions {
  /** The project folder, already resolved (`realpath`). */
  dir: string;
  builtinDir?: string;
  /** Today's date for records (YYYY-MM-DD). */
  today?: () => string;
  /** Watch the files for direct edits (default true). */
  watch?: boolean;
  /** How long the watcher waits for a burst of file events to settle, in ms (default 50). */
  settleMs?: number;
  /** The interval of the polling safety net beside `fs.watch`, in ms (default 1000; 0: none). */
  pollMs?: number;
  /** The clock that names a file restore keeps (`.alukit/rejected/<UTC time>.json`). */
  now?: () => Date;
}

/** The project could not be opened: its files are not valid (§7.4). */
export class HostOpenError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => d.message).join("; "));
    this.name = "HostOpenError";
    this.diagnostics = diagnostics;
  }
}

const RECENT_IDS = 256;

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function counts(ds: readonly Diagnostic[]) {
  return {
    error: ds.filter((d) => d.severity === "error").length,
    warn: ds.filter((d) => d.severity === "warn").length,
    info: ds.filter((d) => d.severity === "info").length,
  };
}

function key(d: Diagnostic): string {
  return JSON.stringify([d.severity, d.code, d.entity ?? "", d.field ?? "", d.message]);
}

function info(step: Step | undefined): StepInfo | null {
  return step
    ? { rev: step.rev, source: step.source, what: stepText(step), text: stepWords(step) }
    : null;
}

/** What the files on disk hold, read and validated. */
interface Files {
  docText?: string;
  lockText?: string;
  state?: { doc: Record<string, unknown>; lock: Lock | undefined };
  problems: Diagnostic[];
}

async function readFiles(dir: string): Promise<Files> {
  const doc = await readDocument(dir);
  const lock = await readLock(dir);
  const problems = [...doc.diagnostics, ...lock.diagnostics];
  const raw = doc.value;
  if (raw !== undefined) {
    // The document schema (§7.4): what parseProject reports as a schema error.
    for (const d of parseProject(raw).diagnostics) if (d.code === "schema") problems.push(d);
  }
  const out: Files = {
    ...(doc.text !== undefined ? { docText: doc.text } : {}),
    ...(lock.text !== undefined ? { lockText: lock.text } : {}),
    problems,
  };
  if (problems.length === 0 && raw !== undefined) {
    out.state = { doc: raw as Record<string, unknown>, lock: lock.value };
  }
  return out;
}

export class ProjectHost {
  readonly dir: string;
  private readonly opts: HostOptions;
  private readonly history: History;
  private statusValue: Status = { readOnly: false };
  /** Hashes of the files as the server last wrote or read them. */
  private disk: { doc?: string; lock?: string };
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(e: HostEvent) => void>();
  private readonly recent = new Map<string, Promise<CommandsAnswer>>();
  private snap: Snapshot;
  /** The current revision in other variants than the default, each computed on first ask. */
  private variantSnaps = new Map<string, Snapshot>();
  private catalogDiagnostics: Diagnostic[];
  /** The live catalogs as last opened, and when: the catalog browser reads them (§8). */
  private live: { set: CatalogSet; named: string[]; at: number } | undefined;
  private watcher: FSWatcher | undefined;
  /** The stat poll's listener, to remove exactly it on close. */
  private poll: (() => void) | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** Where a command may take a catalog from: the built-in ids, folders inside the project. */
  private readonly places: CatalogPlaces;

  private constructor(
    opts: HostOptions,
    state: State,
    disk: { doc?: string; lock?: string },
    live: { set: CatalogSet; diagnostics: Diagnostic[]; named: string[] },
    places: CatalogPlaces,
  ) {
    this.dir = opts.dir;
    this.opts = opts;
    this.places = places;
    this.history = new History(state);
    this.disk = disk;
    this.catalogDiagnostics = live.diagnostics;
    this.live = { set: live.set, named: live.named, at: Date.now() };
    this.snap = this.compute();
  }

  /**
   * Opens a project the server will own. The caller holds `.alukit/edit.lock`. A missing lock,
   * or one that does not cover the document, is completed from the live catalogs and written
   * (§4.13), as the first command would. Invalid files refuse to open.
   */
  static async open(opts: HostOptions): Promise<ProjectHost> {
    const files = await readFiles(opts.dir);
    if (!files.state) throw new HostOpenError(files.problems);
    const raw = files.state.doc;
    const live = await openLiveCatalogs(opts.dir, raw, opts.builtinDir);
    let lock = files.state.lock;
    const refs = documentRefs(raw);
    const disk: { doc?: string; lock?: string } = {
      ...(files.docText !== undefined ? { doc: sha(files.docText) } : {}),
      ...(files.lockText !== undefined ? { lock: sha(files.lockText) } : {}),
    };
    if (!lock || !lockCovers(lock, refs)) {
      lock = pinLock(live.set, refs, lock, { kind: "add" }).lock;
      const text = lockText(lock);
      await writeAtomic(join(opts.dir, LOCK_FILE), text);
      disk.lock = sha(text);
    }
    const places = await catalogPlaces(opts.dir, opts.builtinDir);
    const host = new ProjectHost(opts, { doc: raw, lock }, disk, live, places);
    if (opts.watch !== false) {
      host.startWatching();
      // An edit between the read above and the watchers starting would be reported by neither:
      // the stat poll's baseline is taken as it starts. Read once more now; anything later, the
      // poll sees even while fs.watch's own stream is still starting (macOS FSEvents starts
      // it after `watch` returns).
      await host.checkFiles();
    }
    return host;
  }

  get rev(): number {
    return this.history.rev;
  }

  get status(): Status {
    return this.statusValue;
  }

  get state(): State {
    return this.history.current;
  }

  summary(): Summary {
    const name = this.state.doc.name;
    return {
      rev: this.rev,
      ...(typeof name === "string" ? { name } : {}),
      status: this.statusValue,
      undo: info(this.history.undoStep),
      redo: info(this.history.redoStep),
    };
  }

  log(): readonly LogEntry[] {
    return this.history.log();
  }

  /** Today's date, YYYY-MM-DD: what records carry, and the order's date unless one is given. */
  today(): string {
    return (this.opts.today ?? localDate)();
  }

  /**
   * The current revision's derived model and checks, in a variant (§4.10): the one named, else
   * the document's default, as `--variant` on the CLI. A name the document does not list is the
   * caller's to refuse first (`selectedVariant`); here it derives with derive's own error.
   */
  snapshot(variant?: string): Snapshot {
    if (variant === undefined || variant === this.snap.derived.variant) return this.snap;
    let s = this.variantSnaps.get(variant);
    if (!s) {
      s = this.compute(variant);
      this.variantSnaps.set(variant, s);
    }
    return s;
  }

  /**
   * The live catalogs the document names (§3.1), and their ids, for browsing them (§8). They
   * are opened again for each batch and each direct edit (M4a decision 13); a browse longer
   * than `maxAgeMs` after the last open opens them again, so a catalog edited while the server
   * runs is seen. Reading only: the queue is not needed.
   */
  async catalogs(maxAgeMs = 5000): Promise<{ set: CatalogSet; named: string[] }> {
    const now = Date.now();
    if (!this.live || now - this.live.at > maxAgeMs) {
      const live = await openLiveCatalogs(this.dir, this.state.doc, this.opts.builtinDir);
      this.live = { set: live.set, named: live.named, at: now };
    }
    return { set: this.live.set, named: this.live.named };
  }

  subscribe(listener: (e: HostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Applies a batch of commands as one step (§6, §7.1). */
  commands(req: CommandsRequest): Promise<CommandsAnswer> {
    if (req.id !== undefined) {
      const seen = this.recent.get(req.id);
      if (seen) return seen;
    }
    const answer = this.run(() => this.applyNow(req));
    if (req.id !== undefined) {
      this.recent.set(req.id, answer);
      if (this.recent.size > RECENT_IDS) {
        const oldest = this.recent.keys().next().value as string;
        this.recent.delete(oldest);
      }
    }
    return answer;
  }

  /**
   * A dry run (BE-2, D-UX-11): the batch applied and derived in the command queue, against the
   * revision after every step queued before it, the files read first as for a step. It writes,
   * logs and broadcasts nothing, and answers what the step would add: the diagnostics, the ids
   * it would create, and the effects on what is derived. Not remembered by id: a dry run and a
   * real step never share an answer.
   */
  dryRun(req: Pick<CommandsRequest, "commands" | "source">): Promise<DryRunAnswer> {
    return this.run(async () => {
      await this.takeInFiles();
      const rev = this.rev;
      if (this.statusValue.readOnly) {
        return { ok: false, kind: "read-only", status: this.statusValue, rev };
      }
      const { r, now, derived } = await this.tryBatch(req.commands);
      this.adoptCatalogs(now);
      if (!r.ok) return { ok: false, kind: "refused", failed: r.failed, rev };
      const after = this.compute(undefined, r.state, derived(r.state));
      return {
        ok: true,
        rev,
        source: req.source,
        results: r.results,
        created: r.results.flatMap((x) => x.created),
        diagnostics: deltaOf(this.snap, after),
        effects: effectsOf(this.snap.derived, after.derived, r.results),
      };
    });
  }

  /**
   * Every corner rule's arrangement of the corners at these points (S5.5, `arrange`): one
   * request in the command queue against the revision after every step queued before it, the
   * files read first, as a dry run is; it writes, logs and broadcasts nothing. The catalogs are
   * opened once, and the rules share the derive of the state the corners' butts leave.
   */
  arrangements(req: {
    at: readonly V3[];
    rules?: readonly CornerRule[];
    joints?: readonly JointKind[];
  }): Promise<ArrangementsAnswer> {
    return this.run(async () => {
      await this.takeInFiles();
      const rev = this.rev;
      if (this.statusValue.readOnly) {
        return { ok: false, kind: "read-only", status: this.statusValue, rev };
      }
      const now = await openLiveCatalogs(this.dir, this.state.doc, this.opts.builtinDir);
      this.adoptCatalogs(now);
      const a = await arrange({
        state: this.state,
        derived: this.snap.derived,
        at: req.at,
        ...(req.rules ? { rules: req.rules } : {}),
        ...(req.joints ? { joints: req.joints } : {}),
        env: this.env(now.set),
        open: async (catalogs) =>
          (await openLiveCatalogs(this.dir, { catalogs }, this.opts.builtinDir)).set,
      });
      return { ok: true, rev, ...a };
    });
  }

  /** Takes back the latest step, whoever made it (§7.1). */
  undo(source: string): Promise<HistoryAnswer> {
    return this.run(() => this.move("undo", source));
  }

  redo(source: string): Promise<HistoryAnswer> {
    return this.run(() => this.move("redo", source));
  }

  /**
   * "Restore last good" (§7.1): writes the last good state over files that are not valid. What
   * it writes over is kept first in `.alukit/rejected/` (BE-9), and the answer names it: the one
   * action that could lose a person's typing loses nothing.
   */
  restore(): Promise<{ ok: boolean; rev: number; message?: string; kept?: string[] }> {
    return this.run(async () => {
      // A fix saved a moment ago, before the watcher saw it, is not to be overwritten.
      await this.takeInFiles();
      if (!this.statusValue.readOnly) {
        return { ok: true, rev: this.rev, message: "the files already hold the current state" };
      }
      let kept: string[];
      try {
        // Each file as it stands, when it differs from what is written over it.
        const [doc, lock] = await Promise.all(
          [DOCUMENT, LOCK_FILE].map((f) =>
            readFile(join(this.dir, f), "utf8").catch(() => undefined),
          ),
        );
        kept = await keepRejected(
          this.dir,
          {
            ...(doc !== undefined && doc !== projectText(this.state.doc) ? { doc } : {}),
            ...(lock !== undefined && lock !== lockText(this.state.lock) ? { lock } : {}),
          },
          (this.opts.now ?? (() => new Date()))(),
        );
        await this.write(this.state, true);
      } catch (e) {
        this.setStatus(writeFailure(e));
        return {
          ok: false,
          rev: this.rev,
          message: (this.statusValue as { message: string }).message,
        };
      }
      this.setStatus({ readOnly: false });
      return { ok: true, rev: this.rev, ...(kept.length > 0 ? { kept } : {}) };
    });
  }

  /**
   * Saves a revision of the current state (§4.13) into `revisions/`, in the queue: between
   * steps, after any direct edit not yet taken in. Refused while read-only: the files are not
   * what the server holds.
   */
  saveRevision(input: {
    name: string;
    asOf: string;
    version: string;
  }): Promise<SaveResult | { ok: false; kind: "read-only"; message: string }> {
    return this.run(async () => {
      await this.takeInFiles();
      if (this.statusValue.readOnly) {
        return {
          ok: false as const,
          kind: "read-only" as const,
          message: this.statusValue.message,
        };
      }
      const { doc, lock } = this.state;
      return saveRevision(this.dir, {
        name: input.name,
        document: doc,
        lock,
        asOf: input.asOf,
        version: input.version,
        node: process.version,
        git: (await gitStamp(this.dir)) ?? null,
      });
    });
  }

  /** Reads the files now, as the watcher does after an event; resolves when it is handled. */
  checkFiles(): Promise<void> {
    return this.run(() => this.takeInFiles());
  }

  /** Resolves when everything queued so far has run. */
  settled(): Promise<void> {
    return this.run(async () => {});
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.watcher?.close();
    if (this.poll) {
      unwatchFile(join(this.dir, DOCUMENT), this.poll);
      unwatchFile(join(this.dir, LOCK_FILE), this.poll);
    }
    await this.settled();
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------------------------

  /** The one command queue: every change runs here, in turn. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => {});
    return next;
  }

  private env(live: CatalogSet): CommandEnv {
    return { today: this.today(), live, catalogs: this.places };
  }

  /**
   * Applies a batch to the current state with the catalogs at hand, opened afresh (M4a decision
   * 13); a command that changes the catalogs the document names has them opened before it runs.
   * `now` is the current document's catalogs, `after` those the batch ends with: the host takes
   * the second only once the step is written.
   */
  private async tryBatch(commands: readonly unknown[]) {
    const now = await openLiveCatalogs(this.dir, this.state.doc, this.opts.builtinDir);
    let after = now;
    // One derive per state (review M6): the current state's is the snapshot's, and the batch's
    // last state is derived once, by the batch or after it, for the answer and the snapshot.
    const snap = this.snap;
    const env = sharedDerives({
      ...this.env(now.set),
      derived: (s) => (s === snap.state ? snap.derived : undefined),
    });
    const r = await applyBatchLive(this.state, commands, env, async (catalogs) => {
      after = await openLiveCatalogs(this.dir, { catalogs }, this.opts.builtinDir);
      return after.set;
    });
    return { r, now, after, derived: env.derived };
  }

  private adoptCatalogs(live: { set: CatalogSet; diagnostics: Diagnostic[]; named: string[] }) {
    this.catalogDiagnostics = live.diagnostics;
    this.live = { set: live.set, named: live.named, at: Date.now() };
  }

  private async applyNow(req: CommandsRequest): Promise<CommandsAnswer> {
    // A direct edit the watcher has not reported yet (it waits for a burst to settle) comes
    // first: otherwise this step's write would replace it unseen.
    await this.takeInFiles();
    const rev0 = this.rev;
    // The revisions in between and their sources (§7.1); their commands are the log's alone.
    const between = this.log()
      .filter((e) => req.baseRev !== undefined && e.rev > req.baseRev && e.rev <= rev0)
      .map(({ commands: _, ...e }) => e);
    if (this.statusValue.readOnly) {
      return { ok: false, kind: "read-only", status: this.statusValue, rev: rev0 };
    }
    if (req.strict && req.baseRev !== undefined && req.baseRev !== rev0) {
      return { ok: false, kind: "stale", rev: rev0, between };
    }
    const { r, now, after, derived } = await this.tryBatch(req.commands);
    this.adoptCatalogs(now);
    if (!r.ok) return { ok: false, kind: "refused", failed: r.failed, rev: rev0 };
    try {
      await this.write(r.state);
    } catch (e) {
      this.setStatus(writeFailure(e));
      return { ok: false, kind: "write", message: (e as Error).message, rev: rev0 };
    }
    this.adoptCatalogs(after);
    const before = this.snap;
    const rev = this.history.commit(req.commands, r.results, r.state, req.source);
    const changes = {
      created: r.results.flatMap((x) => x.created),
      removed: r.results.flatMap((x) => x.removed),
      changed: r.results.flatMap((x) => x.changed),
    };
    const delta = this.advance(before, { state: r.state, derived: derived(r.state) });
    this.emit({
      type: "rev",
      rev,
      source: req.source,
      what: stepText(this.history.undoStep as Step),
      text: stepWords(this.history.undoStep as Step),
      changes,
      diagnostics: delta,
      undo: info(this.history.undoStep),
      redo: info(this.history.redoStep),
    });
    return { ok: true, rev, source: req.source, results: r.results, diagnostics: delta, between };
  }

  private async move(which: "undo" | "redo", source: string): Promise<HistoryAnswer> {
    await this.takeInFiles();
    const rev0 = this.rev;
    if (this.statusValue.readOnly) {
      return { ok: false, kind: "read-only", message: this.statusValue.message, rev: rev0 };
    }
    const step = which === "undo" ? this.history.undoStep : this.history.redoStep;
    if (!step) return { ok: false, kind: "nothing", message: `nothing to ${which}`, rev: rev0 };
    try {
      await this.write(which === "undo" ? step.before : step.after);
    } catch (e) {
      this.setStatus(writeFailure(e));
      return { ok: false, kind: "write", message: (e as Error).message, rev: rev0 };
    }
    const before = this.snap;
    if (which === "undo") this.history.undo(source);
    else this.history.redo(source);
    const delta = this.advance(before);
    const entry = this.log()[this.log().length - 1] as LogEntry;
    this.emit({
      type: "rev",
      rev: this.rev,
      source,
      what: entry.what,
      text: entry.text,
      of: step.rev,
      diagnostics: delta,
      undo: info(this.history.undoStep),
      redo: info(this.history.redoStep),
    });
    return {
      ok: true,
      rev: this.rev,
      step: info(step) as StepInfo,
      undo: info(this.history.undoStep),
      redo: info(this.history.redoStep),
    };
  }

  /**
   * The watcher's work: read the files; ignore the server's own writes (by hash); take a valid
   * edit in as a `file` step; go read-only on an invalid one; come back when they are valid.
   */
  private async takeInFiles(): Promise<void> {
    if (this.closed) return;
    const files = await readFiles(this.dir);
    const docHash = files.docText === undefined ? undefined : sha(files.docText);
    const lockHash = files.lockText === undefined ? undefined : sha(files.lockText);
    if (docHash === this.disk.doc && lockHash === this.disk.lock) return;

    if (!files.state) {
      this.disk = {
        ...(docHash !== undefined ? { doc: docHash } : {}),
        ...(lockHash !== undefined ? { lock: lockHash } : {}),
      };
      this.setStatus({
        readOnly: true,
        reason: "file",
        message: `the files are not valid: ${files.problems[0]?.message ?? "unreadable"}`,
        diagnostics: sortDiagnostics(files.problems),
      });
      return;
    }

    // Valid. The lock, edited or deleted with it, is completed from the live catalogs.
    const raw = files.state.doc;
    let lock = files.state.lock ?? this.state.lock;
    const live = await openLiveCatalogs(this.dir, raw, this.opts.builtinDir);
    this.catalogDiagnostics = live.diagnostics;
    this.live = { set: live.set, named: live.named, at: Date.now() };
    const refs = documentRefs(raw);
    let lockWritten: string | undefined;
    if (!files.state.lock || !lockCovers(lock, refs)) {
      lock = pinLock(live.set, refs, lock, { kind: "add" }).lock;
      lockWritten = lockText(lock);
    }
    this.disk = {
      ...(docHash !== undefined ? { doc: docHash } : {}),
      ...(lockHash !== undefined ? { lock: lockHash } : {}),
    };
    if (lockWritten !== undefined) {
      try {
        await writeAtomic(join(this.dir, LOCK_FILE), lockWritten);
        this.disk.lock = sha(lockWritten);
      } catch (e) {
        this.setStatus(writeFailure(e));
        return;
      }
    }
    const next: State = { doc: raw, lock };
    const same =
      projectText(next.doc) === projectText(this.state.doc) &&
      lockText(next.lock) === lockText(this.state.lock);
    if (!same) {
      const before = this.snap;
      const rev = this.history.record(next, "file");
      const delta = this.advance(before);
      this.emit({
        type: "rev",
        rev,
        source: "file",
        what: "file edit",
        text: stepWords({}),
        diagnostics: delta,
        undo: info(this.history.undoStep),
        redo: info(this.history.redoStep),
      });
    }
    if (this.statusValue.readOnly) this.setStatus({ readOnly: false });
  }

  /**
   * Writes a state: the lock, then the document (§7.1), each atomically, and only the files
   * whose canonical text differs from what is on disk; `force` writes both.
   */
  private async write(state: State, force = false): Promise<void> {
    const lt = lockText(state.lock);
    const dt = projectText(state.doc);
    const lh = sha(lt);
    const dh = sha(dt);
    if (force || lh !== this.disk.lock) {
      await writeAtomic(join(this.dir, LOCK_FILE), lt);
      this.disk.lock = lh;
    }
    if (force || dh !== this.disk.doc) {
      await writeAtomic(join(this.dir, DOCUMENT), dt);
      this.disk.doc = dh;
    }
  }

  /** A state's snapshot; `known`, a derive of that state in the default variant already made. */
  private compute(variant?: string, state: State = this.state, known?: Derived): Snapshot {
    const items = lockItems(state.lock);
    const derived =
      known !== undefined && variant === undefined ? known : derive(state.doc, items, { variant });
    const stamp = { lock: lockHash(state.lock) };
    const outputs = modelOutputs(derived, items, stamp);
    // The same checks as `alukit check` and a headless `alukit do`: mass() and cost() evaluate.
    const check = checkModel({
      raw: state.doc,
      derived,
      items,
      accessors: outputAccessors(outputs),
    });
    return {
      rev: this.rev,
      state,
      items,
      derived,
      stamp,
      outputs,
      check,
      catalogs: this.catalogDiagnostics,
    };
  }

  /** Moves the snapshot to the current revision; the diagnostics it added and resolved. */
  private advance(before: Snapshot, known?: { state: State; derived: Derived }): DiagnosticsDelta {
    const state = this.state;
    this.snap = this.compute(undefined, state, known?.state === state ? known.derived : undefined);
    this.variantSnaps.clear();
    return deltaOf(before, this.snap);
  }

  private setStatus(s: Status): void {
    this.statusValue = s;
    this.emit({ type: "status", rev: this.rev, status: s });
  }

  private emit(e: HostEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // A listener that fails (a closed stream) must not stop the others.
      }
    }
  }

  private startWatching(): void {
    const names = new Set([DOCUMENT, LOCK_FILE]);
    const poke = () => {
      if (this.closed) return;
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = undefined;
        void this.checkFiles();
      }, this.opts.settleMs ?? 50);
    };
    // The folder, not the files: an editor that saves by rename replaces the file's inode.
    try {
      this.watcher = watch(this.dir, { persistent: false }, (_event, name) => {
        if (name === null || names.has(String(name))) poke();
      });
      this.watcher.on("error", () => {
        // The polling below still sees the files.
      });
    } catch {
      // A file system without change events: the polling below is the watcher.
    }
    // `fs.watch` is not reliable on every file system (Node's docs, "Caveats"); a slow stat poll
    // beside it costs little, and a duplicate check is harmless (it compares hashes).
    const pollMs = this.opts.pollMs ?? 1000;
    if (pollMs > 0) {
      this.poll = poke;
      for (const n of names) {
        watchFile(join(this.dir, n), { interval: pollMs, persistent: false }, poke);
      }
    }
  }
}

/** The diagnostics a step added and resolved, going from one snapshot to the next. */
function deltaOf(before: Snapshot, after: Snapshot): DiagnosticsDelta {
  const was = new Set(before.check.diagnostics.map(key));
  const now = new Set(after.check.diagnostics.map(key));
  return {
    new: after.check.diagnostics.filter((d) => !was.has(key(d))),
    resolved: before.check.diagnostics.filter((d) => !now.has(key(d))),
    counts: counts(after.check.diagnostics),
  };
}

function writeFailure(e: unknown): Status {
  const message = `cannot write the project files: ${e instanceof Error ? e.message : String(e)}`;
  return {
    readOnly: true,
    reason: "write",
    message,
    diagnostics: [{ severity: "error", code: "write", message }],
  };
}
