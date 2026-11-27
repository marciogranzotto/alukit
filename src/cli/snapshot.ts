import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { EditLockHeld } from "#core/project/store.ts";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { diagnosticLine } from "./project.ts";
import { publishUsageOf } from "./publish-usage.ts";

/**
 * `alukit snapshot <dir> [--view iso] [--size 1600x1000] [--theme dark|light] -o shot.png` (design
 * §7.3): lets an agent
 * see what it built. It always renders in headless Chromium through Playwright, from a fresh page
 * on the project's server: the running one when there is one (found through
 * `.alukit/owner.json`), else an ephemeral one that holds the edit lock while it renders. One
 * code path, which never depends on a person's camera, selection or a hidden tab. The page
 * shows the viewport alone (`?snapshot=<view>`), at a named view (the document's `views`, then
 * the standard ones), with no animation, in SwiftShader at a fixed size and a device scale of 1,
 * so two snapshots of the same state match. The theme is dark unless `--theme light` (D-UX-21,
 * BE-11): the page is asked for it (`&theme=`) and the browser prefers that scheme, so the
 * picture never depends on the machine's setting.
 *
 * The PNG comes back to the CLI, which writes it wherever `-o` says (§7.2: the server writes only
 * inside the project).
 */

const USAGE = publishUsageOf("snapshot");

const SIZE = /^(\d{2,5})x(\d{2,5})$/;
const MAX_PX = 8192;
export const THEMES = ["dark", "light"] as const;
export type SnapshotTheme = (typeof THEMES)[number];

/** The page a snapshot loads: the viewport alone at a view, in a theme, the token in the hash. */
export function snapshotUrl(o: {
  url: string;
  token: string;
  view: string;
  theme: SnapshotTheme;
}): string {
  const q = new URLSearchParams({ snapshot: o.view, theme: o.theme });
  return `${o.url}?${q}#t=${o.token}`;
}

/** What a snapshot page answers once it has drawn, or why it cannot. */
interface Hook {
  snapshot(): string | undefined;
}

/** Renders a project's view in headless Chromium; resolves with the PNG's bytes. */
export async function renderSnapshot(o: {
  url: string;
  token: string;
  view: string;
  width: number;
  height: number;
  theme?: SnapshotTheme;
  timeoutMs?: number;
}): Promise<Buffer> {
  const theme = o.theme ?? "dark";
  let chromium: typeof import("@playwright/test").chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    throw new Error(
      "snapshots render in Playwright's Chromium, which is not installed: run pnpm install, then pnpm exec playwright install chromium",
    );
  }
  // SwiftShader, as the end-to-end tests run: the same pixels on every machine with no GPU.
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: o.width, height: o.height },
      deviceScaleFactor: 1,
      colorScheme: theme,
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(snapshotUrl({ ...o, theme }));
    try {
      await page.waitForFunction(
        () => (window as unknown as { __alukit?: Hook }).__alukit?.snapshot() !== undefined,
        undefined,
        { timeout: o.timeoutMs ?? 30_000, polling: 50 },
      );
    } catch {
      throw new Error(
        `the page did not draw the project${pageErrors.length > 0 ? `: ${pageErrors.join("; ")}` : ""}`,
      );
    }
    const state = await page.evaluate(() =>
      (window as unknown as { __alukit?: Hook }).__alukit?.snapshot(),
    );
    if (state !== "ready") throw new Error(state ?? "the page did not draw the project");
    return await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
  } finally {
    await browser.close();
  }
}

export async function snapshotCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions(
    "snapshot",
    argv,
    {
      view: { type: "string" },
      size: { type: "string" },
      output: { type: "string", short: "o" },
      theme: { type: "string" },
    },
    USAGE,
    io,
  );
  if (args === 2) return 2;
  const [dir, ...extra] = args.positionals;
  if (dir === undefined) return usageError("snapshot", "a project folder is needed", USAGE, io);
  if (extra.length > 0) return usageError("snapshot", `unexpected argument ${extra[0]}`, USAGE, io);
  const out = args.values.output;
  if (out === undefined) return usageError("snapshot", "-o <file.png> is needed", USAGE, io);
  const view = args.values.view ?? "iso";
  const size = SIZE.exec(args.values.size ?? "1600x1000");
  const width = Number(size?.[1]);
  const height = Number(size?.[2]);
  if (!size || width < 16 || height < 16 || width > MAX_PX || height > MAX_PX) {
    return usageError(
      "snapshot",
      `invalid --size ${args.values.size}: <width>x<height>, 16 to ${MAX_PX} pixels each`,
      USAGE,
      io,
    );
  }

  const theme = (args.values.theme ?? "dark") as SnapshotTheme;
  if (!THEMES.includes(theme)) {
    return usageError("snapshot", `invalid --theme ${theme}: dark or light`, USAGE, io);
  }

  // Loaded lazily so --help never touches the server.
  const { findServer } = await import("../server/client.ts");
  const link = await findServer(dir);
  let ephemeral: Awaited<ReturnType<typeof import("../server/server.ts").startServer>> | undefined;
  try {
    let url: string;
    let token: string;
    if (link) {
      url = link.url;
      token = link.token;
    } else {
      const { startServer } = await import("../server/server.ts");
      const { HostOpenError } = await import("../server/host.ts");
      try {
        ephemeral = await startServer({ dir, port: 0, host: { watch: false } });
      } catch (e) {
        if (e instanceof HostOpenError) {
          io.err(`alukit snapshot: the project's files are not valid (see alukit check ${dir}):`);
          for (const d of e.diagnostics) io.err(`  ${diagnosticLine(d)}`);
        } else if (e instanceof EditLockHeld) {
          io.err(`alukit snapshot: ${e.message}`);
        } else io.err(`alukit snapshot: ${e instanceof Error ? e.message : String(e)}`);
        return 1;
      }
      url = ephemeral.url;
      token = ephemeral.token;
    }
    let png: Buffer;
    try {
      png = await renderSnapshot({ url, token, view, width, height, theme });
    } catch (e) {
      io.err(`alukit snapshot: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
    const file = resolve(out);
    await writeFile(file, png);
    io.out(
      `${out}: ${width}x${height}, view ${view}, ${link ? "from the running server" : "from an ephemeral server"}`,
    );
    return 0;
  } finally {
    await ephemeral?.close();
  }
}
