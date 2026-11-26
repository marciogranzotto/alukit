import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkFetchSite,
  checkHost,
  checkJsonBody,
  checkOrigin,
  checkToken,
  confine,
  newToken,
} from "./security.ts";

/** The checks of design §7.2, one by one. The HTTP tests in server.test.ts run them end to end. */

describe("the token", () => {
  it("is 256 random bits, URL-safe, new each time", () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(newToken()).not.toBe(a);
  });

  it("must come as a bearer token, exactly", () => {
    const t = newToken();
    expect(checkToken({ authorization: `Bearer ${t}` }, t)).toBeUndefined();
    for (const auth of [
      undefined,
      "",
      t,
      `bearer ${t}`,
      `Bearer ${t} `,
      `Bearer ${t}x`,
      `Bearer ${t.slice(1)}`,
      `Basic ${t}`,
      `Bearer ${newToken()}`,
    ]) {
      const h = auth === undefined ? {} : { authorization: auth };
      expect(checkToken(h, t), String(auth)).toMatchObject({ status: 403 });
    }
  });
});

describe("Host and Origin (DNS rebinding, foreign pages)", () => {
  it("Host must name this server's address and port", () => {
    expect(checkHost({ host: "127.0.0.1:4173" }, 4173)).toBeUndefined();
    expect(checkHost({ host: "localhost:4173" }, 4173)).toBeUndefined();
    expect(checkHost({ host: "LOCALHOST:4173" }, 4173)).toBeUndefined();
    for (const host of [
      undefined,
      "evil.example:4173",
      "127.0.0.1",
      "127.0.0.1:4174",
      "localhost",
      "127.0.0.1.evil.example:4173",
      "[::1]:4173",
      "0.0.0.0:4173",
    ]) {
      const h = host === undefined ? {} : { host };
      expect(checkHost(h, 4173), String(host)).toMatchObject({ status: 403 });
    }
  });

  it("Origin, when present, must be this server's own", () => {
    expect(checkOrigin({}, 4173)).toBeUndefined();
    expect(checkOrigin({ origin: "http://127.0.0.1:4173" }, 4173)).toBeUndefined();
    expect(checkOrigin({ origin: "http://localhost:4173" }, 4173)).toBeUndefined();
    for (const origin of [
      "null",
      "http://evil.example",
      "http://127.0.0.1:4174",
      "https://127.0.0.1:4173",
      "http://127.0.0.1",
      "http://localhost:4173.evil.example",
    ]) {
      expect(checkOrigin({ origin }, 4173), origin).toMatchObject({ status: 403 });
    }
  });

  it("Sec-Fetch-Site, when present, must be same-origin or a person's own navigation", () => {
    expect(checkFetchSite({})).toBeUndefined();
    expect(checkFetchSite({ "sec-fetch-site": "same-origin" })).toBeUndefined();
    expect(checkFetchSite({ "sec-fetch-site": "none" })).toBeUndefined();
    expect(checkFetchSite({ "sec-fetch-site": "same-site" })).toMatchObject({ status: 403 });
    expect(checkFetchSite({ "sec-fetch-site": "cross-site" })).toMatchObject({ status: 403 });
  });
});

describe("bodies", () => {
  it("must be application/json, so no HTML form can send one", () => {
    expect(checkJsonBody({ "content-type": "application/json" })).toBeUndefined();
    expect(checkJsonBody({ "content-type": "application/json; charset=utf-8" })).toBeUndefined();
    for (const type of [
      undefined,
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "application/jsonx",
    ]) {
      const h = type === undefined ? {} : { "content-type": type };
      expect(checkJsonBody(h), String(type)).toMatchObject({ status: 415 });
    }
  });
});

describe("paths", () => {
  it("resolve inside the project, following symbolic links, or are refused", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "alukit confine-")));
    const root = join(base, "project");
    await mkdir(join(root, "exports"), { recursive: true });
    await writeFile(join(base, "secret.txt"), "secret");
    await symlink(join(base, "secret.txt"), join(root, "leak.txt"));
    await symlink(base, join(root, "up"));

    expect(await confine(root, "alukit.json")).toBe(join(root, "alukit.json"));
    expect(await confine(root, "exports/new/x.glb")).toBe(join(root, "exports/new/x.glb"));
    expect(await confine(root, join(root, "exports"))).toBe(join(root, "exports"));
    for (const p of [
      "../secret.txt",
      "exports/../../secret.txt",
      join(base, "secret.txt"),
      "leak.txt",
      "up/secret.txt",
      "up/new.txt",
      "a\0b",
    ]) {
      expect(await confine(root, p), p).toBeUndefined();
    }
  });
});
