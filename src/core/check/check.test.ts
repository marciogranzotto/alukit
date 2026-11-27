import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { derive } from "../derive/derive.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { idRanges, select } from "../query.ts";
import { FIXTURES, readJson } from "../testing.ts";
import { checkModel } from "./check.ts";
import { modelOutputs, outputAccessors } from "./outputs.ts";

/** `checkModel` (design §4.9, §5.5) and query selection (§7.3) on the fixtures. */

function load(dir: string, edit?: (doc: Record<string, unknown>) => void) {
  const raw = structuredClone(readJson(join(dir, "alukit.json"))) as Record<string, unknown>;
  edit?.(raw);
  const items = lockItems(LockFile.parse(readJson(join(dir, "alukit.lock.json"))));
  return { raw, derived: derive(raw, items), items };
}

const cart = join(FIXTURES, "cart");
const g01 = join(FIXTURES, "golden-ends", "G01");
const g26 = join(FIXTURES, "golden-gen", "G26");

/** `checkModel` with the outputs' accessors, as `alukit check`, `do` and `order` call it. */
function checkWithOutputs(input: ReturnType<typeof load>) {
  return checkModel({
    ...input,
    accessors: outputAccessors(modelOutputs(input.derived, input.items)),
  });
}

describe("project checks", () => {
  it("reads lengths, points, distances, the model box and tag counts", () => {
    const r = checkModel(
      load(cart, (d) => {
        d.nodes = { n1: [0, 0, 0], n2: [300, 400, 0] };
        d.checks = [
          { id: "C1", value: "len(r1)", op: "==", limit: "W" },
          { id: "C2", value: "dist(n1, n2)", op: "==", limit: "500" },
          { id: "C3", value: "pos(n2).y", op: "==", limit: "400" },
          { id: "C4", value: "cut(b1)", op: "<", limit: "len(b1)" },
          { id: "C5", value: "count(tag:post)", op: "==", limit: "4" },
          { id: "C6", expr: "bbox().z > H and sec(b1).width_mm == 40" },
        ];
      }),
    );
    expect(r.checks.map((c) => [c.id, c.pass])).toEqual([
      ["C1", true],
      ["C2", true],
      ["C3", true],
      ["C4", true],
      ["C5", true],
      ["C6", true],
    ]);
    expect(r.diagnostics.filter((d) => d.code.startsWith("check"))).toEqual([]);
  });

  it("reports a record it cannot read, an unknown id and a value that is not a condition", () => {
    const r = checkModel(
      load(g01, (d) => {
        d.checks = [
          { value: "1", op: "=<", limit: "2" },
          { id: "C2", value: "len(b9)", op: "<=", limit: "1" },
          { id: "C3", expr: "len(b1)" },
          { id: "C4", value: "mass()", op: "<=", limit: "10", severity: "warn" },
        ];
      }),
    );
    expect(r.diagnostics.map((d) => [d.severity, d.code, d.entity])).toEqual([
      ["error", "check", "C2"],
      ["error", "check", "C3"],
      ["error", "check", "checks[0]"],
      ["info", "check-pending", "C4"],
      // G01's one butt names no connector, nor does the project (review B1).
      ["info", "butt-no-connector", "c1"],
    ]);
    expect(r.diagnostics[0]?.message).toContain("no bar b9 that derives");
  });
});

describe("mass() and cost(): the bill of materials and the priced order (§4.9)", () => {
  it("reads the BOM's total mass and the order's low, likely and high totals", () => {
    const bomMass = (readJson(join(cart, "expected-bom.json")) as { mass_kg: number }).mass_kg;
    const total = (
      readJson(join(g26, "expected.json")) as {
        expect: {
          order: { total: { low_minor: number; likely_minor: number; high_minor: number } };
        };
      }
    ).expect.order.total;
    const withMass = checkWithOutputs(
      load(cart, (d) => {
        d.checks = [{ id: "C1", value: "mass()", op: "==", limit: String(bomMass) }];
      }),
    );
    expect(withMass.checks.map((c) => [c.id, c.value, c.pass])).toEqual([["C1", bomMass, true]]);
    const r = checkWithOutputs(
      load(g26, (d) => {
        d.checks = [
          { id: "C1", value: "cost()", op: "<=", limit: "300" },
          { id: "C2", value: "cost(low)", op: "==", limit: String(total.low_minor / 100) },
          { id: "C3", value: "cost(likely)", op: "==", limit: "cost()" },
          { id: "C4", value: "cost(high)", op: "<=", limit: "300", severity: "warn" },
        ];
      }),
    );
    expect(r.checks.map((c) => [c.id, c.value, c.pass])).toEqual([
      ["C1", total.likely_minor / 100, true],
      ["C2", total.low_minor / 100, true],
      ["C3", total.likely_minor / 100, true],
      ["C4", total.high_minor / 100, false],
    ]);
    expect(r.diagnostics.map((d) => [d.severity, d.code, d.entity])).toEqual([
      ["warn", "check", "C4"],
    ]);
  });

  it("cannot be evaluated on a total that leaves something out, nor with a bad argument", () => {
    // The cart's order has lines no offer prices (its unsourced group).
    const r = checkWithOutputs(
      load(cart, (d) => {
        d.checks = [
          { id: "C1", value: "cost()", op: "<=", limit: "1000000" },
          { id: "C2", value: "cost(worst)", op: "<=", limit: "1" },
          { id: "C3", value: "mass(b1)", op: "<=", limit: "1" },
        ];
      }),
    );
    expect(r.checks.map((c) => [c.id, c.pass, c.problem])).toEqual([
      ["C1", undefined, expect.stringMatching(/^cost\(\): \d+ order lines? ha(s|ve) no price$/)],
      ["C2", undefined, "cost takes nothing, or one of low, likely and high: cost(high)"],
      ["C3", undefined, "mass takes no arguments"],
    ]);
    // A cost line in a currency with no rate is left out of the total.
    const noRate = checkWithOutputs(
      load(g26, (d) => {
        d.costs = [
          {
            id: "K1",
            label: "freight",
            kind: "freight",
            low_minor: 1,
            likely_minor: 1,
            high_minor: 1,
            currency: "USD",
          },
        ];
        d.checks = [{ id: "C1", value: "cost()", op: "<=", limit: "1000" }];
      }),
    );
    expect(noRate.checks[0]?.problem).toBe("cost(): no exchange rate into BRL for K1");
    // An item with no mass is left out of the BOM's total (no fixture has one: the BOM says so).
    const input = load(g26, (d) => {
      d.checks = [{ id: "C1", value: "mass()", op: "<=", limit: "100" }];
    });
    const real = modelOutputs(input.derived, input.items);
    const gap = checkModel({
      ...input,
      accessors: outputAccessors({
        ...real,
        bom: () => ({ ...real.bom(), mass_unknown: ["test:PANEL-PC4"] }),
      }),
    });
    expect(gap.checks[0]?.problem).toBe("mass(): 1 item has no mass (test:PANEL-PC4)");
    expect(gap.diagnostics.map((d) => [d.severity, d.code, d.entity])).toEqual([
      ["error", "check", "C1"],
    ]);
  });
});

describe("bbox(): every body the viewer draws and the GLB holds (§4.9)", () => {
  /*
   * The cart's box, worked by hand from tests/fixtures/cart/alukit.json with W = 1200, D = 600,
   * H = 900 and Hb = 100, the bar frames of §4.4 and the part frames of §4.7. No AluKit.
   *
   * x, the high side: the push handle. Its grip b32 runs from (W + 350, 20, 600) to
   *   (W + 150, 20, 800): along t = (−1, 0, 1)/√2, so local y = (1, 0, 1)/√2 and local x = −Y.
   *   Its end a is free, so square at its design point; the 40x40's corners there reach
   *   W + 350 + 20/√2 = 1564.14. The frame itself ends at x = W (the right posts, anchored +x).
   * x, the low side: the sensor bracket p7, a bent angle (length 50, legs a 40 and b 30) on the
   *   left top rail b7. b7 runs along +Y (local x = −X, local y = +Z), anchored +x+y at x = 0,
   *   z = H: its section spans x 0..40 and z 860..900, its face +y (up) has its centre line at
   *   x = 20. At at_mm 300 the station is (20, 300, 900). The angle's frame there: z = +Z, x along
   *   the bar = +Y, y = z × x = −X. It has no mount datum, so its origin lands on the station, and
   *   leg a, along its y, reaches x = 20 − 40 = −20. The bars reach no lower than x = 0.
   * y: from 0 (the front posts and the front top rail, anchored on y = 0) to the motor plate p6.
   *   p6 is on the back base rail b10, which runs along +X (local x = +Y, local y = +Z), anchored
   *   +x at y = D, z = Hb: it spans y 560..600, z 80..120, its face +y (up) at z = 120 with its
   *   centre line at y = 580. The station at 900 is (900, 580, 120); the plate's frame is the
   *   world's, and its mount (80, 50, 0) lands there, so its outline (x 0..160, y 0..100) spans
   *   y 530..630. The placeholder motor p8 at (900, 580, 128), no datum, box y −45..45: 535..625,
   *   inside the plate's 630. The bars reach y = 600.
   * z: from 0 (the posts' feet) to 930, reached twice. The carriages p1 (box z −12.9..12.5, the
   *   run datum at its origin) land on the linear rail's running face: the rail is 17.5 high,
   *   anchored at its mount (its bottom) on z = H, so its top is 917.5, and 917.5 + 12.5 = 930.
   *   p7's leg b rises 30 from b7's top: 900 + 30 = 930. The motor reaches 128 + 110 = 238. The
   *   bars reach 917.5 (the rail).
   */
  const handle = 1200 + 350 + 20 / Math.SQRT2;
  const cartBox = { min: [-20, 0, 0], max: [handle, 630, 930] };
  const size = (b: { min: number[]; max: number[] }) => b.max.map((x, i) => x - (b.min[i] ?? 0));

  function bboxOf(edit?: (d: Record<string, unknown>) => void) {
    const r = checkModel(
      load(cart, (d) => {
        edit?.(d);
        d.checks = ["x", "y", "z"].map((k, i) => ({
          id: `C${i + 1}`,
          value: `bbox().${k}`,
          op: ">=",
          limit: "0",
        }));
      }),
    );
    return { r, size: r.checks.map((c) => c.value) };
  }

  it("covers the parts, the push handle and the placeholder, as worked by hand", () => {
    const { r, size: got } = bboxOf();
    expect(r.checks.map((c) => c.problem)).toEqual([undefined, undefined, undefined]);
    const want = size(cartBox);
    got.forEach((v, i) => {
      expect(v, ["x", "y", "z"][i]).toBeCloseTo(want[i] as number, 9);
    });
    // With no parts, the bars (and the fasteners, inside them) give (W + 350 + 20/√2, D, H + 17.5)
    // from (0, 0, 0): the parts reach past them on three sides.
    const bars = bboxOf((d) => {
      d.parts = {};
      delete (d.patterns as Record<string, unknown>).pt2;
    });
    expect(bars.r.checks.map((c) => c.problem)).toEqual([undefined, undefined, undefined]);
    [handle, 600, 917.5].forEach((v, i) => {
      expect(bars.size[i], ["x", "y", "z"][i]).toBeCloseTo(v, 9);
    });
  });

  it("follows the placeholder where its box reaches past every other body", () => {
    // The motor's box made deeper and taller: y to 580 + 60 = 640, past the plate's 630; z to
    // 128 + 850 = 978, past the carriages' and the bracket's 930.
    const { size: got } = bboxOf((d) => {
      const items = d.items as Record<string, Record<string, unknown>>;
      (items.motor as Record<string, unknown>).bbox_mm = [
        [-60, -45, 0],
        [60, 60, 850],
      ];
    });
    const want = size({ min: cartBox.min, max: [handle, 640, 978] });
    got.forEach((v, i) => {
      expect(v, ["x", "y", "z"][i]).toBeCloseTo(want[i] as number, 9);
    });
  });

  it("cannot be evaluated while a placed part gives no box, naming it", () => {
    // A T-nut placed on a face: its item gives no box, so its extent is not known (§4.9: never a
    // pass on a partial box).
    const { r } = bboxOf((d) => {
      (d.parts as Record<string, unknown>).p9 = {
        item: "test:TNUT-M8",
        on: { bar: "b9", at_mm: 300, face: "+y" },
      };
    });
    expect(r.checks.map((c) => [c.pass, c.problem])).toEqual(
      Array(3).fill([undefined, "bbox(): no box for test:TNUT-M8 (p9): its item gives no bbox_mm"]),
    );
  });
});

describe("unconnected ends", () => {
  it("leaves an end a butt bears on, and warns where ends meet with no connection", () => {
    expect(checkModel(load(cart)).diagnostics.filter((d) => d.code === "unconnected")).toEqual([]);
    const loose = checkModel(load(g01, (d) => delete d.connections));
    expect(loose.diagnostics).toMatchObject([
      { severity: "warn", code: "unconnected", entity: "b1.b", refs: ["b1.b", "b2.a"] },
    ]);
  });
});

describe("query selection", () => {
  const doc = readJson(join(cart, "alukit.json")) as Record<string, unknown>;
  it("selects by kind name, singular or plural, and relation in both directions", () => {
    expect(select(doc, "run")).toEqual({ ok: true, ids: ["r1", "r2"] });
    expect(select(doc, "bars of c9")).toEqual({ ok: true, ids: ["b11", "b12"] });
    expect(select(doc, "connections of b31")).toEqual({ ok: true, ids: ["c32", "c33"] });
    expect(select(doc, "bars of n1")).toMatchObject({ ok: false });
    expect(select(doc, "item:")).toMatchObject({ ok: false });
  });

  it("compresses ids into ranges", () => {
    expect(idRanges(["b3", "b1", "b2", "b5", "b6", "c1", "pt1"])).toBe("b1–b3, b5, b6, c1, pt1");
  });
});
