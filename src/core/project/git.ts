import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

/**
 * The little git a project needs (Node only): the commit and dirty flag a revision's stamp
 * carries as a hint (design §4.13, §9), and a file as it was at a ref, for `alukit diff
 * git:<ref>:<path>`. Git is run with fixed arguments, never through a shell.
 */

interface Run {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: readonly string[]): Promise<Run> {
  return new Promise((done) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        done({ ok: error === null, stdout, stderr });
      },
    );
  });
}

export interface GitStamp {
  commit: string;
  /** The project folder has changes not committed (untracked files count). */
  dirty: boolean;
}

/** The commit HEAD names and whether the project folder differs from it; undefined outside git. */
export async function gitStamp(dir: string): Promise<GitStamp | undefined> {
  const head = await git(dir, ["rev-parse", "--verify", "HEAD"]);
  if (!head.ok) return undefined;
  const status = await git(dir, ["status", "--porcelain", "--", "."]);
  if (!status.ok) return undefined;
  return { commit: head.stdout.trim(), dirty: status.stdout.trim() !== "" };
}

/** The nearest folder at or above `path` that exists now. */
async function nearestFolder(path: string): Promise<string> {
  let p = path;
  for (;;) {
    try {
      if ((await stat(p)).isDirectory()) return p;
    } catch {
      // not there (any more): look further up
    }
    const up = dirname(p);
    if (up === p) return p;
    p = up;
  }
}

/**
 * A file's text at a ref. `path` is resolved against `cwd`; git runs in the nearest folder of it
 * that exists now, so the file is read from the repository that holds it (which need not be the
 * one around `cwd`), as `git show <ref>:./<path>` reads it there. Throws with git's own message
 * when the ref or the path does not exist.
 */
export async function gitShow(cwd: string, ref: string, path: string): Promise<string> {
  const target = resolve(cwd, path);
  const from = await nearestFolder(target);
  const rel = relative(from, target).split(sep).join("/");
  const r = await git(from, ["show", `${ref}:./${rel}`]);
  if (!r.ok) throw new Error(r.stderr.trim() || `git show ${ref}:./${rel} failed`);
  return r.stdout;
}
