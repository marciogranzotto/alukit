import { randomBytes, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Protecting the local server (design §7.2, review M2, n4). A page in the same browser can send
 * requests to 127.0.0.1, or reach it by DNS rebinding, so every request passes these checks
 * before anything else reads it:
 *
 * - `Host` must name this server: `127.0.0.1:<port>` or `localhost:<port>`. A rebinding attack
 *   reaches the socket with the attacker's host name in `Host`, so it stops here.
 * - `Origin`, when present, must be this server's own. A foreign page's fetch, form or preflight
 *   carries its own origin, so it stops here; `null` (a sandboxed frame, a file) is foreign too.
 * - `Sec-Fetch-Site`, when present on an `/api` request, must be `same-origin` or `none`:
 *   defence in depth for the requests where a browser sends no `Origin` (a `no-cors` GET).
 * - Every `/api` request but the health probe carries the per-start token as
 *   `Authorization: Bearer <token>`, compared in constant time.
 * - A request body must be `application/json`, so no HTML form can send one.
 *
 * No CORS header is ever sent, so a foreign page cannot read an answer even if one were given.
 */

/** 256 bits from the system's random source, URL-safe (design §7.2). */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export type Refusal = { status: 403 | 415; reason: string };

/** The hosts a request may name: the loopback address the server binds, and its usual name. */
export function ownHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

export function ownOrigins(port: number): string[] {
  return ownHosts(port).map((h) => `http://${h}`);
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v.join(",") : v;
}

/** `Host` names this server. A missing or repeated header is foreign. */
export function checkHost(headers: IncomingHttpHeaders, port: number): Refusal | undefined {
  const host = header(headers, "host");
  if (host === undefined) return { status: 403, reason: "no Host header" };
  if (!ownHosts(port).includes(host.toLowerCase())) {
    return { status: 403, reason: `Host ${JSON.stringify(host)} is not this server` };
  }
  return undefined;
}

/** `Origin`, when present, is this server's own. */
export function checkOrigin(headers: IncomingHttpHeaders, port: number): Refusal | undefined {
  const origin = header(headers, "origin");
  if (origin === undefined) return undefined;
  if (!ownOrigins(port).includes(origin.toLowerCase())) {
    return { status: 403, reason: `Origin ${JSON.stringify(origin)} is not this server` };
  }
  return undefined;
}

/** `Sec-Fetch-Site`, when the browser sends it, says the request came from this origin or a person. */
export function checkFetchSite(headers: IncomingHttpHeaders): Refusal | undefined {
  const site = header(headers, "sec-fetch-site");
  if (site === undefined || site === "same-origin" || site === "none") return undefined;
  return { status: 403, reason: `a ${site} request` };
}

/** `Authorization: Bearer <token>`, compared in constant time. */
export function checkToken(headers: IncomingHttpHeaders, token: string): Refusal | undefined {
  const auth = header(headers, "authorization");
  const m = auth === undefined ? null : /^Bearer ([A-Za-z0-9_-]+)$/.exec(auth);
  if (!m) return { status: 403, reason: "no token" };
  const given = Buffer.from(m[1] as string);
  const want = Buffer.from(token);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { status: 403, reason: "wrong token" };
  }
  return undefined;
}

/** A body is JSON: `application/json`, with at most a charset parameter. */
export function checkJsonBody(headers: IncomingHttpHeaders): Refusal | undefined {
  const type = header(headers, "content-type");
  const media = type?.split(";")[0]?.trim().toLowerCase();
  if (media === "application/json") return undefined;
  return { status: 415, reason: "a request body must be application/json" };
}

/** True when `path` is `root` itself or lies under it. Both absolute and normalised. */
export function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * A path a request names, resolved inside the project folder with symbolic links followed
 * (design §7.2), or undefined when it leads outside it. The project folder is given already
 * resolved by `realpath`. A path that does not exist yet resolves through its nearest existing
 * parent, so a file about to be written is confined too.
 */
export async function confine(realRoot: string, path: string): Promise<string | undefined> {
  if (path.includes("\0")) return undefined;
  const lexical = isAbsolute(path) ? resolve(path) : resolve(realRoot, path);
  if (!isInside(realRoot, lexical)) return undefined;
  let existing = lexical;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await realpath(existing);
      const out = resolve(real, ...missing);
      return isInside(realRoot, out) ? out : undefined;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
      const parent = resolve(existing, "..");
      if (parent === existing || !isInside(realRoot, parent)) return undefined;
      missing.unshift(relative(parent, existing));
      existing = parent;
    }
  }
}
