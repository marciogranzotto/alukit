import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { type CatalogSet, linkCatalogs } from "#catalog/link.ts";
import { builtinIds } from "#catalog/open.ts";
import { type Lock, LockFile } from "#core/lock/schema.ts";
import { openLiveCatalogs } from "#core/project/open.ts";
import { FIXTURES, readJson, scratchFixtures } from "#core/testing.ts";
import {
  type BuiltinCatalog,
  type CatalogEntry,
  catalogIndex,
  catalogTree,
  familyOf,
  itemCard,
  searchCatalog,
} from "./catalog.ts";
import { type RunningServer, startServer } from "./server.ts";

/**
 * The catalog browser's data (design §8): vendor › kind › family, search, and item cards, from
 * the live catalogs and, for what only the lock holds, the lock.
 */

const CART = join(FIXTURES, "cart");
let live: CatalogSet;
let named: string[];
let lock: Lock;

beforeAll(async () => {
  const opened = await openLiveCatalogs(CART, readJson(join(CART, "alukit.json")));
  live = opened.set;
  named = opened.named;
  lock = LockFile.parse(readJson(join(CART, "alukit.lock.json")));
});

describe("the index", () => {
  it("lists every live item with its vendor, kind and family, and whether the lock pins it", () => {
    const entries = catalogIndex(live, lock, named);
    const ts40 = entries.find((e) => e.id === "test:TS40");
    expect(ts40).toEqual({
      id: "test:TS40",
      catalog: "test",
      vendor: "test-vendor",
      kind: "bar",
      family: "s40-c8",
      name: expect.any(String),
      code: "TS40",
      pinned: true,
      live: true,
      size_mm: [40, 40],
      from: { minor: 12650, currency: "BRL", per: "m" },
      // What the start card and the connector pickers sort and fit by (review M8, B1).
      offers: 2,
      shape: "tslot",
      system: "test:s40-c8",
    });
    expect(entries.find((e) => e.id === "test:FOOT-M8")).toMatchObject({
      kind: "accessory",
      family: "foot",
      pinned: false,
    });
    expect(entries.find((e) => e.id === "test-geo:FB-50x10")).toMatchObject({
      vendor: "test-geo-vendor",
      family: "flat",
    });
    expect(entries.find((e) => e.id === "test:CAR20")?.family).toBe("rail-hg20");
    expect(entries.find((e) => e.id === "test:PSU-24V")?.family).toBe("electronics");
    expect(entries.find((e) => e.id === "test:PANEL-PC4")?.family).toBe("panel");
    // Every item of the catalogs the cart names, once; not those of the catalogs linked in only
    // because the test catalog refers to them.
    expect(named).toEqual(["test", "test-geo", "test-gen"]);
    expect(live.catalogs.has("ref-test")).toBe(true);
    const n = named.reduce((k, id) => k + (live.catalogs.get(id)?.items.size ?? 0), 0);
    expect(entries.length).toBe(n);
    expect(new Set(entries.map((e) => e.id)).size).toBe(n);
  });

  it("shows what only the lock pins when its catalog is not at hand", () => {
    const entries = catalogIndex(linkCatalogs([]).set, lock);
    expect(entries.length).toBe(Object.keys(lock.items).length);
    expect(entries.every((e) => e.pinned && !e.live)).toBe(true);
    expect(entries.find((e) => e.id === "test:TS4080")).toMatchObject({
      vendor: "test-vendor",
      family: "s40-c8",
      size_mm: [40, 80],
    });
    const card = itemCard("test:TS4080", linkCatalogs([]).set, lock, entries);
    expect(card?.section?.bbox).toEqual([
      [-20, -40],
      [20, 40],
    ]);
  });

  it("groups vendor › kind › family with counts", () => {
    const tree = catalogTree(catalogIndex(live, lock, named));
    expect(tree.map((t) => t.vendor)).toEqual([
      "test-gen-vendor",
      "test-geo-vendor",
      "test-vendor",
    ]);
    const test = tree.find((t) => t.vendor === "test-vendor");
    const bars = test?.kinds.find((k) => k.kind === "bar");
    expect(bars?.families).toEqual([
      { family: "rail-hg20", count: 1 },
      { family: "rhs", count: 1 },
      { family: "s40-c8", count: 3 },
      { family: "threaded-rod", count: 1 },
      { family: "tube", count: 1 },
    ]);
    expect(bars?.count).toBe(7);
    for (const v of tree) expect(v.count).toBe(v.kinds.reduce((n, k) => n + k.count, 0));
  });

  it("names a family by system, shape, subtype, rail system or category", () => {
    expect(familyOf({ kind: "bar", shape: "flat" } as never)).toBe("flat");
    expect(familyOf({ kind: "bar", shape: "tslot", system: "forseti:s40-c8" } as never)).toBe(
      "s40-c8",
    );
    expect(familyOf({ kind: "generic" } as never)).toBe("other");
  });
});

describe("search", () => {
  it("matches every word, accents and case aside; an exact code first", () => {
    const entries = catalogIndex(live, lock, named);
    const r = searchCatalog(entries, { q: "ts40" });
    expect(r.items[0]?.id).toBe("test:TS40");
    expect(r.items.map((e) => e.id)).toEqual(
      expect.arrayContaining(["test:TS40", "test:TS4080", "test:TS40E"]),
    );
    expect(searchCatalog(entries, { q: "TS4080" }).items.map((e) => e.id)).toEqual(["test:TS4080"]);
    const bars = searchCatalog(entries, { kind: "bar", vendor: "test-geo-vendor" });
    expect(bars.items.every((e) => e.kind === "bar" && e.vendor === "test-geo-vendor")).toBe(true);
    expect(bars.total).toBe(4);
    const page = searchCatalog(entries, { kind: "bar", limit: 2, offset: 1 });
    expect(page.items.length).toBe(2);
    expect(page.total).toBeGreaterThan(3);
    expect(searchCatalog(entries, { q: "no such thing" }).total).toBe(0);
  });

  it("knows each bar's own size, from its section's box (BE-8)", () => {
    const entries = catalogIndex(live, lock, named);
    const size = (id: string) => entries.find((e) => e.id === id)?.size_mm;
    expect(size("test:TS40")).toEqual([40, 40]);
    expect(size("test:TS4080")).toEqual([40, 80]);
    expect(entries.filter((e) => e.kind !== "bar").every((e) => e.size_mm === undefined)).toBe(
      true,
    );
  });

  // A caster plate and a hinge kit "for 40x40" ranked above the profile itself (U14).
  const sized: CatalogEntry[] = [
    entry("v:CAP-40", "accessory", "Cap (for profile 40x40)"),
    entry("v:HINGE", "generic", "Hinge kit 40x40"),
    entry("v:P40", "bar", "Profile 40 basic, groove 8", [40, 40]),
    entry("v:P40L", "bar", "Profile 40x40 light", [40, 40]),
    entry("v:P4080", "bar", "Profile 40x80", [40, 80]),
    entry("v:P2040", "bar", "Profile 40x40 V-slot", [20, 40]),
  ];

  it("ranks items whose own size is the size asked above items that only mention it", () => {
    const ids = (q: string, more: object = {}) =>
      searchCatalog(sized, { q, ...more }).items.map((e) => e.id);
    // Both 40 × 40 bars, the shorter name first; then what says 40x40 without being it.
    expect(ids("40x40")).toEqual(["v:P40L", "v:P40", "v:HINGE", "v:P2040", "v:CAP-40"]);
    expect(ids("40 × 40")).toEqual(ids("40x40"));
    // Either way round; and the other words still have to match.
    expect(ids("80x40")).toEqual(["v:P4080"]);
    expect(ids("40x40 light")).toEqual(["v:P40L"]);
    expect(ids("40x40", { kind: "accessory" })).toEqual(["v:CAP-40"]);
  });

  it("ranks the kind the tool wants first within each tier (prefer)", () => {
    const ids = (q: string, prefer?: string) =>
      searchCatalog(sized, { q, ...(prefer ? { prefer } : {}) }).items.map((e) => e.id);
    expect(ids("40x40", "accessory")).toEqual([
      "v:P40L",
      "v:P40",
      "v:CAP-40",
      "v:HINGE",
      "v:P2040",
    ]);
    expect(ids("profile")).toEqual(["v:P4080", "v:P40L", "v:P2040", "v:CAP-40", "v:P40"]);
    expect(ids("profile", "bar")).toEqual(["v:P4080", "v:P40L", "v:P2040", "v:P40", "v:CAP-40"]);
    expect(ids("kit", "bar")).toEqual(["v:HINGE"]);
  });

  // docs/ux/review-phase4.md N6: browsing for a frame's bar, the profiles come before the guides.
  it("ranks a linear guide after the profiles when a bar is wanted, and not otherwise", () => {
    const guide = { ...entry("v:A-GUIDE", "bar", "Guide 15", [15, 15]), shape: "rail" };
    const profile = { ...entry("v:Z-PROFILE", "bar", "Profile 40", [40, 40]), shape: "tslot" };
    const cap = entry("v:B-CAP", "accessory", "Cap");
    const all = [guide, profile, cap];
    const ids = (prefer?: string) =>
      searchCatalog(all, prefer ? { prefer } : {}).items.map((e) => e.id);
    expect(ids()).toEqual(["v:A-GUIDE", "v:B-CAP", "v:Z-PROFILE"]);
    expect(ids("bar")).toEqual(["v:Z-PROFILE", "v:A-GUIDE", "v:B-CAP"]);
  });
});

function entry(id: string, kind: string, name: string, size?: [number, number]): CatalogEntry {
  return {
    id,
    catalog: "v",
    vendor: "v",
    kind,
    family: kind,
    name,
    pinned: false,
    live: true,
    ...(size ? { size_mm: size } : {}),
  };
}

describe("item cards", () => {
  it("give a bar's section with its grooves and datums, its anchors, data and offers", () => {
    const entries = catalogIndex(live, lock, named);
    const card = itemCard("test:TS40", live, lock, entries);
    expect(card?.entry.id).toBe("test:TS40");
    expect(card?.section?.bbox).toEqual([
      [-20, -20],
      [20, 20],
    ]);
    // One groove on each face, numbered by face.
    expect(card?.section?.grooves?.map((g) => g.face).sort()).toEqual(["+x", "+y", "-x", "-y"]);
    expect(card?.anchors?.slice(0, 5)).toEqual(["c", "-x-y", "+x-y", "+x+y", "-x+y"]);
    expect(card?.data.map((d) => d.key)).toEqual(
      expect.arrayContaining(["shape", "system", "section_mm", "fidelity", "mass_kg_per_m"]),
    );
    expect(card?.offers.length).toBeGreaterThan(0);
    expect(card?.options).toEqual({ finish: ["anodised", "black"] });

    const rail = itemCard("test:RAIL20", live, lock, entries);
    expect(rail?.anchors).toContain("mount");
    const car = itemCard("test:CAR20", live, lock, entries);
    expect(car?.section).toBeUndefined();
    expect(car?.data.find((d) => d.key === "box_mm")).toBeDefined();
    expect(itemCard("test:NOPE", live, lock, entries)).toBeUndefined();
  });
});

describe("the catalog API", () => {
  const scratch: string[] = [];
  let r: RunningServer | undefined;
  afterEach(async () => {
    await r?.close();
    r = undefined;
    for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
  });

  async function serveCart(): Promise<RunningServer> {
    const base = await mkdtemp(join(tmpdir(), "alukit-catalog-"));
    scratch.push(base);
    const dist = join(base, "dist");
    await mkdir(dist);
    await writeFile(join(dist, "index.html"), "<p>hi</p>");
    const root = await scratchFixtures();
    scratch.push(root);
    r = await startServer({ dir: join(root, "cart"), distDir: dist, host: { watch: false } });
    return r;
  }

  async function get(s: RunningServer, path: string) {
    const res = await fetch(new URL(path, s.url), {
      headers: { authorization: `Bearer ${s.token}` },
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("answers the tree, a search and a card behind the token", async () => {
    const s = await serveCart();
    expect((await fetch(new URL("api/catalog", s.url))).status).toBe(403);
    const tree = await get(s, "api/catalog");
    expect(tree.status).toBe(200);
    expect(tree.body.schema).toBe("alukit.catalog-index/1");
    expect((tree.body.catalogs as { id: string }[]).map((c) => c.id)).toEqual([
      "test",
      "test-geo",
      "test-gen",
    ]);
    // Every built-in catalog, named or not, so settings can add one with a click (S2's ask):
    // the folders of catalogs/, each with its name and counts. Forseti sells T-slot profile;
    // the reference guideways and the standard shapes have bars, but none with grooves.
    const builtins = tree.body.builtins as BuiltinCatalog[];
    expect(builtins.map((b) => b.id)).toEqual(await builtinIds());
    for (const b of builtins) {
      expect(b.name.length, b.id).toBeGreaterThan(0);
      expect(b.items, b.id).toBeGreaterThanOrEqual(b.bars);
    }
    const by = new Map(builtins.map((b) => [b.id, b]));
    expect(by.get("forseti")).toMatchObject({ name: "Forseti", tslot: true });
    expect(by.get("forseti")?.bars).toBeGreaterThan(0);
    expect(by.get("std")).toMatchObject({ tslot: false });
    expect(by.get("ref-hiwin")).toMatchObject({ tslot: false });
    const found = await get(s, "api/catalog/items?q=TS4080&kind=bar");
    expect((found.body.items as { id: string }[]).map((e) => e.id)).toEqual(["test:TS4080"]);
    // A list card carries a bar's thumbnail, so the list needs no request per item.
    expect((found.body.items as { thumb?: { bbox: unknown } }[])[0]?.thumb?.bbox).toEqual([
      [-20, -40],
      [20, 40],
    ]);
    const card = await get(s, "api/catalog/item?id=test%3ATS4080");
    expect(card.status).toBe(200);
    expect((card.body.entry as { id: string }).id).toBe("test:TS4080");
    expect((await get(s, "api/catalog/item?id=test%3ANOPE")).status).toBe(404);
    expect((await get(s, "api/catalog/items?limit=x")).status).toBe(400);
  });

  it("lists the project's own items under the vendor project, read only (§4.8)", async () => {
    const s = await serveCart();
    const tree = (await get(s, "api/catalog")).body.tree as { vendor: string; count: number }[];
    expect(tree.find((t) => t.vendor === "project")?.count).toBe(3);
    const own = await get(s, "api/catalog/items?vendor=project");
    expect(own.body.items).toEqual([
      expect.objectContaining({ id: "project:angle-a", kind: "bent-angle", family: "al-6063-t5" }),
      expect.objectContaining({ id: "project:motor", kind: "placeholder", family: "placeholder" }),
      expect.objectContaining({ id: "project:plate-a", kind: "plate", family: "s235" }),
    ]);
    expect((own.body.items as { project?: boolean }[]).every((e) => e.project === true)).toBe(true);
    // A search finds them with the catalogs' items.
    const motor = await get(s, "api/catalog/items?q=gear%20motor");
    expect((motor.body.items as { id: string }[]).map((e) => e.id)).toContain("project:motor");

    const card = (await get(s, "api/catalog/item?id=project%3Aplate-a")).body as {
      item: { kind: string; outline: unknown[] };
      data: { key: string; value: unknown; src?: string }[];
      options: Record<string, unknown>;
      offers: unknown[];
    };
    // The item as the document writes it, with what the BOM and the machining sheet read of it.
    expect(card.item.kind).toBe("plate");
    expect(card.item.outline).toHaveLength(5);
    const data = Object.fromEntries(card.data.map((d) => [d.key, d]));
    expect(data.material?.value).toBe("test:s235");
    expect(data.thickness_mm?.value).toBe(8);
    expect(data.holes?.value).toBe(4);
    expect(data.mass_kg?.src).toBe("calc");
    expect(card.options).toEqual({});
    expect(card.offers).toEqual([]);
    const angle = (await get(s, "api/catalog/item?id=project%3Aangle-a")).body as {
      data: { key: string; value: unknown }[];
    };
    expect(angle.data.find((d) => d.key === "legs_mm")?.value).toBe("40 × 30");
    expect((await get(s, "api/catalog/item?id=project%3Anope")).status).toBe(404);
  });

  it("sends each section's grooves and datums in the view model, for snapping", async () => {
    const s = await serveCart();
    const m = await get(s, "api/model");
    const sections = (m.body.display as { sections: Record<string, Record<string, unknown>> })
      .sections;
    expect(sections["test:TS40"]?.grooves).toHaveLength(4);
    expect(sections["test:RAIL20"]?.datums).toHaveProperty("mount");
  });
});
