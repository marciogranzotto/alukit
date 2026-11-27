import { type ChildProcess, spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/**
 * Serving a project for a test the way a person does: `alukit serve <dir>` on a scratch copy of
 * a fixture (its catalogs beside it, so relative paths hold), and the CLI as a separate process.
 * The app must be built first (`pnpm build`).
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = join(ROOT, "tests", "fixtures");
const MAIN = join(ROOT, "src", "cli", "main.ts");

export interface Served {
  /** The app's address, ending in "/". */
  url: string;
  /** The address `serve` printed: the token in the fragment. */
  appUrl: string;
  token: string;
  port: number;
  dir: string;
  stop(): Promise<void>;
}

/**
 * Runs the CLI as its own process, in the repository or in `cwd`; resolves with its exit code,
 * output, and timing.
 */
export function cli(
  args: string[],
  cwd = ROOT,
): Promise<{ code: number; out: string; err: string; exitedAt: number }> {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [MAIN, ...args], { cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      err += b.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => ok({ code: code ?? -1, out, err, exitedAt: Date.now() }));
  });
}

/** A scratch copy of a fixture project with its catalogs beside it, served by nothing. */
export async function scratchProject(
  project = "cart",
): Promise<{ dir: string; remove(): Promise<void> }> {
  const base = await mkdtemp(join(tmpdir(), "alukit-e2e-"));
  await cp(join(FIXTURES, "catalogs"), join(base, "catalogs"), { recursive: true });
  const dir = join(base, ...project.split("/"));
  await cp(join(FIXTURES, ...project.split("/")), dir, { recursive: true });
  return { dir, remove: () => rm(base, { recursive: true, force: true }) };
}

/** A scratch copy of a fixture project, served by `alukit serve`. */
export async function serve(project = "cart"): Promise<Served> {
  const base = await mkdtemp(join(tmpdir(), "alukit-e2e-"));
  await cp(join(FIXTURES, "catalogs"), join(base, "catalogs"), { recursive: true });
  const dir = join(base, ...project.split("/"));
  await cp(join(FIXTURES, ...project.split("/")), dir, { recursive: true });
  return serveAt(dir, base);
}

/**
 * A project as `alukit new` makes it, with the options given (the README's first run:
 * `--catalog forseti --currency BRL`), in a scratch folder, served by `alukit serve`.
 */
export async function serveNew(args: string[] = []): Promise<Served> {
  const base = await mkdtemp(join(tmpdir(), "alukit-e2e-new-"));
  const dir = join(base, "project");
  const made = await cli(["new", dir, ...args]);
  if (made.code !== 0) throw new Error(`alukit new failed: ${made.err}`);
  return serveAt(dir, base);
}

/** `alukit serve` on a folder; stopping it removes `base`, the scratch folder it is in. */
async function serveAt(dir: string, base: string): Promise<Served> {
  const child: ChildProcess = spawn(process.execPath, [MAIN, "serve", dir, "--no-open"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appUrl = await new Promise<string>((ok, fail) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => fail(new Error(`alukit serve did not start: ${err}`)), 20_000);
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString();
      const line = out.split("\n").find((l) => l.startsWith("http://"));
      if (line) {
        clearTimeout(timer);
        ok(line.trim());
      }
    });
    child.stderr?.on("data", (b: Buffer) => {
      err += b.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`alukit serve exited ${code}: ${err}`));
    });
  });
  const u = new URL(appUrl);
  const token = u.hash.replace(/^#t=/, "");
  return {
    url: `${u.origin}/`,
    appUrl,
    token,
    port: Number(u.port),
    dir,
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once("exit", r));
        child.kill("SIGINT");
        await exited;
      }
      await rm(base, { recursive: true, force: true });
    },
  };
}

/**
 * `pnpm dev` with a project (design §10): Vite's dev server, as the `dev` script runs it, on a
 * scratch copy of a fixture named relative to the folder pnpm ran in (`INIT_CWD`). The project's
 * server is mounted in it and prints the address with the token.
 */
export async function dev(project = "cart"): Promise<Served> {
  const base = await mkdtemp(join(tmpdir(), "alukit-e2e-dev-"));
  await cp(join(FIXTURES, "catalogs"), join(base, "catalogs"), { recursive: true });
  const dir = join(base, ...project.split("/"));
  await cp(join(FIXTURES, ...project.split("/")), dir, { recursive: true });

  const vite = join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const child: ChildProcess = spawn(process.execPath, [vite, "--port", "0"], {
    cwd: ROOT,
    env: { ...process.env, ALUKIT_PROJECT: project, INIT_CWD: base },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appUrl = await new Promise<string>((ok, fail) => {
    let out = "";
    const timer = setTimeout(
      () => fail(new Error(`vite did not mount the project: ${out}`)),
      30_000,
    );
    const read = (b: Buffer) => {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Vite's colours are ANSI escapes
      out += b.toString().replace(/\u001b\[[0-9;]*m/g, "");
      const m = /AluKit: +(http:\/\/\S+#t=\S+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        ok(m[1] as string);
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`vite exited ${code}: ${out}`));
    });
  });
  const u = new URL(appUrl);
  return {
    url: `${u.origin}/`,
    appUrl,
    token: u.hash.replace(/^#t=/, ""),
    port: Number(u.port),
    dir,
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await exited;
      }
      await rm(base, { recursive: true, force: true });
    },
  };
}

export interface Raw {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

/** A raw HTTP request, with whatever Host and Origin a test chooses (fetch would not send them). */
export function raw(
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
        res.on("data", (c: string) => {
          body += c;
        });
        res.on("end", () => ok({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on("error", fail);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
    req.end(opts.body);
  });
}

/** Opens a tab on the served app and waits until it draws the given revision. */
export async function openTab(page: Page, s: Served, rev = 0): Promise<void> {
  await page.goto(s.appUrl);
  await waitDrawn(page, rev);
}

export async function waitDrawn(page: Page, rev: number, timeout = 15_000): Promise<void> {
  // Drawn means rendered: the tab has handed revision `rev` to the viewer (`drawnRev`) and a frame
  // has drawn it (`modelFrame`, the frame that first drew the current model; the viewer sets it
  // back to 0 when it takes a new model). The view renders on demand, so the hand-over comes
  // before that frame, and a check made in between (a shader-link count, a pixel, a pick) raced
  // the frame: under load, the model's programs linked after a count read "after the revision".
  await page.waitForFunction(
    (r) => window.__alukit?.drawnRev() === r && (window.__alukit?.frames()?.modelFrame ?? 0) > 0,
    rev,
    { timeout, polling: 10 },
  );
}

/**
 * A number as the CLI prints it, as a pattern that also matches the app's grouping: the tables
 * put a narrow no-break space (U+202F) between thousands (docs/ux/plan.md S4.2), so `1090.00`
 * and `1 090.00` are one number. Digits and the point still have to match, in order.
 */
export function numberText(printed: string): RegExp {
  const escaped = [...printed].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join(" ?"));
}

/**
 * The newest step's words as `alukit log --json` gives them (BE-4's `text`, else the commands'
 * names): what the top bar's Undo names, an oracle independent of the app.
 */
export async function lastStepWords(dir: string): Promise<string> {
  const r = await cli(["log", dir, "--json"]);
  const entries = (JSON.parse(r.out) as { entries: { what: string; text?: string }[] }).entries;
  const last = entries[entries.length - 1];
  if (!last) throw new Error("the log is empty");
  return last.text ?? last.what;
}

/** The number of bars `alukit derive --json` reports: an oracle independent of the app. */
export async function derivedBarCount(dir: string): Promise<number> {
  const r = await cli(["derive", dir, "--json"]);
  return Object.keys((JSON.parse(r.out) as { bars: Record<string, unknown> }).bars).length;
}

/** The project's document as it is on disk (`alukit.json`): what a step wrote, read by the test. */
export async function docOf(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, "alukit.json"), "utf8")) as Record<string, unknown>;
}

/**
 * Selects entities by id, from the outline: a click on the first one's row, Ctrl+click on the
 * others', as a person would. Waits until the selection is exactly them.
 */
export async function selectByIds(page: Page, ids: readonly string[]): Promise<void> {
  const tree = page.getByTestId("tree");
  for (const [i, id] of ids.entries()) {
    await tree
      .locator(`[data-id="${id}"]`)
      .first()
      .click(i > 0 ? { modifiers: ["ControlOrMeta"] } : {});
  }
  const want = [...ids].sort();
  await page.waitForFunction(
    (w) => JSON.stringify([...(window.__alukit?.selection() ?? [])].sort()) === JSON.stringify(w),
    want,
  );
}

/**
 * Opens the context menu with a right-click (a press and release that do not move) at a world
 * point, Z up, mm; returns the menu, once it shows.
 */
export async function contextMenu(page: Page, at: readonly [number, number, number]) {
  const s = await page.evaluate((p) => window.__alukit?.screen(p), at as [number, number, number]);
  if (!s) throw new Error(`${at} is not on the screen`);
  await page.mouse.click(s[0], s[1], { button: "right" });
  const menu = page.getByTestId("context-menu");
  await menu.waitFor({ state: "visible" });
  return menu;
}
