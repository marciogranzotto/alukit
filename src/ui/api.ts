import { type SseMessage, SseParser } from "./sse.ts";

/**
 * The app's side of the server (design §7.2). `alukit serve` opens `/#t=<token>`: a fragment
 * never reaches a server or a `Referer`. The app moves it to `sessionStorage` (this tab only),
 * clears it from the address bar, and sends it as `Authorization` on every `/api` request. The
 * event stream is read with `fetch`, not `EventSource`, so it carries the header too.
 */

const KEY = "alukit.token";

/** Takes the token from the fragment, once, and keeps it for this tab. */
export function adoptToken(): string | undefined {
  const m = /^#t=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (m) {
    sessionStorage.setItem(KEY, m[1] as string);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
  return sessionStorage.getItem(KEY) ?? undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `the server answered ${status}`,
    );
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function headers(json: boolean): Record<string, string> {
  const t = sessionStorage.getItem(KEY);
  return {
    ...(t ? { authorization: `Bearer ${t}` } : {}),
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: headers(false), cache: "no-store" });
  const body = await r.json().catch(() => undefined);
  if (!r.ok) throw new ApiError(r.status, body);
  return body as T;
}

/** A POST whose answer is returned whatever its status: refusals are answers too. */
export async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(path, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
}

/**
 * Reads the event stream until it ends or `signal` aborts, handing each event over. Reconnecting
 * is the caller's: a client that misses an event refetches (§7.1).
 */
export async function readEvents(
  onEvent: (m: SseMessage) => void,
  signal: AbortSignal,
): Promise<void> {
  const r = await fetch("/api/events", { headers: headers(false), signal, cache: "no-store" });
  if (!r.ok || !r.body) throw new ApiError(r.status, undefined);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    for (const m of parser.push(decoder.decode(value, { stream: true }))) onEvent(m);
  }
}
