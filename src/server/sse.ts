/**
 * The event stream's wire format (design §7.2): server-sent events
 * ([HTML §9.2](https://html.spec.whatwg.org/multipage/server-sent-events.html)), read by the app
 * with `fetch` so the request carries the token. One event per revision or status change; `id`
 * is the revision, so a client sees a gap and refetches.
 */

/** One event as text: `event`, `id`, then the JSON payload on a single `data` line. */
export function sseEvent(type: string, data: unknown, id?: number): string {
  // JSON.stringify never emits a raw newline, so one data line always holds the payload.
  const lines = [`event: ${type}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

/** A comment line: keeps an idle connection from being closed by anything in between. */
export const SSE_PING = ": ping\n\n";
