import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type CutList, cutList } from "./cutlist/cutlist.ts";
import { cutListCsv, cutListJson, cutListMarkdown } from "./cutlist/format.ts";
import { derive } from "./derive/derive.ts";
import { derivedJson, jsonText } from "./derive/output.ts";
import { type OpenedProject, openProject } from "./project/open.ts";
import { FIXTURES, readJson } from "./testing.ts";

/**
 * The cart (design §12): a small synthetic cart with eccentric anchors, rolled 40x80 rails, a
 * steel beam, a spliced run, braces between pivots, a bolted stack of five layers with packers,
 * a flush cover strip, a free end counted from a cut, angled knee braces, a pattern of slats,
 * and a grip bearing on another bar's end through an end plate.
 * Its cut list must equal the table worked by hand in tests/fixtures/cart/hand/, which imports
 * nothing from AluKit.
 */

const CART = join(FIXTURES, "cart");
const MAIN = fileURLToPath(new URL("../cli/main.ts", import.meta.url));

interface Expected {
  kerf_mm: number;
  trim_mm: number;
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
      ...(l.ordered_mm !== undefined ? { ordered_mm: l.ordered_mm, billed_mm: l.billed_mm } : {}),
      sources: l.sources,
    })),
    ...(g.stock
      ? {
          stock: g.stock.map((s) => ({
            sku: s.sku,
            length_mm: s.length_mm,
            sources: s.pieces.map((p) => p.source),
            offcut_mm: s.offcut_mm,
            waste_mm: s.waste_mm,
          })),
          cost_minor: g.cost_minor,
        }
      : {}),
  }));
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
    expect(d.bars.size).toBe(37);
    // The grip bears on the arm's end (an end provider reading a placement provider's end),
    // through the end plate's 8 mm, measured along the face's normal: 8·√2 along the grip.
    const grip = d.bars.get("b32")?.ends.b;
    expect(grip?.by).toBe("c33");
    expect(Math.round((grip?.move ?? 0) * 100) / 100).toBe(-11.31);
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

  it("gives byte-identical output for the same input, run twice", () => {
    const once = () => {
      const d = derive(project.raw, project.items);
      const cl = cutList({ derived: d, items: project.items });
      return [jsonText(derivedJson(d)), cutListJson(cl), cutListCsv(cl), cutListMarkdown(cl)];
    };
    expect(once()).toEqual(once());
  });

  it("gives byte-identical derive --json from two processes", () => {
    const run = (args: string[]) =>
      execFileSync(process.execPath, [MAIN, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const a = run(["derive", CART, "--json"]);
    const b = run(["derive", CART, "--json"]);
    expect(a.length).toBeGreaterThan(1000);
    expect(a).toBe(b);
    expect(JSON.parse(a).schema).toBe("alukit.derived/1");
    expect(run(["cutlist", CART, "--format", "json"])).toBe(
      run(["cutlist", CART, "--format", "json"]),
    );
  });
});
