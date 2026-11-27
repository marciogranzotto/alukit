import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editJson, scratchFixtures } from "#core/testing.ts";
import { capture, git } from "./testing.ts";

/** Revisions (design §4.13): save, list, show, and verify by a read-only replay. */

const AS_OF = "2026-11-26";

async function cart() {
  const root = await scratchFixtures();
  return { root, dir: join(root, "cart") };
}

describe("alukit revision", () => {
  it("saves the document, the lock and the outputs, and verifies with zero drift", async () => {
    const { dir } = await cart();
    const saved = await capture(["revision", "save", dir, "Rev 1.2", "--as-of", AS_OF]);
    expect(saved.err).toBe("");
    expect(saved.code).toBe(0);
    expect(saved.out).toMatch(/^saved revisions\/rev-1\.2\.json: "Rev 1\.2", as of 2026-11-26/);
    const path = join(dir, "revisions", "rev-1.2.json");
    const rev = JSON.parse(readFileSync(path, "utf8"));
    expect(rev).toMatchObject({
      schema: "alukit.revision/1",
      name: "Rev 1.2",
      as_of: AS_OF,
      stamp: { alukit: "0.0.0", schema: "alukit.project/1", git: null },
    });
    expect(rev.stamp.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(rev.document).toEqual(JSON.parse(readFileSync(join(dir, "alukit.json"), "utf8")));
    expect(rev.lock).toEqual(JSON.parse(readFileSync(join(dir, "alukit.lock.json"), "utf8")));
    expect(rev.outputs).toHaveLength(1);

    const v = await capture(["revision", "verify", dir, "Rev 1.2"]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("verified: zero drift in 1 variant");
    const json = JSON.parse((await capture(["revision", "verify", dir, "rev-1.2", "--json"])).out);
    expect(json).toMatchObject({ ok: true, intact: true, drift: [] });

    // A revision is never overwritten.
    const again = await capture(["revision", "save", dir, "Rev 1.2"]);
    expect(again.code).toBe(1);
    expect(again.err).toContain("revisions/rev-1.2.json exists; a revision is never overwritten");
  });

  it("stores the same numbers the outputs print", async () => {
    const { dir } = await cart();
    expect((await capture(["revision", "save", dir, "r1", "--as-of", AS_OF])).code).toBe(0);
    const out = async (args: string[]) => (await capture(args)).out;
    const pairs: [string, string[]][] = [
      ["derive", ["derive", dir, "--json"]],
      ["cutlist", ["cutlist", dir, "--format", "json"]],
      ["bom", ["bom", dir, "--format", "json"]],
      ["order", ["order", dir, "--format", "json", "--as-of", AS_OF]],
      ["costs", ["costs", dir, "--format", "json", "--as-of", AS_OF]],
      ["machining", ["machining", dir, "--format", "json"]],
    ];
    for (const [what, args] of pairs) {
      const stored = await out([
        "revision",
        "show",
        dir,
        "r1",
        "--output",
        what,
        "--format",
        "json",
      ]);
      expect(stored, what).toBe(await out(args));
    }
    // Markdown from the stored outputs, as the command prints it.
    const md = await out(["revision", "show", dir, "r1", "--output", "order"]);
    expect(md).toBe(await out(["order", dir, "--as-of", AS_OF]));
    const sheet = await out(["revision", "show", dir, "r1", "--output", "machining"]);
    expect(sheet).toBe(await out(["machining", dir]));
    const csv = ["revision", "show", dir, "r1", "--output", "machining", "--format", "csv"];
    expect((await capture(csv)).code).toBe(2);
  });

  it("reports drift in a stored output, and a document edited after the save", async () => {
    const { dir } = await cart();
    await capture(["revision", "save", dir, "r1", "--as-of", AS_OF]);
    const path = join(dir, "revisions", "r1.json");
    await editJson(path, (r) => {
      r.outputs[0].cutlist.groups[0].lines[0].cut_mm += 1;
    });
    const v = await capture(["revision", "verify", dir, "r1"]);
    expect(v.code).toBe(1);
    expect(v.out).toMatch(
      /drift: \(no variant\), cutlist: 1 field\n {6}groups\/0\/lines\/0\/cut_mm: /,
    );

    await capture(["revision", "save", dir, "r2", "--as-of", AS_OF]);
    await editJson(join(dir, "revisions", "r2.json"), (r) => {
      r.document.params.W = "1300";
    });
    const w = await capture(["revision", "verify", dir, "r2"]);
    expect(w.code).toBe(1);
    expect(w.out).toContain("CHANGED: the stored document or lock no longer hashes to the stamp");
  });

  it("verifies a revision stored before every output stated its stamp with zero drift", async () => {
    const { dir } = await cart();
    await capture(["revision", "save", dir, "r1", "--as-of", AS_OF]);
    const path = join(dir, "revisions", "r1.json");
    const rev = JSON.parse(readFileSync(path, "utf8"));
    const lock = rev.outputs[0].order.lock;
    expect(lock).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const k of ["derived", "cutlist", "bom", "machining"])
      expect(rev.outputs[0][k].lock).toBe(lock);
    expect(rev.outputs[0].cutlist.oldest_read).toBe("2026-11-26");
    expect(rev.outputs[0].costs.oldest_read).toBe(rev.outputs[0].order.oldest_read);
    // As an earlier AluKit stored it: only the order and the costs stated the lock, and only the
    // order its oldest read date. The stamp is not a derived value: absent, it is not drift.
    await editJson(path, (r) => {
      const o = r.outputs[0];
      for (const k of ["derived", "cutlist", "bom", "machining"]) delete o[k].lock;
      delete o.cutlist.oldest_read;
      delete o.costs.oldest_read;
    });
    const v = await capture(["revision", "verify", dir, "r1"]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("verified: zero drift in 1 variant");
    // A stamp that is stored is compared: one that no longer matches is drift.
    await editJson(path, (r) => {
      r.outputs[0].cutlist.oldest_read = "2026-01-01";
    });
    const w = await capture(["revision", "verify", dir, "r1"]);
    expect(w.code).toBe(1);
    expect(w.out).toMatch(/drift: \(no variant\), cutlist: 1 field\n {6}oldest_read: /);
  });

  it("verifies by replay: the live catalogs and the project's files are not read", async () => {
    const { root, dir } = await cart();
    await capture(["revision", "save", dir, "r1", "--as-of", AS_OF]);
    // Change the live catalog and the working document: the revision does not move.
    await editJson(join(root, "catalogs", "test", "offers.json"), (o) => {
      o.offers["TS40-c7"].price.regular_minor = 99999;
    });
    await editJson(join(dir, "alukit.json"), (d) => {
      d.params.W = "1500";
    });
    await writeFile(join(dir, "alukit.lock.json"), "{ not json");
    const v = await capture(["revision", "verify", dir, "r1"]);
    expect(v.code).toBe(0);
    expect(v.out).toContain("zero drift");
  });

  it("stores every variant, shows one, and lists the revisions", async () => {
    const { dir } = await cart();
    await capture([
      "do",
      dir,
      JSON.stringify([
        { cmd: "addVariant", args: { name: "base", variant: {}, default: true } },
        { cmd: "addVariant", args: { name: "tall", variant: { params: { H: "1100" } } } },
      ]),
    ]);
    const s = await capture(["revision", "save", dir, "With variants", "--as-of", AS_OF]);
    expect(s.code).toBe(0);
    const rev = JSON.parse(readFileSync(join(dir, "revisions", "with-variants.json"), "utf8"));
    expect(rev.outputs.map((o: { variant?: string }) => o.variant)).toEqual(["base", "tall"]);
    const tall = await capture([
      "revision",
      "show",
      dir,
      "With variants",
      "--variant",
      "tall",
      "--output",
      "derive",
    ]);
    expect(JSON.parse(tall.out).bars.b1.len_mm).toBe(1100);
    expect(JSON.parse(tall.out).variant).toBe("tall");
    expect((await capture(["revision", "verify", dir, "With variants"])).out).toContain(
      "zero drift in 2 variants",
    );
    const none = await capture(["revision", "show", dir, "With variants", "--variant", "wide"]);
    expect(none.code).toBe(1);
    expect(none.err).toContain("stores no outputs for variant wide; it has base, tall");

    const list = await capture(["revision", "list", dir, "--json"]);
    expect(JSON.parse(list.out)).toEqual([
      expect.objectContaining({
        file: "revisions/with-variants.json",
        name: "With variants",
        variants: ["base", "tall"],
      }),
    ]);
  });

  it("stamps the project's git commit and whether its document or lock had changes", async () => {
    const { root, dir } = await cart();
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "fixtures");
    const head = git(root, "rev-parse", "HEAD").trim();
    await capture(["revision", "save", dir, "clean", "--as-of", AS_OF]);
    const clean = JSON.parse(readFileSync(join(dir, "revisions", "clean.json"), "utf8"));
    expect(clean.stamp.git).toEqual({ commit: head, dirty: false });
    // The first revision, untracked in the folder, does not make the next one dirty.
    await capture(["revision", "save", dir, "again", "--as-of", AS_OF]);
    const again = JSON.parse(readFileSync(join(dir, "revisions", "again.json"), "utf8"));
    expect(again.stamp.git).toEqual({ commit: head, dirty: false });
    // An edit to the document does.
    await editJson(join(dir, "alukit.json"), (d) => {
      d.params.W = "1300";
    });
    await capture(["revision", "save", dir, "dirty", "--as-of", AS_OF]);
    const dirty = JSON.parse(readFileSync(join(dir, "revisions", "dirty.json"), "utf8"));
    expect(dirty.stamp.git).toEqual({ commit: head, dirty: true });
  });

  it("refuses a name with nothing to name a file by, and a revision that is not there", async () => {
    const { dir } = await cart();
    expect((await capture(["revision", "save", dir, "..."])).code).toBe(2);
    expect((await capture(["revision", "verify", dir, "nope"])).code).toBe(1);
    expect((await capture(["revision", "frobnicate"])).code).toBe(2);
    expect(existsSync(join(dir, "revisions"))).toBe(false);
  });
});
