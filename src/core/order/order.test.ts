import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bom } from "../bom/bom.ts";
import { cutList } from "../cutlist/cutlist.ts";
import { derive } from "../derive/derive.ts";
import type { Diagnostic } from "../diagnostics.ts";
import type { ItemSource } from "../items.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES, mergePatch } from "../testing.ts";
import { type Order, order } from "./order.ts";

/**
 * The order list's rules (design §5.5) and choices (§5.4, §4.11) on tests/fixtures/order: one
 * profile cut by supplier shop-a, 37 screws from shop-a, and two valves from shop-eu in euros. As
 * written, both suppliers are READY; each test patches the document to trip one rule, then shows
 * the rule switched to warn (or the condition gone) lets the order through.
 */

let items: ItemSource;
let base: unknown;
beforeAll(async () => {
  const p = await openProject(join(FIXTURES, "order"));
  expect(p.diagnostics).toEqual([]);
  items = p.items;
  base = p.raw;
});

interface Run {
  asOf?: string;
  /** Problems found elsewhere (a project check), fed to `check-error`. */
  diagnostics?: Diagnostic[];
}

function run(patch: unknown = {}, opts: Run = {}): Order {
  const derived = derive(mergePatch(base, patch), items);
  const cl = cutList({ derived, items });
  const b = bom({ derived, items });
  return order({
    derived,
    items,
    bom: b,
    cutList: cl,
    diagnostics: [
      ...derived.diagnostics,
      ...cl.diagnostics,
      ...b.diagnostics,
      ...(opts.diagnostics ?? []),
    ],
    asOf: opts.asOf ?? "2026-11-26",
  });
}

/** Each supplier's status; null is the unsourced group. */
function status(o: Order): Record<string, string> {
  return Object.fromEntries(o.suppliers.map((s) => [s.supplier ?? "(unsourced)", s.status]));
}

function reasons(o: Order, rule: string): [string, string, string][] {
  return o.suppliers.flatMap((s) =>
    s.reasons
      .filter((r) => r.rule === rule)
      .map((r): [string, string, string] => [s.supplier ?? "(unsourced)", r.action, r.message]),
  );
}

const lines = (o: Order, item: string) =>
  o.suppliers.flatMap((s) => s.lines.filter((l) => l.item === `test-order:${item}`));

const READY = { "shop-a": "READY", "shop-eu": "READY" };

describe("the base fixture", () => {
  it("is ready to order from both suppliers, with no reasons", () => {
    const o = run();
    expect(o.diagnostics).toEqual([]);
    expect(status(o)).toEqual(READY);
    expect(o.suppliers.flatMap((s) => s.reasons)).toEqual([]);
    expect(o.status).toBe("READY");
  });
});

describe("check-error: a failing check blocks the suppliers of what it names", () => {
  // A 20 mm piece is shorter than the cut offer's 40 mm minimum: a `length` error on b3.
  const short = {
    bars: {
      b3: { item: "test-order:FLAT-O", opt: { finish: "raw" }, a: [0, 200, 0], b: [20, 200, 0] },
    },
  };

  it("blocks the supplier of the entity it names, and only that one", () => {
    const o = run(short);
    expect(status(o)).toEqual({ "shop-a": "BLOCKED", "shop-eu": "READY" });
    expect(reasons(o, "check-error")).toEqual([
      ["shop-a", "block", expect.stringMatching(/^length b3: b3 is 20 mm, shorter than/)],
    ]);
  });

  it("blocks every supplier for an error that names no entity", () => {
    const o = run({}, { diagnostics: [{ severity: "error", code: "check", message: "C1 fails" }] });
    expect(status(o)).toEqual({ "shop-a": "BLOCKED", "shop-eu": "BLOCKED" });
  });

  it("does not block when switched to warn, nor for a warning", () => {
    const o = run({ ...short, order_rules: { "check-error": "warn" } });
    expect(status(o)).toEqual(READY);
    expect(reasons(o, "check-error").map((r) => r[1])).toEqual(["warn"]);
    const w = run({}, { diagnostics: [{ severity: "warn", code: "check", message: "C1 close" }] });
    expect(status(w)).toEqual(READY);
  });

  it("is off when switched off", () => {
    expect(
      reasons(run({ ...short, order_rules: { "check-error": "off" } }), "check-error"),
    ).toEqual([]);
  });
});

describe("open-item: an open item with blocks: order holds its scope's suppliers", () => {
  const open = (o: Record<string, unknown>) => ({
    open: [{ id: "O1", text: "ask about the valves", blocks: "order", ...o }],
  });

  it("blocks the suppliers of the entities in its scope", () => {
    expect(status(run(open({ scope: ["p2"] })))).toEqual({
      "shop-a": "READY",
      "shop-eu": "BLOCKED",
    });
    expect(status(run(open({ scope: ["supplier:shop-a"] })))).toEqual({
      "shop-a": "BLOCKED",
      "shop-eu": "READY",
    });
    expect(status(run(open({ scope: ["test-order:SCR-O"] })))).toEqual({
      "shop-a": "BLOCKED",
      "shop-eu": "READY",
    });
  });

  it("blocks the whole order with no scope, or a scope that reaches no supplier", () => {
    const all = { "shop-a": "BLOCKED", "shop-eu": "BLOCKED" };
    expect(status(run(open({})))).toEqual(all);
    expect(status(run(open({ scope: ["b99"] })))).toEqual(all);
  });

  it("holds a cost line's supplier when the cost line blocks", () => {
    const o = run({
      costs: [
        {
          id: "K1",
          label: "valve fitting, not quoted yet",
          kind: "other",
          supplier: "shop-eu",
          low_minor: 0,
          likely_minor: 0,
          high_minor: 0,
          blocks: "order",
        },
      ],
    });
    expect(reasons(o, "open-item")).toEqual([
      ["shop-eu", "block", "K1 (valve fitting, not quoted yet) holds the order"],
    ]);
  });

  it("does not block when it does not say blocks: order, or when switched to warn", () => {
    expect(status(run(open({ scope: ["p2"], blocks: null })))).toEqual(READY);
    const o = run({ ...open({ scope: ["p2"] }), order_rules: { "open-item": "warn" } });
    expect(status(o)).toEqual(READY);
    expect(reasons(o, "open-item")).toEqual([["shop-eu", "warn", "O1: ask about the valves"]]);
  });
});

describe("placeholder: a placeholder blocks its own line's group, and no other", () => {
  // A placeholder on the first bar, derived and counted like any part (§4.7, §4.8).
  const box = (extra: Record<string, unknown> = {}) => ({
    items: {
      box: {
        kind: "placeholder",
        name: "Electronics box, to be chosen",
        bbox_mm: [
          [-50, 0, 0],
          [50, 80, 60],
        ],
        mass_kg: 1.2,
        price_minor: { v: 20000, low: 15000, high: 30000 },
        ...extra,
      },
    },
    parts: { p9: { item: "project:box", on: { bar: "b1", at_mm: 300, face: "+y" } } },
  });

  it("blocks the unsourced group only, and keeps its estimate in the totals", () => {
    const o = run(box());
    expect(status(o)).toEqual({ ...READY, "(unsourced)": "BLOCKED" });
    expect(reasons(o, "placeholder")).toEqual([
      ["(unsourced)", "block", "project:box: a placeholder, not a part to order"],
    ]);
    const line = o.suppliers.find((s) => s.supplier === null)?.lines[0];
    expect([line?.kind, line?.low_minor, line?.likely_minor, line?.high_minor]).toEqual([
      "placeholder",
      15000,
      20000,
      30000,
    ]);
    expect(line?.price_src).toBe("est");
    expect(o.totals.lines.likely_minor - run().totals.lines.likely_minor).toBe(20000);
  });

  it("blocks only its supplier when it names one; the others stay ready", () => {
    const o = run(box({ supplier: "shop-eu" }));
    expect(status(o)).toEqual({ "shop-a": "READY", "shop-eu": "BLOCKED" });
    expect(reasons(o, "placeholder")).toEqual([
      ["shop-eu", "block", "project:box: a placeholder, not a part to order"],
    ]);
  });

  it("does not block a project item that is not a placeholder, or when switched to warn", () => {
    const generic = box({ kind: "generic", price_minor: { v: 20000, src: "src" } });
    expect(status(run(generic))).toEqual({ ...READY, "(unsourced)": "READY" });
    const o = run({ ...box(), order_rules: { placeholder: "warn" } });
    expect(status(o)).toEqual({ ...READY, "(unsourced)": "READY" });
  });
});

describe("project items: made local or by a fabricator, priced by hand (§4.8)", () => {
  const plate = (extra: Record<string, unknown> = {}) => ({
    items: {
      plate: {
        kind: "plate",
        name: "Valve plate",
        material: "test:s235",
        thickness_mm: 5,
        outline: [
          [0, 0],
          [100, 0],
          [100, 60],
          [0, 60],
        ],
        price_minor: { v: 4500, src: "src", ref: "a quote", read: "2026-11-20" },
        ...extra,
      },
    },
    parts: { p9: { item: "project:plate", on: { bar: "b1", at_mm: 300, face: "+y" } } },
  });

  it("goes to the local group when it names no fabricator, priced as entered", () => {
    const o = run(plate());
    expect(status(o)).toEqual({ ...READY, local: "READY" });
    const line = o.suppliers.find((s) => s.supplier === "local")?.lines[0];
    expect([line?.kind, line?.qty, line?.likely_minor, line?.price_src, line?.read]).toEqual([
      "plate",
      1,
      4500,
      "src",
      "2026-11-20",
    ]);
  });

  it("goes to its fabricator's group when it names one", () => {
    expect(status(run(plate({ supplier: "shop-a" })))).toEqual(READY);
  });

  it("blocks only its own group for an estimated price, a missing price or an open item", () => {
    const est = run(plate({ price_minor: 4500 }));
    expect(status(est)).toEqual({ ...READY, local: "BLOCKED" });
    expect(reasons(est, "est-price")).toEqual([
      ["local", "block", "project:plate: its price is an estimate"],
    ]);
    const none = run(plate({ price_minor: null }));
    expect(status(none)).toEqual({ ...READY, local: "BLOCKED" });
    expect(reasons(none, "missing-price")).toEqual([["local", "block", "project:plate: no price"]]);
    expect(none.totals.unpriced).toBe(1);
    const open = run({
      ...plate({ price_minor: null }),
      open: [
        {
          id: "O1",
          text: "price the plate with the local shop",
          blocks: "order",
          scope: ["project:plate"],
        },
      ],
    });
    expect(status(open)).toEqual({ ...READY, local: "BLOCKED" });
    expect(reasons(open, "open-item")).toEqual([
      ["local", "block", "O1: price the plate with the local shop"],
    ]);
  });

  it("warns on a price read more than 30 days before the order", () => {
    const o = run(plate({ price_minor: { v: 4500, src: "src", read: "2026-09-01" } }));
    expect(status(o)).toEqual({ ...READY, local: "READY" });
    expect(reasons(o, "stale-price")).toEqual([
      ["local", "warn", "project:plate: price read 2026-09-01, 86 days before 2026-11-26"],
    ]);
    expect(o.oldest_read).toBe("2026-09-01");
  });
});

describe("missing-price: no offer, no exchange rate, or machining with no price", () => {
  it("blocks an item no offer sells, under unsourced", () => {
    const o = run({
      parts: { p3: { item: "test-order:PIN-O", qty: 4, unplaced: true, why: "pins" } },
    });
    expect(status(o)).toEqual({ ...READY, "(unsourced)": "BLOCKED" });
    expect(reasons(o, "missing-price")).toEqual([
      ["(unsourced)", "block", "test-order:PIN-O: no offer"],
    ]);
    expect(o.totals.unpriced).toBe(1);
  });

  it("blocks a supplier whose currency has no rate", () => {
    const o = run({ fx: null });
    expect(status(o)).toEqual({ "shop-a": "READY", "shop-eu": "BLOCKED" });
    expect(reasons(o, "missing-price")).toEqual([
      ["shop-eu", "block", "test-order-eu:VALVE-O-eu: no exchange rate for EUR"],
    ]);
  });

  it("blocks a supplier's machining that no cost line prices, until one covers it", () => {
    const hole = { bars: { b1: { ops: [{ op: "hole", face: "+y", at_mm: 100, d_mm: 6.6 }] } } };
    const o = run(hole);
    expect(status(o)).toEqual({ "shop-a": "BLOCKED", "shop-eu": "READY" });
    expect(reasons(o, "missing-price")).toEqual([
      [
        "shop-a",
        "block",
        "test-order:FLAT-O-c: no price for 1 machining service; cover them with a cost line",
      ],
    ]);
    const covered = run({
      ...hole,
      costs: [
        {
          id: "K1",
          label: "holes at shop-a",
          kind: "machining",
          supplier: "shop-a",
          low_minor: 500,
          likely_minor: 800,
          high_minor: 1200,
          covers: { supplier: "shop-a", services: true },
        },
      ],
    });
    expect(status(covered)).toEqual(READY);
    expect(lines(covered, "FLAT-O").flatMap((l) => l.services ?? [])).toEqual([
      { what: "hole Ø6.60", count: 1, by: "supplier", covered_by: "K1" },
    ]);
  });

  it("does not block when switched to warn", () => {
    const o = run({ fx: null, order_rules: { "missing-price": "warn" } });
    expect(status(o)).toEqual(READY);
  });
});

describe("est-price: an estimated price blocks its supplier by default (call 13)", () => {
  const lamp = {
    parts: { p3: { item: "test-order:LAMP-O", qty: 1, unplaced: true, why: "a lamp" } },
  };

  it("blocks", () => {
    const o = run(lamp);
    expect(status(o)).toEqual({ "shop-a": "BLOCKED", "shop-eu": "READY" });
    expect(reasons(o, "est-price")).toEqual([
      ["shop-a", "block", "test-order:LAMP-O: the price of test-order:LAMP-O is an estimate"],
    ]);
  });

  it("does not block when switched to warn", () => {
    expect(status(run({ ...lamp, order_rules: { "est-price": "warn" } }))).toEqual(READY);
  });
});

describe("out-of-stock: an offer read out of stock blocks its supplier", () => {
  const nuts = {
    parts: { p3: { item: "test-order:NUT-O", qty: 20, unplaced: true, why: "nuts" } },
  };

  it("blocks when the cheapest cover is out of stock", () => {
    // One pack of 20 (4.00) beats four packs of 5 (6.00), but it is out of stock.
    const o = run(nuts);
    expect(lines(o, "NUT-O").map((l) => [l.sku, l.qty])).toEqual([["NUT-O-20", 1]]);
    expect(reasons(o, "out-of-stock")).toEqual([
      ["shop-a", "block", "test-order:NUT-O-20: out of stock as read on 2026-11-26"],
    ]);
  });

  it("does not block once the project chooses an offer in stock, or switches it to warn", () => {
    const o = run({ ...nuts, order: { "test-order:NUT-O": { offer: "NUT-O-5" } } });
    expect(lines(o, "NUT-O").map((l) => [l.sku, l.qty])).toEqual([["NUT-O-5", 4]]);
    expect(status(o)).toEqual(READY);
    expect(status(run({ ...nuts, order_rules: { "out-of-stock": "warn" } }))).toEqual(READY);
  });
});

describe("option-not-sold: an item sold, but not in the options asked for", () => {
  const clamps = (finish: string) => ({
    parts: {
      p3: { item: "test-order:CLAMP-O", opt: { finish }, qty: 2, unplaced: true, why: "clamps" },
    },
  });

  it("blocks the supplier that sells the item, for a unit and for a bar", () => {
    const o = run(clamps("black"));
    expect(status(o)).toEqual({ "shop-a": "BLOCKED", "shop-eu": "READY" });
    expect(reasons(o, "option-not-sold")).toEqual([
      ["shop-a", "block", "test-order:CLAMP-O: not sold with finish black"],
    ]);
    const painted = run({ bars: { b2: { opt: { finish: "painted" } } } });
    expect(reasons(painted, "option-not-sold")).toEqual([
      ["shop-a", "block", "test-order:FLAT-O: not sold with finish painted"],
    ]);
  });

  it("does not block in the options sold, or when switched to warn", () => {
    const o = run(clamps("zinc"));
    expect(status(o)).toEqual(READY);
    expect(lines(o, "CLAMP-O").map((l) => [l.sku, l.likely_minor])).toEqual([["CLAMP-O-zn", 1000]]);
    expect(status(run({ ...clamps("black"), order_rules: { "option-not-sold": "warn" } }))).toEqual(
      READY,
    );
  });
});

describe("stale-price: a price read more than 30 days before the order", () => {
  const old = {
    parts: { p3: { item: "test-order:OLD-O", qty: 1, unplaced: true, why: "grommets" } },
  };

  it("warns by default, and blocks when switched to block", () => {
    const o = run(old);
    expect(status(o)).toEqual(READY);
    expect(reasons(o, "stale-price")).toEqual([
      ["shop-a", "warn", "test-order:OLD-O: price read 2026-09-01, 86 days before 2026-11-26"],
    ]);
    expect(status(run({ ...old, order_rules: { "stale-price": "block" } }))).toEqual({
      "shop-a": "BLOCKED",
      "shop-eu": "READY",
    });
  });

  it("says nothing for a price read 30 days before", () => {
    const o = run({ ...old, order_rules: { "stale-price": "block" } }, { asOf: "2026-10-01" });
    expect(reasons(o, "stale-price")).toEqual([]);
    expect(status(o)).toEqual(READY);
  });
});

describe("offers (§5.4)", () => {
  it("buys 37 screws as the cheapest pack cover, on the regular price", () => {
    const o = run();
    expect(lines(o, "SCR-O").map((l) => [l.sku, l.qty, l.likely_minor, l.surplus])).toEqual([
      ["SCR-O-10", 4, 2600, [{ item: "test-order:SCR-O", opt: {}, qty: 3 }]],
    ]);
  });

  it("uses the sale price only when the project opts in (call 12)", () => {
    for (const basis of ["sale", "lowest"]) {
      const o = run({ price_basis: basis });
      expect(lines(o, "SCR-O").map((l) => [l.sku, l.qty, l.likely_minor, l.on_sale])).toEqual([
        ["SCR-O-50", 1, 2300, true],
      ]);
    }
  });

  it("follows an explicit choice, and says when it names no offer", () => {
    const o = run({ order: { "test-order:SCR-O": { offer: "SCR-O-50" } } });
    expect(lines(o, "SCR-O").map((l) => [l.sku, l.qty])).toEqual([["SCR-O-50", 1]]);
    const bad = run({ order: { "test-order:SCR-O": { offer: "SCR-O-7" } } });
    expect(bad.diagnostics.map((d) => [d.code, d.entity])).toEqual([["order", "test-order:SCR-O"]]);
    expect(status(bad)).toEqual({ "shop-a": "BLOCKED", "shop-eu": "READY" });
  });

  it("buys an item sold only in kits as kits, and credits the kit's screws", () => {
    const o = run({
      parts: { p3: { item: "test-order:BOX-O", qty: 3, unplaced: true, why: "boxes" } },
    });
    const kit = lines(o, "BOX-O")[0];
    expect([kit?.sku, kit?.qty, kit?.unit, kit?.bom, kit?.surplus]).toEqual([
      "BOX-O-K2",
      2,
      "kit",
      [
        { item: "test-order:BOX-O", opt: {}, qty: 3 },
        { item: "test-order:SCR-O", opt: {}, qty: 8 },
      ],
      [{ item: "test-order:BOX-O", opt: {}, qty: 1 }],
    ]);
    // 37 − 8 = 29 screws left: 3 packs of 10.
    expect(lines(o, "SCR-O").map((l) => [l.sku, l.qty, l.bom[0]?.qty])).toEqual([
      ["SCR-O-10", 3, 29],
    ]);
  });

  it("bills a supplier-cut line at least its line minimum (bill: line)", () => {
    // Two pieces of 600 bill 1,200 mm: above the 1,000 mm minimum.
    expect(
      lines(run(), "FLAT-O").map((l) => [l.qty, l.billed_mm, l.line_billed_mm, l.likely_minor]),
    ).toEqual([[2, 600, undefined, 6000]]);
    // One piece of 500 bills the line's 1,000 mm: R$ 50.00 at R$ 50.00/m.
    const one = run({ bars: { b2: null, b1: { b: [500, 0, 0] } } });
    expect(
      lines(one, "FLAT-O").map((l) => [l.qty, l.billed_mm, l.line_billed_mm, l.likely_minor]),
    ).toEqual([[1, 500, 1000, 5000]]);
  });

  it("converts a line in another currency per line, at the project's rate", () => {
    const valve = lines(run(), "VALVE-O")[0];
    expect([valve?.currency, valve?.likely_minor, valve?.converted]).toEqual([
      "EUR",
      2400,
      { rate: 6.2, low_minor: 14880, likely_minor: 14880, high_minor: 14880 },
    ]);
  });
});

describe("costs (§4.11)", () => {
  const cost = (id: string, covers: unknown) => ({
    id,
    label: `machining ${id}`,
    kind: "machining",
    low_minor: 100,
    likely_minor: 100,
    high_minor: 100,
    covers,
  });

  it("is an error to cover a service twice, and it blocks that supplier", () => {
    const o = run({
      bars: { b1: { ops: [{ op: "hole", face: "+y", at_mm: 100, d_mm: 6.6 }] } },
      costs: [
        cost("K1", { supplier: "shop-a", services: true }),
        cost("K2", { services_on: { supplier: "shop-a" } }),
      ],
    });
    expect(o.diagnostics.map((d) => [d.code, d.entity, d.refs, d.message])).toEqual([
      [
        "covers",
        "K1",
        ["K1", "K2", "test-order:FLAT-O"],
        "K1 and K2 both cover the machining on test-order:FLAT-O-c",
      ],
    ]);
    // Neither cost line names a supplier: the error holds whoever sells what is covered.
    expect(status(o)).toEqual({ "shop-a": "BLOCKED", "shop-eu": "READY" });
  });

  it("warns about a band that selects no line, not about one a more specific band outranks", () => {
    const o = run({
      price_bands: [
        { supplier: "shop-b", low_pct: -10, high_pct: 10 },
        { supplier: "shop-a", low_pct: -10, high_pct: 10 },
        { supplier: "shop-a", kind: "bar", low_pct: -5, high_pct: 5 },
      ],
    });
    expect(o.diagnostics.map((d) => [d.severity, d.code, d.message])).toEqual([
      ["warn", "price-band", "price_bands[0] selects no line (supplier shop-b)"],
    ]);
  });

  it("takes the most specific price band, and an error when two tie", () => {
    const o = run({
      price_bands: [
        { supplier: "shop-a", low_pct: -10, high_pct: 10 },
        { supplier: "shop-a", kind: "bar", low_pct: -5, high_pct: 5 },
        { item: "test-order:SCR-O", low_pct: 0, high_pct: 50 },
      ],
    });
    expect(lines(o, "FLAT-O").map((l) => [l.band, l.low_minor, l.high_minor])).toEqual([
      [1, 5700, 6300],
    ]);
    expect(lines(o, "SCR-O").map((l) => [l.band, l.low_minor, l.high_minor])).toEqual([
      [2, 2600, 3900],
    ]);
    const tie = run({
      price_bands: [
        { supplier: "shop-a", low_pct: -10, high_pct: 10 },
        { kind: "fastener", low_pct: -5, high_pct: 5 },
      ],
    });
    expect(tie.diagnostics.map((d) => [d.code, d.entity])).toEqual([
      ["price-band", "test-order:SCR-O"],
    ]);
    expect(lines(tie, "SCR-O").map((l) => [l.range, l.low_minor])).toEqual([[undefined, 2600]]);
    expect(status(tie)).toEqual({ "shop-a": "BLOCKED", "shop-eu": "READY" });
  });

  it("asks for the project's currency when prices come in two and it names none", () => {
    const o = run({ currency: null });
    expect(o.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["currency", "prices are in BRL and EUR: name the project's currency"],
    ]);
    expect(o.currency).toBe("BRL");
  });

  it("adds a percentage contingency to each of the low, likely and high subtotals", () => {
    const o = run({
      costs: [
        {
          id: "K1",
          label: "labour",
          kind: "labour",
          low_minor: 1000,
          likely_minor: 2000,
          high_minor: 4001,
        },
        { id: "K2", label: "contingency", kind: "contingency", pct: 12.5, of: "subtotal" },
      ],
    });
    // Lines: 6000 + 2600 + 14880 = 23480 each; subtotals 24480, 25480, 27481.
    expect(o.totals.subtotal).toEqual({ low_minor: 24480, likely_minor: 25480, high_minor: 27481 });
    // 12.5 % of 27481 is 3435.125: rounded once, 3435.
    expect(o.totals.contingency).toEqual({ low_minor: 3060, likely_minor: 3185, high_minor: 3435 });
    expect(o.totals.total).toEqual({ low_minor: 27540, likely_minor: 28665, high_minor: 30916 });
    // Everything read but the labour and the contingency, which are estimates.
    expect(o.totals.share).toEqual([
      { src: "src", likely_minor: 23480, pct: 81.91 },
      { src: "est", likely_minor: 5185, pct: 18.09 },
    ]);
  });
});
