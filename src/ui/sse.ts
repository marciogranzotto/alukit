/**
 * A parser for the server-sent events wire format
 * ([HTML §9.2.6](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)),
 * fed text chunks as `fetch` delivers them (design §7.2: the stream is read with `fetch`, not
 * `EventSource`, so it carries the token). Pure: no DOM, so it is tested in Node.
 */

export interface SseMessage {
  /** The `event` field, or "message" when none was given. */
  event: string;
  data: string;
  /** The last `id` seen, which the spec carries over to later events. */
  id?: string;
}

export class SseParser {
  private buffer = "";
  private data: string[] = [];
  private event = "";
  private lastId: string | undefined;
  private started = false;

  /** Feeds a chunk; returns the events it completes. */
  push(chunk: string): SseMessage[] {
    let text = this.buffer + chunk;
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    const out: SseMessage[] = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c !== "\n" && c !== "\r") continue;
      // A CR at the very end may be the first half of CRLF: wait for the next chunk.
      if (c === "\r" && i === text.length - 1) break;
      this.line(text.slice(start, i), out);
      if (c === "\r" && text[i + 1] === "\n") i++;
      start = i + 1;
    }
    this.buffer = text.slice(start);
    return out;
  }

  private line(line: string, out: SseMessage[]): void {
    if (line === "") {
      if (this.data.length > 0) {
        out.push({
          event: this.event || "message",
          data: this.data.join("\n"),
          ...(this.lastId !== undefined ? { id: this.lastId } : {}),
        });
      }
      this.data = [];
      this.event = "";
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        this.data.push(value);
        break;
      case "event":
        this.event = value;
        break;
      case "id":
        if (!value.includes("\0")) this.lastId = value;
        break;
      default:
        // `retry` and unknown fields: the app reconnects on its own schedule.
        break;
    }
  }
}
