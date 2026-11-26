import { mkdir, readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { STATE_DIR, writeAtomic } from "#core/project/store.ts";

/**
 * `.alukit/owner.json` (design §7.1, §7.2): how the CLI finds the server that owns a project, and
 * the token it needs. It holds a secret, so it is written at mode 0600 in a folder created at
 * 0700, and removed when the server stops, only if it is still this server's.
 */

export const OWNER_FILE = "owner.json";
export const OWNER_SCHEMA = "alukit.owner/1";

export interface Owner {
  schema: typeof OWNER_SCHEMA;
  /** The app's address, without the token. */
  url: string;
  port: number;
  pid: number;
  host: string;
  /** When the server started, ISO 8601. */
  started: string;
  token: string;
}

export function ownerPath(dir: string): string {
  return join(dir, STATE_DIR, OWNER_FILE);
}

export async function writeOwner(
  dir: string,
  o: Omit<Owner, "schema" | "pid" | "host">,
): Promise<Owner> {
  const owner: Owner = { schema: OWNER_SCHEMA, ...o, pid: process.pid, host: hostname() };
  await mkdir(join(dir, STATE_DIR), { recursive: true, mode: 0o700 });
  await writeAtomic(ownerPath(dir), `${JSON.stringify(owner, null, 2)}\n`, 0o600);
  return owner;
}

/** The owner file, or undefined when there is none or it cannot be read as one. */
export async function readOwner(dir: string): Promise<Owner | undefined> {
  let text: string;
  try {
    text = await readFile(ownerPath(dir), "utf8");
  } catch {
    return undefined;
  }
  try {
    const o = JSON.parse(text) as Partial<Owner>;
    if (
      o.schema === OWNER_SCHEMA &&
      typeof o.url === "string" &&
      typeof o.port === "number" &&
      typeof o.pid === "number" &&
      typeof o.host === "string" &&
      typeof o.started === "string" &&
      typeof o.token === "string"
    ) {
      return o as Owner;
    }
  } catch {
    // Not JSON: not an owner file.
  }
  return undefined;
}

/** Removes the owner file if it still names this token: a newer server's file is left alone. */
export async function removeOwner(dir: string, token: string): Promise<void> {
  const o = await readOwner(dir);
  if (o?.token === token) await unlink(ownerPath(dir)).catch(() => {});
}
