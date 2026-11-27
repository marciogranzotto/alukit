import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCK_FILE } from "#core/lock/schema.ts";
import { projectText } from "#core/project/canonical.ts";
import { DOCUMENT } from "#core/project/open.ts";
import { scratchFixtures } from "#core/testing.ts";
import { type HostEvent, HostOpenError, ProjectHost } from "./host.ts";

/**
 * The server owns the document (design §7.1): one queue for commands, undo, redo and direct
 * edits; files written before a step is committed; the watcher's own writes recognised by hash;
 * read-only on an invalid edit until the file is valid again or "restore last good".
 */

const open: ProjectHost[] = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) await h.close();
  for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
});

async function host(
  project = "golden-ends/G27",
  opts: { watch?: boolean; settleMs?: number; pollMs?: number; now?: () => Date } = {
    watch: false,
  },
) {
  const root = await scratchFixtures();
  scratch.push(root);
  const dir = join(root, project);
  const h = await ProjectHost.open({ dir, today: () => "2026-11-26", ...opts });
  open.push(h);
  const events: HostEvent[] = [];
  h.subscribe((e) => events.push(e));
  return { h, dir, events };
}

const addNode = (at: number[]) => ({ cmd: "addNode", args: { at } });
const text = (dir: string, f = DOCUMENT) => readFile(join(dir, f), "utf8");

/** Waits until `cond` holds, checking every 20 ms, for at most `ms`. */
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("steps", () => {
  it("applies a batch as one step: files written in canonical form, then broadcast", async () => {
    const { h, dir, events } = await host();
    const a = await h.commands({ commands: [addNode([1, 2, 3])], source: "ui" });
    expect(a).toMatchObject({ ok: true, rev: 1, source: "ui", between: [] });
    if (!a.ok) return;
    expect(a.results).toEqual([{ cmd: "addNode", created: ["n2"], removed: [], changed: [] }]);
    expect(await text(dir)).toBe(projectText(h.state.doc));
    expect((h.state.doc.nodes as Record<string, unknown>).n2).toEqual([1, 2, 3]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "rev",
        rev: 1,
        source: "ui",
        what: "addNode",
        changes: { created: ["n2"], removed: [], changed: [] },
        undo: { rev: 1, source: "ui", what: "addNode", text: "add point n2" },
        redo: null,
      }),
    ]);
    expect(h.snapshot().rev).toBe(1);

    // A refused batch changes nothing: no step, no write, no event.
    const before = await text(dir);
    const r = await h.commands({ commands: [addNode([0, 0, 0]), { cmd: "nope" }], source: "ui" });
    expect(r).toMatchObject({ ok: false, kind: "refused", rev: 1, failed: { index: 1 } });
    expect(await text(dir)).toBe(before);
    expect(events).toHaveLength(1);
  });

  it("reports the diagnostics a step adds and resolves", async () => {
    const { h } = await host();
    const a = await h.commands({
      commands: [{ cmd: "addBar", args: { a: [0, 0, 800], b: [0, 0, 1200] } }],
      source: "cli:t",
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.diagnostics.new.map((d) => `${d.code} ${d.entity}`)).toEqual(["unconnected b3.a"]);
    const u = await h.commands({
      commands: [{ cmd: "removeEntity", args: { id: "b4" } }],
      source: "ui",
    });
    expect(u.ok && u.diagnostics.resolved.map((d) => d.code)).toEqual(["unconnected"]);
  });

  it("undoes the latest step, whoever made it, and redoes it; the log names who asked", async () => {
    const { h, dir } = await host();
    const original = await text(dir);
    await h.commands({ commands: [addNode([1, 2, 3])], source: "cli:a" });
    const after = await text(dir);
    const u = await h.undo("ui");
    expect(u).toMatchObject({
      ok: true,
      rev: 2,
      step: { rev: 1, source: "cli:a", what: "addNode" },
    });
    expect(await text(dir)).toBe(projectText(JSON.parse(original)));
    const r = await h.redo("agent:x");
    expect(r).toMatchObject({ ok: true, rev: 3, redo: null });
    expect(await text(dir)).toBe(after);
    expect(h.log()).toEqual([
      { rev: 1, source: "cli:a", what: "addNode", text: "add point n2" },
      { rev: 2, source: "ui", what: "undo addNode", text: "undo add point n2", of: 1 },
      { rev: 3, source: "agent:x", what: "redo addNode", text: "redo add point n2", of: 1 },
    ]);
    expect(await h.redo("ui")).toMatchObject({ ok: false, kind: "nothing", rev: 3 });
  });

  it("remembers ids: a retry gets the first answer and applies nothing twice", async () => {
    const { h } = await host();
    const req = { commands: [addNode([1, 2, 3])], source: "cli", id: "retry-1" };
    const [a, b] = await Promise.all([h.commands(req), h.commands(req)]);
    expect(b).toBe(a);
    expect(await h.commands(req)).toBe(a);
    expect(h.rev).toBe(1);
  });

  it("treats baseRev as advisory, listing the steps between; strict refuses a stale base", async () => {
    const { h } = await host();
    await h.commands({ commands: [addNode([1, 0, 0])], source: "cli:other" });
    const a = await h.commands({ commands: [addNode([2, 0, 0])], source: "ui", baseRev: 0 });
    expect(a).toMatchObject({
      ok: true,
      rev: 2,
      between: [{ rev: 1, source: "cli:other", what: "addNode" }],
    });
    const s = await h.commands({
      commands: [addNode([3, 0, 0])],
      source: "ui",
      baseRev: 1,
      strict: true,
    });
    expect(s).toMatchObject({ ok: false, kind: "stale", rev: 2 });
    expect(h.rev).toBe(2);
  });
});

describe("direct edits", () => {
  it("take a valid edit in as one file step; ignore the server's own writes and no-op edits", async () => {
    const { h, dir, events } = await host();
    await h.commands({ commands: [addNode([1, 2, 3])], source: "ui" });
    await h.checkFiles();
    expect(h.rev).toBe(1);

    const doc = JSON.parse(await text(dir));
    doc.nodes.n1 = [540, 0, 100];
    await writeFile(join(dir, DOCUMENT), JSON.stringify(doc));
    await h.checkFiles();
    expect(h.rev).toBe(2);
    expect(h.log()[1]).toEqual({
      rev: 2,
      source: "file",
      what: "file edit",
      text: "edit the files by hand",
    });
    expect(events.at(-1)).toMatchObject({ type: "rev", rev: 2, source: "file" });
    // G27: with n1 at z = 100 the strut is 884.00 (golden case G27).
    expect(h.snapshot().derived.bars.get("b3")?.lengths.cut).toBeCloseTo(884, 9);
    // The file is not rewritten: a hand edit is canonicalised on the next write (§2).
    expect(await text(dir)).toBe(JSON.stringify(doc));

    // The same document in another layout is no step.
    await writeFile(join(dir, DOCUMENT), JSON.stringify(doc, null, 4));
    await h.checkFiles();
    expect(h.rev).toBe(2);

    // Undo takes the file step back, and writes.
    await h.undo("ui");
    expect(h.snapshot().derived.bars.get("b3")?.lengths.cut).toBeCloseTo(900, 9);
    expect(await text(dir)).toBe(projectText(h.state.doc));
  });

  it("come before a command that arrives first: a step never writes over an unseen edit", async () => {
    // No watcher here: the edit is on disk, and nothing has reported it.
    const { h, dir } = await host();
    const doc = JSON.parse(await text(dir));
    doc.nodes.n1 = [540, 0, 100];
    await writeFile(join(dir, DOCUMENT), JSON.stringify(doc));
    const a = await h.commands({ commands: [addNode([1, 2, 3])], source: "ui", baseRev: 0 });
    expect(a).toMatchObject({
      ok: true,
      rev: 2,
      between: [{ rev: 1, source: "file", what: "file edit" }],
    });
    const nodes = JSON.parse(await text(dir)).nodes;
    expect(nodes).toEqual({ n1: [540, 0, 100], n2: [1, 2, 3] });

    // An undo right after an unseen edit takes that edit back: it is the latest step.
    doc.nodes.n1 = [540, 0, 120];
    await writeFile(
      join(dir, DOCUMENT),
      JSON.stringify({ ...doc, nodes: { ...doc.nodes, n2: [1, 2, 3] } }),
    );
    expect(await h.undo("ui")).toMatchObject({ ok: true, step: { source: "file" } });
    expect(JSON.parse(await text(dir)).nodes.n1).toEqual([540, 0, 100]);
  });

  it("pin an item a direct edit newly names into the lock", async () => {
    const { h, dir } = await host();
    const doc = JSON.parse(await text(dir));
    doc.bars.b4 = { item: "test:TS4080", a: [0, 500, 0], b: [1000, 500, 0] };
    await writeFile(join(dir, DOCUMENT), JSON.stringify(doc));
    await h.checkFiles();
    expect(h.rev).toBe(1);
    expect(Object.keys(h.state.lock.items)).toContain("test:TS4080");
    expect(await text(dir, LOCK_FILE)).toContain('"test:TS4080"');
    expect(h.snapshot().derived.bars.has("b4")).toBe(true);
  });

  it("make the project read-only while the files are invalid; valid again ends it", async () => {
    const { h, dir, events } = await host();
    const good = await text(dir);
    await writeFile(join(dir, DOCUMENT), '{ "schema": "alukit.project/1", ');
    await h.checkFiles();
    expect(h.status).toMatchObject({ readOnly: true, reason: "file" });
    expect(h.status.readOnly && h.status.diagnostics[0]?.code).toBe("json");
    expect(events.at(-1)).toMatchObject({ type: "status", rev: 0, status: { readOnly: true } });
    expect(await h.commands({ commands: [addNode([0, 0, 0])], source: "ui" })).toMatchObject({
      ok: false,
      kind: "read-only",
    });
    expect(await h.undo("ui")).toMatchObject({ ok: false, kind: "read-only" });

    // The document schema decides validity (§7.4): an unknown field is invalid.
    await writeFile(join(dir, DOCUMENT), good.replace('"name": "G27"', '"nmae": "G27"'));
    await h.checkFiles();
    expect(h.status.readOnly && h.status.diagnostics.map((d) => d.code)).toEqual(["schema"]);

    // Back to what the server holds: writable, and no step.
    await writeFile(join(dir, DOCUMENT), good);
    await h.checkFiles();
    expect(h.status).toEqual({ readOnly: false });
    expect(h.rev).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: "status", status: { readOnly: false } });
  });

  it("accept a document with a dangling reference: derive draws it with diagnostics", async () => {
    const { h, dir } = await host();
    const doc = JSON.parse(await text(dir));
    doc.connections.c2.through = "b9.b";
    await writeFile(join(dir, DOCUMENT), JSON.stringify(doc));
    await h.checkFiles();
    expect(h.status.readOnly).toBe(false);
    expect(h.rev).toBe(1);
    expect(h.snapshot().check.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("restore last good writes the state the server holds over invalid files", async () => {
    const { h, dir } = await host();
    await h.commands({ commands: [addNode([1, 2, 3])], source: "ui" });
    const held = await text(dir);
    await writeFile(join(dir, DOCUMENT), "not json");
    await h.checkFiles();
    expect(h.status.readOnly).toBe(true);
    expect(await h.restore()).toEqual({
      ok: true,
      rev: 1,
      kept: [expect.stringMatching(/^\.alukit\/rejected\/[-0-9T]+Z\.json$/)],
    });
    expect(h.status).toEqual({ readOnly: false });
    expect(await text(dir)).toBe(held);
    await h.checkFiles();
    expect(h.rev).toBe(1);
  });

  it("restore keeps the rejected files, named by the time, and says where (BE-9)", async () => {
    const now = () => new Date("2026-11-27T05:30:12.345Z");
    const { h, dir } = await host("golden-ends/G27", { watch: false, now });
    const lock = await readFile(join(dir, LOCK_FILE), "utf8");
    const typed = '{ "schema": "alukit.project/1", "bars": { "b1": 7 } ';
    await writeFile(join(dir, DOCUMENT), typed);
    await h.checkFiles();
    expect(h.status.readOnly).toBe(true);
    const first = ".alukit/rejected/2026-11-27T05-30-12Z.json";
    expect(await h.restore()).toEqual({ ok: true, rev: 0, kept: [first] });
    expect(await readFile(join(dir, first), "utf8")).toBe(typed);
    // In the same second, the next is numbered; a lock that is not valid is kept beside it.
    await writeFile(join(dir, DOCUMENT), "not json");
    await writeFile(join(dir, LOCK_FILE), "neither");
    await h.checkFiles();
    const second = ".alukit/rejected/2026-11-27T05-30-12Z-2";
    expect(await h.restore()).toEqual({
      ok: true,
      rev: 0,
      kept: [`${second}.json`, `${second}.lock.json`],
    });
    expect(await readFile(join(dir, `${second}.lock.json`), "utf8")).toBe("neither");
    expect(await readFile(join(dir, LOCK_FILE), "utf8")).toBe(lock);
    // A lock alone, then a document alone, in that second: two restores, two stems.
    await writeFile(join(dir, LOCK_FILE), "lock alone");
    await h.checkFiles();
    const third = ".alukit/rejected/2026-11-27T05-30-12Z-3";
    expect((await h.restore()).kept).toEqual([`${third}.lock.json`]);
    await writeFile(join(dir, DOCUMENT), "document alone");
    await h.checkFiles();
    expect((await h.restore()).kept).toEqual([".alukit/rejected/2026-11-27T05-30-12Z-4.json"]);
  });

  it("a failed write leaves no step and makes the project read-only until restored", async () => {
    const { h, dir } = await host();
    await chmod(dir, 0o555);
    try {
      const a = await h.commands({ commands: [addNode([1, 2, 3])], source: "ui" });
      expect(a).toMatchObject({ ok: false, kind: "write", rev: 0 });
      expect(h.rev).toBe(0);
      expect(h.status).toMatchObject({ readOnly: true, reason: "write" });
    } finally {
      await chmod(dir, 0o755);
    }
    expect(await h.restore()).toEqual({ ok: true, rev: 0 });
    expect((await h.commands({ commands: [addNode([1, 2, 3])], source: "ui" })).ok).toBe(true);
  });

  it("are seen by the watcher, whether an editor writes in place or by rename", async () => {
    // fs.watch alone (no stat poll). On macOS its FSEvents stream starts some time after `watch`
    // returns, with no signal when it is live, and an event before that is never reported (the
    // poll covers that window in the product). So the first edit is written again until seen.
    const { h, dir } = await host("golden-ends/G27", { settleMs: 20, pollMs: 0 });
    const doc = JSON.parse(await text(dir));
    doc.nodes.n1 = [540, 0, 100];
    for (let attempt = 0; h.rev === 0; attempt++) {
      if (attempt === 5) throw new Error("the watcher never reported an edit");
      await writeFile(join(dir, DOCUMENT), JSON.stringify(doc));
      await until(() => h.rev === 1, 1000).catch(() => {});
    }

    doc.nodes.n1 = [540, 0, 120];
    await writeFile(join(dir, ".alukit.json.swp"), JSON.stringify(doc));
    await rename(join(dir, ".alukit.json.swp"), join(dir, DOCUMENT));
    await until(() => h.rev === 2);

    await writeFile(join(dir, DOCUMENT), "{");
    await until(() => h.status.readOnly);
    expect(h.log().map((e) => e.source)).toEqual(["file", "file"]);
  });

  it("are seen by the polling safety net alone", async () => {
    const { h, dir } = await host("golden-ends/G27", { watch: true, settleMs: 0, pollMs: 50 });
    // Stop fs.watch, as on a file system that has no change events.
    (h as unknown as { watcher?: { close(): void } }).watcher?.close();
    await writeFile(join(dir, DOCUMENT), "{");
    await until(() => h.status.readOnly);
  });
});

describe("opening", () => {
  it("refuses invalid files, naming the problems", async () => {
    const root = await scratchFixtures();
    scratch.push(root);
    const dir = join(root, "golden-ends/G27");
    await writeFile(join(dir, DOCUMENT), "[]");
    await expect(ProjectHost.open({ dir, watch: false })).rejects.toBeInstanceOf(HostOpenError);
  });

  it("creates a missing lock from the live catalogs", async () => {
    const root = await scratchFixtures();
    scratch.push(root);
    const dir = join(root, "golden-ends/G27");
    await rm(join(dir, LOCK_FILE));
    const h = await ProjectHost.open({ dir, watch: false });
    open.push(h);
    expect(Object.keys(h.state.lock.items)).toEqual(["test:TS40"]);
    expect(await text(dir, LOCK_FILE)).toContain('"test:TS40"');
    expect(h.rev).toBe(0);
  });
});
