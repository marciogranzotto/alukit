import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localDate } from "#core/dates.ts";
import type { Io } from "./cli.ts";

/**
 * `alukit catalog import forseti` (design §7.3, §11): runs the Forseti importer
 * (`importers/forseti/import_forseti.py`, Python with PyMuPDF) on its documented inputs, a
 * snapshot of the shop and the technical catalogue's PDF, and writes `catalogs/forseti` (or
 * `--out`). Each input comes from its flag, else its environment variable (as the importer's
 * test reads them), else the checkout's `.cache/forseti/`:
 *
 * | Input | Flag | Variable | In `.cache/forseti/` |
 * |---|---|---|---|
 * | Python with PyMuPDF | `--python` | `FORSETI_PYTHON` | `venv/bin/python` |
 * | the shop's snapshot | `--snapshot` | `FORSETI_SNAPSHOT` | the newest of `snapshots/<date>` |
 * | the catalogue PDF | `--pdf` | `FORSETI_PDF` | `catalogo_forsetiA4.pdf` |
 *
 * When one is missing it says which, and how to get it, and runs nothing. It reads the network
 * only with `--fetch`, which first takes a new snapshot (the importer's `fetch`: GET only, at
 * most one request per second) into `--snapshot`'s folder, else `snapshots/<today>`.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const IMPORTERS: Readonly<Record<string, string>> = {
  forseti: join(ROOT, "importers", "forseti", "import_forseti.py"),
};

export interface ImportArgs {
  name: string;
  python?: string;
  snapshot?: string;
  pdf?: string;
  out?: string;
  fetch: boolean;
}

/** What the importer needs, resolved; `missing` says what is not there, and how to get it. */
export interface ImportPlan {
  script: string;
  python?: string;
  snapshot?: string;
  pdf?: string;
  out: string;
  /** The new folder `fetch` takes the snapshot into, with --fetch. */
  fetchInto?: string;
  missing: string[];
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

/** The newest snapshot under `.cache/forseti/snapshots/`: folder names are dates. */
function newestSnapshot(cache: string): string | undefined {
  const dir = join(cache, "snapshots");
  if (!isDir(dir)) return undefined;
  const names = readdirSync(dir)
    .filter((n) => isFile(join(dir, n, "manifest.json")))
    .sort();
  const last = names[names.length - 1];
  return last === undefined ? undefined : join(dir, last);
}

export function importPlan(
  a: ImportArgs,
  env: Readonly<Record<string, string | undefined>> = process.env,
  root = ROOT,
): ImportPlan | string {
  const script = IMPORTERS[a.name];
  if (!script) {
    return `there is no importer for "${a.name}"; the importers are: ${Object.keys(IMPORTERS).join(", ")}`;
  }
  const cache = join(root, ".cache", a.name);
  const missing: string[] = [];

  const python =
    a.python ??
    env.FORSETI_PYTHON ??
    (isFile(join(cache, "venv", "bin", "python"))
      ? join(cache, "venv", "bin", "python")
      : undefined);
  if (python === undefined) {
    missing.push(
      [
        "no Python with PyMuPDF: make one in the checkout with",
        `      python3 -m venv .cache/${a.name}/venv`,
        `      .cache/${a.name}/venv/bin/pip install pymupdf`,
        "    or pass --python <interpreter> (or set FORSETI_PYTHON)",
      ].join("\n"),
    );
  }

  let snapshot = a.snapshot ?? env.FORSETI_SNAPSHOT;
  let fetchInto: string | undefined;
  if (a.fetch) {
    fetchInto = resolve(snapshot ?? join(cache, "snapshots", localDate()));
    if (existsSync(fetchInto)) {
      missing.push(
        `${fetchInto} exists, and a snapshot is taken into a new folder: pass --snapshot <new folder>`,
      );
    }
    snapshot = fetchInto;
  } else {
    snapshot ??= newestSnapshot(cache);
    if (snapshot === undefined) {
      missing.push(
        [
          "no snapshot of the shop: pass --snapshot <folder> (or set FORSETI_SNAPSHOT),",
          "    or take one with --fetch, which reads the Forseti shop over the network",
          "    (GET only, at most one request per second)",
        ].join("\n"),
      );
    } else if (!isFile(join(snapshot, "manifest.json"))) {
      missing.push(`${snapshot} is not a snapshot: it has no manifest.json`);
    }
  }

  const pdf =
    a.pdf ??
    env.FORSETI_PDF ??
    (isFile(join(cache, "catalogo_forsetiA4.pdf"))
      ? join(cache, "catalogo_forsetiA4.pdf")
      : undefined);
  if (pdf === undefined) {
    missing.push(
      [
        "no technical catalogue: pass --pdf <catalogo_forsetiA4.pdf> (or set FORSETI_PDF),",
        `    or put it at .cache/${a.name}/catalogo_forsetiA4.pdf; the importer checks its SHA-256`,
      ].join("\n"),
    );
  } else if (!isFile(pdf)) {
    missing.push(`no file at ${pdf}`);
  }

  return {
    script,
    ...(python !== undefined ? { python } : {}),
    ...(snapshot !== undefined ? { snapshot: resolve(snapshot) } : {}),
    ...(pdf !== undefined ? { pdf: resolve(pdf) } : {}),
    out: resolve(a.out ?? join(root, "catalogs", a.name)),
    ...(fetchInto !== undefined ? { fetchInto } : {}),
    missing,
  };
}

/** Runs a program, passing its output through line by line; resolves with its exit code. */
function run(cmd: string, args: readonly string[], io: Io): Promise<number> {
  return new Promise((done) => {
    const child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    const relay = (write: (t: string) => void) => {
      let rest = "";
      return {
        data(b: Buffer) {
          rest += b.toString();
          const lines = rest.split("\n");
          rest = lines.pop() ?? "";
          for (const l of lines) write(l);
        },
        end() {
          if (rest !== "") write(rest);
        },
      };
    };
    const out = relay(io.out);
    const err = relay(io.err);
    child.stdout.on("data", out.data);
    child.stderr.on("data", err.data);
    child.on("error", (e) => {
      io.err(`cannot run ${cmd}: ${e.message}`);
      done(127);
    });
    child.on("close", (code) => {
      out.end();
      err.end();
      done(code ?? 1);
    });
  });
}

/** Where the inputs are looked for: the process's environment and the checkout, unless a test says. */
export interface ImportContext {
  env?: Readonly<Record<string, string | undefined>>;
  root?: string;
}

export async function importCommand(
  a: ImportArgs,
  io: Io,
  context: ImportContext = {},
): Promise<number> {
  const plan = importPlan(a, context.env ?? process.env, context.root ?? ROOT);
  const cmd = `alukit catalog import ${a.name}`;
  if (typeof plan === "string") {
    io.err(`${cmd}: ${plan}`);
    return 1;
  }
  if (plan.python !== undefined && plan.missing.length === 0) {
    // PyMuPDF is what `build` reads the PDF with: say so now rather than halfway through.
    const probe = await run(plan.python, ["-I", "-c", "import pymupdf"], {
      out: () => {},
      err: () => {},
    });
    if (probe !== 0) {
      plan.missing.push(
        `${plan.python} cannot import pymupdf: install it there (pip install pymupdf), or pass --python`,
      );
    }
  }
  if (plan.missing.length > 0) {
    io.err(`${cmd}: cannot run the importer:`);
    for (const m of plan.missing) io.err(`  - ${m}`);
    io.err(`  (see importers/${a.name}/README.md)`);
    return 1;
  }
  const python = plan.python as string;
  if (plan.fetchInto !== undefined) {
    io.err(`${cmd}: taking a snapshot of the shop into ${plan.fetchInto}`);
    const code = await run(python, ["-I", plan.script, "fetch", plan.fetchInto], io);
    if (code !== 0) return code;
  }
  io.err(`${cmd}: building ${plan.out} from ${plan.snapshot} and ${plan.pdf}`);
  return run(
    python,
    ["-I", plan.script, "build", plan.snapshot as string, plan.pdf as string, plan.out],
    io,
  );
}
