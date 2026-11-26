import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localDate } from "#core/dates.ts";
import { type ImportArgs, importCommand, importPlan } from "./catalog-import.ts";
import { capture } from "./testing.ts";

/**
 * `alukit catalog import forseti` (design §7.3, §11): finds the importer's inputs or says what is
 * missing; never reads the network without --fetch. The importer itself (Python, PyMuPDF, the
 * shop's data) is tested by its own suite; here a stand-in interpreter records what it is asked.
 */

const args = (over: Partial<ImportArgs> = {}): ImportArgs => ({
  name: "forseti",
  fetch: false,
  ...over,
});

/** A checkout's root with a `.cache/forseti/` holding what the flags name, nothing by default. */
async function scratchRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "alukit-import-"));
}

/** A stand-in Python: logs each call's arguments to `calls.log` beside it and exits `code`. */
async function fakePython(dir: string, code = 0): Promise<string> {
  const path = join(dir, "python");
  await writeFile(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${join(dir, "calls.log")}"\necho "importer says hi"\nexit ${code}\n`,
  );
  await chmod(path, 0o755);
  return path;
}

async function snapshot(root: string, name: string): Promise<string> {
  const dir = join(root, ".cache", "forseti", "snapshots", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "manifest.json"), "{}");
  return dir;
}

function collect() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
}

describe("alukit catalog import forseti", () => {
  it("says every input that is missing, and how to get it, and runs nothing", async () => {
    const root = await scratchRoot();
    const c = collect();
    expect(await importCommand(args(), c.io, { env: {}, root })).toBe(1);
    const said = c.err.join("\n");
    expect(said).toMatch(/cannot run the importer/);
    expect(said).toMatch(/no Python with PyMuPDF/);
    expect(said).toMatch(/python3 -m venv \.cache\/forseti\/venv/);
    expect(said).toMatch(/no snapshot of the shop: pass --snapshot/);
    expect(said).toMatch(/or take one with --fetch, which reads the Forseti shop over the network/);
    expect(said).toMatch(/no technical catalogue: pass --pdf/);
    expect(said).toMatch(/see importers\/forseti\/README\.md/);
    expect(c.out).toEqual([]);
  });

  it("takes each input from its flag, else its variable, else the checkout's cache", async () => {
    const root = await scratchRoot();
    const cache = join(root, ".cache", "forseti");
    await mkdir(join(cache, "venv", "bin"), { recursive: true });
    await writeFile(join(cache, "venv", "bin", "python"), "");
    await writeFile(join(cache, "catalogo_forsetiA4.pdf"), "");
    await snapshot(root, "2026-11-01");
    const newest = await snapshot(root, "2026-11-20");
    await mkdir(join(cache, "snapshots", "2026-11-25"), { recursive: true }); // no manifest: not one

    const cached = importPlan(args(), {}, root);
    expect(cached).toEqual({
      script: expect.stringMatching(/importers\/forseti\/import_forseti\.py$/),
      python: join(cache, "venv", "bin", "python"),
      snapshot: newest,
      pdf: join(cache, "catalogo_forsetiA4.pdf"),
      out: join(root, "catalogs", "forseti"),
      missing: [],
    });

    const other = await snapshot(root, "elsewhere");
    const fromEnv = importPlan(
      args(),
      {
        FORSETI_PYTHON: "/opt/py",
        FORSETI_SNAPSHOT: other,
        FORSETI_PDF: join(cache, "catalogo_forsetiA4.pdf"),
      },
      root,
    );
    expect(fromEnv).toMatchObject({ python: "/opt/py", snapshot: other, missing: [] });

    const flags = importPlan(
      args({ python: "/usr/bin/py3", snapshot: newest, out: join(root, "out") }),
      { FORSETI_PYTHON: "/opt/py" },
      root,
    );
    expect(flags).toMatchObject({ python: "/usr/bin/py3", out: join(root, "out"), missing: [] });
  });

  it("refuses a folder that is not a snapshot, a PDF that is not there, an importer it lacks", async () => {
    const root = await scratchRoot();
    const plan = importPlan(
      args({ python: "/usr/bin/py3", snapshot: root, pdf: join(root, "nope.pdf") }),
      {},
      root,
    );
    expect(typeof plan === "object" && plan.missing).toEqual([
      `${root} is not a snapshot: it has no manifest.json`,
      `no file at ${join(root, "nope.pdf")}`,
    ]);
    expect(importPlan(args({ name: "acme" }), {}, root)).toBe(
      'there is no importer for "acme"; the importers are: forseti',
    );
    const r = await capture(["catalog", "import", "acme"]);
    expect(r.code).toBe(1);
  });

  it("runs the importer's build on the inputs, passing its output through", async () => {
    const root = await scratchRoot();
    const python = await fakePython(root);
    const snap = await snapshot(root, "2026-11-20");
    const pdf = join(root, "catalogue.pdf");
    await writeFile(pdf, "");
    const c = collect();
    const code = await importCommand(
      args({ python, pdf, out: join(root, "catalogs", "forseti") }),
      c.io,
      { env: {}, root },
    );
    expect(code).toBe(0);
    const calls = (await readFile(join(root, "calls.log"), "utf8")).trim().split("\n");
    expect(calls).toEqual([
      "-I -c import pymupdf",
      expect.stringMatching(
        new RegExp(
          `^-I \\S+/importers/forseti/import_forseti\\.py build ${snap} ${pdf} ${join(root, "catalogs", "forseti")}$`,
        ),
      ),
    ]);
    expect(c.out).toEqual(["importer says hi"]);
    expect(c.err.join("\n")).toMatch(/building .* from .* and .*catalogue\.pdf/);
  });

  it("says when the interpreter has no PyMuPDF, before building anything", async () => {
    const root = await scratchRoot();
    const python = await fakePython(root, 3);
    await snapshot(root, "2026-11-20");
    const pdf = join(root, "catalogue.pdf");
    await writeFile(pdf, "");
    const c = collect();
    expect(await importCommand(args({ python, pdf }), c.io, { env: {}, root })).toBe(1);
    expect(c.err.join("\n")).toMatch(/cannot import pymupdf: install it there/);
  });

  it("reads the network only with --fetch, into a new folder, then builds from it", async () => {
    const root = await scratchRoot();
    const python = await fakePython(root);
    const pdf = join(root, "catalogue.pdf");
    await writeFile(pdf, "");
    const today = join(root, ".cache", "forseti", "snapshots", localDate());
    expect(importPlan(args({ python, pdf, fetch: true }), {}, root)).toMatchObject({
      snapshot: today,
      fetchInto: today,
      missing: [],
    });
    // A folder that exists is never fetched into.
    const taken = await snapshot(root, "taken");
    const refused = importPlan(args({ python, pdf, fetch: true, snapshot: taken }), {}, root);
    expect(typeof refused === "object" && refused.missing).toEqual([
      `${taken} exists, and a snapshot is taken into a new folder: pass --snapshot <new folder>`,
    ]);

    const into = join(root, "fresh");
    const c = collect();
    const code = await importCommand(args({ python, pdf, fetch: true, snapshot: into }), c.io, {
      env: {},
      root,
    });
    expect(code).toBe(0);
    const calls = (await readFile(join(root, "calls.log"), "utf8")).trim().split("\n");
    expect(calls[1]).toMatch(new RegExp(`import_forseti\\.py fetch ${into}$`));
    expect(calls[2]).toMatch(new RegExp(`import_forseti\\.py build ${into} ${pdf} `));
  });
});
