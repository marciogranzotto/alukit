import { existsSync, readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editJson, fixtureProjects, scratchFixtures } from "#core/testing.ts";
import { capture } from "./testing.ts";

async function cutOf(dir: string, bar: string): Promise<number> {
  const r = await capture(["derive", dir, "--json"]);
  expect(r.code).toBe(0);
  return JSON.parse(r.out).bars[bar].cut_mm;
}

describe("the lock pins catalog data (§4.13, call 11)", () => {
  it("a catalog change reaches derive only through lock update, which shows it first", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-ends", "G01");
    const lockPath = join(dir, "alukit.lock.json");
    const before = readFileSync(lockPath, "utf8");
    expect(await cutOf(dir, "b2")).toBe(580);

    await editJson(join(root, "catalogs", "test", "sections", "TS40.json"), (s) => {
      s.params.w_mm = 45;
    });
    await editJson(join(root, "catalogs", "test", "offers.json"), (o) => {
      o.offers["TS40-c7"].price.regular_minor = 13000;
    });
    // Derive reads the lock, never the live catalogs.
    expect(await cutOf(dir, "b2")).toBe(580);

    const dry = await capture(["lock", "update", dir, "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("changed offer test:TS40-c7");
    expect(dry.out).toContain("price/regular_minor: 12650 -> 13000");
    expect(dry.out).toContain("changed section test:TS40");
    expect(dry.out).toContain("params/w_mm: 40 -> 45");
    expect(dry.out).toMatch(/b2 +cut 580\.00 -> 577\.50/);
    expect(dry.out).toContain("dry run: nothing written");
    expect(readFileSync(lockPath, "utf8")).toBe(before);
    expect(await cutOf(dir, "b2")).toBe(580);

    const json = await capture(["lock", "update", dir, "--dry-run", "--json"]);
    const report = JSON.parse(json.out);
    expect(report.schema).toBe("alukit.lockdiff/1");
    expect(report.written).toBe(false);
    expect(report.cut).toContainEqual({ bar: "b2", cut_mm: [580, 577.5], centre_mm: [580, 577.5] });

    const real = await capture(["lock", "update", dir]);
    expect(real.code).toBe(0);
    expect(readFileSync(lockPath, "utf8")).not.toBe(before);
    expect(await cutOf(dir, "b2")).toBe(577.5);
    // Up to date now: nothing more to change, and the lock is canonical.
    expect((await capture(["lock", "update", dir, "--dry-run"])).out).toMatch(
      /^alukit\.lock\.json: no change/,
    );
    expect((await capture(["fmt", "--check", dir])).code).toBe(0);
  });

  it("refreshes one item with --item", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "cart");
    await editJson(join(root, "catalogs", "test", "offers.json"), (o) => {
      o.offers["TS40-c7"].price.regular_minor = 13000;
      o.offers["TS4080-c7"].price.regular_minor = 1;
    });
    const r = await capture(["lock", "update", dir, "--item", "test:TS40", "--json"]);
    const ids = JSON.parse(r.out).entries.map((e: { id: string }) => e.id);
    expect(ids).toEqual(["test:TS40-c7"]);
  });

  it("creates a missing lock on first derive, with a notice; --frozen refuses instead", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-ends", "G03");
    const lockPath = join(dir, "alukit.lock.json");
    const committed = readFileSync(lockPath, "utf8");
    await rm(lockPath);

    const frozen = await capture(["derive", dir, "--frozen"]);
    expect(frozen.code).toBe(1);
    expect(frozen.err).toMatch(/alukit\.lock\.json is missing; --frozen/);
    expect(existsSync(lockPath)).toBe(false);

    const first = await capture(["derive", dir]);
    expect(first.code).toBe(0);
    expect(first.err).toMatch(/^notice: alukit\.lock\.json created: 1 item pinned from test/m);
    expect(readFileSync(lockPath, "utf8")).toBe(committed);
    expect(existsSync(join(dir, ".alukit", "edit.lock"))).toBe(false);

    // A new reference is pinned on the next derive, and nothing else changes.
    await editJson(join(dir, "alukit.json"), (d) => {
      d.bars.b3 = { item: "test:TS4080", a: [0, -500, 0], b: [500, -500, 0] };
    });
    const frozen2 = await capture(["derive", dir, "--frozen"]);
    expect(frozen2.code).toBe(1);
    expect(frozen2.err).toMatch(/has no entry for test:TS4080/);
    const next = await capture(["derive", dir]);
    expect(next.err).toMatch(/notice: alukit\.lock\.json: pinned 1 new item: test:TS4080/);
    expect(JSON.parse(readFileSync(lockPath, "utf8")).items["test:TS40"]).toEqual(
      JSON.parse(committed).items["test:TS40"],
    );
  });

  it("refuses a broken lock until lock update rebuilds it", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-ends", "G01");
    await writeFile(join(dir, "alukit.lock.json"), '{ "schema": "alukit.lock/1" }\n');
    const r = await capture(["derive", dir]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^error lock: alukit\.lock\.json: catalogs: /m);
    const u = await capture(["lock", "update", dir]);
    expect(u.code).toBe(0);
    expect(u.err).toMatch(/rebuilt from the live catalogs/);
    expect(await cutOf(dir, "b2")).toBe(580);
  });

  it("refuses bad usage with exit 2", async () => {
    expect((await capture(["lock"])).code).toBe(2);
    expect((await capture(["lock", "refresh", "x"])).code).toBe(2);
    expect((await capture(["lock", "update"])).code).toBe(2);
    expect((await capture(["lock", "update", "x", "--frob"])).code).toBe(2);
  });
});

describe("alukit fmt (§2)", () => {
  it("finds every fixture project in canonical form", async () => {
    const r = await capture(["fmt", "--check", ...fixtureProjects()]);
    expect(r).toEqual({ code: 0, out: "", err: "" });
  });

  it("rewrites a hand edit into canonical form; --check reports it first", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "cart");
    const path = join(dir, "alukit.json");
    const canonical = readFileSync(path, "utf8");
    await writeFile(path, JSON.stringify(JSON.parse(canonical)));
    const check = await capture(["fmt", "--check", dir]);
    expect(check.code).toBe(1);
    expect(check.out).toBe(`would reformat ${path}`);
    const fmt = await capture(["fmt", dir]);
    expect(fmt).toEqual({ code: 0, out: `formatted ${path}`, err: "" });
    expect(readFileSync(path, "utf8")).toBe(canonical);
  });

  it("reports a file that is not JSON and exits 1", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "cart");
    await writeFile(join(dir, "alukit.json"), '{ "a": 1, "a": 2 }');
    const r = await capture(["fmt", dir]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/duplicate key "a"/);
    expect((await capture(["fmt"])).code).toBe(2);
  });
});
