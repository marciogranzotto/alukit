import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DOCUMENT } from "#core/project/open.ts";
import { acquireEditLock, EditLockHeld, STATE_DIR } from "#core/project/store.ts";
import { FIXTURES, lockStamp, scratchFixtures, withStamp } from "#core/testing.ts";
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
    for (const path of [
      "/api/project",
      "/api/model",
      "/api/order",
      "/api/costs",
      "/api/events",
      "/api/log",
      "/api/x",
    ]) {
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
    for (const path of [
      "api/derived",
      "api/cutlist",
      "api/bom",
      "api/machining",
      "api/check",
      "api/project",
    ]) {
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
    expect(await next("rev")).toMatchObject({
      rev: 1,
      source: "cli:t",
      what: "addNode",
      text: "add point n2",
      undo: { rev: 1, source: "cli:t", what: "addNode", text: "add point n2" },
    });

    await writeFile(join(f.dir, DOCUMENT), "{ nope");
    await r.host.checkFiles();
    expect(await next("status")).toMatchObject({
      rev: 1,
      status: { readOnly: true, reason: "file" },
    });
    ctrl.abort();
  });
});

describe("the order and the costs (§5.4, §4.11)", () => {
  const AS_OF = "2026-11-26";

  async function text(r: RunningServer, path: string) {
    const res = await fetch(new URL(path, r.url), { headers: auth(r) });
    return { status: res.status, rev: res.headers.get("x-alukit-rev"), body: await res.text() };
  }

  it("answers as alukit order and costs --format json, byte for byte, derived from the lock", async () => {
    const f = await fixture();
    const cart = join(f.dir, "..", "..", "cart");
    const r = await serve({ ...f, dir: cart });

    // The cart's order is the hand golden plus the stamp: the hash of the lock the server holds.
    const order = await text(r, `api/order?as_of=${AS_OF}`);
    expect(order).toMatchObject({ status: 200, rev: "0" });
    const golden = await readFile(join(FIXTURES, "cart", "expected-order.json"), "utf8");
    expect(order.body).toBe(withStamp(golden, "oldest_read", { lock: lockStamp(cart) }));
    for (const cmd of ["order", "costs"]) {
      const served = await text(r, `api/${cmd}?as_of=${AS_OF}`);
      const cli = await capture([cmd, cart, "--format", "json", "--as-of", AS_OF]);
      expect(served.body, cmd).toBe(`${cli.out}\n`);
    }
  });

  it("answers the problems as alukit problems --json, byte for byte (BE-3)", async () => {
    const f = await fixture();
    const cart = join(f.dir, "..", "..", "cart");
    // Headless first, before a server owns the folder: revision 0, the files as read.
    const cli = await capture(["problems", cart, "--json", "--as-of", AS_OF]);
    expect(cli.code).toBe(1);
    const r = await serve({ ...f, dir: cart });
    const served = await text(r, `api/problems?as_of=${AS_OF}`);
    expect(served).toMatchObject({ status: 200, rev: "0" });
    expect(served.body).toBe(`${cli.out}\n`);
    // Its blocking problems are the order's blocking reasons; each raw is a message printed.
    const p = JSON.parse(served.body) as { order: { blocks: number }; problems: { raw: string }[] };
    const order = JSON.parse((await text(r, `api/order?as_of=${AS_OF}`)).body) as {
      suppliers: { reasons: { action: string; message: string }[] }[];
    };
    const reasons = order.suppliers.flatMap((s) => s.reasons);
    expect(p.order.blocks).toBe(reasons.filter((x) => x.action === "block").length);
    const check = JSON.parse((await text(r, "api/check")).body) as {
      diagnostics: { message: string }[];
    };
    const printed = new Set([...reasons, ...check.diagnostics].map((x) => x.message));
    expect(p.problems.every((x) => printed.has(x.raw))).toBe(true);

    // With the server running, the CLI asks it: the revision after a step, still equal.
    await api(r, "api/commands", {
      commands: [{ cmd: "resolveOpen", args: { id: "O2" } }],
      source: "ui",
    });
    const after = await text(r, `api/problems?as_of=${AS_OF}`);
    expect(after.rev).toBe("1");
    const through = await capture(["problems", cart, "--json", "--as-of", AS_OF]);
    expect(after.body).toBe(`${through.out}\n`);
    expect(JSON.parse(after.body)).toMatchObject({ rev: 1, order: { blocks: p.order.blocks - 1 } });
    expect((await text(r, "api/problems?as_of=26-11-2026")).status).toBe(400);
    expect((await text(r, "api/problems?variant=nope")).status).toBe(400);
  });

  it("answers a corner's arrangements as alukit arrangements --json, byte for byte (S5.5)", async () => {
    const f = await fixture();
    const frame = join(f.dir, "..", "..", "base-frame", "cli");
    // Headless first, before a server owns the folder: revision 0, the files as read.
    const cli = await capture(["arrangements", frame, "--json", "--at", "0,0,900"]);
    expect(cli.code).toBe(0);
    const r = await serve({ ...f, dir: frame });
    const served = await text(r, "api/arrangements?at=0,0,900");
    expect(served).toMatchObject({ status: 200, rev: "0" });
    expect(served.body).toBe(`${cli.out}\n`);
    // Every rule, in order, each what a dry run of its own batch answers; nothing is written.
    const a = JSON.parse(served.body) as {
      corners: unknown[];
      rules: { rule: string; ok: boolean; commands: unknown[]; effects: unknown }[];
    };
    expect(a.corners).toEqual([{ at: [0, 0, 900], ends: ["b1.b", "b5.a", "b7.a"], butts: ["c1"] }]);
    expect(a.rules.map((x) => [x.rule, x.ok])).toEqual([
      ["vertical", true],
      ["x", true],
      ["y", true],
      ["first", true],
    ]);
    for (const x of a.rules) {
      const dry = await api(r, "api/commands", {
        commands: x.commands,
        source: "ui",
        dryRun: true,
      });
      expect(dry.body.effects, x.rule).toEqual(x.effects);
    }
    expect((await api(r, "api/log")).body.entries).toEqual([]);
    // With the server running, the CLI asks it.
    const through = await capture(["arrangements", frame, "--json", "--at", "0,0,900"]);
    expect(`${through.out}\n`).toBe(served.body);
    // Only the rules asked for, in the order asked.
    const two = JSON.parse((await text(r, "api/arrangements?at=0,0,900&rule=y&rule=x")).body);
    expect(two.rules.map((x: { rule: string }) => x.rule)).toEqual(["y", "x"]);
    for (const bad of ["", "?at=0,0", "?at=0,0,a", "?at=0,0,900&rule=diagonal"]) {
      expect((await text(r, `api/arrangements${bad}`)).status, bad).toBe(400);
    }
  });

  it("answers the machining sheet as alukit machining --format json, byte for byte", async () => {
    const f = await fixture();
    const cart = join(f.dir, "..", "..", "cart");
    const r = await serve({ ...f, dir: cart });

    // The cart's sheet is the golden worked by hand (M6): the plate's and the bent angle's holes,
    // stamped with the lock the server holds.
    const served = await text(r, "api/machining");
    expect(served).toMatchObject({ status: 200, rev: "0" });
    const golden = await readFile(join(FIXTURES, "cart", "expected-machining.json"), "utf8");
    expect(served.body).toBe(withStamp(golden, "schema", { lock: lockStamp(cart) }));
    const cli = await capture(["machining", cart, "--format", "json"]);
    expect(served.body).toBe(`${cli.out}\n`);
  });

  it("answers the derived model, the cut list and the BOM as the CLI prints them, byte for byte", async () => {
    const f = await fixture();
    const cart = join(f.dir, "..", "..", "cart");
    const r = await serve({ ...f, dir: cart });
    const outputs: [string, string[]][] = [
      ["api/derived", ["derive", cart, "--json"]],
      ["api/cutlist", ["cutlist", cart, "--format", "json"]],
      ["api/bom", ["bom", cart, "--format", "json"]],
    ];
    for (const [path, argv] of outputs) {
      const served = await text(r, path);
      expect(served.status, path).toBe(200);
      expect(JSON.parse(served.body).lock, path).toBe(lockStamp(cart));
      expect(served.body, path).toBe(`${(await capture(argv)).out}\n`);
    }
  });

  it("follows the revision, takes today by default, and refuses a date that is not one", async () => {
    const f = await fixture();
    const r = await startServer({
      dir: join(f.dir, "..", "..", "golden-gen", "G26"),
      distDir: f.dist,
      host: { watch: false, today: () => AS_OF },
    });
    running.push(r);
    const before = JSON.parse((await text(r, "api/costs")).body);
    expect(before).toMatchObject({ schema: "alukit.costs/1", as_of: AS_OF, costs: [] });
    const a = await api(r, "api/commands", {
      commands: [
        {
          cmd: "addCost",
          args: {
            cost: {
              label: "Paint",
              kind: "labour",
              low_minor: 1000,
              likely_minor: 1000,
              high_minor: 1000,
            },
          },
        },
      ],
      source: "ui",
    });
    expect(a.status).toBe(200);
    const after = await text(r, "api/costs");
    expect(after.rev).toBe("1");
    const costs = JSON.parse(after.body);
    expect(costs.costs.map((c: { id: string }) => c.id)).toEqual(["K1"]);
    expect(costs.totals.total.likely_minor).toBe(before.totals.total.likely_minor + 1000);

    expect(JSON.parse((await text(r, "api/order?as_of=2027-01-02")).body).as_of).toBe("2027-01-02");
    for (const bad of ["2026-02-30", "26-11-2026", ""]) {
      expect((await text(r, `api/order?as_of=${bad}`)).status, bad).toBe(400);
    }
  });
});

describe("a dry run (BE-2)", () => {
  /** A post where the beam ends, butted by the default rule: the beam's cut moves. */
  const post = [
    { cmd: "addBar", args: { a: [1000, 0, 0], b: [1000, 0, 600] } },
    { cmd: "autoConnect", args: { end: "b4.a" } },
  ];
  const hashes = async (dir: string) =>
    Promise.all(["alukit.json", "alukit.lock.json"].map((n) => readFile(join(dir, n), "utf8")));

  it("writes, logs and broadcasts nothing, and says what the real step then does", async () => {
    const r = await serve();
    const files = await hashes(r.dir);
    const events: unknown[] = [];
    r.host.subscribe((e) => events.push(e));
    const dry = await api(r, "api/commands", { commands: post, source: "ui", dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({
      schema: "alukit.do/1",
      ok: true,
      dry: true,
      rev: 0,
      created: ["b4", "c3"],
      effects: { cuts: { b1: [1000, 980] }, removed: [], claimed: ["b1.b", "b4.a"] },
    });
    expect(Object.keys((dry.body.effects as { added: object }).added)).toEqual(["b4"]);
    expect(await hashes(r.dir)).toEqual(files);
    expect((await api(r, "api/log")).body.entries).toEqual([]);
    expect(r.host.rev).toBe(0);
    expect(events).toEqual([]);

    const real = await api(r, "api/commands", { commands: post, source: "ui" });
    expect(real.body.results).toEqual(dry.body.results);
    expect(real.body.diagnostics).toEqual(dry.body.diagnostics);
    // A refused dry run is refused as the step would be, and changes nothing either.
    const refused = await api(r, "api/commands", {
      commands: [{ cmd: "removeEntity", args: { id: "b1" } }],
      source: "ui",
      dryRun: true,
    });
    expect(refused).toMatchObject({ status: 422, body: { ok: false, dry: true, kind: "refused" } });
    expect(r.host.rev).toBe(1);
  });

  it("runs in the queue: behind a step already queued, against the revision it makes", async () => {
    const r = await serve();
    const step = r.host.commands({
      commands: [{ cmd: "addNode", args: { at: [5, 5, 5] } }],
      source: "cli",
    });
    const dry = r.host.dryRun({ commands: post, source: "ui" });
    expect((await step).rev).toBe(1);
    expect(await dry).toMatchObject({ ok: true, rev: 1, created: ["b4", "c3"] });
    expect(r.host.rev).toBe(1);
  });

  it("is alukit do --dry-run, through the server or in-process, writing nothing", async () => {
    const root = await scratchFixtures();
    scratch.push(root);
    const dir = join(root, "golden-ends", "G27");
    const files = await hashes(dir);
    const headless = await capture(["do", dir, JSON.stringify(post), "--dry-run"]);
    expect(headless.code).toBe(0);
    expect(headless.out.split("\n")).toEqual([
      "addBar: would create b4",
      "autoConnect: would create c3",
      // G27's butts name no connector, nor does the project: the new one is noted too.
      "would add info butt-no-connector c3: c3 names no connector, and the project names no default butt connector: the order buys nothing to join its ends",
      "cut b1: 1000 → 980",
      expect.stringMatching(/^new b4: cut \d+(\.\d+)?$/),
      "claims b1.b, b4.a",
      expect.stringMatching(/^dry run on rev [0-9a-f]{12}: .* after it; nothing was written$/),
    ]);
    expect(await hashes(dir)).toEqual(files);
    const json = JSON.parse(
      (await capture(["do", dir, JSON.stringify(post), "--dry-run", "--json"])).out,
    );
    const f = await fixture();
    const served = await serve({ ...f, dir });
    const through = JSON.parse(
      (await capture(["do", dir, JSON.stringify(post), "--dry-run", "--json"])).out,
    );
    // The same step, the same answer, but for the revision: a hash headless, the counter here.
    expect({ ...through, rev: 0 }).toEqual({ ...json, rev: 0 });
    expect(through).toMatchObject({ dry: true, rev: 0 });
    expect(served.host.rev).toBe(0);
    expect(await hashes(dir)).toEqual(files);
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

  it("logs --as agent:<name> as that agent, and a bare name as cli:<name> (U57)", async () => {
    const r = await serve();
    const as = async (cmd: string[], who: string) =>
      expect((await capture([...cmd, "--as", who])).code, who).toBe(0);
    await as(["do", r.dir, '{"cmd":"addNode","args":{"at":[1,2,3]}}'], "agent:claude");
    await as(["add", "point", r.dir, "--at", "4,5,6"], "me");
    await as(["add", "point", r.dir, "--at", "7,8,9"], "cli:other");
    await as(["undo", r.dir], "agent:claude");
    await as(["redo", r.dir], "agent:claude");
    const log = JSON.parse((await capture(["log", r.dir, "--json"])).out) as {
      entries: { source: string }[];
    };
    expect(log.entries.map((e) => e.source)).toEqual([
      "agent:claude",
      "cli:me",
      "cli:other",
      "agent:claude",
      "agent:claude",
    ]);
    // A name the server would refuse is the CLI's usage error, before anything is sent.
    for (const bad of ["agent:", "agent:two words", "x/y", ""]) {
      const refused = await capture([
        "do",
        r.dir,
        '{"cmd":"addNode","args":{"at":[0,0,1]}}',
        "--as",
        bad,
      ]);
      expect(refused.code, bad).toBe(2);
      expect(refused.err, bad).toContain("--as");
    }
    expect(r.host.rev).toBe(5);
  });

  it("words each step for a person, keeping the command names for scripts (BE-4)", async () => {
    const r = await serve();
    await capture(["add", "point", r.dir, "--at", "4,5,6", "--as", "agent:claude"]);
    await capture(["add", "bar", r.dir, "--a", "n2", "--b", "4,5,600"]);
    await capture(["undo", r.dir]);
    const log = JSON.parse((await capture(["log", r.dir, "--json"])).out) as {
      entries: { what: string; text: string }[];
    };
    expect(log.entries.map((e) => [e.what, e.text])).toEqual([
      ["addNode", "add point n2"],
      ["addBar", "add bar b4"],
      ["undo addBar", "undo add bar b4"],
    ]);
    expect((await capture(["log", r.dir])).out.split("\n")).toEqual([
      "   1  agent:claude add point n2",
      "   2  cli          add bar b4",
      "   3  cli          undo add bar b4",
      "rev 3",
    ]);
    // The undo and redo buttons read the same words, as the session and every event give them.
    const session = (await api(r, "api/session")).body as {
      undo: { text: string };
      redo: { text: string };
    };
    expect([session.undo.text, session.redo.text]).toEqual(["add point n2", "add bar b4"]);
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

describe("variants, the GLB and revisions through the server (§4.10, §4.13, §9)", () => {
  const AS_OF = "2026-11-26";

  /** The cart with two variants, as the CLI's variant tests make it, served. */
  async function cartWithVariants(): Promise<RunningServer> {
    const f = await fixture();
    const cart = join(f.dir, "..", "..", "cart");
    const made = await capture([
      "do",
      cart,
      JSON.stringify([
        { cmd: "addVariant", args: { name: "base", variant: {}, default: true } },
        { cmd: "addVariant", args: { name: "tall", variant: { params: { H: "1100" } } } },
        { cmd: "setBar", args: { id: "b13", set: { not_in: ["tall"] } } },
      ]),
    ]);
    expect(made.code).toBe(0);
    const r = await startServer({
      dir: cart,
      distDir: f.dist,
      host: { watch: false, today: () => AS_OF },
    });
    running.push(r);
    return r;
  }

  async function get(r: RunningServer, path: string) {
    const res = await fetch(new URL(path, r.url), { headers: auth(r) });
    return { status: res.status, res };
  }

  it("derives every view in the variant ?variant= names, as --variant does", async () => {
    const r = await cartWithVariants();
    const base = (await (await get(r, "api/model")).res.json()) as {
      variant: string | null;
      derived: { bars: Record<string, { len_mm: number }> };
    };
    expect(base.variant).toBe("base");
    expect(base.derived.bars.b1?.len_mm).toBe(900);
    expect(base.derived.bars.b13).toBeDefined();

    const tall = (await (await get(r, "api/model?variant=tall")).res.json()) as typeof base;
    expect(tall.variant).toBe("tall");
    expect(tall.derived.bars.b1?.len_mm).toBe(1100);
    expect(tall.derived.bars.b13).toBeUndefined();

    // Each output as the CLI prints it with --variant, byte for byte.
    const outputs: [string, string[]][] = [
      [`api/order?variant=tall&as_of=${AS_OF}`, ["order", r.dir, "--as-of", AS_OF]],
      [`api/costs?variant=tall&as_of=${AS_OF}`, ["costs", r.dir, "--as-of", AS_OF]],
      ["api/machining?variant=tall", ["machining", r.dir]],
      ["api/cutlist?variant=tall", ["cutlist", r.dir]],
      ["api/bom?variant=tall", ["bom", r.dir]],
    ];
    for (const [path, argv] of outputs) {
      const served = await get(r, path);
      expect(served.status, path).toBe(200);
      const cli = await capture([...argv, "--variant", "tall", "--format", "json"]);
      expect(await served.res.text(), path).toBe(`${cli.out}\n`);
    }
    const derived = await get(r, "api/derived?variant=tall");
    const cliDerived = await capture(["derive", r.dir, "--variant", "tall", "--json"]);
    expect(await derived.res.text()).toBe(`${cliDerived.out}\n`);
    const check = (await (await get(r, "api/check?variant=tall")).res.json()) as {
      variant: string;
      checks: unknown;
    };
    const cliCheck = await capture(["check", r.dir, "--variant", "tall", "--json"]);
    expect(check.variant).toBe("tall");
    expect(check.checks).toEqual(JSON.parse(cliCheck.out).checks);

    // A name the document does not list is refused, listing the ones it does.
    for (const path of [
      "api/model?variant=wood",
      "api/order?variant=wood",
      "api/export/glb?variant=wood",
    ]) {
      const bad = await get(r, path);
      expect(bad.status, path).toBe(400);
      expect(((await bad.res.json()) as { message: string }).message).toBe(
        "there is no variant wood; the project has base, tall",
      );
    }
  });

  it("answers the GLB alukit export glb writes, byte for byte, in a variant too", async () => {
    const r = await cartWithVariants();
    for (const variant of [undefined, "tall"]) {
      const served = await get(r, `api/export/glb${variant ? `?variant=${variant}` : ""}`);
      expect(served.status).toBe(200);
      expect(served.res.headers.get("content-type")).toBe("model/gltf-binary");
      // Named after the project and the variant derived: the default is "base".
      expect(served.res.headers.get("content-disposition")).toBe(
        `attachment; filename="Cart-synthetic-${variant ?? "base"}.glb"`,
      );
      const bytes = Buffer.from(await served.res.arrayBuffer());
      const out = join(r.dir, "..", `cart-${variant ?? "default"}.glb`);
      const cli = await capture([
        "export",
        "glb",
        r.dir,
        "-o",
        out,
        ...(variant ? ["--variant", variant] : []),
      ]);
      expect(cli.code).toBe(0);
      expect(bytes.equals(await readFile(out)), variant ?? "default").toBe(true);
    }
  });

  it("saves and verifies revisions of what it holds; the CLI's save goes through it", async () => {
    const r = await cartWithVariants();
    const empty = await api(r, "api/revisions");
    expect(empty.body).toMatchObject({ revisions: [], problems: [] });
    const current = empty.body.current as string;
    expect(current).toMatch(/^sha256:[0-9a-f]{64}$/);

    const saved = await api(r, "api/revisions", { name: "Quote 1", as_of: AS_OF });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      ok: true,
      file: join("revisions", "quote-1.json"),
      name: "Quote 1",
      as_of: AS_OF,
      stamp: { hash: current },
      variants: ["base", "tall"],
    });
    const outs = saved.body.outputs as { variant: string; bars: number }[];
    expect(outs.map((o) => o.variant)).toEqual(["base", "tall"]);
    const again = await api(r, "api/revisions", { name: "quote 1" });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe(
      `${join("revisions", "quote-1.json")} exists; a revision is never overwritten`,
    );
    expect((await api(r, "api/revisions", { name: "--" })).status).toBe(400);

    // The CLI's save meets the server's edit lock, so it is the server's to make.
    const cli = await capture(["revision", "save", r.dir, "Quote 2", "--as-of", AS_OF]);
    expect(cli.err).toBe("");
    expect(cli.code).toBe(0);
    expect(cli.out).toContain(`saved ${join("revisions", "quote-2.json")}: "Quote 2"`);

    const listed = await api(r, "api/revisions");
    expect((listed.body.revisions as { name: string }[]).map((x) => x.name)).toEqual([
      "Quote 1",
      "Quote 2",
    ]);

    // Verify answers what alukit revision verify --json prints.
    const v = await get(r, "api/revisions/verify?name=Quote%201");
    expect(v.status).toBe(200);
    const cliVerify = await capture(["revision", "verify", r.dir, "Quote 1", "--json"]);
    expect(await v.res.text()).toBe(`${cliVerify.out}\n`);
    expect(JSON.parse(cliVerify.out)).toMatchObject({ name: "Quote 1", ok: true });
    expect((await get(r, "api/revisions/verify?name=nope")).status).toBe(404);

    // An edit moves the current state away from what was saved.
    const a = await api(r, "api/commands", {
      commands: [{ cmd: "setParam", args: { name: "W", value: "1300" } }],
      source: "ui",
    });
    expect(a.status).toBe(200);
    expect((await api(r, "api/revisions")).body.current).not.toBe(current);
  });
});
