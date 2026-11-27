import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sectionProperties } from "#core/section-properties.ts";
import { checkCatalog } from "./check.ts";
import { buildSection, type CatalogSet } from "./link.ts";
import { BUILTIN_DIR, openCatalog } from "./open.ts";
import { reportJson } from "./report.ts";
import { at, checkTest, fixtureCopy, patchJson } from "./testing.ts";

const codes = (r: { report: { diagnostics: { code: string }[] } }) =>
  r.report.diagnostics.map((d) => d.code);

describe("the test catalog", () => {
  it("loads and checks with no errors and no warnings", async () => {
    const { report, set } = await checkTest(await fixtureCopy());
    expect(report.diagnostics).toEqual([]);
    expect(report.counts).toEqual({ items: 18, offers: 22, sections: 6, errors: 0, warnings: 0 });
    // TS40E's section is the built-in Forseti outline; Forseti's rails reference ref-hiwin, its
    // screws the standards in std (F2a).
    expect([...set.catalogs.keys()].sort()).toEqual([
      "forseti",
      "ref-hiwin",
      "ref-test",
      "std",
      "test",
    ]);
    expect(report.uncomputed).toEqual(["test:RAIL20", "test:TS40", "test:TS4080"]);
  });

  it("the 40x40 básico's exact outline gives 553.5 ± 0.1 mm² and Ix, Iy 9.13 ± 0.01 cm⁴ (design §12, M1)", async () => {
    const { set } = await checkTest(await fixtureCopy());
    // The importer's section in the built-in catalog, which the test catalog references.
    const ls = set.get("section", "forseti:PF40-01", "test")?.value;
    expect(ls?.section.fidelity).toBe("exact");
    if (ls?.section.fidelity !== "exact") throw new Error("not exact");
    const p = sectionProperties([{ outline: ls.section.outline, holes: ls.section.holes ?? [] }]);
    expect(Math.abs(p.area_mm2 - 553.5)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(p.Ix_mm4 / 1e4 - 9.13)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(p.Iy_mm4 / 1e4 - 9.13)).toBeLessThanOrEqual(0.01);
    // One solid with five holes (the centre cell and four corner cells), centred on its box.
    expect(ls.section.holes).toHaveLength(5);
    expect(Math.hypot(...p.centroid_mm)).toBeLessThan(0.02);
  });

  it("reports computed against published, with an accepted mismatch", async () => {
    const { report } = await checkTest(await fixtureCopy());
    const row = (item: string, field: string) =>
      report.rows.find((r) => r.item === item && r.field === field);
    expect(row("test:TS40E", "area_mm2")).toMatchObject({
      status: "ok",
      published: 553,
      fidelity: "exact",
    });
    expect(row("test:TS40E", "mass_kg_per_m")?.status).toBe("ok");
    expect(row("test:RHS-50x30x2", "Iy_mm4")).toMatchObject({
      status: "accepted",
      published: 42300,
    });
    expect(row("test:M10-ROD", "area_mm2")?.status).toBe("ok");
    expect(row("test:M10-ROD", "Ix_mm4")?.status).toBe("computed");
    // Envelopes are not compared.
    expect(row("test:TS40", "area_mm2")).toBeUndefined();
  });

  it("is deterministic: two runs give the same JSON", async () => {
    const root = await fixtureCopy();
    const a = JSON.stringify(reportJson((await checkTest(root)).report));
    const b = JSON.stringify(reportJson((await checkTest(root)).report));
    expect(a).toBe(b);
  });
});

describe("merge layers (design §3.1)", () => {
  it("applies an override whose expect matches, and computes the corrected history", async () => {
    const { set } = await checkTest(await fixtureCopy());
    const li = set.get("item", "TS4080", "test")?.value;
    if (li?.item.kind !== "bar") throw new Error("not a bar");
    expect(li.item.Ix_mm4).toMatchObject({ v: 655000, src: "calc" });
    expect(li.item.Iy_mm4).toMatchObject({ v: 177600, src: "calc" });
    expect(li.corrected.map((c) => [c.field, (c.was as { v: number }).v])).toEqual([
      ["Ix_mm4", 177600],
      ["Iy_mm4", 65500],
    ]);
    expect(li.sources.get("Ix_mm4")).toMatchObject({ file: "test/overrides.json", layer: 3 });
  });

  it("a test override with a stale expect is reported by catalog check, and not applied (design §12, M1)", async () => {
    const root = await fixtureCopy();
    // The vendor fixes one value: the correction written against the old one is now stale.
    await patchJson(join(root, "test/catalog.json"), (d) => {
      at(d, "items", "TS4080").Ix_mm4 = 650000;
    });
    const { report, set } = await checkTest(root);
    const stale = report.diagnostics.filter((d) => d.code === "override-stale");
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      severity: "error",
      entity: "test:TS4080",
      field: "Ix_mm4",
      files: ["test/overrides.json", "test/catalog.json"],
    });
    expect(stale[0]?.message).toMatch(/expects 177600 but the item has 650000/);
    expect(report.counts.errors).toBe(1);
    const li = set.get("item", "TS4080", "test")?.value;
    if (li?.item.kind !== "bar") throw new Error("not a bar");
    expect(li.item.Ix_mm4).toBe(650000);
    expect(li.corrected.map((c) => c.field)).toEqual(["Iy_mm4"]);
  });

  it("compares expect by number, so a refreshed read date does not make it stale", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/catalog.json"), (d) => {
      at(d, "items", "TS4080").Ix_mm4.read = "2027-01-01";
    });
    expect((await checkTest(root)).report.diagnostics).toEqual([]);
  });

  it("a family file that changes a field set by the importer fails, naming both files (design §12, M1)", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/families/connectors.json"), (d) => {
      at(d, "items", "BRK-40").mass_kg = 0.2;
    });
    const { report, set } = await checkTest(root);
    const hits = report.diagnostics.filter((d) => d.code === "family-changes-importer-field");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      severity: "error",
      entity: "test:BRK-40",
      field: "mass_kg",
      files: ["test/catalog.json", "test/families/connectors.json"],
    });
    // The importer's value stands.
    const li = set.get("item", "BRK-40", "test")?.value;
    expect(li?.item.kind === "connector" && li.item.mass_kg).toBe(0.15);
  });

  it("two families setting one field differently collide, naming both", async () => {
    const root = await fixtureCopy();
    await writeFile(
      join(root, "test/families/zz-extra.json"),
      JSON.stringify({
        schema: "alukit.family/1",
        family: "extra",
        prov: { src: "est" },
        items: { "BRK-40": { ratings: { safety_factor: 3 } } },
      }),
    );
    const { report } = await checkTest(root);
    expect(report.diagnostics.map((d) => [d.code, d.field, d.files])).toEqual([
      [
        "family-collision",
        "ratings/safety_factor",
        ["test/families/connectors.json", "test/families/zz-extra.json"],
      ],
    ]);
  });

  it("a family may restate a value unchanged, and add fields", async () => {
    const root = await fixtureCopy();
    await writeFile(
      join(root, "test/families/zz-extra.json"),
      JSON.stringify({
        schema: "alukit.family/1",
        family: "extra",
        prov: { src: "meas", note: "weighed" },
        items: { "BRK-40": { mass_kg: 0.15, ratings: { slip_N: 400 } } },
      }),
    );
    const { report, set } = await checkTest(root);
    expect(report.diagnostics).toEqual([]);
    const li = set.get("item", "BRK-40", "test")?.value;
    expect(li?.item.ratings).toMatchObject({ slip_N: 400, safety_factor: 2 });
    // A bare number a family sets takes the family's provenance, not the item's.
    expect(li?.sources.get("ratings/slip_N")).toMatchObject({
      layer: 2,
      prov: { src: "meas", note: "weighed" },
    });
    expect(li?.sources.get("mass_kg")).toMatchObject({ layer: 1 });
  });

  it("a family may add a whole item, which takes its provenance", async () => {
    const { set } = await checkTest(await fixtureCopy());
    const li = set.get("item", "HNG-40", "test")?.value;
    expect(li?.item).toMatchObject({ kind: "connector", subtype: "hinge", prov: { src: "meas" } });
    expect(li?.files).toEqual(["test/families/connectors.json"]);
  });

  it("names the file to fix for an invalid field, and every contributor for a missing one", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/families/connectors.json"), (d) => {
      const brk = at(d, "items", "BRK-40");
      delete brk.fits;
      brk.frame.x = "sideways";
    });
    const { report } = await checkTest(root);
    const schema = report.diagnostics.filter((d) => d.code === "schema");
    expect(schema.map((d) => [d.field, d.files])).toEqual([
      ["fits", ["test/catalog.json", "test/families/connectors.json"]],
      ["frame/x", ["test/families/connectors.json"]],
    ]);
  });

  it("refuses a duplicate key in a JSON file, with its line", async () => {
    const root = await fixtureCopy();
    const path = join(root, "test/families/connectors.json");
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace('"safety_factor": 2', '"safety_factor": 2, "safety_factor": 3'),
    );
    const { report } = await checkTest(root);
    const d = report.diagnostics.find((x) => x.code === "json");
    expect(d?.message).toMatch(
      /duplicate key "safety_factor" in \/items\/BRK-40\/ratings \(line \d+, column \d+\)/,
    );
    expect(d?.files).toEqual(["test/families/connectors.json"]);
  });
});

describe("ids across catalogs (design §3.1)", () => {
  it("resolves full and bare references", async () => {
    const { set } = await checkTest(await fixtureCopy());
    expect(set.get("item", "ref-test:HG20CA", "test")?.id).toBe("ref-test:HG20CA");
    expect(set.get("item", "HG20CA", "test")).toBeUndefined();
    expect(set.get("system", "rail-hg20", "test")?.id).toBe("test:rail-hg20");
    expect(set.get("system", "rail-hg20", "ref-test")?.id).toBe("ref-test:rail-hg20");
    // Items and sections are separate namespaces.
    expect(set.get("section", "TS40", "test")?.id).toBe("test:TS40");
    expect(set.get("item", "TS40", "test")?.id).toBe("test:TS40");
  });

  it("fills a clone's missing ratings from its original, as estimates", async () => {
    const { set } = await checkTest(await fixtureCopy());
    const li = set.get("item", "CAR20", "test")?.value;
    if (!li) throw new Error("CAR20 did not load");
    const ratings = li.item.ratings ?? {};
    expect(ratings.preload_class).toBe("ZA");
    expect(ratings.C_N).toMatchObject({ v: 27100, src: "est" });
    expect((ratings.C0_N as { note: string }).note).toMatch(/ref-test:HG20CA/);
    expect(li.sources.get("ratings/C_N")).toMatchObject({
      layer: "clone",
      from: "ref-test:HG20CA",
    });
  });

  it("gives a rail's stock offer its stated factory E, or the centred layout's as an estimate (draft 2.1)", async () => {
    const { set } = await checkTest(await fixtureCopy());
    const sale = (sku: string) => set.catalogs.get("test")?.offers.get(sku)?.sale;
    // Stated: kept as is.
    expect(sale("RAIL20-1000")).toMatchObject({ factory_E_mm: 20 });
    // Not stated: pitch 60, E_min 20, 500 long: ((500 − 40) mod 60) / 2 + 20 = 40.
    expect(sale("RAIL20-500")).toMatchObject({ factory_E_mm: { v: 40, src: "est" } });
  });

  it("checks a stated factory E against the rail's range and pitch, and only on rails", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/offers.json"), (d) => {
      at(d, "offers", "RAIL20-1000").sale.factory_E_mm = 50; // 900 between: 15 pitches, E > 40
      at(d, "offers", "RAIL20-500").sale.factory_E_mm = 25; // 450 between: 7.5 pitches
      at(d, "offers", "M10-ROD-1000").sale.factory_E_mm = 20;
    });
    const { report } = await checkTest(root);
    expect(report.diagnostics.map((d) => [d.code, d.entity])).toEqual([
      ["offer-factory-E", "test:offers/M10-ROD-1000"],
      ["factory-E-pitch", "test:offers/RAIL20-500"],
      ["factory-E-range", "test:offers/RAIL20-1000"],
    ]);
  });

  it("reports unknown references and unknown catalogs", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/catalog.json"), (d) => {
      at(d, "items", "TS40").section = "NOPE";
      at(d, "items", "CAR20").clone_of.item = "nope:X";
    });
    const { report } = await checkTest(root);
    expect(report.diagnostics.map((d) => [d.code, d.entity, d.field])).toEqual([
      ["ref-unknown", "test:TS40", "section"],
      ["ref-unknown-catalog", "test:CAR20", "clone_of/item"],
    ]);
  });

  it("refuses two catalogs with one id, naming both folders", async () => {
    const root = await fixtureCopy();
    const { cp } = await import("node:fs/promises");
    await cp(join(root, "test"), join(root, "test-copy"), { recursive: true });
    const { report } = await checkTest(root, [join(root, "test-copy")]);
    const d = report.diagnostics.find((x) => x.code === "duplicate-id");
    expect(d).toMatchObject({
      entity: "test",
      files: ["test/catalog.json", "test-copy/catalog.json"],
    });
  });

  it("refuses two section files with one id, naming both", async () => {
    const root = await fixtureCopy();
    await copyFile(
      join(root, "test/sections/TS40.json"),
      join(root, "test/sections/TS40-again.json"),
    );
    const { report } = await checkTest(root);
    expect(report.diagnostics.find((d) => d.code === "duplicate-id")).toMatchObject({
      entity: "test:sections/TS40",
      files: ["test/sections/TS40-again.json", "test/sections/TS40.json"],
    });
  });

  it("finds a referenced catalog beside the target only if it declares that id", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "ref-test/catalog.json"), (d) => {
      d.id = "other";
    });
    const { report } = await checkTest(root);
    expect(codes({ report })).toContain("catalog-id-mismatch");
    expect(codes({ report })).toContain("ref-unknown-catalog");
  });
});

describe("a fastener made to a standard (F2a)", () => {
  const open = async (root: string) => {
    const opened = await openCatalog(join(root, "test-x"), { cwd: root });
    return { ...opened, report: checkCatalog(opened.set, "test-x", opened.diagnostics) };
  };
  const dims = (set: CatalogSet, id: string) => {
    const it = set.get("item", id, "test-x")?.value.item;
    return it?.kind === "fastener" ? it.dims : undefined;
  };

  it("fills the dimensions it does not state from its standard's row, with where they came from", async () => {
    const { set, report } = await open(await fixtureCopy());
    expect(report.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(dims(set, "SCR-M8x50-STD")).toEqual({
      dk_mm: {
        v: 13,
        src: "src",
        ref: "a synthetic table, ISO 4762's values at M4 and M8",
        note: "from test-x:SHCS's row for M8, the standard it cites",
      },
      k_mm: expect.objectContaining({ v: 8, src: "src" }),
      s_mm: expect.objectContaining({ v: 6, src: "src" }),
    });
    expect(set.get("item", "SCR-M8x50-STD", "test-x")?.value.sources.get("dims/dk_mm")).toEqual({
      file: expect.stringMatching(/test-x\/catalog\.json$/),
      layer: "standard",
      from: "test-x:SHCS",
    });
    // Taken to be made to it: the values are the standard's, their claim an estimate.
    expect(dims(set, "SCR-M8x50-EST")?.dk_mm).toMatchObject({
      v: 13,
      src: "est",
      note: "from test-x:SHCS's row for M8, the standard it is taken to be made to",
    });
    // What the item states wins.
    expect(dims(set, "SCR-M8x50-OWN")).toMatchObject({ dk_mm: 10, k_mm: { v: 8 }, s_mm: { v: 6 } });
    expect(dims(set, "SCR-M8x50-BARE")).toBeUndefined();
  });

  it("refuses a standard with no row for the thread, a fastener with no thread, and an unknown one", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test-x/catalog.json"), (d) => {
      at(d, "items", "SCR-M8x50-STD").thread = "M6";
      delete at(d, "items", "SCR-M8x50-EST").thread;
      at(d, "items", "SCR-M8x50-OWN").standard.id = "NOPE";
    });
    const { report } = await open(root);
    expect(
      report.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => [d.code, d.entity, d.field, d.message]),
    ).toEqual([
      [
        "ref-unknown",
        "test-x:SCR-M8x50-OWN",
        "standard/id",
        '"NOPE" is not a standard in catalog "test-x"',
      ],
      [
        "standard-size",
        "test-x:SCR-M8x50-EST",
        "thread",
        "standard test-x:SHCS is read at the fastener's thread, and it gives none",
      ],
      [
        "standard-size",
        "test-x:SCR-M8x50-STD",
        "standard/id",
        "standard test-x:SHCS (SHCS (synthetic)) has no row for M6",
      ],
    ]);
  });

  it("fills the vendor's screws from the std catalog's tables", async () => {
    const opened = await openCatalog(join(BUILTIN_DIR, "forseti"));
    const it = (id: string) => opened.set.get("item", id, "forseti")?.value.item;
    const socket = it("PCI8-10");
    expect(socket?.kind === "fastener" && socket.standard).toMatchObject({
      id: "std:ISO4762",
      src: "est",
    });
    expect(socket?.kind === "fastener" && socket.dims).toMatchObject({
      dk_mm: { v: 13, src: "est", ref: "ISO 4762:2004, Table 1" },
      k_mm: { v: 8 },
      s_mm: { v: 6 },
    });
    const button = it("PAB5-8");
    expect(button?.kind === "fastener" && button.dims?.dk_mm).toMatchObject({ v: 9.5 });
  });
});

describe("computed against published (design §3.6)", () => {
  it("fails on a mismatch beyond 1 % that no override accepts", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/overrides.json"), (d) => {
      d.overrides = (d.overrides as { accept?: boolean }[]).filter((o) => !o.accept);
    });
    const { report } = await checkTest(root);
    expect(report.diagnostics.map((d) => [d.code, d.entity, d.field])).toEqual([
      ["mismatch", "test:RHS-50x30x2", "Iy_mm4"],
    ]);
    expect(
      report.rows.find((r) => r.item === "test:RHS-50x30x2" && r.field === "Iy_mm4")?.status,
    ).toBe("mismatch");
  });

  it("holds a traced outline to 2 % of the published area", async () => {
    const root = await fixtureCopy();
    // The built-in 40x40 básico outline, copied into the test catalog as a traced section.
    const traced = join(root, "test/sections/PF40-T.json");
    await copyFile(join(BUILTIN_DIR, "forseti/sections/PF40-01.json"), traced);
    await patchJson(traced, (d) => {
      d.id = "PF40-T";
      d.fidelity = "traced";
      for (const g of d.grooves as { type: string }[]) g.type = "c8";
    });
    await patchJson(join(root, "test/catalog.json"), (d) => {
      at(d, "items", "TS40E").section = "PF40-T";
      at(d, "items", "TS40E").area_mm2 = 530;
    });
    const { report } = await checkTest(root);
    expect(codes({ report })).toEqual(["mismatch", "traced-area"]);
  });
});

describe("a drawn section's cores (§3.5, §5.5)", () => {
  /** The built-in 40x40 básico outline, copied into the test catalog with the given cores. */
  async function withCores(cores: unknown) {
    const root = await fixtureCopy();
    const file = join(root, "test/sections/PF40-C.json");
    await copyFile(join(BUILTIN_DIR, "forseti/sections/PF40-01.json"), file);
    await patchJson(file, (d) => {
      d.id = "PF40-C";
      d.cores = cores;
      for (const g of d.grooves as { type: string }[]) g.type = "c8";
    });
    return checkTest(root);
  }

  it("are holes of the outline: the centre bore and the corner holes of the 40x40 básico", async () => {
    // p. 16: Ø13.7 at the centre and Ø5 at (±15.5, ±15.5), "31" between the corner holes.
    const { report, set } = await withCores([
      { at_mm: [0, 0], d_mm: 13.7 },
      { at_mm: [15.5, 15.5], d_mm: 5 },
    ]);
    expect(report.diagnostics).toEqual([]);
    const ls = set.get("section", "test:PF40-C", "test")?.value;
    if (!ls) throw new Error("PF40-C did not load");
    const b = buildSection(set, ls);
    expect("cores" in b && b.cores).toEqual([
      { at_mm: [0, 0], d_mm: 13.7 },
      { at_mm: [15.5, 15.5], d_mm: 5 },
    ]);
  });

  it("refuses a core in solid metal, or one its hole is not the size of", async () => {
    // (19, 19) is in the wall outside the corner hole; the corner hole's inscribed circle about
    // (15.5, 15.5) is Ø4.97, not Ø8.
    const { report } = await withCores([
      { at_mm: [19, 19], d_mm: 5 },
      { at_mm: [15.5, 15.5], d_mm: 8 },
    ]);
    expect(report.diagnostics.map((d) => [d.code, d.entity, d.message])).toEqual([
      [
        "section-invalid",
        "test:sections/PF40-C",
        "core 0 at (19, 19) is in no hole of the outline",
      ],
      [
        "section-invalid",
        "test:sections/PF40-C",
        expect.stringMatching(
          /^core 1 at \(15\.5, 15\.5\): its hole's inscribed circle there is Ø4\.9\d\d, not its Ø8 \(more than 0\.1 mm off on the radius\)$/,
        ),
      ],
    ]);
  });
});

describe("offers (design §3.2)", () => {
  it("checks options, sale rules, price units and kits against the item", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/offers.json"), (d) => {
      const o = d.offers as Record<string, Record<string, unknown>>;
      (o["TS40-c7"] as Record<string, unknown>).options = { finish: "gold" };
      delete (o["TS40-pp-c7"] as Record<string, unknown>).options;
      delete (o["TS40E-c7"] as Record<string, unknown>).sale;
      at(o, "RAIL20-500", "price").per = "m";
      at(o, "BRK-40-K10", "kit")[0].item = "SCR-M8x16";
      (o["CAR20-1"] as Record<string, unknown>).sale = { mode: "stock", length_mm: 100 };
    });
    const { report } = await checkTest(root);
    expect(
      report.diagnostics.filter((d) => d.severity === "error").map((d) => [d.code, d.entity]),
    ).toEqual([
      ["offer-kit-main", "test:offers/BRK-40-K10"],
      ["offer-option", "test:offers/TS40-c7"],
      ["offer-option-missing", "test:offers/TS40-pp-c7"],
      ["offer-price-per", "test:offers/RAIL20-500"],
      ["offer-sale", "test:offers/CAR20-1"],
      ["offer-sale-missing", "test:offers/TS40E-c7"],
    ]);
  });

  it("refuses an offer or a kit that sells a joint recipe (acceptance gap A2)", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/catalog.json"), (d) => {
      const brk = at(d, "items", "BRK-40");
      brk.recipe = true;
      delete brk.mass_kg;
      delete brk.bbox_mm;
    });
    const { report } = await checkTest(root);
    expect(
      report.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => [d.code, d.entity, d.field]),
    ).toEqual([
      ["offer-recipe", "test:offers/BRK-40", "item"],
      ["offer-recipe", "test:offers/BRK-40-K10", "item"],
      ["offer-recipe", "test:offers/BRK-40-K10", "kit/0/item"],
    ]);
  });

  it("warns about an option no offer sells", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/offers.json"), (d) => {
      delete (d.offers as Record<string, unknown>)["TS40-pp-c7"];
    });
    const { report } = await checkTest(root);
    expect(report.diagnostics.map((d) => [d.severity, d.code, d.entity, d.message])).toEqual([
      ["warn", "option-no-offer", "test:TS40", "option finish=black has no offer"],
    ]);
  });

  it("reports one invalid offer and still loads the rest", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/offers.json"), (d) => {
      at(d, "offers", "FOOT-M8").pack = 0;
    });
    const { report, set } = await checkTest(root);
    expect(report.diagnostics.map((d) => [d.code, d.entity])).toEqual([
      ["schema", "test:offers/FOOT-M8"],
    ]);
    expect(set.catalogs.get("test")?.offers.size).toBe(21);
  });
});

describe("a missing or broken catalog", () => {
  it("reports a folder with no catalog.json", async () => {
    const root = await fixtureCopy();
    await rm(join(root, "test/catalog.json"));
    const { report } = await checkTest(root);
    expect(report.counts.errors).toBeGreaterThan(0);
    expect(codes({ report })).toContain("catalog-not-found");
  });
});
