import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { at, FIXTURES, fixtureCopy, patchJson } from "#catalog/testing.ts";
import { editJson, scratchFixtures } from "#core/testing.ts";
import { helpText, run } from "./cli.ts";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const main = fileURLToPath(new URL("./main.ts", import.meta.url));

function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  return run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }).then((code) => ({
    code,
    out,
    err,
  }));
}

describe("cli", () => {
  it("prints the package version", async () => {
    const r = await capture(["--version"]);
    expect(r).toEqual({ code: 0, out: [pkg.version], err: [] });
  });

  it("lists planned commands as not implemented yet, and the server and project commands as usable", () => {
    expect(helpText()).toContain("(not implemented yet)");
    expect(helpText()).toMatch(/\n {2}derive <dir> \[--json\] \[--variant v\] \[--frozen\]\n/);
    expect(helpText()).toMatch(
      /\n {2}cutlist <dir> \[--format md\|csv\|json\] \[--variant v\] \[--frozen\]\n/,
    );
    expect(helpText()).toMatch(
      /\n {2}bom <dir> \[--format md\|csv\|json\] \[--variant v\] \[--frozen\]\n/,
    );
    expect(helpText()).toMatch(
      /\n {2}order <dir> \[--format md\|csv\|json\] \[--as-of YYYY-MM-DD\] \[--variant v\] \[--frozen\]\n/,
    );
    expect(helpText()).toMatch(
      /\n {2}costs <dir> \[--format md\|csv\|json\] \[--as-of YYYY-MM-DD\] \[--variant v\] \[--frozen\]\n/,
    );
    expect(helpText()).toMatch(/\n {2}fmt <dir>\.\.\. \[--check\]\n/);
    for (const cmd of [
      "serve",
      "undo",
      "log",
      "bom",
      "order",
      "costs",
      "new",
      "check",
      "do",
      "add",
      "query",
      "lock update",
      "fmt",
    ]) {
      expect(helpText()).toMatch(new RegExp(`\\n {2}${cmd} `));
      expect(helpText()).not.toMatch(new RegExp(`\\n {2}${cmd} .*not implemented`));
    }
  });

  it("refuses planned and unknown commands, and a project command with no folder", async () => {
    expect((await capture(["order"])).code).toBe(2);
    expect((await capture(["nope"])).code).toBe(2);
    expect((await capture(["bom"])).code).toBe(2);
  });

  it("runs under Node with no flag and no warning", () => {
    // execFileSync throws on a non-zero exit; stdio "pipe" lets us see stderr.
    const stdout = execFileSync(process.execPath, [main, "--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(stdout.trim()).toBe(pkg.version);
  });
});

describe("alukit catalog", () => {
  const fixture = (name: string) => join(FIXTURES, name);

  it("checks a clean catalog: exit 0, the table, OK", async () => {
    const r = await capture(["catalog", "check", fixture("test")]);
    expect(r.code).toBe(0);
    const text = r.out.join("\n");
    expect(text).toMatch(
      /test:TS40E\s+forseti:PF40-01\s+exact\s+area_mm2\s+553\.53\s+553\s+\+0\.10 %\s+ok/,
    );
    expect(text).toMatch(/Iy_mm4 .* accepted: synthetic/);
    expect(text.trimEnd().endsWith("OK")).toBe(true);
  });

  it("exits 1 and names the stale override", async () => {
    const root = await fixtureCopy();
    await patchJson(join(root, "test/catalog.json"), (d) => {
      at(d, "items", "TS4080").Ix_mm4 = 650000;
    });
    const r = await capture(["catalog", "check", join(root, "test"), "--json"]);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.out.join("\n")) as { ok: boolean; diagnostics: { code: string }[] };
    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((d) => d.code)).toEqual(["override-stale"]);
  });

  it("shows a merged item with its sources, corrections, section and offers", async () => {
    const r = await capture(["catalog", "show", "test:TS4080", "--catalog", fixture("test")]);
    expect(r.code).toBe(0);
    const shown = JSON.parse(r.out.join("\n"));
    expect(shown.id).toBe("test:TS4080");
    expect(shown.item.Ix_mm4.v).toBe(655000);
    expect(shown.corrected).toHaveLength(2);
    expect(shown.sources.Ix_mm4).toMatch(/overrides\.json \(layer 3\)$/);
    expect(shown.section).toMatchObject({
      id: "test:TS4080",
      fidelity: "parametric",
      props_ok: false,
    });
    expect(shown.offers.map((o: { sku: string }) => o.sku)).toEqual([
      "test:TS4080-c7",
      "test:TS4080-pp-c7",
    ]);
    expect(
      (await capture(["catalog", "show", "test:NOPE", "--catalog", fixture("test")])).code,
    ).toBe(1);
  });

  it("prints the JSON Schemas", async () => {
    const one = await capture(["catalog", "schema", "section"]);
    expect(one.code).toBe(0);
    expect(JSON.parse(one.out.join("\n")).title).toBe("alukit section");
    const all = JSON.parse((await capture(["catalog", "schema"])).out.join("\n"));
    expect(Object.keys(all)).toEqual([
      "catalog",
      "offers",
      "section",
      "family",
      "overrides",
      "item",
    ]);
    expect((await capture(["catalog", "schema", "nope"])).code).toBe(2);
  });

  it("refuses bad usage with exit 2", async () => {
    expect((await capture(["catalog"])).code).toBe(2);
    expect((await capture(["catalog", "check"])).code).toBe(2);
    expect((await capture(["catalog", "check", "x", "--frobnicate"])).code).toBe(2);
    expect((await capture(["catalog", "search", "x"])).code).toBe(2);
    expect((await capture(["catalog", "check", "no-such-catalog"])).code).toBe(1);
  });

  it("runs as a Node process, subpath imports included", () => {
    const stdout = execFileSync(
      process.execPath,
      [main, "catalog", "check", fixture("test"), "--json"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(JSON.parse(stdout).ok).toBe(true);
  });
});

describe("alukit derive, cutlist and bom", () => {
  const project = (name: string) =>
    fileURLToPath(new URL(`../../tests/fixtures/${name}`, import.meta.url));

  it("derives a project as JSON: exit 0, alukit.derived/1", async () => {
    const r = await capture(["derive", project("cart"), "--json"]);
    expect(r.code).toBe(0);
    const d = JSON.parse(r.out.join("\n"));
    expect(d.schema).toBe("alukit.derived/1");
    expect(d.bars.b14.cut_mm).toBe(569.88);
    expect(d.bars["b26@6"].pattern).toBe("pt1");
    expect(d.diagnostics).toEqual([]);
  });

  it("exits 1 and names the problem when the document has an error", async () => {
    const r = await capture(["derive", project("golden-ends/G07")]);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/^error angled-end b2\.a: /m);
  });

  it("prints the cut list in each format", async () => {
    const md = await capture(["cutlist", project("cart")]);
    expect(md.code).toBe(0);
    expect(md.out.join("\n")).toMatch(/\| 4 \| 153\.14 \| 113\.14 \| 45\.00° mitre -45\.00° \//);
    const csv = await capture(["cutlist", project("cart"), "--format", "csv"]);
    expect(csv.out.join("\n").split("\n")[0]).toMatch(/^kind,item,options,mode,count,cut_mm,/);
    const json = await capture(["cutlist", project("cart"), "--format", "json"]);
    expect(JSON.parse(json.out.join("\n")).schema).toBe("alukit.cutlist/1");
  });

  it("prints the bill of materials in each format", async () => {
    const md = await capture(["bom", project("cart")]);
    expect(md.code).toBe(0);
    expect(md.out.join("\n")).toMatch(/^# Bill of materials$/m);
    expect(md.out.join("\n")).toMatch(
      /^\| test:CAR20 \| .* \| 3 \| 0\.400 \| 1\.200 \| p1, p1@1, p1@2 \|$/m,
    );
    const csv = await capture(["bom", project("cart"), "--format", "csv"]);
    expect(csv.out.join("\n").split("\n")[0]).toMatch(/^kind,item,name,options,qty,length_mm,/);
    const json = await capture(["bom", project("cart"), "--format", "json"]);
    const b = JSON.parse(json.out.join("\n"));
    expect(b.schema).toBe("alukit.bom/1");
    expect(b.diagnostics).toEqual([]);
  });

  it("exits 1 for the BOM of a document with an error, naming it", async () => {
    const r = await capture(["bom", project("golden-ends/G07")]);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/^error angled-end b2\.a: /m);
  });

  it("prints the order list, and exits 0 when every supplier is ready", async () => {
    const md = await capture(["order", project("order"), "--as-of", "2026-11-26"]);
    expect(md.code).toBe(0);
    expect(md.out.join("\n")).toMatch(
      /^# Order list\n\nREADY\. Prices on the regular basis in BRL/,
    );
    expect(md.out.join("\n")).toMatch(/^## shop-eu: READY$/m);
    expect(md.err).toEqual([]);
    const csv = await capture([
      "order",
      project("order"),
      "--format",
      "csv",
      "--as-of",
      "2026-11-26",
    ]);
    expect(csv.out.join("\n").split("\n")[0]).toMatch(/^row,supplier,status,id,sku,offer,item,/);
    expect(csv.out.join("\n")).toMatch(
      /^line,shop-a,READY,,SCR-O-10,test-order:SCR-O-10,test-order:SCR-O,.*,fastener,,4,pack,10,,6\.50,BRL,26\.00,26\.00,26\.00,/m,
    );
    expect(csv.out.join("\n")).toMatch(/^total,,,,,,,total,,.*,BRL,234\.80,234\.80,234\.80,/m);
  });

  it("exits 1 when a supplier is blocked, and says why on stderr", async () => {
    const r = await capture(["order", project("cart"), "--as-of", "2026-11-26"]);
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toMatch(/^## test-vendor: BLOCKED$/m);
    expect(r.err).toEqual([
      "BLOCKED local: open-item: O2: price the sensor bracket with the local shop",
      "BLOCKED local: missing-price: project:angle-a: no price",
      "BLOCKED test-gen-vendor: open-item: O1: confirm the rail screws' length against the rail's counterbore",
      "BLOCKED test-vendor: est-price: test:PSU-24V: the price of test:PSU-24V is an estimate",
      "BLOCKED (unsourced): placeholder: project:motor: a placeholder, not a part to order",
      "BLOCKED (unsourced): missing-price: test:SPL-STUD: no offer",
    ]);
  });

  it("prints the machining sheet as Markdown or JSON (M6)", async () => {
    const md = await capture(["machining", project("cart")]);
    expect(md.code).toBe(0);
    expect(md.out.join("\n")).toMatch(
      /^\| h2 \| 140\.00 \| 20\.00 \| countersunk \| Ø6\.60, countersink Ø12\.40 at 90\.00°, 2\.90 deep, through \| front \|$/m,
    );
    expect(md.out.join("\n")).toMatch(/^Blank 50\.00 × 64\.60; bend allowance 6\.60/m);
    const json = await capture(["machining", project("cart"), "--format", "json"]);
    const sheet = JSON.parse(json.out.join("\n"));
    expect([sheet.schema, sheet.parts.map((p: { item: string }) => p.item)]).toEqual([
      "alukit.machining/1",
      ["project:angle-a", "project:plate-a"],
    ]);
    const csv = await capture(["machining", project("cart"), "--format", "csv"]);
    expect(csv.code).toBe(2);
  });

  it("prints the costs and totals in each format", async () => {
    const md = await capture(["costs", project("cart"), "--as-of", "2026-11-26"]);
    expect(md.code).toBe(0);
    expect(md.out.join("\n")).toMatch(/^\| \*\*Total\*\* \| 5441\.59 \| 6155\.35 \| 7512\.91 \|$/m);
    const json = await capture([
      "costs",
      project("cart"),
      "--format",
      "json",
      "--as-of",
      "2026-11-26",
    ]);
    const c = JSON.parse(json.out.join("\n"));
    expect([c.schema, c.costs.length, c.totals.total.likely_minor]).toEqual([
      "alukit.costs/1",
      5,
      615535,
    ]);
    const csv = await capture([
      "costs",
      project("cart"),
      "--format",
      "csv",
      "--as-of",
      "2026-11-26",
    ]);
    const rows = csv.out.join("\n").split("\n");
    expect(rows[0]).toBe("row,supplier,id,name,kind,currency,low,likely,high,price_src,details");
    expect(rows).toContain(
      'cost,,K4,"freight, quoted in dollars",freight,USD,20.00,30.00,45.00,est,"at 5.5: 110.00, 165.00, 247.50"',
    );
    expect(rows).toContain("total,,,total,,BRL,5441.59,6155.35,7512.91,,");
  });

  it("states the lock it was derived from in every format (the stamp, §4.13, §9)", async () => {
    const dir = project("order");
    // Any sha256 tool gives the stamp from the canonical lock file.
    const lockFile = readFileSync(join(dir, "alukit.lock.json"));
    const stamp = `sha256:${createHash("sha256").update(lockFile).digest("hex")}`;
    const args = [dir, "--as-of", "2026-11-26"];
    for (const cmd of ["order", "costs"]) {
      const json = await capture([cmd, ...args, "--format", "json"]);
      expect(JSON.parse(json.out.join("\n")).lock).toBe(stamp);
      const md = await capture([cmd, ...args]);
      expect(md.out.join("\n")).toContain(`\n\nDerived from the lock ${stamp}.\n\n`);
      const csv = await capture([cmd, ...args, "--format", "csv"]);
      expect(csv.out.join("\n").split("\n")[1]).toMatch(new RegExp(`^stamp,+lock,+${stamp}$`));
    }
    // --frozen derives from the lock alone, and states the same one.
    const frozen = await capture(["order", ...args, "--format", "json", "--frozen"]);
    expect(JSON.parse(frozen.out.join("\n")).lock).toBe(stamp);
  });

  it("runs the project's checks before the order rules: a failing one holds the order", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "order");
    const budget = (limit: string) =>
      editJson(join(dir, "alukit.json"), (d) => {
        d.checks = [{ id: "C1", value: "cost()", op: "<=", limit, text: "budget" }];
      });
    // The fixture's order comes to R$ 234.80 (cost() reads the priced order, §4.9).
    await budget("100");
    const over = await capture(["order", dir, "--as-of", "2026-11-26"]);
    expect(over.code).toBe(1);
    expect(over.err).toContain(
      "error check C1: C1 (budget): cost() = 234.8, not <= 100 (margin -134.8)",
    );
    // A check that names no entity holds every supplier (§5.5).
    for (const shop of ["shop-a", "shop-eu"]) {
      expect(over.err.join("\n")).toMatch(
        new RegExp(`^BLOCKED ${shop}: check-error: check C1: `, "m"),
      );
    }
    expect((await capture(["costs", dir, "--as-of", "2026-11-26"])).code).toBe(1);
    await budget("250");
    const within = await capture(["order", dir, "--as-of", "2026-11-26"]);
    expect(within.code).toBe(0);
    expect(within.err).toEqual([]);
  });

  it("refuses a date that is not one", async () => {
    expect((await capture(["order", project("cart"), "--as-of", "2026-02-30"])).code).toBe(2);
    expect((await capture(["costs", project("cart"), "--as-of"])).code).toBe(2);
  });

  it("refuses bad usage with exit 2", async () => {
    expect((await capture(["cutlist"])).code).toBe(2);
    expect((await capture(["cutlist", "x", "--format", "pdf"])).code).toBe(2);
    expect((await capture(["bom", "x", "--format", "pdf"])).code).toBe(2);
    expect((await capture(["derive", "x", "--frob"])).code).toBe(2);
  });

  it("exits 1 for a folder with no document", async () => {
    const r = await capture(["derive", project("catalogs")]);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/cannot read alukit\.json/);
  });
});
