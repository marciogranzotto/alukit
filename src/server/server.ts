import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

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

const defaultDist = resolve(new URL("../../dist", import.meta.url).pathname);

export function createAppServer(distDir: string = defaultDist): Server {
  const root = resolve(distDir);
  return createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");

    if (path === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const rel = normalize(path === "/" ? "/index.html" : path);
    const file = join(root, rel);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    }
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
