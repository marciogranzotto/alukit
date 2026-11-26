import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "./server.ts";

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("server skeleton", () => {
  it("binds 127.0.0.1, serves files and /api/health, and refuses traversal", async () => {
    const dist = await mkdtemp(join(tmpdir(), "alukit-dist-"));
    await writeFile(join(dist, "index.html"), "<p>hi</p>");
    running = await startServer({ distDir: dist });
    expect(running.url.startsWith("http://127.0.0.1:")).toBe(true);

    const health = await fetch(`${running.url}api/health`);
    expect(await health.json()).toEqual({ ok: true });
    expect(await (await fetch(running.url)).text()).toBe("<p>hi</p>");
    expect((await fetch(`${running.url}missing.js`)).status).toBe(404);
    expect((await fetch(`${running.url}..%2f..%2fetc%2fpasswd`)).status).toBeGreaterThanOrEqual(
      403,
    );
  });
});
