import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type Bom, bom } from "./bom/bom.ts";
import { bomCsv, bomJson, bomMarkdown } from "./bom/format.ts";
import { type CutList, cutList } from "./cutlist/cutlist.ts";
import { cutListCsv, cutListJson, cutListMarkdown } from "./cutlist/format.ts";
import { derive } from "./derive/derive.ts";
import { derivedJson, jsonText } from "./derive/output.ts";
import { type OpenedProject, openProject } from "./project/open.ts";
import { FIXTURES, readJson } from "./testing.ts";

/**
 * The cart (design §12): a small synthetic cart with eccentric anchors, rolled 40x80 rails, a
 * steel beam, a spliced run, braces between pivots, a bolted stack of five layers with packers
 * and threaded rods cut from stock in sleeves inside the beam, a flush cover strip, a free end
 * counted from a cut, angled knee braces, a pattern of slats, a grip bearing on another bar's end
 * through an end plate, a linear rail run from stock lengths with its factory ends at the joint,
 * a pattern of carriages crossing the joint, rail screws at a selection of the rail's holes, and
 * an unplaced line.
 * Its cut list and BOM must equal the tables worked by hand in tests/fixtures/cart/hand/, which
 * imports nothing from AluKit.
 */

const CART = join(FIXTURES, "cart");
const MAIN = fileURLToPath(new URL("../cli/main.ts", import.meta.url));

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
      ...(l.centre_mm !== undefined ? { centre_mm: l.centre_mm, short_mm: l.short_mm } : {}),
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

  it("derives with no problems", () => {
    const d = derive(project.raw, project.items);
    expect(d.diagnostics).toEqual([]);
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

  it("gives byte-identical output for the same input, run twice", () => {
    const once = () => {
      const d = derive(project.raw, project.items);
      const cl = cutList({ derived: d, items: project.items });
      const b = bom({ derived: d, items: project.items });
      return [
        jsonText(derivedJson(d)),
        cutListJson(cl),
        cutListCsv(cl),
        cutListMarkdown(cl),
        bomJson(b),
        bomCsv(b),
        bomMarkdown(b),
      ];
    };
    expect(once()).toEqual(once());
  });

  it("gives byte-identical derive --json from two processes, with generated ops and hardware", () => {
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
    expect(run(["cutlist", CART, "--format", "json"])).toBe(
      run(["cutlist", CART, "--format", "json"]),
    );
    expect(run(["bom", CART, "--format", "json"])).toBe(run(["bom", CART, "--format", "json"]));
  });
});
