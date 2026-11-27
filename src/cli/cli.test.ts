import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { at, FIXTURES, fixtureCopy, patchJson } from "#catalog/testing.ts";
import { editJson, lockStamp, oldestCutRead, scratchFixtures } from "#core/testing.ts";
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

  it("lists every command of design §7.3 as usable: none is left planned", () => {
    expect(helpText()).not.toContain("not implemented");
    expect(helpText()).toMatch(
      /\n {2}derive <dir> \[--json\] \[--select <paths>\] \[--variant v\] \[--frozen\]\n/,
    );
    expect(helpText()).toMatch(/\n {2}catalog search <query> \[--kind <kind>\]/);
    expect(helpText()).toMatch(/\n {2}catalog import forseti /);
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
      "move",
      "rotate",
      "query",
      "lock update",
      "fmt",
    ]) {
      expect(helpText()).toMatch(new RegExp(`\\n {2}${cmd} `));
      expect(helpText()).not.toMatch(new RegExp(`\\n {2}${cmd} .*not implemented`));
    }
  });

  it("refuses unknown commands, and a project command with no folder", async () => {
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
    expect((await capture(["catalog", "search"])).code).toBe(2);
    expect((await capture(["catalog", "import"])).code).toBe(2);
    expect((await capture(["catalog", "import", "forseti", "--json"])).code).toBe(2);
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
    // Its three end faces that overhang their faces, warnings, and two parts whose seats are not
    // checked, infos (§4.5): derive exits 0.
    expect(
      d.diagnostics.map((x: { severity: string; code: string; entity: string }) => [
        x.severity,
        x.code,
        x.entity,
      ]),
    ).toEqual([
      ["warn", "connection", "c21"],
      ["warn", "connection", "c22"],
      ["warn", "connection", "c33"],
      ["info", "fit", "c23"],
      ["info", "fit", "c35"],
    ]);
  });

  it("answers only the members --select names, as derive --json has them (§7.3)", async () => {
    const whole = JSON.parse((await capture(["derive", project("cart"), "--json"])).out.join("\n"));
    const r = await capture(["derive", project("cart"), "--select", "bars.*.cut_mm,params"]);
    expect(r.code).toBe(0);
    const d = JSON.parse(r.out.join("\n"));
    // The schema and the stamp (§5.4) are always kept.
    expect(Object.keys(d)).toEqual(["schema", "lock", "params", "bars"]);
    expect(d.params).toEqual(whole.params);
    expect(Object.keys(d.bars)).toEqual(Object.keys(whole.bars));
    expect(d.bars.b14).toEqual({ cut_mm: whole.bars.b14.cut_mm });
    const missing = await capture(["derive", project("cart"), "--select", "bars.b999"]);
    expect(missing.code).toBe(1);
    expect(missing.err.join("\n")).toBe("alukit derive: the derived model has no bars.b999");
    expect((await capture(["derive", project("cart"), "--select", "bars..b1"])).code).toBe(2);
    expect((await capture(["cutlist", project("cart"), "--select", "bars"])).code).toBe(2);
  });

  it("exits 1 and names the problem when the document has an error", async () => {
    const r = await capture(["derive", project("golden-ends/G07")]);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/^error angled-end b2\.a: /m);
  });

  it("prints the cut list in each format", async () => {
    const md = await capture(["cutlist", project("cart")]);
    expect(md.code).toBe(0);
    // The knee braces: long point, centre line, then the span, which a trapezoid's long point is.
    expect(md.out.join("\n")).toMatch(
      /\| 4 \| 153\.14 \| 113\.14 \| 153\.14 \| 45\.00° mitre -45\.00° \//,
    );
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
    expect(b.diagnostics.map((x: { entity: string }) => x.entity)).toEqual([
      "c21",
      "c22",
      "c33",
      "c23",
      "c35",
    ]);
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
    const unjoined = (c: string) =>
      `info butt-no-connector ${c}: ${c} names no connector, and the project names no default butt connector: the order buys nothing to join its ends`;
    const r = await capture(["order", project("cart"), "--as-of", "2026-11-26"]);
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toMatch(/^## test-vendor: BLOCKED$/m);
    expect(r.err).toEqual([
      "warn connection c21: b18.a's end face overhangs b9's face +x by 30.00 mm: 2969.10 of its 4969.10 mm² (59.8 %) bear on nothing",
      "warn connection c22: b18.b's end face overhangs b10's face -x by 30.00 mm: 2969.10 of its 4969.10 mm² (59.8 %) bear on nothing",
      "warn connection c33: b32.b's end face overhangs b31's end b by 16.28 mm: 662.74 of its 2262.74 mm² (29.3 %) bear on nothing",
      // The cart's 18 butts that name no connector, a note each, among the other infos by id.
      ...["c1", "c2", "c5", "c6", "c7", "c8", "c10", "c11", "c12", "c21", "c22"].map(unjoined),
      "info fit c23: test-geo:WSH-M10 gives no outside diameter (d2_mm), so its seats are not checked: c23",
      ...["c26", "c27", "c28", "c29", "c30", "c31", "c32"].map(unjoined),
      "info fit c35: test-gen:SCR-M5x25 gives no bearing diameter (dw_mm, dk_mm or s_mm), so its seats are not checked: c35",
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

  it("states the lock in the cut list, the BOM, the machining sheet and the derived model too", async () => {
    const dir = project("cart");
    const stamp = lockStamp(dir);
    const outputs: [string, string[]][] = [
      ["cutlist", ["md", "csv", "json"]],
      ["bom", ["md", "csv", "json"]],
      ["machining", ["md", "json"]],
    ];
    for (const [cmd, formats] of outputs) {
      for (const format of formats) {
        const r = await capture([cmd, dir, "--format", format]);
        const text = r.out.join("\n");
        if (format === "json") expect(JSON.parse(text).lock, cmd).toBe(stamp);
        if (format === "md") expect(text, cmd).toContain(`\n\nDerived from the lock ${stamp}.\n\n`);
        // The first row after the header: `stamp`, named `lock`, the hash in the last free text.
        if (format === "csv") {
          expect(text.split("\n")[1], cmd).toMatch(new RegExp(`^stamp,lock,+${stamp},?$`));
        }
      }
    }
    const derived = JSON.parse((await capture(["derive", dir, "--json"])).out.join("\n"));
    expect(Object.keys(derived).slice(0, 2)).toEqual(["schema", "lock"]);
    expect(derived.lock).toBe(stamp);
    // A selection keeps the stamp, as it keeps the schema.
    const some = JSON.parse((await capture(["derive", dir, "--select", "params"])).out.join("\n"));
    expect(Object.keys(some)).toEqual(["schema", "lock", "params"]);
    expect(some.lock).toBe(stamp);
  });

  it("states the price basis and the oldest read date wherever an output carries prices", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "cart");
    const asOf = ["--as-of", "2026-11-26"];
    const cutJson = async () =>
      JSON.parse((await capture(["cutlist", dir, "--format", "json", "--frozen"])).out.join("\n"));
    // The cut list prices the stock bars it nests: the oldest read of the offers it chose, worked
    // from the lock by hand.
    const cl = await cutJson();
    expect(Object.keys(cl).slice(0, 4)).toEqual(["schema", "price_basis", "oldest_read", "lock"]);
    expect([cl.price_basis, cl.oldest_read]).toEqual(["regular", oldestCutRead(cl, dir)]);
    expect(cl.oldest_read).toBe("2026-11-26");
    const md = (await capture(["cutlist", dir])).out.join("\n");
    expect(md).toContain(
      "\nPrices on the regular basis, in minor units; the oldest was read 2026-11-26.\n",
    );
    // An older read of one nested offer, which the order prices too, is the oldest of both.
    await editJson(join(dir, "alukit.lock.json"), (l) => {
      l.offers["test-geo:FB-50x10-6000"].offer.price.read = "2026-09-15";
    });
    expect((await cutJson()).oldest_read).toBe("2026-09-15");

    // The costs state the order's: the nuts, read 56 days before the order's date.
    const order = JSON.parse(
      (await capture(["order", dir, "--format", "json", ...asOf, "--frozen"])).out.join("\n"),
    );
    const costs = JSON.parse(
      (await capture(["costs", dir, "--format", "json", ...asOf, "--frozen"])).out.join("\n"),
    );
    expect(Object.keys(costs).slice(0, 6)).toEqual([
      "schema",
      "currency",
      "price_basis",
      "as_of",
      "oldest_read",
      "lock",
    ]);
    expect([costs.price_basis, costs.oldest_read]).toEqual([order.price_basis, order.oldest_read]);
    expect(costs.oldest_read).toBe("2026-09-15");
    expect((await capture(["costs", dir, ...asOf, "--frozen"])).out.join("\n")).toContain(
      "\nPrices on the regular basis in BRL, as of 2026-11-26; the oldest was read 2026-09-15.\n",
    );
    // In CSV, stamp rows after the lock's: the basis and the oldest read date.
    for (const cmd of ["order", "costs"]) {
      const rows = (await capture([cmd, dir, "--format", "csv", ...asOf, "--frozen"])).out
        .join("\n")
        .split("\n");
      expect(rows[1], cmd).toMatch(/^stamp,+lock,+sha256:[0-9a-f]{64}$/);
      expect(rows[2], cmd).toMatch(/^stamp,+price_basis,+regular$/);
      expect(rows[3], cmd).toMatch(/^stamp,+oldest_read,+2026-09-15$/);
    }
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
