import { randomBytes } from "node:crypto";
import { access, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseJson } from "#catalog/json.ts";
import { BUILTIN_DIR } from "#catalog/open.ts";
import type { Diagnostic } from "../diagnostics.ts";
import type { ItemSource } from "../items.ts";
import { pinLock } from "../lock/pin.ts";
import { documentRefs, lockCovers } from "../lock/refs.ts";
import { emptyLock, LOCK_FILE, type Lock, LockFile, lockText } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { DOCUMENT, openLiveCatalogs } from "./open.ts";

/**
 * A project folder on disk (design §4.1, §7.1), Node only: reading the document and its lock,
 * writing each atomically (temporary file, fsync, rename), and the edit lock the CLI holds when
 * no server runs. `loadProject` gives derive its items from the lock (§4.13): a missing lock is
 * created on first use and missing entries are added, each with a notice, unless `frozen`.
 */

export const STATE_DIR = ".alukit";
export const EDIT_LOCK = "edit.lock";

export interface ReadResult<T> {
  value?: T;
  /** The file's text, when it was read. */
  text?: string;
  diagnostics: Diagnostic[];
}

/** Reads `alukit.json` strictly (a duplicate key is an error, as for catalogs). */
export async function readDocument(dir: string): Promise<ReadResult<unknown>> {
  let text: string;
  try {
    text = await readFile(join(dir, DOCUMENT), "utf8");
  } catch (e) {
    return {
      diagnostics: [
        {
          severity: "error",
          code: "json",
          message: `cannot read ${DOCUMENT}: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
  const parsed = parseJson(text);
  if (parsed.ok) return { value: parsed.value, text, diagnostics: [] };
  return {
    text,
    diagnostics: parsed.problems.map((p) => ({
      severity: "error",
      code: "json",
      message: `${DOCUMENT}${p.line ? `:${p.line}:${p.col}` : ""}: ${p.message}`,
    })),
  };
}

/** Reads `alukit.lock.json`; no value and no diagnostic when there is none. */
export async function readLock(dir: string): Promise<ReadResult<Lock>> {
  let text: string;
  try {
    text = await readFile(join(dir, LOCK_FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { diagnostics: [] };
    return {
      diagnostics: [
        {
          severity: "error",
          code: "lock",
          message: `cannot read ${LOCK_FILE}: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return {
      text,
      diagnostics: parsed.problems.map((p) => ({
        severity: "error",
        code: "lock",
        message: `${LOCK_FILE}${p.line ? `:${p.line}:${p.col}` : ""}: ${p.message}`,
      })),
    };
  }
  const r = LockFile.safeParse(parsed.value);
  if (r.success) return { value: r.data, text, diagnostics: [] };
  return {
    text,
    diagnostics: r.error.issues.slice(0, 20).map((i) => ({
      severity: "error",
      code: "lock",
      message: `${LOCK_FILE}: ${i.path.join("/")}: ${i.message}`,
    })),
  };
}

/**
 * Writes a file atomically: a temporary file beside it, fsync, rename, then the folder fsync. Text
 * is written as UTF-8; bytes as they are.
 * `mode` sets the new file's permissions from its creation on (a secret is never readable by
 * others, not even for a moment).
 */
export async function writeAtomic(
  path: string,
  text: string | Uint8Array,
  mode?: number,
): Promise<void> {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    const fh = await open(tmp, "wx", mode);
    try {
      // The umask may only take bits away, but say exactly what is meant.
      if (mode !== undefined) await fh.chmod(mode);
      await fh.writeFile(text, typeof text === "string" ? "utf8" : undefined);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  try {
    const d = await open(dirname(path), "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } catch {
    // Not every platform syncs a folder; the rename is atomic either way.
  }
}

/** Where "restore last good" keeps the files it writes over (BE-9, D-UX-15). */
export const REJECTED_DIR = "rejected";

/**
 * Keeps the text of files about to be written over, in `.alukit/rejected/`, named by the UTC
 * time to the second (`2026-11-27T05-30-12Z.json`, the lock as `….lock.json`; colons are not
 * allowed in a file name everywhere), and numbered `-2`, `-3` within a second. Each is created
 * exclusively, so nothing kept is ever written over. Answers the paths kept, relative to the
 * project and with `/`, as a person reads them.
 */
export async function keepRejected(
  dir: string,
  files: { doc?: string; lock?: string },
  now: Date,
): Promise<string[]> {
  const EXTS = [".json", ".lock.json"] as const;
  const kept = [
    ...(files.doc !== undefined ? [{ ext: EXTS[0], text: files.doc }] : []),
    ...(files.lock !== undefined ? [{ ext: EXTS[1], text: files.lock }] : []),
  ];
  if (kept.length === 0) return [];
  const folder = join(dir, STATE_DIR, REJECTED_DIR);
  await mkdir(folder, { recursive: true });
  const time = `${now.toISOString().slice(0, 19).replaceAll(":", "-")}Z`;
  const taken = async (path: string) =>
    access(path).then(
      () => true,
      () => false,
    );
  for (let n = 1; ; n++) {
    const stem = n === 1 ? time : `${time}-${n}`;
    // A stem is one restore's: free only when neither of its names exists, so a set never
    // mixes the document of one restore with the lock of another.
    const names = EXTS.map((ext) => join(folder, `${stem}${ext}`));
    if ((await Promise.all(names.map(taken))).some((t) => t)) continue;
    const handles: Awaited<ReturnType<typeof open>>[] = [];
    try {
      // Created exclusively: a restore racing for the same stem moves on to the next.
      for (const k of kept) handles.push(await open(join(folder, `${stem}${k.ext}`), "wx", 0o600));
    } catch (e) {
      for (const h of handles) await h.close();
      for (const k of kept.slice(0, handles.length)) {
        await unlink(join(folder, `${stem}${k.ext}`)).catch(() => {});
      }
      if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw e;
    }
    for (const [i, h] of handles.entries()) {
      try {
        await h.writeFile((kept[i] as { text: string }).text, "utf8");
        await h.sync();
      } finally {
        await h.close();
      }
    }
    return kept.map((k) => `${STATE_DIR}/${REJECTED_DIR}/${stem}${k.ext}`);
  }
}

/** Writes the lock, then the document (§7.1's order), each atomically. */
export async function writeProject(dir: string, doc: string | undefined, lock: Lock | undefined) {
  if (lock) await writeAtomic(join(dir, LOCK_FILE), lockText(lock));
  if (doc !== undefined) await writeAtomic(join(dir, DOCUMENT), doc);
}

/** Who holds `.alukit/edit.lock`: a process, and what it is when it says (`alukit serve`). */
export interface EditLockHolder {
  pid?: number;
  host?: string;
  started?: string;
  /** `alukit serve` holds the lock for as long as it owns the project (§7.1). */
  by?: string;
}

export class EditLockHeld extends Error {
  readonly holder: EditLockHolder;
  constructor(path: string, holder: EditLockHolder) {
    const who = `${holder.by ? `${holder.by}, ` : ""}process ${holder.pid ?? "?"}${holder.host ? ` on ${holder.host}` : ""}`;
    super(
      `${path} is held by ${who} (started ${holder.started ?? "?"}); ${holder.by === SERVE ? "it owns the project: send edits through it, or stop it" : "wait for it, or delete the file if that process is gone"}`,
    );
    this.name = "EditLockHeld";
    this.holder = holder;
  }
}

/** The `by` of the edit lock the server holds. */
export const SERVE = "alukit serve";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Takes `.alukit/edit.lock` (§7.1): created exclusively, holding the pid, the host and the
 * process's start time, and `by` when the holder says what it is. A lock whose process is gone
 * (same host) is stale and taken over. Returns the release, which removes the file once.
 */
export async function acquireEditLock(dir: string, by?: string): Promise<() => Promise<void>> {
  const stateDir = join(dir, STATE_DIR);
  await mkdir(stateDir, { recursive: true });
  const path = join(stateDir, EDIT_LOCK);
  const me: EditLockHolder = {
    pid: process.pid,
    host: hostname(),
    started: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    ...(by ? { by } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const fh = await open(path, "wx");
      try {
        await fh.writeFile(`${JSON.stringify(me)}\n`, "utf8");
      } finally {
        await fh.close();
      }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let holder: EditLockHolder = {};
      try {
        holder = JSON.parse(await readFile(path, "utf8"));
      } catch {
        // An unreadable lock is treated as held: its writer may be writing it now.
      }
      const stale = typeof holder.pid === "number" && holder.host === me.host && !alive(holder.pid);
      if (!stale || attempt > 0) throw new EditLockHeld(join(STATE_DIR, EDIT_LOCK), holder);
      await unlink(path).catch(() => {});
    }
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await unlink(path).catch(() => {});
  };
}

/** Runs `fn` holding `.alukit/edit.lock` (§7.1); see `acquireEditLock`. */
export async function withEditLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireEditLock(dir);
  try {
    return await fn();
  } finally {
    await release();
  }
}

export interface LoadedProject {
  dir: string;
  /** The parsed document, or undefined when it could not be read. */
  raw: unknown;
  /** The lock derive reads; undefined only when it cannot be read or `frozen` found none. */
  lock: Lock | undefined;
  items: ItemSource;
  /** Problems with the files, the lock and (when they were opened) the catalogs. */
  diagnostics: Diagnostic[];
  /** What was done on the way: a lock created, entries added. */
  notices: string[];
}

export interface LoadOptions {
  /** A missing lock or entry is an error, and nothing is written (`--frozen`, for CI). */
  frozen?: boolean;
  /** Write a created or extended lock (default true). A caller holding the edit lock writes it itself. */
  persist?: boolean;
  builtinDir?: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Opens a project for derive: the document, and items from its lock (§4.13). */
export async function loadProject(dir: string, opts: LoadOptions = {}): Promise<LoadedProject> {
  const doc = await readDocument(dir);
  const empty = lockItems(emptyLock());
  if (doc.value === undefined) {
    return {
      dir,
      raw: undefined,
      lock: undefined,
      items: empty,
      diagnostics: doc.diagnostics,
      notices: [],
    };
  }
  const raw = doc.value;
  const lockRead = await readLock(dir);
  if (lockRead.diagnostics.length > 0) {
    return {
      dir,
      raw,
      lock: undefined,
      items: empty,
      diagnostics: lockRead.diagnostics,
      notices: [],
    };
  }
  const refs = documentRefs(raw);
  const lock = lockRead.value;
  if (lock && lockCovers(lock, refs)) {
    return { dir, raw, lock, items: lockItems(lock), diagnostics: [], notices: [] };
  }

  if (opts.frozen) {
    const diagnostics: Diagnostic[] = [];
    if (!lock) {
      diagnostics.push({
        severity: "error",
        code: "lock",
        message: `${LOCK_FILE} is missing; --frozen derives only from a lock (run alukit lock update)`,
      });
    } else {
      for (const r of [...refs.items, ...refs.materials]) {
        if (Object.hasOwn(lock.items, r) || Object.hasOwn(lock.materials, r)) continue;
        diagnostics.push({
          severity: "error",
          code: "lock",
          entity: r,
          message: `${LOCK_FILE} has no entry for ${r}; --frozen does not add one (run alukit lock update)`,
        });
      }
    }
    return { dir, raw, lock, items: lockItems(lock ?? emptyLock()), diagnostics, notices: [] };
  }

  const live = await openLiveCatalogs(dir, raw, opts.builtinDir ?? BUILTIN_DIR);
  const pinned = pinLock(live.set, refs, lock, { kind: "add" });
  const notices: string[] = [];
  const catalogs = Object.keys(pinned.lock.catalogs).join(", ");
  if (!lock) {
    notices.push(
      `${LOCK_FILE} created: ${plural(Object.keys(pinned.lock.items).length, "item")} pinned from ${catalogs || "no catalog"}`,
    );
  } else if (pinned.added.length > 0) {
    notices.push(
      `${LOCK_FILE}: pinned ${plural(pinned.added.length, "new item")}: ${pinned.added.join(", ")}`,
    );
  }
  if (opts.persist !== false && (!lock || pinned.added.length > 0)) {
    try {
      await withEditLock(dir, () => writeProject(dir, undefined, pinned.lock));
    } catch (e) {
      // Someone else edits the project (a running server pins on its own next step): derive
      // from the pinned lock all the same, and say it was not written.
      if (!(e instanceof EditLockHeld)) throw e;
      notices.push(`${LOCK_FILE} not written: ${e.message}`);
    }
  }
  return {
    dir,
    raw,
    lock: pinned.lock,
    items: lockItems(pinned.lock),
    diagnostics: live.diagnostics,
    notices,
  };
}
