import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "./server.ts";

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** A raw GET: fetch() normalises "..", percent-escapes and the like before sending. */
function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

/** A dist/ with an index.html, a subfolder, and a secret file outside it. */
async function fixture(): Promise<{ dist: string; secret: string }> {
  const base = await mkdtemp(join(tmpdir(), "alukit dist-"));
  const dist = join(base, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), "<p>hi</p>");
  const secret = join(base, "secret.txt");
  await writeFile(secret, "secret");
  return { dist, secret };
}

describe("server skeleton", () => {
  it("binds 127.0.0.1 and serves files and /api/health", async () => {
    const { dist } = await fixture();
    running = await startServer({ distDir: dist });
    expect(running.url.startsWith("http://127.0.0.1:")).toBe(true);

    const health = await fetch(`${running.url}api/health`);
    expect(await health.json()).toEqual({ ok: true });
    expect(await (await fetch(running.url)).text()).toBe("<p>hi</p>");
    expect((await fetch(`${running.url}missing.js`)).status).toBe(404);
    expect((await fetch(`${running.url}assets`)).status).toBe(404);
  });

  it("keeps raw and encoded .. inside dist/", async () => {
    const { dist } = await fixture();
    running = await startServer({ distDir: dist });
    for (const path of [
      "/../secret.txt",
      "/..%2fsecret.txt",
      "/%2e%2e/secret.txt",
      "/a/../../secret.txt",
    ]) {
      const r = await rawGet(running.port, path);
      expect(r.status, path).toBe(404);
      expect(r.body, path).not.toContain("secret");
    }
  });

  it("refuses a symbolic link that leads outside dist/", async () => {
    const { dist, secret } = await fixture();
    await symlink(secret, join(dist, "leak.txt"));
    running = await startServer({ distDir: dist });
    const r = await rawGet(running.port, "/leak.txt");
    expect(r.status).toBe(403);
    expect(r.body).not.toContain("secret");
  });

  it("answers 400 to a malformed escape and keeps running", async () => {
    const { dist } = await fixture();
    running = await startServer({ distDir: dist });
    expect((await rawGet(running.port, "/%E0%A4%A")).status).toBe(400);
    expect((await rawGet(running.port, "/a%00b")).status).toBe(400);
    expect((await rawGet(running.port, "/index.html")).status).toBe(200);
  });
});
