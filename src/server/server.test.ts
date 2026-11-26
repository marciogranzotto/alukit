import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DOCUMENT } from "#core/project/open.ts";
import { acquireEditLock, EditLockHeld, STATE_DIR } from "#core/project/store.ts";
import { scratchFixtures } from "#core/testing.ts";
import { capture } from "../cli/testing.ts";
import { SseParser } from "../ui/sse.ts";
import { ownerPath, readOwner } from "./owner.ts";
import { type RunningServer, startServer } from "./server.ts";

/**
 * The server end to end (design §7.1, §7.2): static files, the security gate in front of
 * everything, the API, the event stream, the owner file and the edit lock, and the CLI sending
 * its commands through a running server.
 */

let running: RunningServer[] = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const r of running) await r.close();
  running = [];
  for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
});

/** A dist/ with an index.html, a subfolder, and a secret file outside it; and a project. */
async function fixture(): Promise<{ dist: string; secret: string; dir: string }> {
  const base = await mkdtemp(join(tmpdir(), "alukit dist-"));
  scratch.push(base);
  const dist = join(base, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), "<p>hi</p>");
  const secret = join(base, "secret.txt");
  await writeFile(secret, "secret");
  const root = await scratchFixtures();
  scratch.push(root);
  return { dist, secret, dir: join(root, "golden-ends", "G27") };
}

async function serve(f?: Awaited<ReturnType<typeof fixture>>) {
  const { dist, dir } = f ?? (await fixture());
  const r = await startServer({ dir, distDir: dist, host: { watch: false } });
  running.push(r);
  return r;
}

interface Raw {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

/** A raw request: fetch() normalises "..", sets Host itself and refuses to send some headers. */
function raw(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Raw> {
  return new Promise((ok, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: opts.method ?? "GET",
        headers: { host: `127.0.0.1:${port}`, ...opts.headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => ok({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on("error", fail);
    req.end(opts.body);
  });
}

const auth = (r: RunningServer) => ({ authorization: `Bearer ${r.token}` });

async function api(r: RunningServer, path: string, body?: unknown) {
  const res = await fetch(new URL(path, r.url), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...auth(r),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("static files", () => {
  it("binds 127.0.0.1 and serves files and /api/health", async () => {
    const r = await serve();
    expect(r.url.startsWith("http://127.0.0.1:")).toBe(true);
    const health = await fetch(`${r.url}api/health`);
    expect(await health.json()).toEqual({ ok: true });
    expect(await (await fetch(r.url)).text()).toBe("<p>hi</p>");
    expect((await fetch(`${r.url}missing.js`)).status).toBe(404);
    expect((await fetch(`${r.url}assets`)).status).toBe(404);
  });

  it("keeps raw and encoded .. inside dist/", async () => {
    const r = await serve();
    for (const path of [
      "/../secret.txt",
      "/..%2fsecret.txt",
      "/%2e%2e/secret.txt",
      "/a/../../secret.txt",
    ]) {
      const res = await raw(r.port, path);
      expect(res.status, path).toBe(404);
      expect(res.body, path).not.toContain("secret");
    }
  });

  it("refuses a symbolic link that leads outside dist/", async () => {
    const f = await fixture();
    await symlink(f.secret, join(f.dist, "leak.txt"));
    const r = await serve(f);
    const res = await raw(r.port, "/leak.txt");
    expect(res.status).toBe(403);
    expect(res.body).not.toContain("secret");
  });

  it("answers 400 to a malformed escape and keeps running", async () => {
    const r = await serve();
    expect((await raw(r.port, "/%E0%A4%A")).status).toBe(400);
    expect((await raw(r.port, "/a%00b")).status).toBe(400);
    expect((await raw(r.port, "/index.html")).status).toBe(200);
  });
});

describe("the security gate (§7.2)", () => {
  it("answers 403 without the token, or with a wrong one", async () => {
    const r = await serve();
    for (const path of ["/api/project", "/api/model", "/api/events", "/api/log", "/api/x"]) {
      expect((await raw(r.port, path)).status, path).toBe(403);
      const wrong = await raw(r.port, path, { headers: { authorization: "Bearer nope" } });
      expect(wrong.status, path).toBe(403);
    }
    const post = await raw(r.port, "/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commands: [{ cmd: "addNode", args: { at: [0, 0, 0] } }],
        source: "ui",
      }),
    });
    expect(post.status).toBe(403);
    expect(r.host.rev).toBe(0);
    expect((await raw(r.port, "/api/project", { headers: auth(r) })).status).toBe(200);
  });

  it("answers 403 to a foreign Host, even with the token: DNS rebinding learns nothing", async () => {
    const r = await serve();
    for (const host of ["evil.example", `evil.example:${r.port}`, `127.0.0.1:${r.port + 1}`]) {
      for (const path of ["/", "/index.html", "/api/health", "/api/project"]) {
        const res = await raw(r.port, path, { headers: { host, ...auth(r) } });
        expect(res.status, `${host} ${path}`).toBe(403);
        expect(res.body).not.toContain("<p>hi</p>");
        expect(res.body).not.toContain('"doc"');
      }
    }
    const local = await raw(r.port, "/api/project", {
      headers: { host: `localhost:${r.port}`, ...auth(r) },
    });
    expect(local.status).toBe(200);
  });

  it("answers 403 to a foreign Origin, also on a preflight, and never sends CORS headers", async () => {
    const r = await serve();
    for (const origin of ["http://evil.example", "null", `http://127.0.0.1:${r.port + 1}`]) {
      const get = await raw(r.port, "/api/project", { headers: { origin, ...auth(r) } });
      expect(get.status, origin).toBe(403);
      const pre = await raw(r.port, "/api/commands", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });
      expect(pre.status, origin).toBe(403);
      for (const res of [get, pre]) {
        expect(Object.keys(res.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
      }
    }
    const own = await raw(r.port, "/api/project", {
      headers: { origin: `http://127.0.0.1:${r.port}`, ...auth(r) },
    });
    expect(own.status).toBe(200);
    expect(Object.keys(own.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
  });

  it("answers 403 to a cross-site fetch and 415 to a body that is not JSON", async () => {
    const r = await serve();
    const cross = await raw(r.port, "/api/project", {
      headers: { "sec-fetch-site": "cross-site", ...auth(r) },
    });
    expect(cross.status).toBe(403);
    const form = await raw(r.port, "/api/commands", {
      method: "POST",
      headers: { "content-type": "text/plain", ...auth(r) },
      body: JSON.stringify({
        commands: [{ cmd: "addNode", args: { at: [0, 0, 0] } }],
        source: "ui",
      }),
    });
    expect(form.status).toBe(415);
    expect(r.host.rev).toBe(0);
  });

  it("writes the token to .alukit/owner.json at mode 0600, holds the edit lock, cleans up", async () => {
    const f = await fixture();
    const r = await serve(f);
    const owner = await readOwner(r.dir);
    expect(owner).toMatchObject({ url: r.url, port: r.port, token: r.token, pid: process.pid });
    expect((await stat(ownerPath(r.dir))).mode & 0o777).toBe(0o600);
    expect(r.appUrl).toBe(`${r.url}#t=${r.token}`);

    // Nobody else edits the project while it runs: not a CLI, not a second server.
    await expect(acquireEditLock(r.dir)).rejects.toThrow(/alukit serve/);
    await expect(
      startServer({ dir: f.dir, distDir: f.dist, host: { watch: false } }),
    ).rejects.toBeInstanceOf(EditLockHeld);

    await r.close();
    running = [];
    expect(await readOwner(r.dir)).toBeUndefined();
    await expect(stat(join(r.dir, STATE_DIR, "edit.lock"))).rejects.toThrow();
  });
});

describe("the API", () => {
  it("applies commands, undoes and redoes, and answers GETs at the same revision", async () => {
    const r = await serve();
    const a = await api(r, "api/commands", {
      commands: [{ cmd: "addNode", args: { at: [1, 2, 3] } }],
      source: "ui",
      id: "x1",
    });
    expect(a).toMatchObject({ status: 200, body: { schema: "alukit.do/1", ok: true, rev: 1 } });
    const refused = await api(r, "api/commands", { commands: [{ cmd: "nope" }], source: "ui" });
    expect(refused).toMatchObject({ status: 422, body: { ok: false, kind: "refused" } });
    const bad = await api(r, "api/commands", { commands: [], source: "file" });
    expect(bad.status).toBe(400);

    const m = await api(r, "api/model");
    expect(m.body).toMatchObject({ schema: "alukit.view/1", rev: 1, name: "G27" });
    const derived = (m.body.derived as { bars: Record<string, unknown> }).bars;
    expect(Object.keys(derived)).toEqual(["b1", "b2", "b3"]);
    const display = m.body.display as { bars: Record<string, { section: string }> };
    expect(display.bars.b1?.section).toBe("test:TS40");

    expect((await api(r, "api/undo", { source: "ui" })).body).toMatchObject({ ok: true, rev: 2 });
    expect((await api(r, "api/redo", { source: "ui" })).body).toMatchObject({ ok: true, rev: 3 });
    expect((await api(r, "api/log")).body.entries).toHaveLength(3);
    for (const path of ["api/derived", "api/cutlist", "api/bom", "api/check", "api/project"]) {
      expect((await api(r, path)).status, path).toBe(200);
    }
    expect((await api(r, "api/check")).body).toMatchObject({ schema: "alukit.check/1", rev: 3 });
  });

  it("evaluates mass() and cost() as alukit check does: the checks read the outputs", async () => {
    const f = await fixture();
    const g26 = join(f.dir, "..", "..", "golden-gen", "G26");
    const r = await serve({ ...f, dir: g26 });
    const a = await api(r, "api/commands", {
      commands: [
        { cmd: "addCheck", args: { check: { value: "cost()", op: "<=", limit: "1" } } },
        { cmd: "addCheck", args: { check: { value: "mass()", op: ">=", limit: "0" } } },
      ],
      source: "ui",
    });
    expect(a.status).toBe(200);
    const served = (await api(r, "api/check")).body as {
      checks: { id: string; pass?: boolean; pending?: boolean; value?: number }[];
    };
    const cli = await capture(["check", g26, "--json"]);
    const headless = JSON.parse(cli.out) as { checks: unknown[] };
    expect(served.checks).toEqual(headless.checks);
    expect(served.checks.map((c) => [c.id, c.pass, c.pending])).toEqual([
      ["C1", false, undefined],
      ["C2", true, undefined],
    ]);
  });

  it("streams each revision and status change in the SSE wire format, read with fetch", async () => {
    const f = await fixture();
    const r = await serve(f);
    const ctrl = new AbortController();
    const res = await fetch(new URL("api/events", r.url), {
      headers: auth(r),
      signal: ctrl.signal,
    });
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const seen: { event: string; data: Record<string, unknown> }[] = [];
    const next = async (event: string) => {
      for (;;) {
        const hit = seen.find((m) => m.event === event);
        if (hit) {
          seen.splice(seen.indexOf(hit), 1);
          return hit.data;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("the stream ended");
        for (const m of parser.push(decoder.decode(value, { stream: true }))) {
          seen.push({ event: m.event, data: JSON.parse(m.data) });
        }
      }
    };
    expect(await next("hello")).toMatchObject({ rev: 0, name: "G27", status: { readOnly: false } });
    await api(r, "api/commands", {
      commands: [{ cmd: "addNode", args: { at: [1, 2, 3] } }],
      source: "cli:t",
    });
    expect(await next("rev")).toMatchObject({ rev: 1, source: "cli:t", what: "addNode" });

    await writeFile(join(f.dir, DOCUMENT), "{ nope");
    await r.host.checkFiles();
    expect(await next("status")).toMatchObject({
      rev: 1,
      status: { readOnly: true, reason: "file" },
    });
    ctrl.abort();
  });
});

describe("the CLI through a running server (§7.1, §7.3)", () => {
  it("sends do, add, undo, redo and log to the server, so the tabs see them live", async () => {
    const r = await serve();
    const d = await capture(["do", r.dir, '{"cmd":"addNode","args":{"at":[1,2,3]}}', "--as", "t"]);
    expect(d).toMatchObject({ code: 0 });
    expect(d.out).toContain("addNode: created n2");
    expect(d.out).toContain("rev 1:");
    expect(r.host.rev).toBe(1);

    const add = await capture(["add", "bar", r.dir, "--a", "n2", "--b", "1,2,500", "--json"]);
    expect(add.code).toBe(0);
    expect(JSON.parse(add.out)).toMatchObject({ ok: true, rev: 2, source: "cli" });

    expect((await capture(["undo", r.dir])).out).toMatch(/^undid rev 2 \(cli: addBar\); rev 3$/);
    expect((await capture(["redo", r.dir, "--as", "me"])).code).toBe(0);
    const log = await capture(["log", r.dir, "--json"]);
    expect(JSON.parse(log.out).entries.map((e: { source: string }) => e.source)).toEqual([
      "cli:t",
      "cli",
      "cli",
      "cli:me",
    ]);

    const refused = await capture(["do", r.dir, '{"cmd":"addBar","args":{"a":"n99","b":[0,0,1]}}']);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("refused: command 1 (addBar)");
    expect(r.host.rev).toBe(4);
  });

  it("is refused while the project is read-only, naming why", async () => {
    const f = await fixture();
    const r = await serve(f);
    await writeFile(join(f.dir, DOCUMENT), "{ nope");
    await r.host.checkFiles();
    const d = await capture(["do", r.dir, '{"cmd":"addNode","args":{"at":[1,2,3]}}']);
    expect(d.code).toBe(1);
    expect(d.err).toMatch(/refused: the project is read-only: the files are not valid/);
  });

  it("works headless when no server runs, and says undo needs one", async () => {
    const root = await scratchFixtures();
    scratch.push(root);
    const dir = join(root, "golden-ends", "G27");
    const d = await capture(["do", dir, '{"cmd":"addNode","args":{"at":[1,2,3]}}']);
    expect(d.code).toBe(0);
    expect(d.out).toMatch(/rev [0-9a-f]{12}:/);
    const u = await capture(["undo", dir]);
    expect(u.code).toBe(1);
    expect(u.err).toContain("no server runs");

    // A stale owner file (its process gone) is not a server.
    await mkdir(join(dir, STATE_DIR), { recursive: true });
    await writeFile(
      ownerPath(dir),
      JSON.stringify({
        schema: "alukit.owner/1",
        url: "http://127.0.0.1:9/",
        port: 9,
        pid: 2 ** 22 + 7,
        host: "elsewhere",
        started: "2026-01-01T00:00:00.000Z",
        token: "x",
      }),
    );
    expect((await capture(["do", dir, '{"cmd":"addNode","args":{"at":[4,5,6]}}'])).code).toBe(0);
    expect(await readFile(join(dir, DOCUMENT), "utf8")).toContain("[4, 5, 6]");
  });
});
