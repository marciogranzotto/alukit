import { readFile, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// TODO(M4a, design §7.2): the per-start token (.alukit/owner.json, Authorization on /api), the
// Host and Origin checks, JSON-only bodies, project-path confinement, and the document's command
// queue and event stream. Until then this server serves static files and /api/health only, and
// is bound to 127.0.0.1 so nothing off this machine can reach it.

const HOST = "127.0.0.1";

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

export interface ServerOptions {
  /** 0 picks a free port. */
  port?: number;
  /** The built app. Defaults to the repository's dist/. */
  distDir?: string;
}

export interface RunningServer {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

// fileURLToPath, not URL.pathname: pathname keeps percent-escapes, so a checkout under a folder
// with a space in its name would look for "my%20folder/dist".
const defaultDist = fileURLToPath(new URL("../../dist", import.meta.url));

/** True when `path` is `root` itself or lies under it. Both must be absolute and normalised. */
function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

function send(res: ServerResponse, status: number, text?: string): void {
  if (text === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(text);
}

async function handle(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  let path: string;
  try {
    // A malformed escape such as "%E0%A4%A" makes decodeURIComponent throw; uncaught, that
    // would take the whole server down.
    path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
  } catch {
    send(res, 400, "bad request");
    return;
  }
  if (path.includes("\0")) {
    send(res, 400, "bad request");
    return;
  }

  if (path === "/api/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end();
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
    "content-type": MIME[extname(real)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(method === "HEAD" ? undefined : body);
}

export function createAppServer(distDir: string = defaultDist): Server {
  const root = resolve(distDir);
  return createServer((req, res) => {
    handle(root, req, res).catch(() => {
      // Never let one request's failure become an unhandled rejection that ends the process.
      if (res.headersSent) res.destroy();
      else send(res, 500, "internal error");
    });
  });
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const distDir = options.distDir ?? defaultDist;
  try {
    await readFile(join(distDir, "index.html"));
  } catch {
    throw new Error("the app is not built (no dist/index.html); run `pnpm build` first");
  }
  const server = createAppServer(distDir);
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, HOST, ok);
  });
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    url: `http://${HOST}:${port}/`,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}
