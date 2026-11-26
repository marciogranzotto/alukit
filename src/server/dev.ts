import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import type { Session } from "./server.ts";

/**
 * The project's server mounted in Vite's dev server while AluKit itself is developed (design
 * §10): `ALUKIT_PROJECT=<dir> pnpm dev` gives the app with hot reload and a project's data.
 *
 * It is the session `alukit serve` runs (`openSession`): the edit lock, the project host, the
 * event stream, the CLI finding it through `.alukit/owner.json`, and the same security gate in
 * front of every request, Vite's own included (`Host` and `Origin`; the token and
 * `Sec-Fetch-Site` on `/api`; the same response headers). Vite then serves the app's files. To
 * hold to §7.2 the dev server binds 127.0.0.1 and Vite's CORS middleware is off, so no answer
 * carries a CORS header. The address with the token is printed once the server listens.
 *
 * The session opens when Vite's server listens and closes with it. On a restart (an edited
 * config), Vite builds the new server before it closes the old one, so the new session waits for
 * its own `listening`, by which time the old one has let the edit lock go.
 */

export interface DevOptions {
  /** The project folder; without one, the dev server serves the app alone, as before. */
  project?: string | undefined;
  /** Where a relative project path starts: the folder `pnpm dev` ran in (pnpm's INIT_CWD). */
  cwd?: string | undefined;
  builtinDir?: string;
}

/** What a request finds: the session, or why there is none. */
type Mounted = { session: Session } | { error: string };

export function alukitDev(options: DevOptions = {}): Plugin {
  const dir =
    options.project === undefined || options.project === ""
      ? undefined
      : resolve(options.cwd ?? process.cwd(), options.project);
  let mounted: Promise<Mounted> | undefined;
  return {
    name: "alukit:project-server",
    apply: "serve",
    config() {
      if (dir === undefined) return;
      return { server: { host: "127.0.0.1", cors: false } };
    },
    configureServer(server) {
      if (dir === undefined) return;
      const http = server.httpServer;
      const logger = server.config.logger;
      if (!http) {
        logger.warn(`alukit: ${dir} is not mounted: Vite runs in middleware mode, with no server`);
        return;
      }
      http.once("listening", () => {
        const { port } = http.address() as AddressInfo;
        mounted = (async (): Promise<Mounted> => {
          try {
            // Loaded here, so a config that mounts nothing loads no server code.
            const { openSession } = await import("./server.ts");
            const session = await openSession({
              dir,
              ...(options.builtinDir ? { builtinDir: options.builtinDir } : {}),
            });
            try {
              const url = await session.listening(port);
              logger.info(`  ➜  AluKit:  ${url}#t=${session.token}  (${session.dir})`);
            } catch (e) {
              await session.close();
              throw e;
            }
            return { session };
          } catch (e) {
            const error = `cannot serve ${dir}: ${e instanceof Error ? e.message : String(e)}`;
            logger.error(`alukit: ${error}`);
            return { error };
          }
        })();
      });
      server.middlewares.use((req, res, next) => {
        void (async () => {
          const m = await mounted;
          if (m && "session" in m) {
            await m.session.handle(req, res, next);
            return;
          }
          const path = (req.url ?? "/").split("?")[0] ?? "/";
          if (path !== "/api" && !path.startsWith("/api/")) {
            next();
            return;
          }
          res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
          res.end(
            `${JSON.stringify({ ok: false, message: m?.error ?? "the project is not open yet" })}\n`,
          );
        })();
      });
    },
    async closeServer() {
      const m = await mounted;
      mounted = undefined;
      if (m && "session" in m) await m.session.close();
    },
  };
}
