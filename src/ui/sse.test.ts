import { describe, expect, it } from "vitest";
import { SSE_PING, sseEvent } from "../server/sse.ts";
import { SseParser } from "./sse.ts";

/** The event stream's wire format (design §7.2), written by the server and read by the app. */

describe("server-sent events", () => {
  it("round-trip: what the server writes, the app reads, however the chunks fall", () => {
    const events = [
      sseEvent("hello", { rev: 0, name: "Cart: 1200 × 600" }, 0),
      SSE_PING,
      sseEvent("rev", { rev: 1, what: "addBar", text: "line\nbreak" }, 1),
      sseEvent("status", { rev: 1, status: { readOnly: true, message: "é ✓" } }, 1),
    ].join("");
    const want = [
      { event: "hello", data: { rev: 0, name: "Cart: 1200 × 600" }, id: "0" },
      { event: "rev", data: { rev: 1, what: "addBar", text: "line\nbreak" }, id: "1" },
      { event: "status", data: { rev: 1, status: { readOnly: true, message: "é ✓" } }, id: "1" },
    ];
    for (const size of [1, 2, 3, 7, 64, events.length]) {
      const p = new SseParser();
      const got = [];
      for (let i = 0; i < events.length; i += size) got.push(...p.push(events.slice(i, i + size)));
      expect(
        got.map((m) => ({ ...m, data: JSON.parse(m.data) })),
        `chunks of ${size}`,
      ).toEqual(want);
    }
  });

  it("follows the spec's parsing rules: CRLF, multi-line data, default type, comments", () => {
    const p = new SseParser();
    const got = p.push("﻿: hi\r\ndata: a\r\ndata:b\r\n\r\nevent: x\nid: 7\ndata\n\n\n");
    expect(got).toEqual([
      { event: "message", data: "a\nb" },
      { event: "x", data: "", id: "7" },
    ]);
    // A CR that ends a chunk may be half of CRLF.
    expect(p.push("data: c\r")).toEqual([]);
    expect(p.push("\n\r\n")).toEqual([{ event: "message", data: "c", id: "7" }]);
  });
});
