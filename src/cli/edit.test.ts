import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editJson, scratchFixtures } from "#core/testing.ts";
import { capture } from "./testing.ts";

/** `alukit new`, `do`, `add`, `query` and `check` (design §6, §7.3), on scratch copies. */

const read = (path: string) => readFileSync(path, "utf8");

async function g01() {
  const root = await scratchFixtures();
  return { root, dir: join(root, "golden-ends", "G01") };
}

describe("alukit new", () => {
  it("creates a document, its lock and the .gitignore line; refuses an existing project", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "projects", "shelf");
    const r = await capture([
      "new",
      dir,
      "--name",
      "Shelf",
      "--catalog",
      join(root, "catalogs", "test"),
      "--currency",
      "EUR",
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(".alukit/ added to .gitignore");
    expect(JSON.parse(read(join(dir, "alukit.json")))).toEqual({
      schema: "alukit.project/1",
      name: "Shelf",
      catalogs: ["../../catalogs/test"],
      currency: "EUR",
    });
    const lock = JSON.parse(read(join(dir, "alukit.lock.json")));
    // Nothing is used yet, so nothing is pinned: the lock grows as the document names items.
    expect(lock).toMatchObject({ schema: "alukit.lock/1", catalogs: {}, items: {} });
    expect(read(join(dir, ".gitignore"))).toBe(".alukit/\n");
    expect((await capture(["fmt", "--check", dir])).code).toBe(0);
    expect((await capture(["check", dir])).code).toBe(0);

    const again = await capture(["new", dir]);
    expect(again.code).toBe(1);
    expect(again.err).toContain("already exists");
    expect((await capture(["new", join(root, "x"), "--currency", "euro"])).code).toBe(2);
    const bad = await capture(["new", join(root, "y"), "--catalog", "./no-such-catalog"]);
    expect(bad.code).toBe(1);
    expect(existsSync(join(root, "y", "alukit.json"))).toBe(false);
  });

  it("names the built-in std catalog by default, and keeps a .gitignore that has the line", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "p");
    await mkdir(dir);
    await writeFile(join(dir, ".gitignore"), "node_modules/\n.alukit/\n");
    expect((await capture(["new", dir])).code).toBe(0);
    expect(JSON.parse(read(join(dir, "alukit.json"))).catalogs).toEqual(["std"]);
    expect(read(join(dir, ".gitignore"))).toBe("node_modules/\n.alukit/\n");
  });

  it("says which finishes a profile is sold in when a bar names none (U2, U10)", async () => {
    // The README's first frame: a fresh forseti project and a bar with no finish.
    const root = await scratchFixtures();
    const dir = join(root, "first");
    expect((await capture(["new", dir, "--catalog", "forseti"])).code).toBe(0);
    const add = ["add", "bar", dir, "--item", "forseti:PF40-01", "--a", "0,0,0", "--b", "600,0,0"];
    expect((await capture(add)).code).toBe(0);
    const order = await capture(["order", dir, "--as-of", "2026-11-26"]);
    expect(order.code).toBe(1);
    expect(order.err).toContain(
      "option-not-sold: forseti:PF40-01: sold only with finish anodised or black; choose one",
    );
    const check = await capture(["check", dir]);
    expect(check.out).toContain(
      "warn no-offer forseti:PF40-01: forseti:PF40-01 has no offer that sells it by length; it is sold only with finish anodised or black",
    );
    expect(check.out).not.toContain("[]");
  });
});

describe("setProject through alukit do (BE-1)", () => {
  it("names a catalog and a default bar from it in one step, pinning the bar", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "first");
    expect((await capture(["new", dir])).code).toBe(0);
    const set = {
      cmd: "setProject",
      args: {
        catalogs: ["std", "forseti"],
        currency: "BRL",
        defaults: { bar: { item: "forseti:PF40-01", opt: { finish: "anodised" } } },
      },
    };
    const r = await capture(["do", dir, JSON.stringify(set), "--json"]);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out).results).toEqual([
      {
        cmd: "setProject",
        created: [],
        removed: [],
        changed: ["catalogs", "currency", "defaults"],
      },
    ]);
    const lock = JSON.parse(read(join(dir, "alukit.lock.json")));
    expect(Object.keys(lock.items)).toEqual(["forseti:PF40-01"]);
    // A bar drawn with no item takes the default, finish and all: nothing holds the order.
    expect((await capture(["add", "bar", dir, "--a", "0,0,0", "--b", "600,0,0"])).code).toBe(0);
    const order = await capture(["order", dir, "--as-of", "2026-11-26", "--format", "json"]);
    expect(JSON.parse(order.out).status).toBe("READY");
  });

  it("refuses a catalog folder outside the project, and changes nothing", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-ends", "G01");
    const before = read(join(dir, "alukit.json"));
    const was = JSON.parse(before).catalogs as string[];
    const add = (c: string) =>
      capture(["do", dir, JSON.stringify({ cmd: "setProject", args: { catalogs: [...was, c] } })]);
    const out = await add("../../catalogs/test-gen");
    expect(out.code).toBe(1);
    expect(out.err).toContain(
      "catalog catalogs: ../../catalogs/test-gen is outside the project's folder",
    );
    expect((await add("./nowhere")).err).toContain("there is no folder ./nowhere in the project");
    expect(read(join(dir, "alukit.json"))).toBe(before);
  });
});

describe("alukit do", () => {
  it("applies an inline batch, writes canonical files and answers with ids and diagnostics", async () => {
    const { dir } = await g01();
    const r = await capture([
      "do",
      dir,
      '[{"cmd":"addNode","args":{"at":[1000,600,500]}},{"cmd":"addBar","args":{"a":"n1","b":[1000,600,0]}}]',
      "--json",
    ]);
    expect(r.code).toBe(0);
    const answer = JSON.parse(r.out);
    expect(answer).toMatchObject({ schema: "alukit.do/1", ok: true, source: "cli" });
    expect(answer.rev).toMatch(/^[0-9a-f]{12}$/);
    expect(answer.results).toEqual([
      { cmd: "addNode", created: ["n1"], removed: [], changed: [] },
      { cmd: "addBar", created: ["b3"], removed: [], changed: [] },
    ]);
    // The new post's foot meets b2's end b with no connection: a new warning, as check says.
    expect(answer.diagnostics.new).toMatchObject([
      { severity: "warn", code: "unconnected", entity: "b2.b", refs: ["b2.b", "b3.b"] },
    ]);
    expect(answer.diagnostics.resolved).toEqual([]);
    expect(answer.diagnostics.counts).toEqual({ error: 0, warn: 1, info: 0 });
    expect((await capture(["fmt", "--check", dir])).code).toBe(0);
    const doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.ids).toEqual({ b: 3, n: 1 });
    expect(doc.bars.b3).toEqual({ a: "n1", b: [1000, 600, 0] });
  });

  it("reads a batch from a file and from standard input; --as tags the source", async () => {
    const { root, dir } = await g01();
    const file = join(root, "batch.json");
    await writeFile(
      file,
      JSON.stringify({
        commands: [{ cmd: "setConnection", args: { id: "c1", set: { spacer_mm: 8 } } }],
      }),
    );
    const f = await capture(["do", dir, "-f", file]);
    expect(f.code).toBe(0);
    expect(f.out).toMatch(
      /^setConnection: changed c1\nrev [0-9a-f]{12}: 0 errors, 0 warnings \(0 new, 0 resolved\)$/,
    );
    const s = await capture(
      ["do", dir, "-", "--json", "--as", "bot"],
      '{"cmd":"label","args":{"id":"b1","label":"rail"}}',
    );
    expect(JSON.parse(s.out)).toMatchObject({
      ok: true,
      source: "cli:bot",
      results: [{ cmd: "label", changed: ["b1"] }],
    });
    const s2 = await capture(
      ["do", dir, "-f", "-"],
      '{"cmd":"label","args":{"id":"b2","label":"post"}}',
    );
    expect(s2.code).toBe(0);
    const doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.connections.c1.spacer_mm).toBe(8);
    expect(doc.bars.b1.label).toBe("rail");
    expect(doc.bars.b2.label).toBe("post");
  });

  it("refuses a batch with one bad command and leaves both files byte for byte", async () => {
    const { dir } = await g01();
    const doc = read(join(dir, "alukit.json"));
    const lock = read(join(dir, "alukit.lock.json"));
    const r = await capture([
      "do",
      dir,
      '[{"cmd":"addNode","args":{"at":[0,0,0]}},{"cmd":"removeEntity","args":{"id":"b2"}}]',
    ]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("refused: command 2 (removeEntity); nothing was changed");
    expect(r.err).toContain("referenced b2");
    expect(read(join(dir, "alukit.json"))).toBe(doc);
    expect(read(join(dir, "alukit.lock.json"))).toBe(lock);
    const j = await capture(["do", dir, '{"cmd":"nope"}', "--json"]);
    expect(JSON.parse(j.out)).toMatchObject({
      ok: false,
      failed: { index: 0, errors: [{ code: "command" }] },
    });
  });

  it("pins an item the batch newly names, and says when a removal resolves a diagnostic", async () => {
    const { dir } = await g01();
    const r = await capture([
      "do",
      dir,
      '{"cmd":"addPart","args":{"item":"test:TNUT-M8","on":{"bar":"b1","at_mm":100,"groove":"+y.1"}}}',
    ]);
    expect(r.code).toBe(0);
    expect(JSON.parse(read(join(dir, "alukit.lock.json"))).items["test:TNUT-M8"]).toBeDefined();
    const cut = await capture(["do", dir, '{"cmd":"removeEntity","args":{"id":"c1"}}']);
    expect(cut.out).toContain("new warn unconnected b1.b");
    const back = await capture(["do", dir, '{"cmd":"autoConnect","args":{"at":[1000,0,0]}}']);
    expect(back.out).toContain("autoConnect: created c2");
    expect(back.out).toContain("resolved warn unconnected b1.b");
  });

  it("waits for no one: a held edit lock refuses, and usage errors exit 2", async () => {
    const { dir } = await g01();
    await mkdir(join(dir, ".alukit"), { recursive: true });
    await writeFile(
      join(dir, ".alukit", "edit.lock"),
      JSON.stringify({
        pid: process.pid,
        host: (await import("node:os")).hostname(),
        started: "x",
      }),
    );
    const r = await capture(["do", dir, '{"cmd":"addNode","args":{"at":[0,0,0]}}']);
    expect(r.code).toBe(1);
    expect(r.err).toContain("edit.lock is held by process");
    expect((await capture(["do", dir])).code).toBe(2);
    expect((await capture(["do", dir, "{nope"])).code).toBe(2);
    expect((await capture(["do", dir, '{"x":1}'])).code).toBe(2);
    expect((await capture(["do", dir, "[]", "-f", "x.json"])).code).toBe(2);
  });
});

describe("alukit add", () => {
  it("adds a point, a bar, an automatic connection and a part as commands", async () => {
    const { dir } = await g01();
    const point = await capture(["add", "point", dir, "--at", "1000,600,500", "--label", "top"]);
    expect(point).toMatchObject({ code: 0 });
    expect(point.out).toMatch(/^addNode: created n1\n/);
    const bar = await capture([
      "add",
      "bar",
      dir,
      "--a",
      "n1",
      "--b",
      "1000,600,0",
      "--tag",
      "post",
      "--json",
    ]);
    expect(JSON.parse(bar.out).results).toEqual([
      { cmd: "addBar", created: ["b3"], removed: [], changed: [] },
    ]);
    const conn = await capture(["add", "connection", dir, "--auto", "--at", "1000,600,0"]);
    expect(conn.out).toContain("autoConnect: created c2");
    const part = await capture([
      "add",
      "part",
      dir,
      "--item",
      "test:TNUT-M8",
      "--on",
      "b1:250",
      "--groove",
      "+y.1",
    ]);
    expect(part.out).toContain("addPart: created p1");
    const free = await capture([
      "add",
      "bar",
      dir,
      "--a",
      "b1:max(100, 200)",
      "--len",
      "300",
      "--dir",
      "+z",
    ]);
    expect(free.code).toBe(0);
    const doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.nodes.n1).toEqual({ at: [1000, 600, 500], label: "top" });
    expect(doc.bars.b3).toEqual({ a: "n1", b: [1000, 600, 0], tags: ["post"] });
    expect(doc.connections.c2).toEqual({ type: "butt", through: "b3", ends: ["b2.b"] });
    expect(doc.parts.p1).toEqual({
      item: "test:TNUT-M8",
      on: { bar: "b1", at_mm: 250, groove: "+y.1" },
    });
    expect(doc.bars.b4).toEqual({
      a: { on: { bar: "b1", at_mm: "max(100, 200)" } },
      b: { len_mm: 300, dir: "+z" },
    });
  });

  it("explains its options, and refuses what a kind does not take", async () => {
    const { dir } = await g01();
    expect((await capture(["add", "bar", "--help"])).out).toContain(
      "alukit add bar <dir> --a <point>",
    );
    expect((await capture(["add", "wall", dir])).code).toBe(2);
    expect((await capture(["add", "bar", dir, "--a", "n1", "--groove", "+y.1"])).err).toContain(
      "add bar does not take --groove",
    );
    expect((await capture(["add", "bar", dir, "--a", "1,2", "--b", "n1"])).err).toContain(
      "three comma-separated",
    );
    expect((await capture(["add", "connection", dir, "--type", "face"])).err).toContain(
      "write others with alukit do",
    );
    // A refused command exits 1, like do.
    expect((await capture(["add", "bar", dir, "--a", "n9", "--b", "0,0,1"])).code).toBe(1);
  });
});

describe("alukit query", () => {
  const cart = async () => join(await scratchFixtures(), "cart");

  it("selects by id, kind, tag, item and relation, bounded", async () => {
    const dir = await cart();
    expect((await capture(["query", dir, "c1"])).out).toMatch(/^c1 {2}\{ "type": "butt"/);
    const of = await capture(["query", dir, "connections", "of", "b2", "--json"]);
    const ofIds = JSON.parse(of.out).entities.map((e: { id: string }) => e.id);
    expect(ofIds).toContain("c32");
    for (const id of ofIds) expect(id).toMatch(/^c\d+$/);
    const tagged = await capture(["query", dir, "tag:post", "--fields", "label"]);
    expect(tagged.out.split("\n").every((l) => /^b\d+ +(label=.*)?$/.test(l))).toBe(true);
    const item = await capture(["query", dir, "item:test-geo:PLT-8", "--json"]);
    expect(JSON.parse(item.out).entities.map((e: { id: string }) => e.id)).toEqual(["c33"]);

    const limited = await capture(["query", dir, "bars", "--limit", "2"]);
    const lines = limited.out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/^… and 32 more \(b3–b34\); raise --limit or use --summary$/);
    const summary = await capture(["query", dir, "bars", "--summary"]);
    expect(summary.out).toBe("34 matches for bars\n  34 bars: b1–b34");
  });

  it("reads derived fields on request", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-ends", "G01");
    const r = await capture(["query", dir, "bars", "--fields", "cut,item,items", "--json"]);
    expect(JSON.parse(r.out).entities).toEqual([
      // c1 covers b2's end: the through bar runs on over it (§4.5, through_end "cover").
      { id: "b1", kind: "bars", fields: { cut: 1020, items: ["test:TS40"] } },
      { id: "b2", kind: "bars", fields: { cut: 580, items: ["test:TS40"] } },
    ]);
    expect((await capture(["query", dir, "b9"])).code).toBe(1);
    expect((await capture(["query", dir, "frobs"])).err).toContain("is not an id, a kind");
    expect((await capture(["query", dir])).code).toBe(2);
  });
});

describe("alukit check", () => {
  it("passes the fixtures, and reports project checks with their margins", async () => {
    const { dir } = await g01();
    const clean = await capture(["check", dir]);
    expect(clean).toMatchObject({ code: 0 });
    expect(clean.out).toBe("check: 0 errors, 0 warnings, 0 info; 0 checks: 0 passed, 0 failed");
    await capture([
      "do",
      dir,
      JSON.stringify([
        {
          cmd: "addCheck",
          args: { check: { value: "bbox().y", op: "<=", limit: "650", text: "fits the bay" } },
        },
        {
          cmd: "addCheck",
          args: {
            check: {
              value: "cut(b2)",
              op: ">=",
              limit: "600",
              text: "long enough",
              severity: "warn",
            },
          },
        },
        { cmd: "addCheck", args: { check: { expr: "count(tag:leg) == 0" } } },
        {
          cmd: "addCheck",
          args: { check: { value: "cost()", op: "<=", limit: "250", text: "within budget" } },
        },
      ]),
    ]);
    const r = await capture(["check", dir, "--json"]);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(report.schema).toBe("alukit.check/1");
    // b1's 40 mm body reaches y = -20 and b2 ends at y = 600: 620 of 650.
    expect(report.checks).toEqual([
      {
        id: "C1",
        text: "fits the bay",
        severity: "error",
        value: 620,
        op: "<=",
        limit: 650,
        margin: 30,
        pass: true,
      },
      {
        id: "C2",
        text: "long enough",
        severity: "warn",
        value: 580,
        op: ">=",
        limit: 600,
        margin: -20,
        pass: false,
      },
      { id: "C3", severity: "error", pass: true },
      // cost() reads the priced order: G01's two bars cost R$ 202.40.
      {
        id: "C4",
        text: "within budget",
        severity: "error",
        value: 202.4,
        op: "<=",
        limit: 250,
        margin: 47.6,
        pass: true,
      },
    ]);
    expect(report.diagnostics.map((d: { code: string }) => d.code)).toEqual(["check"]);
    const text = await capture(["check", dir]);
    expect(text.out).toContain(
      "warn check C2: C2 (long enough): cut(b2) = 580, not >= 600 (margin -20)",
    );
    expect(text.out).toContain("pass C1 fits the bay, margin 30");
    expect(text.out).toMatch(/4 checks: 3 passed, 1 failed$/);

    await capture([
      "do",
      dir,
      '{"cmd":"addCheck","args":{"check":{"value":"len(b1)","op":"<","limit":"1000"}}}',
    ]);
    const failing = await capture(["check", dir]);
    expect(failing.code).toBe(1);
    expect(failing.out).toContain("FAIL C5, margin 0");
  });

  it("reports unconnected ends, a lock behind the catalogs and a file not in canonical form", async () => {
    const { root, dir } = await g01();
    await capture(["do", dir, '{"cmd":"removeEntity","args":{"id":"c1"}}']);
    await editJson(join(root, "catalogs", "test", "sections", "TS40.json"), (s) => {
      s.params.w_mm = 45;
    });
    await writeFile(join(dir, "alukit.json"), `${read(join(dir, "alukit.json")).trimEnd()}\n\n`);
    const r = await capture(["check", dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "warn unconnected b1.b: b1.b, b2.a meet at (1000, 0, 0); b1.b, b2.a have no connection",
    );
    expect(r.out).toContain(
      "info lock-behind: alukit.lock.json is behind the catalogs: 1 entry and 1 catalog hash differ",
    );
    expect(r.out).toContain("info format: alukit.json is not in canonical form (run alukit fmt)");
    // --frozen reads only the lock: no staleness.
    expect((await capture(["check", dir, "--frozen"])).out).not.toContain("lock-behind");
  });

  it("exits 1 on an error, and with --frozen on a missing lock", async () => {
    const { dir } = await g01();
    await editJson(join(dir, "alukit.json"), (d) => {
      d.connections.c1.through = "b9";
    });
    const r = await capture(["check", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^error ref c1/m);
    const { dir: d2 } = await g01();
    const { rm } = await import("node:fs/promises");
    await rm(join(d2, "alukit.lock.json"));
    const frozen = await capture(["check", d2, "--frozen"]);
    expect(frozen.code).toBe(1);
    expect(existsSync(join(d2, "alukit.lock.json"))).toBe(false);
    const made = await capture(["check", d2]);
    expect(made.code).toBe(0);
    expect(made.err).toContain("notice: alukit.lock.json created");
  });
});
