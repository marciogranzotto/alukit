import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "../cli/cli.ts";
import { checkCatalog } from "./check.ts";
import { BUILTIN_DIR, openCatalog } from "./open.ts";
import { isValuedObject } from "./schema/common.ts";

const snapshot = process.env.FORSETI_SNAPSHOT;
const pdf = process.env.FORSETI_PDF;
const python = process.env.FORSETI_PYTHON ?? "python3";
const inputs = Boolean(snapshot && pdf && existsSync(snapshot) && existsSync(pdf));

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

/**
 * The 1,196 orderable SKUs of the shop snapshot the catalog was built from (the variations, and the
 * products without any): `importers/forseti/import_forseti.py skus`. The shop types eight products
 * `simple` that also have variations; it prices them, so they have offers, but they are not on the
 * list.
 */
const ORDERABLE: string[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("./forseti-orderable-skus.json", import.meta.url)), "utf8"),
);
const PRICED_PARENTS = [
  "CA40-01",
  "CA40-03",
  "CMU02-01",
  "CPT01-01",
  "PF45-02-c8",
  "PFT30-01-C4",
  "PLU40-01-PP",
  "PRP40-01",
];

describe("Forseti (design §12, M2b done-when)", () => {
  it("maps every one of the 1,196 orderable SKUs to an offer, and no offer to an unlisted SKU", async () => {
    expect(ORDERABLE).toHaveLength(1196);
    expect(new Set(ORDERABLE).size).toBe(1196);
    const { set } = await check("forseti");
    const cat = set.catalogs.get("forseti");
    if (!cat) throw new Error("forseti did not load");
    const bySku = new Map<string, string[]>();
    for (const [key, offer] of cat.offers) {
      const sku = offer.sku ?? key;
      bySku.set(sku, [...(bySku.get(sku) ?? []), key]);
    }
    for (const sku of ORDERABLE) {
      const keys = bySku.get(sku) ?? [];
      expect(keys.length, `${sku} has no offer`).toBeGreaterThanOrEqual(1);
      // One offer per SKU, except a SKU sold in several stock lengths (one offer each, §3.2).
      if (keys.length > 1) {
        for (const k of keys) expect(cat.offers.get(k)?.sale?.mode, k).toBe("stock");
      }
    }
    const listed = new Set([...ORDERABLE, ...PRICED_PARENTS]);
    expect([...bySku.keys()].filter((sku) => !listed.has(sku))).toEqual([]);
    expect([...bySku.keys()].filter((sku) => !ORDERABLE.includes(sku)).sort()).toEqual(
      [...PRICED_PARENTS].sort(),
    );
  });

  it("gives every profile stem a section with a declared fidelity", async () => {
    const { set } = await check("forseti");
    const cat = set.catalogs.get("forseti");
    if (!cat) throw new Error("forseti did not load");
    const stems = [
      ...new Set(
        ORDERABLE.map((s) => /^(PF\d\d-\d\d[A-Z]?)(?:-pp)?-c\d+(?:p\d+)?$/i.exec(s)?.[1]).filter(
          (s): s is string => s !== undefined,
        ),
      ),
    ].sort();
    expect(stems).toHaveLength(27);
    const fidelity: Record<string, number> = {};
    for (const stem of stems) {
      const li = cat.items.get(stem);
      expect(li?.item.kind, `${stem} is not a bar item`).toBe("bar");
      if (li?.item.kind !== "bar") continue;
      const f = set.get("section", li.item.section, "forseti")?.value.section.fidelity;
      expect(f, stem).toMatch(/^(exact|traced|parametric|box)$/);
      fidelity[f ?? "none"] = (fidelity[f ?? "none"] ?? 0) + 1;
    }
    expect(fidelity).toEqual({ exact: 8, parametric: 19 });
  });

  it("covers the shop's kinds: real kinds where the data supports them, generic for the rest", async () => {
    const { set } = await check("forseti");
    const cat = set.catalogs.get("forseti");
    if (!cat) throw new Error("forseti did not load");
    const kinds: Record<string, number> = {};
    for (const li of cat.items.values()) kinds[li.item.kind] = (kinds[li.item.kind] ?? 0) + 1;
    expect(Object.keys(kinds).sort()).toEqual(
      ["accessory", "bar", "carriage", "connector", "fastener", "generic", "panel"].sort(),
    );
    // A connector the build modelled says it has no mounting model yet; one layer 2 models with
    // its machining and its own head (the quick connector, after the round-3 acceptance) does not.
    for (const [id, li] of cat.items) {
      if (li.item.kind !== "connector" || li.item.mounts || li.item.requires) continue;
      expect(li.item.prov.note, `${id} does not say it has no mounting model`).toMatch(
        /no mounting model yet/,
      );
    }
    const qc = cat.items.get("CN40-01")?.item;
    expect(qc?.kind).toBe("connector");
    if (qc?.kind !== "connector") return;
    expect(qc.prov.note).not.toMatch(/no mounting model/);
    expect(qc.docs).toEqual([{ ref: "pdf:catalogo_forsetiA4.pdf#p24" }]);
  });

  it("models the base-40 quick connector's cross hole and head from Forseti's published data", async () => {
    const { set } = await check("forseti");
    const li = set.catalogs.get("forseti")?.items.get("CN40-01");
    const qc = li?.item;
    if (qc?.kind !== "connector") throw new Error("CN40-01 is not a connector");
    const v = (x: unknown) => (typeof x === "number" ? x : (x as { v: number }).v);
    const [hole] = qc.requires ?? [];
    expect(qc.requires).toHaveLength(1);
    expect({
      op: hole?.op,
      on: hole?.on,
      d: v(hole?.d_mm),
      depth: v(hole?.depth_mm),
      from_end: v(hole?.from_end_mm),
    }).toEqual({ op: "access-hole", on: "butting", d: 18, depth: 28, from_end: 25 });
    const dims = Object.fromEntries(Object.entries(qc.dims ?? {}).map(([k, x]) => [k, v(x)]));
    expect(dims).toEqual({ dk_mm: 18, d_mm: 7.8, k_mm: 4.48, rf_mm: 17.5 });
    // What is printed is read; what is measured off the drawing is an estimate.
    const src = (k: string) => (qc.dims?.[k] as { src?: string } | undefined)?.src;
    expect([src("dk_mm"), src("d_mm"), src("k_mm"), src("rf_mm")]).toEqual([
      "src",
      "src",
      "est",
      "est",
    ]);
  });

  it.skipIf(!snapshot || !existsSync(snapshot ?? ""))(
    "lists the orderable SKUs of the raw dump",
    async () => {
      const store = join(snapshot as string, "store");
      const read = async (prefix: string) => {
        const byId = new Map<number, { id: number; sku: string; parent?: number }>();
        for (const f of (await readdir(store)).filter((n) => n.startsWith(prefix))) {
          for (const x of JSON.parse(await readFile(join(store, f), "utf8")))
            if (!byId.has(x.id)) byId.set(x.id, x);
        }
        return [...byId.values()];
      };
      const products = await read("products_p");
      const variations = await read("variations_");
      const withChildren = new Set(variations.map((v) => v.parent));
      const orderable = [
        ...variations.map((v) => v.sku),
        ...products.filter((p) => !withChildren.has(p.id)).map((p) => p.sku),
      ].sort();
      expect(orderable).toEqual([...ORDERABLE].sort());
    },
  );
});

const importer = fileURLToPath(
  new URL("../../importers/forseti/import_forseti.py", import.meta.url),
);

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
