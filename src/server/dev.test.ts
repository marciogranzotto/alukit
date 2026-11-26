import { rm, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { DOCUMENT } from "#core/project/open.ts";
import { STATE_DIR } from "#core/project/store.ts";
import { scratchFixtures } from "#core/testing.ts";
import { capture } from "../cli/testing.ts";
import { alukitDev } from "./dev.ts";
import { readOwner } from "./owner.ts";

/**
 * The project's server mounted in Vite's dev server (design §10): the same session as
 * `alukit serve`, its gate in front of Vite's own answers, the owner file the CLI finds, and a
 * clean hand-over across Vite's restart and close.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

let vite: ViteDevServer | undefined;
const scratch: string[] = [];
afterEach(async () => {
  await vite?.close();
  vite = undefined;
  for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
});

async function start(dir: string, logs: string[]): Promise<ViteDevServer> {
  const logger = createLogger("info");
  logger.info = (msg) => {
    logs.push(msg);
  };
  const server = await createServer({
    configFile: false,
    root: ROOT,
    plugins: [alukitDev({ project: dir })],
    customLogger: logger,
    // Nothing here needs Vite's file watching or its dependency scan.
    server: { port: 0, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  return server;
}

function base(server: ViteDevServer): string {
  if (!server.httpServer) throw new Error("Vite runs without its own server");
  const { port } = server.httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${port}/`;
}

describe("the project's server in Vite's dev server", () => {
  it("answers the API behind the same gate, prints the token, and takes the CLI's edits", async () => {
    const root = await scratchFixtures();
    scratch.push(root);
    const dir = join(root, "golden-ends", "G27");
    const logs: string[] = [];
    vite = await start(dir, logs);
    const url = base(vite);
    expect((await fetch(`${url}api/health`)).status).toBe(200);

    const owner = await readOwner(dir);
    expect(owner?.url).toBe(url);
    const token = owner?.token as string;
    expect(logs.some((l) => l.includes(`${url}#t=${token}`))).toBe(true);
    const auth = { authorization: `Bearer ${token}` };

    const session = await fetch(`${url}api/session`, { headers: auth });
    expect(await session.json()).toMatchObject({ schema: "alukit.session/1", rev: 0 });
    expect((await fetch(`${url}api/model`, { headers: auth })).status).toBe(200);
    expect((await fetch(`${url}api/model`)).status).toBe(403);
    const foreign = await fetch(`${url}api/model`, {
      headers: { ...auth, origin: "http://localhost:3000" },
    });
    expect(foreign.status).toBe(403);
    // Vite's CORS middleware is off: a preflight from another local port gets no CORS header.
    const pre = await fetch(`${url}api/commands`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" },
    });
    expect(pre.status).toBe(403);
    expect([...pre.headers.keys()].filter((h) => h.startsWith("access-control-"))).toEqual([]);

    // Vite serves the app, with the server's headers.
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="app">');
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");

    // The CLI finds it through the owner file and sends its edit there.
    const d = await capture(["do", dir, '{"cmd":"addNode","args":{"at":[1,2,3]}}']);
    expect(d.code).toBe(0);
    expect(d.out).toContain("rev 1:");
  });

  it("hands the project over across a restart, and lets it go on close", async () => {
    const root = await scratchFixtures();
    scratch.push(root);
    const dir = join(root, "golden-ends", "G27");
    vite = await start(dir, []);
    await fetch(`${base(vite)}api/health`);
    const first = (await readOwner(dir))?.token;

    // Vite builds the new server before it closes the old one: the new session must wait.
    await vite.restart();
    const url = base(vite);
    expect((await fetch(`${url}api/health`)).status).toBe(200);
    const second = await readOwner(dir);
    expect(second?.token).toBeDefined();
    expect(second?.token).not.toBe(first);
    const old = await fetch(`${url}api/session`, { headers: { authorization: `Bearer ${first}` } });
    expect(old.status).toBe(403);
    const now = await fetch(`${url}api/session`, {
      headers: { authorization: `Bearer ${second?.token}` },
    });
    expect(now.status).toBe(200);

    await vite.close();
    vite = undefined;
    expect(await readOwner(dir)).toBeUndefined();
    await expect(stat(join(dir, STATE_DIR, "edit.lock"))).rejects.toThrow();
    // Headless again: the CLI writes the files itself.
    expect((await capture(["do", dir, '{"cmd":"addNode","args":{"at":[1,2,3]}}'])).code).toBe(0);
    expect((await stat(join(dir, DOCUMENT))).isFile()).toBe(true);
  });

  it("mounts nothing without a project", async () => {
    vite = await createServer({
      configFile: false,
      root: ROOT,
      plugins: [alukitDev({})],
      logLevel: "silent",
      server: { port: 0, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    await vite.listen();
    // Vite answers it as any other path; no session is behind it.
    const res = await fetch(`${vite.resolvedUrls?.local[0] ?? ""}api/session`);
    expect(await res.text()).not.toContain("alukit.session");
  });
});
