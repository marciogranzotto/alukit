import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkModel } from "../check/check.ts";
import { checkedOrder, modelOutputs, outputAccessors } from "../check/outputs.ts";
import { applyBatch } from "../commands/apply.ts";
import type { RawDoc, State } from "../commands/types.ts";
import { derive } from "../derive/derive.ts";
import { sortDiagnostics } from "../diagnostics.ts";
import { lockHash, pinLock } from "../lock/pin.ts";
import { documentRefs } from "../lock/refs.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { openLiveCatalogs } from "../project/open.ts";
import { FIXTURES, mergePatch, readJson } from "../testing.ts";
import { type ModelState, problemsAt } from "./problems.ts";
import type { Problem, ProblemGroup } from "./types.ts";

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
      detail: "The order from test-vendor waits for a price read from a source.",
      fixes: [{ label: "Set a sourced price…", kind: "set-price", item: "test:PSU-24V" }],
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

  it("says EMPTY when there is nothing to order", async () => {
    const p = problemsAt((await model(ORDER, { bars: null, parts: null })).m, AS_OF);
    expect(p.order).toEqual({ status: "EMPTY", blocks: 0, warnings: 0 });
    expect(p.problems).toEqual([]);
  });
});
