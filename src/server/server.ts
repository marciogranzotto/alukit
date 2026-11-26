import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CatalogSet } from "#catalog/link.ts";
import { CHECK_SCHEMA } from "#core/check/check.ts";
import { checkedMachining, checkedOrder } from "#core/check/outputs.ts";
import { isDate } from "#core/dates.ts";
import { derivedJson } from "#core/derive/output.ts";
import { sortDiagnostics } from "#core/diagnostics.ts";
import { compareIds } from "#core/ids.ts";
import { lockHash } from "#core/lock/pin.ts";
import type { Lock } from "#core/lock/schema.ts";
import { machiningJson } from "#core/machining/format.ts";
import { costsJson, costsOf, orderJson } from "#core/order/format.ts";
import { DOCUMENT } from "#core/project/open.ts";
import type { Doc } from "#core/project/parse.ts";
import { acquireEditLock, SERVE } from "#core/project/store.ts";
import type { ResolvedProjectItem } from "#core/project-items/resolve.ts";
import { projectItems } from "#core/project-items/source.ts";
import {
  CATALOG_SCHEMA,
  type CatalogEntry,
  catalogIndex,
  catalogTree,
  itemCard,
  listed,
  projectEntries,
  searchCatalog,
} from "./catalog.ts";
import { type CommandsAnswer, type HistoryAnswer, type HostOptions, ProjectHost } from "./host.ts";
import { removeOwner, writeOwner } from "./owner.ts";
import {
  checkFetchSite,
  checkHost,
  checkJsonBody,
  checkOrigin,
  checkToken,
  isInside,
  newToken,
  type Refusal,
} from "./security.ts";
import { SSE_PING, sseEvent } from "./sse.ts";
import { viewModel } from "./view.ts";

/**
 * `alukit serve` (design §7.1, §7.2, §10): one `node:http` server per project, bound to
 * 127.0.0.1. It serves the built app (`dist/`) and the project's API. The same session (the edit
 * lock, the project host, the token and this handler) mounts in Vite's dev server while AluKit is
 * developed (`dev.ts`), which then serves the app itself:
 *
 * | Request | Answer |
 * |---|---|
 * | `GET /api/health` | `{ ok: true }`: a liveness probe, the only `/api` path without the token |
 * | `GET /api/session` | the project folder, the server's pid, the revision and status |
 * | `GET /api/project` | the document and its lock as the server holds them |
 * | `GET /api/model` | everything a tab shows for one revision (`alukit.view/1`, `view.ts`) |
 * | `GET /api/derived`, `/api/cutlist`, `/api/bom`, `/api/check` | as the CLI's `--json` outputs |
 * | `GET /api/order`, `/api/costs` `[?as_of=YYYY-MM-DD]` | as `alukit order` and `costs --format json`, from the lock; today by default |
 * | `GET /api/machining` | as `alukit machining --format json`: the custom parts' holes, the machined bars |
 * | `GET /api/catalog` | the catalogs the document names, as vendor › kind › family with counts (§8) |
 * | `GET /api/catalog/items` `[?q=&vendor=&kind=&family=&limit=&offset=]` | items matching a search |
 * | `GET /api/catalog/item?id=<catalog>:<code>` | one item's card: key data, section, options, offers |
 * | `GET /api/log` | the log of steps, undos and redos |
 * | `GET /api/events` | the event stream: SSE wire format, read with `fetch` |
 * | `POST /api/commands` | `{ commands, source, id?, baseRev?, strict? }`: one step |
 * | `POST /api/undo`, `/api/redo` | `{ source }` |
 * | `POST /api/restore` | "restore last good": the last good state over invalid files |
 *
 * Every request passes the checks of `security.ts` first: `Host` and `Origin` on everything,
 * the token and `Sec-Fetch-Site` on `/api`, a JSON content type on bodies. A refused request
 * gets 403 (415 for a body that is not JSON) and nothing else is read.
 */

const HOST = "127.0.0.1";
const MAX_BODY = 8 * 1024 * 1024;
const PING_MS = 20_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".woff2": "font/woff2",
};

/**
 * Headers on every answer. The page runs only its own scripts and connects only to its own
 * origin; it may not be framed (a frame could be clicked through); no `Referer` leaves it.
 */
const COMMON: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

const SOURCE = /^(ui|cli|cli:[A-Za-z0-9._-]{1,64}|agent:[A-Za-z0-9._-]{1,64})$/;

const Source = z
  .string()
  .regex(SOURCE, "ui, cli, cli:<name> or agent:<name> (file is the watcher's)");

const CommandsBody = z.strictObject({
  commands: z.array(z.unknown()).min(1).max(10_000),
  source: Source,
  id: z.string().min(1).max(200).optional(),
  baseRev: z.number().int().nonnegative().optional(),
  strict: z.boolean().optional(),
});

const HistoryBody = z.strictObject({ source: Source });

export interface SessionOptions {
  /** The project folder. */
  dir: string;
  /** The built app to serve. Without one, a request for the app's files goes to `next`. */
  distDir?: string;
  builtinDir?: string;
  /** Passed to the project host: watching, its settle time and poll interval, today's date. */
  host?: Omit<HostOptions, "dir" | "builtinDir">;
}

export interface ServerOptions extends SessionOptions {
  /** 0 picks a free port. */
  port?: number;
}

export interface RunningServer {
  server: Server;
  port: number;
  /** The app's address, ending in "/". */
  url: string;
  /** The address `serve` opens: the token in the fragment, which never reaches a server (§7.2). */
  appUrl: string;
  token: string;
  /** The project folder, resolved. */
  dir: string;
  host: ProjectHost;
  close: () => Promise<void>;
}

// fileURLToPath, not URL.pathname: pathname keeps percent-escapes, so a checkout under a folder
// with a space in its name would look for "my%20folder/dist".
const defaultDist = fileURLToPath(new URL("../../dist", import.meta.url));

function send(
  res: ServerResponse,
  status: number,
  text?: string,
  headers: Record<string, string> = {},
): void {
  const h = { ...COMMON, "cache-control": "no-store", ...headers };
  if (text === undefined) {
    res.writeHead(status, h).end();
    return;
  }
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...h }).end(text);
}

function sendJson(res: ServerResponse, status: number, body: unknown, rev?: number): void {
  const text = typeof body === "string" ? body : `${JSON.stringify(body)}\n`;
  res
    .writeHead(status, {
      ...COMMON,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(rev !== undefined ? { "x-alukit-rev": String(rev) } : {}),
    })
    .end(text);
}

function deny(res: ServerResponse, r: Refusal): void {
  send(res, r.status, `${r.status === 403 ? "forbidden" : "unsupported media type"}: ${r.reason}`);
}

/** Reads a JSON body, at most MAX_BODY bytes. */
async function readBody(req: IncomingMessage): Promise<{ value: unknown } | { error: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return { error: "the body is too large" };
    chunks.push(chunk as Buffer);
  }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch (e) {
    return { error: `the body is not JSON: ${(e as Error).message}` };
  }
}

function commandsStatus(a: CommandsAnswer): number {
  if (a.ok) return 200;
  switch (a.kind) {
    case "refused":
      return 422;
    case "read-only":
    case "stale":
      return 409;
    default:
      return 500;
  }
}

function historyStatus(a: HistoryAnswer): number {
  if (a.ok) return 200;
  return a.kind === "write" ? 500 : 409;
}

/** What the catalog browser reads (`catalog.ts`), and what it was built from. */
interface CatalogIndex {
  live: CatalogSet;
  named: string[];
  lock: Lock;
  doc: Doc;
  /** The document's own items, resolved. */
  own: ReadonlyMap<string, ResolvedProjectItem>;
  /** The catalogs' and the lock's entries alone. */
  fromCatalogs: CatalogEntry[];
  /** Those and the project's items, in id order. */
  entries: CatalogEntry[];
}

interface Ctx {
  /** The built app; undefined when another server (Vite's dev server) serves the app. */
  root: string | undefined;
  port: () => number;
  token: string;
  project: ProjectHost;
  /** The model answer of the current revision, serialised once. */
  model: { rev: number; text: string } | undefined;
  /** The catalog browser's index, built once per opening of the catalogs and lock. */
  catalog: CatalogIndex | undefined;
  streams: Set<ServerResponse>;
}

/**
 * The catalog browser's index: the live catalogs, the lock, and the document's own items as
 * derive resolves them (read only, §4.8), kept while none of them changes.
 */
async function catalogEntries(ctx: Ctx): Promise<CatalogIndex> {
  const { set: live, named } = await ctx.project.catalogs();
  const snap = ctx.project.snapshot();
  const lock = snap.state.lock;
  const doc = snap.derived.doc;
  const c = ctx.catalog;
  if (c?.live === live && c.lock === lock && c.doc === doc) return c;
  // The catalogs' entries change with the catalogs and the lock; the project's at a revision.
  const fromCatalogs =
    c?.live === live && c.lock === lock ? c.fromCatalogs : catalogIndex(live, lock, named);
  const own = projectItems(snap.items, doc).resolved;
  const entries = [...fromCatalogs, ...projectEntries(own)].sort((x, y) => compareIds(x.id, y.id));
  ctx.catalog = { live, named, lock, doc, own, fromCatalogs, entries };
  return ctx.catalog;
}

/** A whole number from a query, or undefined; anything else is the caller's 400. */
function intParam(q: URLSearchParams, name: string): number | undefined | "bad" {
  const v = q.get(name);
  if (v === null) return undefined;
  return /^\d{1,6}$/.test(v) ? Number(v) : "bad";
}

async function serveStatic(root: string, method: string, path: string, res: ServerResponse) {
  if (method !== "GET" && method !== "HEAD") {
    send(res, 405, undefined, { allow: "GET, HEAD" });
    return;
  }
  // Lexical check: a leading "/" makes normalize() drop any ".." that would climb above root.
  const file = join(root, normalize(path === "/" ? "/index.html" : path));
  if (!isInside(root, file)) {
    send(res, 403);
    return;
  }
  // Physical check: a symbolic link inside dist/ must not lead outside it.
  let real: string;
  let realRoot: string;
  try {
    [real, realRoot] = await Promise.all([realpath(file), realpath(root)]);
  } catch {
    send(res, 404, "not found");
    return;
  }
  if (!isInside(realRoot, real)) {
    send(res, 403);
    return;
  }
  let body: Buffer;
  try {
    body = await readFile(real);
  } catch {
    // A directory, or a file that vanished between the two calls.
    send(res, 404, "not found");
    return;
  }
  res.writeHead(200, {
    ...COMMON,
    "content-type": MIME[extname(real)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(method === "HEAD" ? undefined : body);
}

function events(ctx: Ctx, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    ...COMMON,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  res.flushHeaders();
  ctx.streams.add(res);
  res.write(sseEvent("hello", ctx.project.summary(), ctx.project.rev));
  const off = ctx.project.subscribe((e) => {
    res.write(sseEvent(e.type, e, e.rev));
  });
  const ping = setInterval(() => res.write(SSE_PING), PING_MS);
  const end = () => {
    clearInterval(ping);
    off();
    ctx.streams.delete(res);
  };
  req.on("close", end);
  res.on("close", end);
}

async function api(
  ctx: Ctx,
  method: string,
  path: string,
  query: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const p = ctx.project;
  if (method === "GET") {
    switch (path) {
      case "/api/session":
        sendJson(res, 200, {
          schema: "alukit.session/1",
          dir: p.dir,
          pid: process.pid,
          ...p.summary(),
        });
        return;
      case "/api/project":
        sendJson(res, 200, { ...p.summary(), doc: p.state.doc, lock: p.state.lock }, p.rev);
        return;
      case "/api/model": {
        const snap = p.snapshot();
        if (ctx.model?.rev !== snap.rev) {
          ctx.model = { rev: snap.rev, text: `${JSON.stringify(viewModel(snap))}\n` };
        }
        sendJson(res, 200, ctx.model.text, snap.rev);
        return;
      }
      case "/api/derived": {
        const snap = p.snapshot();
        sendJson(res, 200, derivedJson(snap.derived), snap.rev);
        return;
      }
      case "/api/cutlist": {
        const snap = p.snapshot();
        sendJson(res, 200, snap.outputs.cutList(), snap.rev);
        return;
      }
      case "/api/bom": {
        const snap = p.snapshot();
        sendJson(res, 200, snap.outputs.bom(), snap.rev);
        return;
      }
      case "/api/machining": {
        // As the CLI prints it (M6), byte for byte: the sheet and the problems met on the way.
        const snap = p.snapshot();
        sendJson(res, 200, machiningJson(checkedMachining(snap.derived, snap.outputs)), snap.rev);
        return;
      }
      case "/api/check": {
        const snap = p.snapshot();
        const diagnostics = sortDiagnostics([...snap.catalogs, ...snap.check.diagnostics]);
        const count = (s: string) => diagnostics.filter((d) => d.severity === s).length;
        sendJson(
          res,
          200,
          {
            schema: CHECK_SCHEMA,
            rev: snap.rev,
            ok: count("error") === 0,
            counts: { error: count("error"), warn: count("warn"), info: count("info") },
            checks: snap.check.checks,
            diagnostics,
          },
          snap.rev,
        );
        return;
      }
      case "/api/order":
      case "/api/costs": {
        // As the CLI prints them (§5.4, §5.5): derived from the lock the server holds, after the
        // checks, stamped with that lock's hash; judged as of a date, today unless one is given.
        const asOf = query.get("as_of") ?? p.today();
        if (!isDate(asOf)) {
          sendJson(res, 400, { ok: false, message: "as_of takes a date, YYYY-MM-DD" });
          return;
        }
        const snap = p.snapshot();
        const o = checkedOrder(snap.outputs, snap.check.diagnostics, {
          asOf,
          lock: lockHash(snap.state.lock),
        });
        sendJson(res, 200, path === "/api/order" ? orderJson(o) : costsJson(costsOf(o)), snap.rev);
        return;
      }
      case "/api/catalog": {
        const { live, named, entries } = await catalogEntries(ctx);
        sendJson(res, 200, {
          schema: CATALOG_SCHEMA,
          catalogs: named.flatMap((id) => {
            const c = live.catalogs.get(id);
            return c ? [{ id: c.id, name: c.name, ...(c.vendor ? { vendor: c.vendor } : {}) }] : [];
          }),
          count: entries.length,
          tree: catalogTree(entries),
        });
        return;
      }
      case "/api/catalog/items": {
        const limit = intParam(query, "limit");
        const offset = intParam(query, "offset");
        if (limit === "bad" || offset === "bad") {
          sendJson(res, 400, { ok: false, message: "limit and offset take whole numbers" });
          return;
        }
        const { live, lock, entries } = await catalogEntries(ctx);
        const opt = (k: string) => query.get(k) ?? undefined;
        const found = searchCatalog(entries, {
          ...(opt("q") !== undefined ? { q: opt("q") } : {}),
          ...(opt("vendor") !== undefined ? { vendor: opt("vendor") } : {}),
          ...(opt("kind") !== undefined ? { kind: opt("kind") } : {}),
          ...(opt("family") !== undefined ? { family: opt("family") } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(offset !== undefined ? { offset } : {}),
        });
        sendJson(res, 200, { total: found.total, items: listed(found.items, live, lock) });
        return;
      }
      case "/api/catalog/item": {
        const id = query.get("id") ?? "";
        const { live, lock, entries, own } = await catalogEntries(ctx);
        const card = itemCard(id, live, lock, entries, own);
        if (!card) sendJson(res, 404, { ok: false, message: `no item ${id}` });
        else sendJson(res, 200, card);
        return;
      }
      case "/api/log":
        sendJson(res, 200, { rev: p.rev, entries: p.log() }, p.rev);
        return;
      case "/api/events":
        events(ctx, req, res);
        return;
    }
    send(res, 404, "not found");
    return;
  }
  if (method !== "POST") {
    send(res, 405, undefined, { allow: "GET, POST" });
    return;
  }
  const bad = checkJsonBody(req.headers);
  if (bad) {
    deny(res, bad);
    return;
  }
  const body = await readBody(req);
  if ("error" in body) {
    sendJson(res, 400, { ok: false, message: body.error });
    return;
  }
  const parse = <T>(schema: z.ZodType<T>): T | undefined => {
    const r = schema.safeParse(body.value);
    if (r.success) return r.data;
    sendJson(res, 400, {
      ok: false,
      message: r.error.issues.map((i) => `${i.path.join("/") || "body"}: ${i.message}`).join("; "),
    });
    return undefined;
  };
  switch (path) {
    case "/api/commands": {
      const b = parse(CommandsBody);
      if (!b) return;
      const a = await p.commands({
        commands: b.commands,
        source: b.source,
        ...(b.id !== undefined ? { id: b.id } : {}),
        ...(b.baseRev !== undefined ? { baseRev: b.baseRev } : {}),
        ...(b.strict !== undefined ? { strict: b.strict } : {}),
      });
      sendJson(res, commandsStatus(a), { schema: "alukit.do/1", ...a }, p.rev);
      return;
    }
    case "/api/undo":
    case "/api/redo": {
      const b = parse(HistoryBody);
      if (!b) return;
      const a = path === "/api/undo" ? await p.undo(b.source) : await p.redo(b.source);
      sendJson(res, historyStatus(a), a, p.rev);
      return;
    }
    case "/api/restore": {
      if (!parse(z.strictObject({}))) return;
      const a = await p.restore();
      sendJson(res, a.ok ? 200 : 500, a, p.rev);
      return;
    }
  }
  send(res, 404, "not found");
}

async function handle(
  ctx: Ctx,
  req: IncomingMessage,
  res: ServerResponse,
  next?: () => void,
): Promise<void> {
  // Host and Origin first, on everything: a rebinding page or a foreign origin learns nothing.
  const foreign = checkHost(req.headers, ctx.port()) ?? checkOrigin(req.headers, ctx.port());
  if (foreign) {
    deny(res, foreign);
    return;
  }
  const method = req.method ?? "GET";
  const url = req.url ?? "/";
  const q = url.indexOf("?");
  const rawPath = q < 0 ? url : url.slice(0, q);
  const rawQuery = q < 0 ? "" : url.slice(q + 1);
  let path: string;
  try {
    // A malformed escape such as "%E0%A4%A" makes decodeURIComponent throw; uncaught, that
    // would take the whole server down.
    path = decodeURIComponent(rawPath);
  } catch {
    send(res, 400, "bad request");
    return;
  }
  if (path.includes("\0")) {
    send(res, 400, "bad request");
    return;
  }
  if (path === "/api" || path.startsWith("/api/")) {
    if (path === "/api/health") {
      if (method !== "GET" && method !== "HEAD") send(res, 405, undefined, { allow: "GET, HEAD" });
      else sendJson(res, 200, { ok: true });
      return;
    }
    const refused = checkFetchSite(req.headers) ?? checkToken(req.headers, ctx.token);
    if (refused) {
      deny(res, refused);
      return;
    }
    await api(ctx, method, path, new URLSearchParams(rawQuery), req, res);
    return;
  }
  if (ctx.root !== undefined) {
    await serveStatic(ctx.root, method, path, res);
    return;
  }
  // The app's files are another server's (Vite's, while AluKit is developed). Its answers carry
  // the same headers as this server's: no framing, no sniffing, only the page's own scripts.
  for (const [name, value] of Object.entries(COMMON)) res.setHeader(name, value);
  if (next) next();
  else send(res, 404, "not found");
}

/**
 * A project's server, apart from where it listens (design §7.1, §7.2, §10): it holds the edit
 * lock and the project host, makes the token, and answers requests behind the security gate.
 * `startServer` gives it a `node:http` server of its own with the built app; Vite's dev server
 * mounts `handle` as a middleware and serves the app itself (`dev.ts`).
 */
export interface Session {
  /** The project folder, resolved. */
  dir: string;
  host: ProjectHost;
  token: string;
  /**
   * Answers a request; never rejects. A request for the app's files goes to `next` when the
   * session serves no built app.
   */
  handle(req: IncomingMessage, res: ServerResponse, next?: () => void): Promise<void>;
  /**
   * The server listens on 127.0.0.1 at `port`: the gate admits that host and origin from now on,
   * and `.alukit/owner.json` is written so the CLI finds it. Returns the app's address.
   */
  listening(port: number): Promise<string>;
  /** Ends the event streams, closes the host, removes the owner file, releases the edit lock. */
  close(): Promise<void>;
}

/** Takes a project: its edit lock (§7.1), then the host. Invalid files refuse to open. */
export async function openSession(options: SessionOptions): Promise<Session> {
  let dir: string;
  try {
    dir = await realpath(options.dir);
    if (!(await stat(join(dir, DOCUMENT))).isFile()) throw new Error();
  } catch {
    throw new Error(`no project in ${options.dir} (no ${DOCUMENT}); create one with alukit new`);
  }

  const release = await acquireEditLock(dir, SERVE);
  let project: ProjectHost;
  try {
    project = await ProjectHost.open({
      ...(options.host ?? {}),
      dir,
      ...(options.builtinDir ? { builtinDir: options.builtinDir } : {}),
    });
  } catch (e) {
    await release();
    throw e;
  }

  const token = newToken();
  // No request passes the gate before the server listens: port 0 is no request's Host.
  let port = 0;
  const ctx: Ctx = {
    root: options.distDir,
    port: () => port,
    token,
    project,
    model: undefined,
    catalog: undefined,
    streams: new Set(),
  };
  let closing: Promise<void> | undefined;
  return {
    dir,
    host: project,
    token,
    handle: (req, res, next) =>
      handle(ctx, req, res, next).catch(() => {
        // Never let one request's failure become an unhandled rejection that ends the process.
        if (res.headersSent) res.destroy();
        else send(res, 500, "internal error");
      }),
    async listening(p) {
      port = p;
      const url = `http://${HOST}:${port}/`;
      await writeOwner(dir, { url, port, started: new Date().toISOString(), token });
      return url;
    },
    close() {
      closing ??= (async () => {
        for (const s of ctx.streams) s.destroy();
        await project.close();
        await removeOwner(dir, token);
        await release();
      })();
      return closing;
    },
  };
}

/**
 * Starts the server for a project: takes the edit lock (§7.1), opens the project, listens on
 * 127.0.0.1, and writes `.alukit/owner.json` with a fresh token. `close` undoes all of it.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const distDir = resolve(options.distDir ?? defaultDist);
  try {
    await readFile(join(distDir, "index.html"));
  } catch {
    throw new Error("the app is not built (no dist/index.html); run `pnpm build` first");
  }
  const session = await openSession({ ...options, distDir });
  const server = createServer((req, res) => {
    void session.handle(req, res);
  });
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      if (server.listening) {
        await new Promise<void>((ok) => {
          server.close(() => ok());
          server.closeAllConnections();
        });
      }
      await session.close();
    })();
    return closing;
  };
  let port: number;
  let url: string;
  try {
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(options.port ?? 0, HOST, ok);
    });
    port = (server.address() as AddressInfo).port;
    url = await session.listening(port);
  } catch (e) {
    await close();
    throw e;
  }
  return {
    server,
    port,
    url,
    appUrl: `${url}#t=${session.token}`,
    token: session.token,
    dir: session.dir,
    host: session.host,
    close,
  };
}
