import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { raw, type Served, serve } from "./helpers.ts";

/**
 * M4a, done when (design §12): requests without the token, or with a foreign Origin or Host, get
 * 403 (§7.2). Raw requests first, then the attacks as a browser makes them: a foreign page
 * calling the API, and DNS rebinding (a foreign name that resolves to 127.0.0.1).
 */

test.use({
  launchOptions: {
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      // A rebinding attacker's name, already resolved to the loopback address.
      "--host-resolver-rules=MAP rebind.test 127.0.0.1",
    ],
  },
});

let served: Served;
let foreign: Server;
let foreignUrl: string;
test.beforeEach(async () => {
  served = await serve("golden-ends/G27");
  // A page on another origin, as any site the person has open.
  foreign = createServer((_req, res) => {
    res
      .writeHead(200, { "content-type": "text/html" })
      .end("<!doctype html><title>elsewhere</title>");
  });
  await new Promise<void>((ok) => foreign.listen(0, "127.0.0.1", ok));
  foreignUrl = `http://localhost:${(foreign.address() as AddressInfo).port}/`;
});
test.afterEach(async () => {
  await new Promise((ok) => foreign.close(ok));
  await served.stop();
});

const API = [
  "/api/session",
  "/api/project",
  "/api/model",
  "/api/derived",
  "/api/log",
  "/api/events",
];

test("requests without the token, or with a foreign Origin or Host, get 403", async () => {
  const port = served.port;
  const auth = { authorization: `Bearer ${served.token}` };
  const body = JSON.stringify({
    commands: [{ cmd: "addNode", args: { at: [1, 2, 3] } }],
    source: "ui",
  });
  const json = { "content-type": "application/json" };

  for (const path of API) {
    expect((await raw(port, path)).status, `${path} without the token`).toBe(403);
    expect((await raw(port, path, { headers: { authorization: "Bearer x" } })).status).toBe(403);
    const origin = await raw(port, path, { headers: { ...auth, origin: "http://evil.example" } });
    expect(origin.status, `${path} foreign Origin`).toBe(403);
    const host = await raw(port, path, { headers: { ...auth, host: `rebind.test:${port}` } });
    expect(host.status, `${path} foreign Host`).toBe(403);
  }
  for (const path of ["/api/commands", "/api/undo", "/api/restore"]) {
    expect((await raw(port, path, { method: "POST", headers: json, body })).status).toBe(403);
    const o = await raw(port, path, {
      method: "POST",
      headers: { ...auth, ...json, origin: "null" },
      body,
    });
    expect(o.status, `${path} Origin null`).toBe(403);
    const h = await raw(port, path, {
      method: "POST",
      headers: { ...auth, ...json, host: "evil.example" },
      body,
    });
    expect(h.status, `${path} foreign Host`).toBe(403);
  }
  // The app's own files are refused under a foreign Host too: a rebinding page gets nothing.
  expect((await raw(port, "/", { headers: { host: `rebind.test:${port}` } })).status).toBe(403);

  // With everything right, the same requests are answered; none of the refused ones changed
  // anything.
  expect((await raw(port, "/api/project", { headers: auth })).status).toBe(200);
  const session = JSON.parse((await raw(port, "/api/session", { headers: auth })).body);
  expect(session.rev).toBe(0);
});

test("a foreign page cannot call the API, even holding the token", async ({ page }) => {
  await page.goto(foreignUrl);
  const outcome = await page.evaluate(
    async ({ url, token }) => {
      try {
        const r = await fetch(`${url}api/commands`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            commands: [{ cmd: "addNode", args: { at: [1, 2, 3] } }],
            source: "ui",
          }),
        });
        return `answered ${r.status}`;
      } catch (e) {
        return `blocked: ${(e as Error).name}`;
      }
    },
    { url: served.url, token: served.token },
  );
  // The preflight carries the foreign Origin: 403, and no CORS headers, so the browser stops.
  expect(outcome).toBe("blocked: TypeError");
  const session = await raw(served.port, "/api/session", {
    headers: { authorization: `Bearer ${served.token}` },
  });
  expect(JSON.parse(session.body).rev).toBe(0);
});

test("a rebinding page gets 403 for the app and the API", async ({ page }) => {
  const r = await page.goto(`http://rebind.test:${served.port}/`);
  expect(r?.status()).toBe(403);
  const status = await page.evaluate(async (token) => {
    const a = await fetch("/api/project", { headers: { authorization: `Bearer ${token}` } });
    return a.status;
  }, served.token);
  expect(status).toBe(403);
});
