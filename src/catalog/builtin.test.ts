import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "../cli/cli.ts";
import { checkCatalog } from "./check.ts";
import { BUILTIN_DIR, openCatalog } from "./open.ts";
import { isValuedObject } from "./schema/common.ts";

/** The built-in catalogs (design §12, M2a): each checks clean, and Forseti's meets its done-when. */

async function check(id: string) {
  const opened = await openCatalog(join(BUILTIN_DIR, id), { cwd: BUILTIN_DIR });
  return { ...opened, report: checkCatalog(opened.set, id, opened.diagnostics) };
}

describe("the built-in catalogs", () => {
  for (const id of ["forseti", "std", "ref-hiwin"]) {
    it(`alukit catalog check ${id} exits 0`, async () => {
      const err: string[] = [];
      const code = await run(["catalog", "check", id], { out: () => {}, err: (t) => err.push(t) });
      expect(err).toEqual([]);
      expect(code).toBe(0);
      const { report } = await check(id);
      expect(report.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    });
  }
});

describe("Forseti (design §12, M2a done-when)", () => {
  it("passes the eight vector outlines within 1 %, or names the mismatch accepted", async () => {
    const { report, set } = await check("forseti");
    const exact = [...(set.catalogs.get("forseti")?.sections.values() ?? [])]
      .filter((s) => s.section.fidelity === "exact")
      .map((s) => `forseti:${s.id}`)
      .sort();
    expect(exact).toEqual(
      ["PF20-14", "PF30-02", "PF30-04", "PF40-00", "PF40-01", "PF40-03", "PF45-02", "PF45-12"].map(
        (s) => `forseti:${s}`,
      ),
    );
    const rows = report.rows.filter((r) => exact.includes(r.section) && r.status !== "computed");
    expect(rows.length).toBeGreaterThanOrEqual(8 * 4);
    for (const r of rows) expect(["ok", "accepted"], `${r.item} ${r.field}`).toContain(r.status);
    // The accepted ones are the two the catalogue's drawings and tables disagree on.
    expect([...new Set(rows.filter((r) => r.status === "accepted").map((r) => r.item))]).toEqual([
      "forseti:PF20-14",
      "forseti:PF40-00",
    ]);
  });

  it("gives every item an offer with regular and sale prices and a read date, and every bar a section", async () => {
    const { set } = await check("forseti");
    const cat = set.catalogs.get("forseti");
    if (!cat) throw new Error("forseti did not load");
    const offered = new Set<string>();
    for (const [sku, offer] of cat.offers) {
      offered.add(offer.item);
      expect(offer.price.read, sku).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(offer.price.regular_minor, sku).toBeDefined();
      // null when there is no sale: the field is always present after the import.
      expect(offer.price.sale_minor === null || offer.price.sale_minor !== undefined, sku).toBe(
        true,
      );
      if (offer.kit) for (const line of offer.kit) offered.add(line.item);
    }
    for (const [local, li] of cat.items) {
      expect(offered.has(local), `${local} has no offer`).toBe(true);
      if (li.item.kind === "bar") {
        const s = set.get("section", li.item.section, "forseti")?.value.section;
        expect(s?.fidelity, local).toMatch(/^(exact|traced|parametric|box)$/);
      }
    }
  });

  it("keeps the printed values and corrects them only by override", async () => {
    const { set } = await check("forseti");
    const item = (id: string) => set.get("item", id, "forseti")?.value.item;
    const v = (x: unknown) => (isValuedObject(x) ? x.v : x);
    const pf4080 = item("PF40-02");
    if (pf4080?.kind !== "bar") throw new Error("PF40-02 is not a bar");
    // p. 17: IY 6,55 cm⁴ printed for the strong axis, read as 65,5; IX 17,76 about the weak one.
    expect(v(pf4080.Ix_mm4)).toBe(655000);
    expect(v(pf4080.Iy_mm4)).toBe(177600);
  });
});

const importer = fileURLToPath(
  new URL("../../importers/forseti/import_forseti.py", import.meta.url),
);
const snapshot = process.env.FORSETI_SNAPSHOT;
const pdf = process.env.FORSETI_PDF;
const python = process.env.FORSETI_PYTHON ?? "python3";
const inputs = Boolean(snapshot && pdf && existsSync(snapshot) && existsSync(pdf));

async function files(dir: string, sub = ""): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const e of await readdir(join(dir, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) for (const [k, b] of await files(dir, rel)) out.set(k, b);
    else out.set(rel, await readFile(join(dir, rel)));
  }
  return out;
}

/**
 * The importer is deterministic (design §11): two runs on one snapshot give byte-identical files,
 * the same as the committed ones. It needs the snapshot and the PDF, which the repository does not
 * hold: set FORSETI_SNAPSHOT, FORSETI_PDF and, for PyMuPDF, FORSETI_PYTHON (importers/forseti).
 */
describe.skipIf(!inputs)("the Forseti importer", () => {
  it("gives byte-identical output twice, equal to the committed catalog", async () => {
    const runs: Map<string, Buffer>[] = [];
    for (let i = 0; i < 2; i++) {
      const out = await mkdtemp(join(tmpdir(), "alukit-forseti-"));
      execFileSync(python, ["-I", importer, "build", snapshot as string, pdf as string, out], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      runs.push(await files(out));
    }
    const [a, b] = runs as [Map<string, Buffer>, Map<string, Buffer>];
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [k, buf] of a) expect(buf.equals(b.get(k) as Buffer), k).toBe(true);
    const committed = await files(join(BUILTIN_DIR, "forseti"));
    for (const [k, buf] of a) expect(buf.equals(committed.get(k) as Buffer), k).toBe(true);
  }, 120_000);
});
