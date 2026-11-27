import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { bom } from "../bom/bom.ts";
import { bomJson } from "../bom/format.ts";
import { cutList } from "../cutlist/cutlist.ts";
import { cutListJson } from "../cutlist/format.ts";
import { derive } from "../derive/derive.ts";
import { derivedJson, jsonText } from "../derive/output.ts";
import { catalogItems, type ItemSource } from "../items.ts";
import { orderJson } from "../order/format.ts";
import { order } from "../order/order.ts";
import { openLiveCatalogs } from "../project/open.ts";
import { editJson, FIXTURES, fixtureProjects, readJson, scratchFixtures } from "../testing.ts";
import { diffLocks, fieldChanges } from "./diff.ts";
import { contentHash, lockHash, pinLock } from "./pin.ts";
import { documentRefs, lockCovers } from "./refs.ts";
import { type Lock, LockFile, lockText } from "./schema.ts";
import { lockItems } from "./source.ts";

async function live(dir: string) {
  const raw = readJson(join(dir, "alukit.json"));
  const { set, diagnostics } = await openLiveCatalogs(dir, raw);
  expect(diagnostics).toEqual([]);
  return { raw, set };
}

function cuts(raw: unknown, lock: Lock): Record<string, number> {
  const d = derive(raw, lockItems(lock));
  return Object.fromEntries([...d.bars].map(([id, b]) => [id, b.lengths.cut]));
}

describe("document references (§4.13)", () => {
  it("finds every item the schema types as ItemRef, swaps and project item materials", () => {
    const refs = documentRefs({
      schema: "alukit.project/1",
      defaults: { bar: { item: "a:BAR" }, butt: { connector: "a:CON" } },
      bars: { b1: { item: "b:BAR2", a: [0, 0, 0], b: [1, 0, 0] } },
      connections: {
        c1: { type: "butt", through: { body: "a:CUBE", at: [0, 0, 0] }, ends: ["b1.a"] },
        c2: {
          type: "face",
          bars: ["b1", "b2"],
          fastening: "bolt",
          fastener: { bar: "a:ROD", len_mm: 10 },
          stack: ["a:WSH", { item: "a:TUBE", inside: "b1", len_mm: "bore" }],
        },
      },
      parts: {
        p1: { item: "a:PART", qty: 2, unplaced: true, why: "spares" },
        p2: { item: "project:plate" },
      },
      order: { "a:SCR": { offer: "SCR-10" } },
      variants: { list: { steel: { swap: { "b:BAR2": "c:RHS" } } } },
      items: { plate: { kind: "plate", material: "std:S235" } },
    });
    expect(refs.items).toEqual([
      "a:BAR",
      "a:CON",
      "a:CUBE",
      "a:PART",
      "a:ROD",
      "a:SCR",
      "a:TUBE",
      "a:WSH",
      "b:BAR2",
      "c:RHS",
    ]);
    expect(refs.materials).toEqual(["std:S235"]);
  });
});

describe("pinning (§4.13)", () => {
  it("pins each item with its offers, section and the definitions they name", async () => {
    const { raw, set } = await live(join(FIXTURES, "golden-ends", "G01"));
    const { lock, missing } = pinLock(set, documentRefs(raw), undefined, { kind: "refresh" });
    expect(missing).toEqual([]);
    expect(Object.keys(lock.items)).toEqual(["test:TS40"]);
    expect(Object.keys(lock.offers)).toEqual(["test:TS40-c7", "test:TS40-pp-c7"]);
    expect(Object.keys(lock.sections)).toEqual(["test:TS40"]);
    expect(Object.keys(lock.materials)).toEqual(["test:al-6063-t5"]);
    expect(Object.keys(lock.systems)).toEqual(["test:s40-c8"]);
    expect(Object.keys(lock.grooves)).toEqual(["test:c8"]);
    expect(Object.keys(lock.catalogs)).toEqual(["test"]);
    const e = lock.items["test:TS40"];
    expect(e?.hash).toBe(contentHash(e?.item));
    expect(LockFile.safeParse(JSON.parse(lockText(lock))).success).toBe(true);
  });

  // One test per fixture project: each derives its project twice, so a single test over every
  // fixture would grow with the fixture set against one timeout.
  const projects = fixtureProjects().map((dir) => [relative(FIXTURES, dir), dir] as const);

  it.each(projects)(
    "derives from the lock what it derives from the live catalogs: %s",
    async (_name, dir) => {
      // Everything derive and its outputs read must reach the lock: the derived model with its
      // generated parts, fastenings and machining, the cut list, the bill of materials, and the
      // order list with its offers, packs, kits and prices.
      const outputs = (raw: unknown, items: ItemSource) => {
        const derived = derive(raw, items);
        const cl = cutList({ derived, items });
        const b = bom({ derived, items });
        return {
          derived: jsonText(derivedJson(derived)),
          cutList: cutListJson(cl),
          bom: bomJson(b),
          order: orderJson(
            order({ derived, items, bom: b, cutList: cl, diagnostics: [], asOf: "2026-11-26" }),
          ),
        };
      };
      const { raw, set } = await live(dir);
      const { lock } = pinLock(set, documentRefs(raw), undefined, { kind: "refresh" });
      expect(outputs(raw, lockItems(lock))).toEqual(outputs(raw, catalogItems(set)));
    },
  );

  it.each(projects)(
    "the committed lock covers its document and is current: %s",
    async (_name, dir) => {
      const lock = LockFile.parse(readJson(join(dir, "alukit.lock.json")));
      const { raw, set } = await live(dir);
      expect(lockCovers(lock, documentRefs(raw))).toBe(true);
      const fresh = pinLock(set, documentRefs(raw), lock, { kind: "refresh" }).lock;
      expect(diffLocks(lock, fresh)).toEqual({ entries: [], catalogs: [] });
    },
  );

  it("an add pins new references and never changes an entry already there", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-ends", "G01");
    const before = LockFile.parse(readJson(join(dir, "alukit.lock.json")));
    await editJson(join(root, "catalogs", "test", "offers.json"), (o) => {
      o.offers["TS40-c7"].price.regular_minor = 13000;
    });
    await editJson(join(dir, "alukit.json"), (d) => {
      d.bars.b3 = { item: "test:TS4080", a: [0, 0, 100], b: [500, 0, 100] };
    });
    const { raw, set } = await live(dir);
    const r = pinLock(set, documentRefs(raw), before, { kind: "add" });
    expect(r.added).toEqual(["test:TS4080"]);
    expect(r.lock.offers["test:TS40-c7"]).toEqual(before.offers["test:TS40-c7"]);
    expect(r.lock.items["test:TS4080"]).toBeDefined();
    expect(r.lock.catalogs.test).toEqual(before.catalogs.test);
  });

  it("a refresh takes the live data, says field by field what changed, and drops what is unused", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-ends", "G01");
    const before = LockFile.parse(readJson(join(dir, "alukit.lock.json")));
    await editJson(join(root, "catalogs", "test", "offers.json"), (o) => {
      o.offers["TS40-c7"].price.regular_minor = 13000;
    });
    await editJson(join(root, "catalogs", "test", "sections", "TS40.json"), (s) => {
      s.params.w_mm = 45;
    });
    const { raw, set } = await live(dir);
    const { lock } = pinLock(set, documentRefs(raw), before, { kind: "refresh" });
    const diff = diffLocks(before, lock);
    expect(diff.catalogs).toEqual([{ id: "test", change: "changed" }]);
    expect(diff.entries).toEqual([
      {
        kind: "offers",
        id: "test:TS40-c7",
        change: "changed",
        fields: [{ path: "price/regular_minor", was: 12650, now: 13000 }],
      },
      {
        kind: "sections",
        id: "test:TS40",
        change: "changed",
        fields: [{ path: "params/w_mm", was: 40, now: 45 }],
      },
    ]);
    // b2 butts into b1's near face, half the width from b1's line: 600 − 22.5.
    expect(cuts(raw, before).b2).toBe(580);
    expect(cuts(raw, lock).b2).toBe(577.5);
  });

  it("keeps an entry the live catalogs no longer hold", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-ends", "G01");
    const before = LockFile.parse(readJson(join(dir, "alukit.lock.json")));
    await editJson(join(dir, "alukit.json"), (d) => {
      d.bars.b3 = { item: "test:NOPE", a: [0, 0, 100], b: [500, 0, 100] };
    });
    const { raw, set } = await live(dir);
    // An item neither the catalogs nor the lock hold is missing.
    const r = pinLock(set, documentRefs(raw), before, { kind: "refresh" });
    expect(r.missing).toEqual(["test:NOPE"]);
    // An item the lock had and the catalog dropped is kept as it was.
    await editJson(join(root, "catalogs", "test", "offers.json"), (o) => {
      o.offers["TS40-c7"] = undefined;
      o.offers["TS40-pp-c7"] = undefined;
    });
    await editJson(join(root, "catalogs", "test", "catalog.json"), (c) => {
      c.items.TS40 = undefined;
    });
    const again = await live(dir);
    const k = pinLock(again.set, documentRefs(again.raw), before, { kind: "refresh" });
    expect(k.kept).toEqual(["test:TS40"]);
    expect(k.lock.items["test:TS40"]).toEqual(before.items["test:TS40"]);
    expect(k.lock.sections["test:TS40"]).toEqual(before.sections["test:TS40"]);
  });

  it("field changes compare objects key by key and equal-length arrays element by element", () => {
    expect(
      fieldChanges({ a: 1, b: [1, 2], c: { d: 1 } }, { a: 1, b: [1, 3], c: {}, e: 2 }),
    ).toEqual([
      { path: "b/1", was: 2, now: 3 },
      { path: "c/d", was: 1 },
      { path: "e", now: 2 },
    ]);
    expect(fieldChanges([1], [1, 2])).toEqual([{ path: "", was: [1], now: [1, 2] }]);
  });

  it("writes the committed locks byte for byte", () => {
    for (const dir of fixtureProjects()) {
      const text = readFileSync(join(dir, "alukit.lock.json"), "utf8");
      expect(lockText(LockFile.parse(JSON.parse(text))), dir).toBe(text);
      // The stamp an output carries is the file's own sha256 (§4.13, §9).
      expect(lockHash(LockFile.parse(JSON.parse(text))), dir).toBe(
        `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
      );
    }
  });
});
