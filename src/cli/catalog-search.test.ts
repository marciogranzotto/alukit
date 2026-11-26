import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "#core/testing.ts";
import { capture } from "./testing.ts";

/** `alukit catalog search` (design §7.3): ranked, bounded, and the same ranking as the browser. */

const TEST = join(FIXTURES, "catalogs", "test");
const GEN = join(FIXTURES, "catalogs", "test-gen");

interface Found {
  schema: string;
  query: string;
  kind?: string;
  catalogs: string[];
  total: number;
  items: { id: string; kind: string; family: string; name: string; code?: string }[];
}

async function search(...argv: string[]) {
  const r = await capture(["catalog", "search", ...argv]);
  return {
    ...r,
    found: r.code === 0 && argv.includes("--json") ? (JSON.parse(r.out) as Found) : undefined,
  };
}

describe("alukit catalog search", () => {
  it("ranks an exact code first, then codes that start with the query", async () => {
    const r = await search("ts40", "--catalog", TEST, "--json");
    expect(r.code).toBe(0);
    expect(r.found).toMatchObject({
      schema: "alukit.catalog-search/1",
      query: "ts40",
      catalogs: ["test"],
      total: 3,
    });
    // TS4080 and TS40E both start with the query: the shorter name first.
    expect(r.found?.items.map((i) => i.id)).toEqual(["test:TS40", "test:TS4080", "test:TS40E"]);
    expect(r.found?.items[0]).toEqual({
      id: "test:TS40",
      kind: "bar",
      family: "s40-c8",
      name: "Profile 40x40 (parametric)",
      code: "TS40",
      vendor: "test-vendor",
    });
  });

  it("puts whole-word matches before matches inside a word, the shorter name first", async () => {
    // M8 is a word of "Levelling foot M8" and "T-nut M8, groove 8", not of "M8x16".
    const r = await search("m8", "--catalog", TEST, "--json");
    expect(r.found?.items.map((i) => i.id)).toEqual([
      "test:FOOT-M8",
      "test:TNUT-M8",
      "test:TNUT-M8-C10",
      "test:SPL-STUD",
      "test:SCR-M8x16",
    ]);
  });

  it("filters by kind, searches several catalogs, and folds accents, case and ×", async () => {
    const fasteners = await search(
      "m5",
      "--kind",
      "fastener",
      "--catalog",
      TEST,
      "--catalog",
      GEN,
      "--json",
    );
    expect(fasteners.found?.catalogs).toEqual(["test", "test-gen"]);
    expect(fasteners.found?.items.map((i) => i.id)).toEqual([
      "test-gen:TNUT-M5",
      "test-gen:SCR-M5x25",
    ]);
    expect(fasteners.found?.kind).toBe("fastener");
    // Forseti writes its sizes with ×, and its names in Portuguese.
    const profiles = await search("PERFIL alumínio 40X40", "--kind", "bar", "--json");
    expect(profiles.found?.catalogs).toEqual(["forseti", "ref-hiwin", "std"]);
    expect(profiles.found?.items.map((i) => i.id)).toEqual(
      expect.arrayContaining(["forseti:PF40-00", "forseti:PF40-01"]),
    );
  });

  it("bounds its output and says how many more matched", async () => {
    const r = await search("profile", "--catalog", TEST, "--limit", "1");
    expect(r.code).toBe(0);
    expect(r.out.split("\n")).toEqual([
      "test:TS40  bar  s40-c8  Profile 40x40 (parametric)",
      "… 2 more of 3: narrow the query, add --kind, or raise --limit (200 at most)",
    ]);
    const all = await search("a", "--json");
    expect(all.found?.items.length).toBe(20);
    expect(all.found?.total).toBeGreaterThan(200);
    const most = await search("a", "--limit", "5000", "--json");
    expect(most.found?.items.length).toBe(200);
  });

  it("exits 1 when nothing matches or a catalog cannot be opened, 2 on a usage error", async () => {
    const none = await search("no such thing", "--catalog", TEST);
    expect(none.code).toBe(1);
    expect(none.err).toBe('no item matches "no such thing" in test');
    expect((await search("ts40", "--catalog", join(FIXTURES, "nope"))).code).toBe(1);
    expect((await search()).code).toBe(2);
    expect((await search("ts40", "--limit", "0")).code).toBe(2);
    expect((await search("ts40", "--fetch")).code).toBe(2);
  });
});
