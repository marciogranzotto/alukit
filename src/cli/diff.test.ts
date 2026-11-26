import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editJson, scratchFixtures } from "#core/testing.ts";
import { capture, git } from "./testing.ts";

/** `alukit diff` (design §4.13, §7.3): files, git refs, revisions and variants. */

const AS_OF = "2026-11-26";

/** The fixtures in a scratch repository: one commit as they are, one with a price raised. */
async function twoCommits() {
  const root = await scratchFixtures();
  const dir = join(root, "cart");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "the cart");
  await editJson(join(root, "catalogs", "test", "offers.json"), (o) => {
    o.offers["TS40-c7"].price.regular_minor = 13000;
  });
  const up = await capture(["lock", "update", dir]);
  expect(up.code).toBe(0);
  git(root, "commit", "-q", "-am", "TS40 dearer");
  return { root, dir };
}

describe("alukit diff", () => {
  it("across two commits, reports a lock price change and its effect on the outputs", async () => {
    const { dir } = await twoCommits();
    const r = await capture([
      "diff",
      `git:HEAD~1:${dir}`,
      `git:HEAD:${dir}`,
      "--as-of",
      AS_OF,
      "--format",
      "json",
    ]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const d = JSON.parse(r.out);
    expect(d.schema).toBe("alukit.diff/1");
    expect(d.same).toBe(false);
    expect(d.a.lock).not.toBe(d.b.lock);
    // The lock change, field by field.
    expect(d.lock.entries).toContainEqual({
      kind: "offers",
      id: "test:TS40-c7",
      change: "changed",
      fields: [{ path: "price/regular_minor", was: 12650, now: 13000 }],
    });
    // Nothing in the document moved, and no cut length.
    expect(d.entities).toEqual([]);
    expect(d.bars).toEqual([]);
    // Its effect: the TS40 order lines' unit prices, the supplier's total and the totals.
    const ts40 = d.order.filter((l: { item: string }) => l.item === "test:TS40");
    expect(ts40.length).toBeGreaterThan(0);
    for (const l of ts40) {
      expect(l.supplier).toBe("test-vendor");
      expect(l.unit_price_minor[1]).toBeGreaterThan(l.unit_price_minor[0]);
    }
    expect(d.suppliers).toContainEqual(
      expect.objectContaining({ supplier: "test-vendor", status: ["BLOCKED", "BLOCKED"] }),
    );
    const total = d.totals.find((t: { what: string }) => t.what === "total");
    expect(total.likely_minor[1]).toBeGreaterThan(total.likely_minor[0]);

    const md = await capture(["diff", `git:HEAD~1:${dir}`, `git:HEAD:${dir}`, "--as-of", AS_OF]);
    expect(md.out).toContain("## Lock");
    expect(md.out).toContain("- changed offer test:TS40-c7");
    expect(md.out).toContain("  - price/regular_minor: 12650 → 13000");
    expect(md.out).toMatch(/\| test-vendor \| test:TS40 \(finish anodised\) \| TS40-c7 \|/);
    expect(md.out).toContain("## Totals (BRL)");
  });

  it("compares the working folder with a commit, and a commit with itself", async () => {
    const { dir } = await twoCommits();
    await editJson(join(dir, "alukit.json"), (doc) => {
      doc.params.W = "1300";
    });
    const r = await capture(["diff", `git:HEAD:${dir}`, dir, "--as-of", AS_OF, "--json"]);
    const d = JSON.parse(r.out);
    expect(d.lock.entries).toEqual([]);
    expect(d.params).toContainEqual({ name: "W", value: [1200, 1300] });
    expect(d.bars).toContainEqual(expect.objectContaining({ id: "b5", cut_mm: [1200, 1300] }));
    const same = await capture(["diff", `git:HEAD:${dir}`, `git:HEAD:${dir}`, "--as-of", AS_OF]);
    expect(same.out).toContain("No differences.");
  });

  it("compares a revision's stored outputs with the project now", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "cart");
    await capture(["revision", "save", dir, "Rev 1", "--as-of", AS_OF]);
    await capture([
      "do",
      dir,
      JSON.stringify({ cmd: "setBar", args: { id: "b31", set: { b: ["W + 200", 20, 800] } } }),
    ]);
    const r = await capture(["diff", join(dir, "revisions", "rev-1.json"), dir, "--json"]);
    expect(r.code).toBe(0);
    const d = JSON.parse(r.out);
    expect(d.a.stored).toBe(true);
    // A side derived now is judged on the revision's date.
    expect(d.b.as_of).toBe(AS_OF);
    expect(d.entities).toEqual([
      {
        id: "b31",
        change: "changed",
        fields: [{ path: "b/0", was: "W + 150", now: "W + 200" }],
      },
    ]);
    expect(d.bars).toContainEqual(expect.objectContaining({ id: "b31" }));
  });

  it("compares two variants of one project", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "cart");
    await capture([
      "do",
      dir,
      JSON.stringify([
        { cmd: "addVariant", args: { name: "base", variant: {}, default: true } },
        {
          cmd: "addVariant",
          args: { name: "steel", variant: { swap: { "test:TS4080": "test:RHS-50x30x2" } } },
        },
      ]),
    ]);
    const r = await capture([
      "diff",
      dir,
      "--variant",
      "base",
      "--variant",
      "steel",
      "--as-of",
      AS_OF,
      "--json",
    ]);
    const d = JSON.parse(r.out);
    expect([d.a.variant, d.b.variant]).toEqual(["base", "steel"]);
    expect(d.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "b5",
          change: "changed",
          fields: [{ path: "item", was: "test:TS4080", now: "test:RHS-50x30x2" }],
        }),
      ]),
    );
    expect(d.bom).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item: "test:TS4080", qty: [2, null] }),
        expect.objectContaining({ item: "test:RHS-50x30x2", qty: [null, 2] }),
      ]),
    );
  });

  it("refuses what it cannot compare", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "cart");
    expect((await capture(["diff"])).code).toBe(2);
    expect((await capture(["diff", dir])).code).toBe(2);
    expect((await capture(["diff", dir, dir, "--format", "csv"])).code).toBe(2);
    const missing = await capture(["diff", dir, join(root, "nowhere")]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no such file or folder");
    const variant = await capture(["diff", dir, "--variant", "a", "--variant", "b"]);
    expect(variant.code).toBe(1);
    expect(variant.err).toContain("there is no variant a; it has none");
    const notGit = await capture(["diff", `git:HEAD:${dir}`, dir]);
    expect(notGit.code).toBe(1);
  });
});
