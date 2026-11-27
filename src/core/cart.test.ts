import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type Bom, bom } from "./bom/bom.ts";
import { bomCsv, bomJson, bomMarkdown } from "./bom/format.ts";
import { checkedBom, checkedCutList, checkedMachining, modelOutputs } from "./check/outputs.ts";
import { type CutList, cutList } from "./cutlist/cutlist.ts";
import { cutListCsv, cutListJson, cutListMarkdown } from "./cutlist/format.ts";
import { derive } from "./derive/derive.ts";
import { derivedJson, jsonText } from "./derive/output.ts";
import { sortDiagnostics } from "./diagnostics.ts";
import { machiningJson, machiningMarkdown } from "./machining/format.ts";
import type { MachiningSheet } from "./machining/machining.ts";
import {
  costsCsv,
  costsJson,
  costsOf,
  orderCsv,
  orderJson,
  orderMarkdown,
} from "./order/format.ts";
import { type Order, order } from "./order/order.ts";
import { type OpenedProject, openProject } from "./project/open.ts";
import { projectItems } from "./project-items/source.ts";
import { FIXTURES, lockStamp, mergePatch, oldestCutRead, readJson, withStamp } from "./testing.ts";

/**
 * The cart (design §12): a small synthetic cart with eccentric anchors, rolled 40x80 rails, a
 * steel beam, a spliced run, braces between pivots, a bolted stack of five layers with packers
 * and threaded rods cut from stock in sleeves inside the beam, a flush cover strip, a free end
 * counted from a cut, angled knee braces, a pattern of slats, a grip bearing on another bar's end
 * through an end plate, a linear rail run from stock lengths with its factory ends at the joint,
 * a pattern of carriages crossing the joint, rail screws at a selection of the rail's holes, an
 * unplaced line, and (M6) a custom plate with threaded, countersunk and counterbored holes, a bent
 * angle, and a placeholder.
 * Its cut list, BOM, order list and machining sheet must equal the tables worked by hand in
 * tests/fixtures/cart/hand/, which imports nothing from AluKit.
 */

const CART = join(FIXTURES, "cart");
const MAIN = fileURLToPath(new URL("../cli/main.ts", import.meta.url));
/** The order's date in the hand script: no price is stale but the nuts', read 56 days before. */
const AS_OF = "2026-11-26";

function cartOrder(project: OpenedProject, raw: unknown = project.raw): Order {
  const derived = derive(raw, project.items);
  const cl = cutList({ derived, items: project.items });
  const b = bom({ derived, items: project.items });
  return order({
    derived,
    items: project.items,
    bom: b,
    cutList: cl,
    diagnostics: sortDiagnostics([...derived.diagnostics, ...cl.diagnostics, ...b.diagnostics]),
    asOf: AS_OF,
  });
}

/** The machining sheet as `alukit machining` builds it, with every problem met on the way. */
function cartSheet(project: OpenedProject): MachiningSheet {
  const derived = derive(project.raw, project.items);
  return checkedMachining(derived, modelOutputs(derived, project.items));
}

interface Expected {
  kerf_mm: number;
  trim_mm: number;
  rail_stations_x_mm: number[];
  groups: unknown[];
}

/** The cut list in the hand table's shape. */
function projected(cl: CutList) {
  return cl.groups.map((g) => ({
    item: g.item,
    opt: g.opt,
    mode: g.mode,
    ...(g.mode === "cut" ? { offer: g.offer } : {}),
    lines: g.lines.map((l) => ({
      count: l.count,
      cut_mm: l.cut_mm,
      ...(l.centre_mm !== undefined
        ? { centre_mm: l.centre_mm, short_mm: l.short_mm, span_mm: l.span_mm }
        : {}),
      ends: l.ends,
      ...(l.machining.length > 0 ? { machining: l.machining } : {}),
      ...(l.rail ? { rail: l.rail } : {}),
      ...(l.ordered_mm !== undefined ? { ordered_mm: l.ordered_mm, billed_mm: l.billed_mm } : {}),
      sources: l.sources,
    })),
    ...(g.stock
      ? {
          stock: g.stock.map((s) => {
            const ends = s.pieces.filter((p) => p.factory_end);
            return {
              sku: s.sku,
              length_mm: s.length_mm,
              sources: s.pieces.map((p) => p.source),
              offcut_mm: s.offcut_mm,
              waste_mm: s.waste_mm,
              ...(ends.length > 0
                ? { factory_ends: Object.fromEntries(ends.map((p) => [p.source, p.factory_end])) }
                : {}),
            };
          }),
          cost_minor: g.cost_minor,
        }
      : {}),
  }));
}

/** The BOM in the hand table's shape: quantities and masses, without the catalog's names. */
function bomProjected(b: Bom) {
  return {
    groups: b.groups.map((g) => ({
      kind: g.kind,
      lines: g.lines.map(({ name: _, ...l }) => l),
      mass_kg: g.mass_kg,
    })),
    mass_kg: b.mass_kg,
  };
}

describe("the cart", () => {
  let project: OpenedProject;
  beforeAll(async () => {
    project = await openProject(CART);
    expect(project.diagnostics).toEqual([]);
  });

  it("derives with no errors, and warns of the three end faces that overhang their faces", () => {
    const d = derive(project.raw, project.items);
    // The beam's ends stand 30 past the base rails' faces above and below, and the grip's 45° end
    // 16.28 past the arm's end; the rods' washers and the rail screws give no bearing diameter, so
    // their seats are not checked (§4.5, after acceptance run 4): worked in hand/cart_by_hand.py.
    expect(d.diagnostics.map((x) => [x.severity, x.code, x.entity])).toEqual([
      ["warn", "connection", "c21"],
      ["warn", "connection", "c22"],
      ["warn", "connection", "c33"],
      ["info", "fit", "c23"],
      ["info", "fit", "c35"],
    ]);
    expect(d.bars.size).toBe(39);
    // The grip bears on the arm's end (an end provider reading a placement provider's end),
    // through the end plate's 8 mm, measured along the face's normal: 8·√2 along the grip.
    const grip = d.bars.get("b32")?.ends.b;
    expect(grip?.by).toBe("c33");
    expect(Math.round((grip?.move ?? 0) * 100) / 100).toBe(-11.31);
  });

  it("puts the rail screws at the selected holes, and the carriages across the joint", () => {
    const expected = readJson(join(CART, "expected-cutlist.json")) as Expected;
    const d = derive(project.raw, project.items);
    const c35 = d.fastenings.get("c35");
    expect(c35?.stations.map((s) => Math.round(s.point[0] * 100) / 100)).toEqual(
      expected.rail_stations_x_mm,
    );
    // The rail (17.5 deep) and the middle rail's groove lip (2.2): the T-nut's grip.
    expect(new Set(c35?.stations.map((s) => Math.round(s.grip * 100) / 100))).toEqual(
      new Set([19.7]),
    );
    const carriages = ["p1", "p1@1", "p1@2"].map((id) => {
      const p = d.parts.get(id);
      return p?.placed ? [p.bar, p.s, p.point[0], p.datum] : undefined;
    });
    expect(carriages).toEqual([
      ["b33", 100, 230, "run"],
      ["b33", 400, 530, "run"],
      ["b34", 230, 830, "run"],
    ]);
  });

  it("has the cut list worked by hand", () => {
    const expected = readJson(join(CART, "expected-cutlist.json")) as Expected;
    const cl = cutList({ derived: derive(project.raw, project.items), items: project.items });
    expect(cl.diagnostics).toEqual([]);
    expect(projected(cl)).toEqual(expected.groups);
    for (const g of cl.groups.filter((x) => x.mode === "stock")) {
      expect([g.kerf_mm, g.trim_mm]).toEqual([expected.kerf_mm, expected.trim_mm]);
    }
  });

  it("states the oldest read date of the offers its cut list chose, worked from the lock", () => {
    const expected = readJson(join(CART, "expected-cutlist.json")) as Parameters<
      typeof oldestCutRead
    >[0];
    const cl = cutList({ derived: derive(project.raw, project.items), items: project.items });
    expect(cl.oldest_read).toBe(oldestCutRead(expected, CART));
  });

  it("has the bill of materials worked by hand", () => {
    const expected = readJson(join(CART, "expected-bom.json")) as {
      groups: unknown;
      mass_kg: number;
    };
    const b = bom({ derived: derive(project.raw, project.items), items: project.items });
    expect(b.diagnostics).toEqual([]);
    expect(b.mass_unknown).toEqual([]);
    expect(bomProjected(b)).toEqual({ groups: expected.groups, mass_kg: expected.mass_kg });
  });

  it("has the order list and totals worked by hand, byte for byte", () => {
    // tests/fixtures/cart/hand/cart_by_hand.py writes expected-order.json without AluKit.
    const expected = readFileSync(join(CART, "expected-order.json"), "utf8");
    expect(orderJson(cartOrder(project))).toBe(expected);
  });

  it("orders per supplier: READY or BLOCKED, each for its own reasons", () => {
    const o = cartOrder(project);
    expect(o.suppliers.map((s) => [s.supplier, s.status, s.reasons.map((r) => r.rule)])).toEqual([
      // The sensor bracket is made locally and has no price yet: O2 holds it.
      ["local", "BLOCKED", ["open-item", "missing-price"]],
      ["test-fab", "READY", []],
      ["test-gen-vendor", "BLOCKED", ["open-item"]],
      ["test-geo-vendor", "READY", ["stale-price"]],
      ["test-steel", "READY", []],
      ["test-vendor", "BLOCKED", ["est-price"]],
      [null, "BLOCKED", ["placeholder", "missing-price"]],
    ]);
    // 77 screws: the chosen bracket kits bring 40, and §5.4's example covers the 37 left with
    // 4 packs of 10, not one of 50.
    const screws = o.suppliers.flatMap((s) =>
      s.lines.flatMap((l) =>
        l.bom.filter((b) => b.item === "test:SCR-M8x16").map((b) => [l.sku, l.qty, b.qty]),
      ),
    );
    expect(screws).toEqual([
      ["BRK-40-K10", 2, 40],
      ["SCR-M8x16-10", 4, 37],
    ]);
  });

  it("has the machining sheet worked by hand, byte for byte, with the plate's three hole types", () => {
    const expected = readFileSync(join(CART, "expected-machining.json"), "utf8");
    const sheet = cartSheet(project);
    expect(machiningJson(sheet)).toBe(expected);
    const plate = sheet.parts.find((p) => p.item === "project:plate-a");
    const shown = plate?.holes
      .filter((h) => h.type !== "through")
      .map((h) => [h.id, h.at_mm, h.type, h.thread ?? h.csk ?? h.cbore]);
    expect(shown).toEqual([
      ["h1", [20, 20], "threaded", "M6"],
      ["h2", [140, 20], "countersunk", { d_mm: 12.4, angle_deg: 90, depth_mm: 2.9 }],
      ["h3", [140, 80], "counterbored", { d_mm: 11, depth_mm: 4 }],
    ]);
    expect(plate?.datum).toMatch(/^the outline's origin/);
  });

  it("holds only the placeholder's own line: the group it is in, and no other", () => {
    const golden = JSON.parse(readFileSync(join(CART, "expected-order.json"), "utf8")) as Order;
    const held = golden.suppliers.filter((s) => s.reasons.some((r) => r.rule === "placeholder"));
    expect(held.map((s) => s.supplier)).toEqual([null]);
    expect(held[0]?.lines.map((l) => l.item)).toContain("project:motor");
    expect(held[0]?.reasons.filter((r) => r.rule === "placeholder")).toEqual([
      {
        rule: "placeholder",
        action: "block",
        message: "project:motor: a placeholder, not a part to order",
        entities: ["project:motor"],
      },
    ]);
    // With the rule off, every group's status and other reasons are as the golden has them: the
    // placeholder held nothing else.
    const off = cartOrder(
      project,
      mergePatch(project.raw, { order_rules: { placeholder: "off" } }),
    );
    const others = (o: Order) =>
      o.suppliers.map((s) => [
        s.supplier,
        s.status,
        s.reasons.filter((r) => r.rule !== "placeholder"),
      ]);
    expect(others(off)).toEqual(others(golden));
  });

  it("weighs the bent angle as its hand calculation does", () => {
    const hand = (
      readJson(join(CART, "expected-bom.json")) as {
        unrounded: Record<string, { developed_mm?: number; mass_kg: number }>;
      }
    ).unrounded;
    const own = projectItems(project.items, derive(project.raw, project.items).doc).resolved;
    const angle = own.get("project:angle-a");
    expect(angle?.angle?.developed).toBeCloseTo(hand["project:angle-a"]?.developed_mm as number, 9);
    expect(angle?.view.mass_kg).toEqual({
      v: expect.closeTo(hand["project:angle-a"]?.mass_kg as number, 12),
      src: "calc",
    });
    expect(own.get("project:plate-a")?.view.mass_kg?.v).toBeCloseTo(
      hand["project:plate-a"]?.mass_kg as number,
      12,
    );
  });

  it("gives byte-identical output for the same input, run twice", () => {
    const once = () => {
      const d = derive(project.raw, project.items);
      const cl = cutList({ derived: d, items: project.items });
      const b = bom({ derived: d, items: project.items });
      const o = cartOrder(project);
      return [
        jsonText(derivedJson(d)),
        cutListJson(cl),
        cutListCsv(cl),
        cutListMarkdown(cl),
        bomJson(b),
        bomCsv(b),
        bomMarkdown(b),
        orderJson(o),
        orderCsv(o),
        orderMarkdown(o),
        costsJson(costsOf(o)),
        costsCsv(costsOf(o)),
        machiningJson(cartSheet(project)),
        machiningMarkdown(cartSheet(project)),
      ];
    };
    expect(once()).toEqual(once());
  });

  // Four Node processes, each loading the catalogs and deriving the cart: more than the default
  // 5 s when the suite's other files run alongside.
  it("gives byte-identical derive --json from two processes, with generated ops and hardware", {
    timeout: 30_000,
  }, () => {
    const run = (args: string[]) =>
      execFileSync(process.execPath, [MAIN, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const a = run(["derive", CART, "--json"]);
    const b = run(["derive", CART, "--json"]);
    expect(a.length).toBeGreaterThan(1000);
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(parsed.schema).toBe("alukit.derived/1");
    expect(parsed.bars.b20.ops.every((o: { by: string }) => o.by === "c23")).toBe(true);
    expect(parsed.bars.b11.ops).toEqual([
      { op: "end-tap", from: "b", thread: "M8", depth_mm: 20, by: "c9" },
    ]);
    expect(parsed.hardware.length).toBeGreaterThan(0);
    expect(parsed.pieces.map((p: { source: string }) => p.source)).toEqual([
      "c23.f1",
      "c23.f2",
      "c23.f3",
      "c23.f4",
      "c23.s1",
      "c23.s2",
      "c23.s3",
      "c23.s4",
    ]);
    // The cut list and the BOM from another process equal this process's, byte for byte, each
    // stating the lock it was derived from (§5.4): its hash, which any sha256 tool gives from the
    // canonical lock file.
    const lock = lockStamp(CART);
    const d = derive(project.raw, project.items);
    const outputs = modelOutputs(d, project.items, { lock });
    expect(run(["cutlist", CART, "--format", "json"])).toBe(
      cutListJson(checkedCutList(d, outputs)),
    );
    expect(run(["bom", CART, "--format", "json"])).toBe(bomJson(checkedBom(d, outputs)));
    // The machining sheet from another process is the golden worked by hand, plus the stamp.
    expect(run(["machining", CART, "--format", "json"])).toBe(
      withStamp(readFileSync(join(CART, "expected-machining.json"), "utf8"), "schema", { lock }),
    );
    // `alukit order` exits 1, since suppliers are blocked, and prints why. Its JSON is the golden
    // plus one line, the stamp (§4.13, §9).
    const o = spawnSync(
      process.execPath,
      [MAIN, "order", CART, "--format", "json", "--as-of", AS_OF],
      { encoding: "utf8" },
    );
    expect(o.status).toBe(1);
    const golden = readFileSync(join(CART, "expected-order.json"), "utf8");
    expect(o.stdout).toBe(withStamp(golden, "oldest_read", { lock }));
    expect(o.stderr).toMatch(/^BLOCKED test-vendor: est-price: test:PSU-24V: /m);
  });
});
