import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkModel } from "../check/check.ts";
import { checkedOrder, modelOutputs, outputAccessors } from "../check/outputs.ts";
import { applyBatch } from "../commands/apply.ts";
import type { RawDoc, State } from "../commands/types.ts";
import { derive } from "../derive/derive.ts";
import { DIAGNOSTIC_CODES, sortDiagnostics } from "../diagnostics.ts";
import { lockHash, pinLock } from "../lock/pin.ts";
import { documentRefs } from "../lock/refs.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { openLiveCatalogs } from "../project/open.ts";
import { FIXTURES, mergePatch, readJson } from "../testing.ts";
import { type ModelState, problemsAt } from "./problems.ts";
import type { Fix, Problem, ProblemGroup } from "./types.ts";
import { checkTitle } from "./words.ts";

/**
 * The problem model (BE-3) on the cart and on small edits of the order fixture and a fresh
 * forseti project: every diagnostic and every order reason is one problem, as the CLI words it;
 * nothing is judged again; the fixes are commands that clear what they fix.
 */

const AS_OF = "2026-11-26";
const GROUPS: readonly ProblemGroup[] = ["blocks-order", "error", "warning", "note"];

/** A project's model as the server holds it: derived from the lock, checked, its catalogs'. */
async function model(dir: string, patch?: unknown): Promise<{ m: ModelState; s: State }> {
  const doc = mergePatch(readJson(join(dir, "alukit.json")), patch ?? {}) as RawDoc;
  const live = await openLiveCatalogs(dir, doc);
  const lock = pinLock(
    live.set,
    documentRefs(doc),
    LockFile.parse(readJson(join(dir, "alukit.lock.json"))),
    { kind: "add" },
  ).lock;
  const s = { doc, lock };
  return { m: modelOf(s, live.diagnostics, 0), s };
}

function modelOf(s: State, catalogs: ModelState["catalogs"], rev: number): ModelState {
  const items = lockItems(s.lock);
  const derived = derive(s.doc, items);
  const lock = lockHash(s.lock);
  const outputs = modelOutputs(derived, items, { lock });
  const check = checkModel({ raw: s.doc, derived, items, accessors: outputAccessors(outputs) });
  return { rev, derived, items, outputs, check, catalogs, lock };
}

const CART = join(FIXTURES, "cart");
const ORDER = join(FIXTURES, "order");

describe("the cart's problems", () => {
  it("hold each diagnostic and each order reason once, as the CLI words them", async () => {
    const { m } = await model(CART);
    const p = problemsAt(m, AS_OF);
    const order = checkedOrder(m.outputs, m.check.diagnostics, { asOf: AS_OF });
    const diagnostics = sortDiagnostics([...m.catalogs, ...m.check.diagnostics]);
    expect(p).toMatchObject({ schema: "alukit.problems/1", rev: 0, variant: null, as_of: AS_OF });

    // The notes on butts that name no connector are the no-connector reason's one problem.
    const notes = diagnostics.filter((d) => d.code === "butt-no-connector");
    for (const d of diagnostics.filter((x) => !notes.includes(x))) {
      expect(
        p.problems.filter((x) => x.from.includes("check") && x.raw === d.message),
      ).toHaveLength(1);
    }
    expect(notes).toHaveLength(18);
    const unjoined = p.problems.filter((x) => x.code === "butt-no-connector");
    expect(unjoined.map((x) => [x.rule, x.group, x.from, x.targets])).toEqual([
      ["no-connector", "warning", ["check", "order"], notes.map((d) => d.entity)],
    ]);
    const reasons = order.suppliers.flatMap((s) => s.reasons.map((r) => ({ ...r, s: s.supplier })));
    for (const r of reasons) {
      const found = p.problems.filter((x) => x.from.includes("order") && x.raw === r.message);
      expect(found, r.message).toHaveLength(1);
      expect(found[0]?.suppliers).toContain(r.s);
      expect(found[0]?.group).toBe(r.action === "block" ? "blocks-order" : "warning");
    }
    // Every raw is a message the CLI prints; nothing else is a problem.
    const printed = new Set([
      ...diagnostics.map((d) => d.message),
      ...reasons.map((r) => r.message),
    ]);
    expect(p.problems.every((x) => printed.has(x.raw))).toBe(true);
    // One problem per reason, over every supplier it holds; the notes folded into one.
    const distinct = new Map(reasons.map((r) => [`${r.rule} ${r.message}`, r]));
    expect(p.problems).toHaveLength(diagnostics.length - notes.length + distinct.size);

    // Grouped by consequence, ids unique; the order's summary counts its problems.
    const rank = p.problems.map((x) => GROUPS.indexOf(x.group));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
    expect(new Set(p.problems.map((x) => x.id)).size).toBe(p.problems.length);
    const blocks = [...distinct.values()].filter((r) => r.action === "block").length;
    expect(p.order).toEqual({ status: "BLOCKED", blocks, warnings: distinct.size - blocks });
    expect(p.problems.filter((x) => x.group === "blocks-order")).toHaveLength(blocks);
  });

  it("reads in words, with targets and fixes, beside the CLI's message", async () => {
    const p = problemsAt((await model(CART)).m, AS_OF);
    const byId = (id: string) => p.problems.find((x) => x.id === id) as Problem;
    expect(byId("open-item/O2,project:angle-a/local")).toEqual({
      id: "open-item/O2,project:angle-a/local",
      code: "open-item",
      rule: "open-item",
      group: "blocks-order",
      title: "Open item O2: price the sensor bracket with the local shop",
      detail: "It holds the order from local until it is resolved.",
      raw: "O2: price the sensor bracket with the local shop",
      suppliers: ["local"],
      targets: ["O2", "project:angle-a"],
      fixes: [{ label: "Resolve O2…", kind: "resolve-open", open: "O2" }],
      from: ["order", "open"],
    });
    expect(byId("est-price/test:PSU-24V/test-vendor")).toMatchObject({
      title: expect.stringMatching(/^The price of .+ \(test:PSU-24V\) is an estimate$/),
      detail:
        "The order from test-vendor waits for a price read from a source: its catalog's offer gives an estimate, so source it there and update the lock.",
      fixes: [],
    });
    expect(byId("stale-price/test-geo:NUT-M10/test-geo-vendor")).toMatchObject({
      group: "warning",
      title: expect.stringMatching(/was read 56 days before the order$/),
      detail: "Read on 2026-10-01: check it before sending the order to test-geo-vendor.",
      fixes: [{ kind: "lock-update", item: "test-geo:NUT-M10" }],
    });
    expect(byId("placeholder/project:motor/-")).toMatchObject({
      suppliers: [null],
      title: expect.stringMatching(/\(project:motor\) is a placeholder, not a part to order$/),
    });
    expect(byId("connection/c21")).toMatchObject({
      group: "warning",
      title: "A joint problem at c21",
      targets: ["c21", "b18", "b9"],
      from: ["check"],
    });
    expect(byId("connection/c21").detail).toMatch(/^b18\.a's end face overhangs b9's face/);
  });
});

describe("problems of a few edits", () => {
  it("counts a check error the order repeats once: blocking, from both", async () => {
    // A finish the item does not have is derive's error, which the order's check-error repeats.
    const { m } = await model(ORDER, { bars: { b2: { opt: { finish: "nope" } } } });
    const p = problemsAt(m, AS_OF);
    const err = p.problems.filter((x) => x.code === "option");
    expect(err).toHaveLength(1);
    expect(err[0]).toMatchObject({
      group: "blocks-order",
      rule: "check-error",
      suppliers: ["shop-a"],
      from: ["check", "order"],
      targets: ["b2"],
    });
    expect(err[0]?.detail).toMatch(/It holds the order from shop-a\.$/);
  });

  it("offers each finish sold, and the default, when a bar names none (U2)", async () => {
    const { m, s } = await model(ORDER, { bars: { b2: { opt: null } } });
    const p = problemsAt(m, AS_OF);
    const sold = p.problems.find((x) => x.code === "option-not-sold") as Problem;
    expect(sold).toMatchObject({
      group: "blocks-order",
      title: "No finish chosen for b2",
      raw: "test-order:FLAT-O: sold only with finish raw; choose one",
      targets: ["b2", "test-order:FLAT-O"],
      field: "opt.finish",
    });
    expect(sold.detail).toMatch(/is sold only with finish raw\.$/);
    expect(sold.fixes).toEqual([
      {
        label: "Set raw",
        kind: "commands",
        commands: [{ cmd: "setBar", args: { id: "b2", set: { opt: { finish: "raw" } } } }],
      },
      {
        label: "Make raw the default",
        kind: "commands",
        commands: [{ cmd: "setProject", args: { defaults: { bar: { opt: { finish: "raw" } } } } }],
      },
    ]);
    // The cut list's warning on the same bar offers the same fixes.
    const cut = p.problems.find((x) => x.code === "no-offer") as Problem;
    expect(cut.title).toMatch(/^Nothing sells .*test-order:FLAT-O\) by length$/);
    expect(cut.fixes.map((f) => f.label)).toEqual(["Set raw", "Make raw the default"]);
    // Either fix, applied as one step, clears both.
    for (const fix of sold.fixes) {
      const r = applyBatch(s, (fix as { commands: unknown[] }).commands, { today: AS_OF });
      if (!r.ok) throw new Error(JSON.stringify(r.failed));
      const after = problemsAt(modelOf(r.state, [], 1), AS_OF);
      expect(
        after.problems.map((x) => x.code),
        fix.label,
      ).toEqual([]);
      expect(after.order).toEqual({ status: "READY", blocks: 0, warnings: 0 });
    }
  });

  it("joins an open corner with the default butt, and lists an open item that holds nothing", async () => {
    const { m, s } = await model(ORDER, {
      bars: {
        b3: { item: "test-order:FLAT-O", opt: { finish: "raw" }, a: [600, 0, 0], b: [600, 0, 300] },
      },
      open: [{ id: "O1", text: "ask about a discount" }],
    });
    const p = problemsAt(m, AS_OF);
    const corner = p.problems.find((x) => x.code === "unconnected") as Problem;
    expect(corner.title).toMatch(/^Open corner: b\d\.[ab] meets b\d\.[ab] with no connection$/);
    const fix = corner.fixes[0] as { commands: unknown[] };
    const r = applyBatch(s, fix.commands, { today: AS_OF });
    expect(r.ok ? [] : r.failed.errors).toEqual([]);
    if (r.ok) {
      const after = problemsAt(modelOf(r.state, [], 1), AS_OF);
      expect(after.problems.some((x) => x.code === "unconnected")).toBe(false);
    }
    expect(p.problems.find((x) => x.code === "open-item")).toMatchObject({
      group: "note",
      targets: ["O1"],
      from: ["open"],
      fixes: [{ kind: "resolve-open", open: "O1" }],
    });
  });

  it("words a supplier's unpriced machining as itself, on the bars it is on, with no dead fix (review M1)", async () => {
    // A hole on b1, which shop-a cuts: a machining service no cost line prices. It is not an
    // item nobody sells, and a catalog item's price is not the app's to set.
    const hole = { op: "hole", face: "+y", at_mm: 100, d_mm: 6.6 };
    const { m, s } = await model(ORDER, { bars: { b1: { ops: [hole] } } });
    const p = problemsAt(m, AS_OF);
    const unpriced = p.problems.filter((x) => x.rule === "missing-price");
    expect(unpriced).toHaveLength(1);
    const machining = unpriced[0] as Problem;
    expect(machining).toMatchObject({
      // Its id is the item's, so it stays while bars gain or lose holes.
      id: "missing-price/test-order:FLAT-O/shop-a",
      group: "blocks-order",
      raw: "test-order:FLAT-O-c: no price for 1 machining service; cover them with a cost line",
      suppliers: ["shop-a"],
      targets: ["b1"],
      fixes: [],
    });
    expect(machining.title).toMatch(
      /^1 machining service on .+ \(test-order:FLAT-O\) has no price$/,
    );
    expect(machining.title).not.toMatch(/sells/);
    expect(machining.detail).toContain("b1 (1 × hole Ø6.60)");
    expect(machining.detail).toContain("addCost");
    expect(machining.detail).toContain('"covers": { "supplier": "shop-a", "services": true }');
    expect(machining.detail).toMatch(/It holds the order from shop-a until one does\.$/);

    // The cost line the words describe, with the amounts filled in, clears it.
    const cost = {
      label: "machining by shop-a",
      kind: "machining",
      supplier: "shop-a",
      low_minor: 500,
      likely_minor: 800,
      high_minor: 1200,
      covers: { supplier: "shop-a", services: true },
    };
    const r = applyBatch(s, [{ cmd: "addCost", args: { cost } }], { today: AS_OF });
    if (!r.ok) throw new Error(JSON.stringify(r.failed));
    const after = problemsAt(modelOf(r.state, [], 1), AS_OF);
    expect(after.problems.filter((x) => x.rule === "missing-price")).toEqual([]);
    expect(after.order.status).toBe("READY");
  });

  it("offers a price form only where the app sets one: a project item's (review M1)", async () => {
    // Every set-price fix the problems offer names a project item: a catalog item's price comes
    // from its catalog, so a form for it could only ever be shown disabled.
    for (const dir of [CART, ORDER]) {
      const p = problemsAt((await model(dir)).m, AS_OF);
      const priced = p.problems.flatMap((x) => x.fixes).filter((f) => f.kind === "set-price");
      for (const f of priced) expect((f as { item: string }).item).toMatch(/^project:/);
    }
    const nobody = problemsAt(
      (
        await model(ORDER, {
          parts: { p3: { item: "test-order:PIN-O", qty: 4, unplaced: true, why: "pins" } },
        })
      ).m,
      AS_OF,
    );
    const none = nobody.problems.find((x) => x.raw === "test-order:PIN-O: no offer") as Problem;
    expect(none.title).toMatch(/^No supplier sells /);
    expect(none.fixes).toEqual([]);
  });

  it("says EMPTY when there is nothing to order", async () => {
    const p = problemsAt((await model(ORDER, { bars: null, parts: null })).m, AS_OF);
    expect(p.order).toEqual({ status: "EMPTY", blocks: 0, warnings: 0 });
    expect(p.problems).toEqual([]);
  });
});

describe("plain words for every diagnostic code (E1.3)", () => {
  it.each([...DIAGNOSTIC_CODES])("%s has a title of its own", (code) => {
    // DIAGNOSTIC_CODES lists every code a diagnostic can carry: the type of Diagnostic.code
    // takes nothing else, so this sweeps them all.
    const title = checkTitle(code, []);
    const generic = new RegExp(`^an? ${code.replaceAll("-", " ")} problem`, "i");
    expect(title).not.toMatch(generic);
    expect(title).not.toBe("");
  });
});

describe("the editing audit's brace (D3, D4; E1.3)", () => {
  // The box frame of tests/fixtures/brace and a brace drawn into its back plane
  // (src/core/brace.test.ts).
  const BRACE = join(FIXTURES, "brace");
  const brace = (a: number[], b: number[]) => ({ cmd: "addBar", args: { a, b, anchor: "+x" } });

  /** The state after a batch on the frame, and its problems. */
  async function edited(commands: object[]) {
    const { s: s0 } = await model(BRACE);
    const r = applyBatch(s0, commands, { today: AS_OF });
    if (!r.ok) throw new Error(JSON.stringify(r.failed));
    return { s: r.state, p: problemsAt(modelOf(r.state, [], 1), AS_OF) };
  }
  /** A fix applied as a dry run would apply it: the check's diagnostics after it. */
  function dryRun(s: State, fix: Fix) {
    if (fix.kind !== "commands") throw new Error(`${fix.label} is not a batch`);
    const r = applyBatch(s, fix.commands, { today: AS_OF });
    if (!r.ok) throw new Error(`${fix.label}: ${JSON.stringify(r.failed)}`);
    return modelOf(r.state, [], 2).check.diagnostics;
  }

  it("offers to join the corner-to-corner brace's open ends, and the join works (D4)", async () => {
    const { s, p } = await edited([brace([0, 600, 0], [1000, 600, 750])]);
    const open = p.problems.filter((x) => x.code === "unconnected");
    expect(open.map((x) => x.targets[0])).toEqual(["b13.a", "b13.b"]);
    for (const problem of open) {
      expect(problem.fixes.map((f) => f.label)).toEqual(["Join with the default butt"]);
      const d = dryRun(s, problem.fixes[0] as Fix);
      const end = problem.targets[0];
      expect(d.filter((x) => x.code === "unconnected" && x.entity === end)).toEqual([]);
      expect(d.filter((x) => x.severity === "error")).toEqual([]);
    }
  });

  it("words an angled end the joint does not declare, with fixes that each clear it (D3)", async () => {
    // Butts made by hand, as the Connect tool makes them: the ends' cuts are not declared.
    const { s, p } = await edited([
      brace([0, 600, 100], [1000, 600, 650]),
      { cmd: "addConnection", args: { type: "butt", through: "b3", ends: ["b13.a"] } },
      { cmd: "addConnection", args: { type: "butt", through: "b4", ends: ["b13.b"] } },
    ]);
    const angled = p.problems.filter((x) => x.code === "angled-end");
    expect(angled.map((x) => [x.group, x.title])).toEqual([
      ["blocks-order", "b13.a is cut at an angle it does not declare"],
      ["blocks-order", "b13.b is cut at an angle it does not declare"],
    ]);
    expect(angled[0]?.detail).toBe(
      "c9 cuts it at 28.81°: say how it is cut, on the face at that angle or square across the bar. Until then it is drawn square at its design point. It holds the order from test-vendor.",
    );
    for (const problem of angled) {
      const end = problem.targets[0] as string;
      const [bar, e] = end.split(".") as [string, string];
      const set = (cut: string) => [
        { cmd: "setBar", args: { id: bar, set: { ends: { [e]: { cut } } } } },
      ];
      expect(problem.fixes).toEqual([
        { label: "Cut it on the face", kind: "commands", commands: set("angle") },
        { label: "Cut it square", kind: "commands", commands: set("square") },
      ]);
      const other = end === "b13.a" ? "b13.b" : "b13.a";
      for (const fix of problem.fixes) {
        const left = dryRun(s, fix)
          .filter((x) => x.severity === "error")
          .map((x) => `${x.code} ${x.entity}`);
        expect(left, fix.label).toEqual([`angled-end ${other}`]);
      }
    }
  });

  it("offers no join the default butt would refuse, and says why", async () => {
    // b14's end a has a plane of its own where b13's end b meets it: nothing runs through there
    // for b13 to butt on, so autoConnect would refuse the join.
    const { p } = await edited([
      { cmd: "addBar", args: { a: [200, 300, 0], b: [500, 300, 0] } },
      {
        cmd: "addBar",
        args: {
          a: [500, 300, 0],
          b: [500, 500, 0],
          ends: { a: { plane: { point: [500, 300, 0], normal: [0, 1, 0] } } },
        },
      },
    ]);
    const open = p.problems.find((x) => x.code === "unconnected") as Problem;
    expect(open.targets[0]).toBe("b13.b");
    expect(open.fixes).toEqual([]);
    expect(open.detail).toBe(
      "The ends meet with nothing to join them, and the default butt cannot join them here (only b13 meets at that point: nothing butts on it): add a connection there.",
    );
  });
});
