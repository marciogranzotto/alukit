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

  it("says when no catalog it names sells T-slot profile, and which built-in one does (D-UX-7)", async () => {
    const root = await scratchFixtures();
    const plain = await capture(["new", join(root, "plain")]);
    expect(plain.code).toBe(0);
    expect(plain.out).toMatch(/^created .*alukit\.json and .*alukit\.lock\.json \(catalogs: std\)/);
    expect(plain.err).toBe(
      "notice: no catalog here sells T-slot profile; forseti does: name it with --catalog forseti, or add it later with setProject",
    );
    const tslot = await capture(["new", join(root, "tslot"), "--catalog", "forseti"]);
    expect(tslot.err).toBe("");
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
    // And G01's own butt, c1, which names no connector: a note that was there before.
    expect(answer.diagnostics.counts).toEqual({ error: 0, warn: 1, info: 1 });
    expect((await capture(["fmt", "--check", dir])).code).toBe(0);
    const doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.ids).toEqual({ b: 3, n: 1 });
    expect(doc.bars.b3).toEqual({ a: "n1", b: [1000, 600, 0] });
  });

  it("moves a bar's end as the app's end handle does: dry run, then one step (moveEnd)", async () => {
    const { dir } = await g01();
    // b2.a butts on b1 through c1: freed and lengthened 100 past b1, then nothing to join.
    const batch = JSON.stringify([
      { cmd: "moveEnd", args: { end: "b2.a", by_mm: 100, detach: true } },
      { cmd: "autoConnect", args: { end: "b2.a", optional: true } },
    ]);
    const dry = JSON.parse((await capture(["do", dir, batch, "--dry-run", "--json"])).out);
    expect(dry).toMatchObject({ ok: true, dry: true });
    expect(dry.effects.cuts.b2).toEqual([580, 700]);
    expect(dry.effects.removed).toEqual(["c1"]);
    const r = await capture(["do", dir, batch, "--json"]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.bars.b2).toEqual({ a: [1000, -100, 0], b: [1000, 600, 0] });
    expect(doc.connections).toEqual({});
    expect((await capture(["fmt", "--check", dir])).code).toBe(0);
    const held = await capture([
      "do",
      dir,
      '{"cmd":"moveEnd","args":{"end":"b1.a","by_mm":5,"len_mm":3}}',
    ]);
    expect(held.code).not.toBe(0);
  });

  it("moves and turns bars as the app's Move tool does: alukit move and rotate (transform)", async () => {
    const { dir } = await g01();
    // b1 away from b2 along −Y: b2.a, butted on it, slides along b2 to stay on it.
    const dry = await capture([
      "move",
      dir,
      "--ids",
      "b1",
      "--by",
      "0,-100,0",
      "--dry-run",
      "--json",
    ]);
    expect(dry.code).toBe(0);
    const answer = JSON.parse(dry.out);
    expect(answer).toMatchObject({ ok: true, dry: true });
    expect(answer.effects.cuts.b2).toEqual([580, 680]);
    expect(answer.results[0].info).toEqual({
      moved: ["b1", "b2"],
      followed: ["b2.a"],
      freed: [],
      kept: [],
    });
    const r = await capture(["move", dir, "--ids", "b1", "--by", "0,-100,0"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^transform: changed b1, b2\n/);
    let doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.bars.b2.a).toEqual([1000, -100, 0]);
    // Detached, the joint goes: b2 moves up off b1, and c1 with its last end.
    expect((await capture(["move", dir, "--ids", "b2", "--by", "0,0,100", "--detach"])).code).toBe(
      0,
    );
    doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.connections).toEqual({});
    // A quarter turn about Z through b2's end a: exact numbers.
    const t = await capture([
      "rotate",
      dir,
      "--ids",
      "b2",
      "--axis",
      "z",
      "--deg",
      "90",
      "--about",
      "1000,-100,100",
    ]);
    expect(t.code, t.err).toBe(0);
    doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.bars.b2).toEqual({ a: [1000, -100, 100], b: [300, -100, 100] });
    expect((await capture(["fmt", "--check", dir])).code).toBe(0);
    // Usage errors name the option.
    const bad = await capture(["move", dir, "--ids", "b1", "--axis", "z"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--axis goes with alukit rotate");
    expect(
      (
        await capture([
          "rotate",
          dir,
          "--ids",
          "b1",
          "--axis",
          "w",
          "--deg",
          "9",
          "--about",
          "0,0,0",
        ])
      ).err,
    ).toContain("--axis w: give x, y or z");
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

  it("names a cross hole's face on a connection, and a member placed after assembly (F11, F12)", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-gen", "G50");
    const step = async (cmd: object) => {
      const r = await capture(["do", dir, JSON.stringify(cmd), "--json"]);
      expect(r.code, r.err).toBe(0);
      const d = JSON.parse(r.out).diagnostics;
      const brief = (xs: { severity: string; code: string; refs?: string[] }[]) =>
        xs.filter((x) => x.code === "connection").map((x) => [x.severity, x.refs]);
      return { new: brief(d.new), resolved: brief(d.resolved) };
    };
    // The wall placed with the frame: the hole at (20, 20) has no clear face.
    const frame = { cmd: "setPart", args: { id: "p1", set: { after_assembly: null } } };
    expect(await step(frame)).toEqual({
      new: [["error", ["b2", "b3", "p1"]]],
      resolved: [["warn", ["b2", "p1"]]],
    });
    // Its face named on the connection, +x, under the wall.
    const named = { "b2.a": [{ at_mm: [20, 20], face: "+x" }] };
    expect(
      await step({ cmd: "setConnection", args: { id: "c1", set: { hole_faces: named } } }),
    ).toEqual({ new: [["error", ["b2", "p1"]]], resolved: [["error", ["b2", "b3", "p1"]]] });
    // The wall set against the frame after assembly: reached when the joint is made.
    const late = { cmd: "setPart", args: { id: "p1", set: { after_assembly: true } } };
    expect(await step(late)).toEqual({
      new: [["warn", ["b2", "p1"]]],
      resolved: [["error", ["b2", "p1"]]],
    });
    expect((await capture(["fmt", "--check", dir])).code).toBe(0);
    const doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.connections.c1.hole_faces).toEqual(named);
    expect(doc.parts.p1.after_assembly).toBe(true);
    // A face that is not a face of a section is refused, and nothing is written.
    const bad = await capture([
      "do",
      dir,
      JSON.stringify({
        cmd: "setConnection",
        args: { id: "c1", set: { hole_faces: { "b2.a": "+z" } } },
      }),
    ]);
    expect(bad.code).toBe(1);
    expect(JSON.parse(read(join(dir, "alukit.json")))).toEqual(doc);
  });

  it("marks a member context with setPart and setBar, and the BOM, order and bbox follow (X11)", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-gen", "G51");
    const original = read(join(dir, "alukit.json"));
    const step = async (cmd: object) => {
      const r = await capture(["do", dir, JSON.stringify(cmd)]);
      expect(r.code, r.err).toBe(0);
    };
    const bom = async () => {
      const r = await capture(["bom", dir, "--format", "json"]);
      expect(r.code, r.err).toBe(0);
      const b = JSON.parse(r.out);
      return {
        lines: b.groups.flatMap((g: { lines: { item: string }[] }) => g.lines.map((l) => l.item)),
        context: (b.context ?? []).map((c: { id: string }) => c.id),
      };
    };
    const ordered = async () => (await capture(["order", dir, "--as-of", "2026-11-26"])).code;
    // As written: the bench, the floor and the wall are context, and the order is ready.
    expect(await bom()).toEqual({
      lines: ["test:TS40", "test:BRK-40"],
      context: ["b3", "b4", "b5", "p2", "p3"],
    });
    expect(await ordered()).toBe(0);
    // The floor unmarked: a placeholder to buy, which holds the order.
    await step({ cmd: "setPart", args: { id: "p2", set: { context: null } } });
    expect(await bom()).toEqual({
      lines: ["test:TS40", "test:BRK-40", "project:FLOOR"],
      context: ["b3", "b4", "b5", "p3"],
    });
    expect(await ordered()).toBe(1);
    // A post of the frame marked context: out of the BOM; its bracket stays.
    await step({ cmd: "setBar", args: { id: "b1", set: { context: true } } });
    expect((await bom()).context).toEqual(["b1", "b3", "b4", "b5", "p3"]);
    expect((await capture(["fmt", "--check", dir])).code).toBe(0);
    const doc = JSON.parse(read(join(dir, "alukit.json")));
    expect(doc.bars.b1.context).toBe(true);
    expect(doc.parts.p2.context).toBeUndefined();
    // Back as it was, byte for byte.
    await step({ cmd: "setBar", args: { id: "b1", set: { context: null } } });
    await step({ cmd: "setPart", args: { id: "p2", set: { context: true } } });
    expect(read(join(dir, "alukit.json"))).toBe(original);
    // Only true marks a member context: anything else is refused, and nothing is written.
    const bad = await capture([
      "do",
      dir,
      JSON.stringify({ cmd: "setPart", args: { id: "p2", set: { context: "yes" } } }),
    ]);
    expect(bad.code).toBe(1);
    expect(read(join(dir, "alukit.json"))).toBe(original);
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

  it("adds a box frame: the skill's work table, the same cut list as drawn bar by bar (BE-6)", async () => {
    // The skill's worked example draws four legs and four top rails butted between them, with
    // brackets, sized by W, D and H. `add frame` with only a top ring is that table.
    const root = await scratchFixtures();
    const byHand = join(root, "by-hand");
    const framed = join(root, "framed");
    for (const dir of [byHand, framed]) {
      expect((await capture(["new", dir, "--catalog", "forseti", "--currency", "BRL"])).code).toBe(
        0,
      );
    }
    const bar = { item: "forseti:PF40-01", opt: { finish: "anodised" } };
    const legs = [
      [0, 0, "-x-y"],
      ["W", 0, "+x-y"],
      [0, "D", "-x+y"],
      ["W", "D", "+x+y"],
    ].map(([x, y, anchor]) => ({
      cmd: "addBar",
      args: { ...bar, a: [x, y, 0], b: [x, y, "H"], anchor, tags: ["leg"] },
    }));
    const rails = [
      [[0, 0, "H"], ["W", 0, "H"], "-x+y"],
      [[0, "D", "H"], ["W", "D", "H"], "+x+y"],
      [[0, 0, "H"], [0, "D", "H"], "+x+y"],
      [["W", 0, "H"], ["W", "D", "H"], "-x+y"],
    ].map(([a, b, anchor]) => ({ cmd: "addBar", args: { ...bar, a, b, anchor } }));
    const brackets = [
      ["b1", "b5.a", "b7.a"],
      ["b2", "b5.b", "b8.a"],
      ["b3", "b6.a", "b7.b"],
      ["b4", "b6.b", "b8.b"],
    ].map(([through, ...ends]) => ({
      cmd: "addConnection",
      args: { type: "butt", through, ends, connector: "forseti:CT75-06", qty: 2 },
    }));
    const sizes = Object.entries({ W: 1000, D: 600, H: 750 }).map(([name, value]) => ({
      cmd: "setParam",
      args: { name, value },
    }));
    const hand = await capture([
      "do",
      byHand,
      JSON.stringify([...sizes, ...legs, ...rails, ...brackets]),
    ]);
    expect(hand.code, hand.err).toBe(0);

    const add = await capture([
      "add",
      "frame",
      framed,
      "--size",
      "1000,600,750",
      "--rings",
      "top",
      "--item",
      "forseti:PF40-01",
      "--opt",
      "finish=anodised",
      "--connector",
      "forseti:CT75-06",
      "--qty",
      "2",
      "--params",
      "--json",
    ]);
    expect(add.code, add.err).toBe(0);
    const answer = JSON.parse(add.out);
    expect(answer.results[0]).toMatchObject({
      cmd: "addFrame",
      created: ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "c1", "c2", "c3", "c4"],
    });
    expect(
      answer.diagnostics.new.filter((d: { code: string }) => d.code === "unconnected"),
    ).toEqual([]);
    for (const out of ["cutlist", "bom", "machining"]) {
      const [a, b] = await Promise.all(
        [byHand, framed].map((d) => capture([out, d, "--format", "json"])),
      );
      expect(b?.out, out).toBe(a?.out);
    }

    // The box frame: 12 bars and 8 butts, nothing open; the shelf and the corner rule.
    const box = join(root, "box");
    expect((await capture(["new", box, "--catalog", "forseti"])).code).toBe(0);
    const r = await capture([
      "add",
      "frame",
      box,
      "--at",
      "0,0,0",
      "--size",
      "1000,600,800",
      "--item",
      "forseti:PF40-01",
      "--opt",
      "finish=anodised",
      "--corner",
      "x",
      "--rings",
      "base,top",
      "--shelf",
      "300",
      "--json",
    ]);
    expect(r.code, r.err).toBe(0);
    const created = JSON.parse(r.out).results[0].created as string[];
    expect([
      created.filter((id) => id[0] === "b").length,
      created.filter((id) => id[0] === "c").length,
    ]).toEqual([16, 12]);
    const check = await capture(["check", box, "--json"]);
    const codes = JSON.parse(check.out).diagnostics.map((d: { code: string }) => d.code);
    expect(codes).not.toContain("unconnected");
    expect((await capture(["add", "frame", box, "--size", "1000,600"])).err).toContain(
      "--size: give three comma-separated values, W,D,H",
    );
    expect(
      (await capture(["add", "frame", box, "--size", "1,2,3", "--opt", "finish"])).err,
    ).toContain("--opt takes <name>=<value>");
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

  it("selects what is like an entity and what is joined to it (E1.5)", async () => {
    const dir = await cart();
    const ids = async (selector: string) => {
      const r = await capture(["query", dir, selector, "--json", "--limit", "100"]);
      expect(r.code, r.err).toBe(0);
      return JSON.parse(r.out).entities.map((e: { id: string }) => e.id);
    };
    // The 80 × 40 top rails, by the item they name; the posts take the default bar's.
    expect(await ids("like:b5")).toEqual(["b5", "b6"]);
    expect(await ids("like:b1")).toHaveLength(22);
    // By tag (E2.2): the posts carry the same tags as b2.
    expect(await ids("like:b2 by tag")).toEqual(["b1", "b2", "b3", "b4"]);
    expect(await ids("connected:b9")).toEqual(["b1", "b2", "b9", "b14", "b15", "b18", "b26"]);
    expect(await ids("connected*:b9")).toHaveLength(33);
    expect((await capture(["query", dir, "connected:c13,r1", "--summary"])).out).toBe(
      "6 matches for connected:c13,r1\n  4 bars: b1, b11, b12, b14\n  1 connection: c13\n  1 run: r1",
    );
    const missing = await capture(["query", dir, "like:b99"]);
    expect([missing.code, missing.err]).toEqual([1, "alukit query: there is no entity b99"]);
    expect((await capture(["query", dir, "connected:"])).err).toContain("connected: needs ids");
  });

  it("prints a corner's miter and splice, and applies the miter's batch as it was shown (E1.4)", async () => {
    const root = await scratchFixtures();
    const dir = join(root, "golden-ends", "G01");
    const shown = await capture([
      "arrangements",
      dir,
      "--at",
      "1000,0,0",
      "--rule",
      "miter",
      "--rule",
      "splice",
    ]);
    expect(shown.code, shown.err).toBe(0);
    expect(shown.out).toBe(
      [
        "corner (1000, 0, 0): ends b1.b, b2.a; butt c1",
        "miter: (1000, 0, 0) b1.b and b2.a",
        "  cut b2 580 → 620",
        "splice: refused: c2: b1 and b2 are not collinear (90.00°)",
        "arrangements on rev 0: 0 distinct of 0 rules, 1 of 2 joints; nothing was written",
      ].join("\n"),
    );
    const json = await capture(["arrangements", dir, "--at", "1000,0,0", "--json"]);
    const miter = JSON.parse(json.out).joints[0];
    expect(miter).toMatchObject({ kind: "miter", ok: true });
    const done = await capture(["do", dir, JSON.stringify(miter.commands)]);
    expect(done.code, done.err).toBe(0);
    const bars = await capture(["query", dir, "bars", "--fields", "cut", "--json"]);
    expect(
      JSON.parse(bars.out).entities.map((e: { fields: { cut: number } }) => e.fields.cut),
    ).toEqual([1020, 620]);
    // Arranged again, the corner names its miter, and the miter's arrangement moves nothing.
    const again = JSON.parse(
      (await capture(["arrangements", dir, "--at", "1000,0,0", "--json"])).out,
    );
    expect(again.corners).toEqual([
      { at: [1000, 0, 0], ends: ["b1.b", "b2.a"], butts: [], joints: ["c2"] },
    ]);
    expect(again.joints[0].effects.cuts).toEqual({});
    expect(
      (await capture(["arrangements", dir, "--at", "1000,0,0", "--rule", "mitre"])).err,
    ).toContain("--rule mitre: one of vertical, x, y, first, miter, splice");
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
    // G01's one butt names no connector, nor does the project: a note, which passes.
    expect(clean.out).toBe(
      [
        "info butt-no-connector c1: c1 names no connector, and the project names no default butt connector: the order buys nothing to join its ends",
        "check: 0 errors, 0 warnings, 1 info; 0 checks: 0 passed, 0 failed",
      ].join("\n"),
    );
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
    // The failed warn check, and G01's butt with no connector.
    expect(report.diagnostics.map((d: { code: string }) => d.code)).toEqual([
      "check",
      "butt-no-connector",
    ]);
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

describe("what a dry run of mirror, array, splitBar and explodePattern adds (E1.6)", () => {
  type Effects = {
    cuts: Record<string, [number, number]>;
    added: Record<string, number>;
    parts: Record<string, { item: string; bar?: string; s_mm?: number; origin?: number[] }>;
  };
  const cases: [string, object, Partial<Effects>][] = [
    // The motor plate on the back base rail at 900, mirrored across x = 600: at 300 on it.
    [
      "mirror",
      { cmd: "mirror", args: { ids: ["p6"], plane: { axis: "x", at_mm: 600 } } },
      { cuts: {}, added: {}, parts: { p9: { item: "project:plate-a", bar: "b10", s_mm: 300 } } },
    ],
    // A slat and its two butts, once more 100 along b9: a slat's cut.
    [
      "array",
      { cmd: "array", args: { ids: ["b26", "c26", "c27"], along: "b9", pitch_mm: 100, count: 2 } },
      { cuts: {}, added: { b35: 520 }, parts: {} },
    ],
    // b9, 1120 between its butts, split 400 from its design point A: 360 and 760.
    [
      "splitBar",
      { cmd: "splitBar", args: { id: "b9", at_mm: 400 } },
      { cuts: { b9: [1120, 360] }, added: { b35: 760 }, parts: {} },
    ],
    // The carriages at 400 on b33 and 230 on b34, the copies the pattern drew already.
    [
      "explodePattern",
      { cmd: "explodePattern", args: { id: "pt2" } },
      {
        cuts: {},
        added: {},
        parts: {
          p9: { item: "test:CAR20", bar: "b33", s_mm: 400 },
          p10: { item: "test:CAR20", bar: "b34", s_mm: 230 },
        },
      },
    ],
  ];

  it.each(cases)("%s: the numbers applying it gives", async (_, command, expected) => {
    const dir = join(await scratchFixtures(), "cart");
    const batch = JSON.stringify([command]);
    const dry = await capture(["do", dir, batch, "--dry-run", "--json"]);
    expect(dry.code, dry.err).toBe(0);
    const effects = JSON.parse(dry.out).effects as Effects;
    expect(effects).toMatchObject(expected);
    expect(Object.keys(effects.parts)).toEqual(Object.keys(expected.parts ?? {}));
    // Applied, the model holds what the dry run said, to the 0.01 mm the effects keep.
    const applied = await capture(["do", dir, batch]);
    expect(applied.code, applied.err).toBe(0);
    for (const [id, cut] of Object.entries(effects.added)) {
      const q = JSON.parse((await capture(["query", dir, id, "--fields", "cut", "--json"])).out);
      expect(q.entities[0].fields.cut, id).toBe(cut);
    }
    for (const [id, p] of Object.entries(effects.parts)) {
      const d = await capture(["derive", dir, "--select", `parts.${id}`, "--json"]);
      const got = JSON.parse(d.out).parts[id];
      expect({ item: got.item, bar: got.bar, s_mm: got.s_mm }, id).toEqual({
        item: p.item,
        bar: p.bar,
        s_mm: p.s_mm,
      });
      got.origin.forEach((x: number, i: number) => {
        expect(x).toBeCloseTo(p.origin?.[i] as number, 2);
      });
    }
  });

  it("explodePattern names which drawn copy each new entity is", async () => {
    const dir = join(await scratchFixtures(), "cart");
    const batch = JSON.stringify([{ cmd: "explodePattern", args: { id: "pt1" } }]);
    const dry = JSON.parse((await capture(["do", dir, batch, "--dry-run", "--json"])).out);
    // pt1 makes copies 1, 2, 4, 5 and 6 of the slat b26 and its butts c26 and c27 (3 is skipped).
    expect(dry.results[0].info.copies).toMatchObject({
      "b26@1": "b35",
      "c26@1": "c36",
      "c27@1": "c37",
      "b26@6": "b39",
    });
    expect(Object.keys(dry.results[0].info.copies)).toHaveLength(15);
    expect(dry.effects.added).toEqual({ b35: 520, b36: 520, b37: 520, b38: 520, b39: 520 });
  });
});
