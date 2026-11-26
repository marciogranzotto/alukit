import { realpath } from "node:fs/promises";
import { hostname } from "node:os";
import { type Owner, readOwner } from "./owner.ts";

/**
 * The CLI's side of the server (design §7.1, §7.3): it finds the server that owns a project
 * through `.alukit/owner.json`, and sends its commands there, so they appear live in every tab.
 * An owner file whose process is gone, or whose server does not answer for this folder, is
 * stale: the CLI then works headless, as with no server.
 */

export interface ServerLink {
  /** The app's address, ending in "/". */
  url: string;
  token: string;
  pid: number;
}

export interface Answer {
  status: number;
  body: unknown;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Calls the server; a body is sent as JSON. Throws when the server cannot be reached. */
export async function call(
  link: ServerLink,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<Answer> {
  const r = await fetch(new URL(path.replace(/^\//, ""), link.url), {
    method,
    headers: {
      authorization: `Bearer ${link.token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: keep the text, for the message.
  }
  return { status: r.status, body: parsed };
}

/** The server that owns `dir`, or undefined when none runs (or its owner file is stale). */
export async function findServer(dir: string): Promise<ServerLink | undefined> {
  let real: string;
  try {
    real = await realpath(dir);
  } catch {
    return undefined;
  }
  const owner: Owner | undefined = await readOwner(real);
  if (!owner) return undefined;
  if (owner.host === hostname() && !alive(owner.pid)) return undefined;
  const link: ServerLink = { url: owner.url, token: owner.token, pid: owner.pid };
  try {
    const r = await call(link, "GET", "/api/session", undefined, 3000);
    const s = r.body as { dir?: unknown };
    if (r.status === 200 && s.dir === real) return link;
  } catch {
    // Not reachable: a server that died without removing its file, or a reused pid.
  }
  return undefined;
}
