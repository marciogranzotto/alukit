import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemsAnswer } from "#core/problems/types.ts";
import { scratchFixtures } from "#core/testing.ts";
import { cornersOf } from "../corners.ts";
import type { Model } from "../model.ts";
import { fromCheck } from "../problems/source.ts";
import { viewOf } from "../testing.ts";
import { badgesOf, barWords, hoverWords, legendItems } from "./words.ts";

/** What the viewport says and badges, on the cart, with S0's hand-made problems of the cart. */

let root: string;
let cart: Model;
beforeAll(async () => {
  root = await scratchFixtures();
  cart = await viewOf(join(root, "cart"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const PROBLEMS = JSON.parse(
  readFileSync(new URL("../../../tests/fixtures/ux/problems-cart.json", import.meta.url), "utf8"),
) as ProblemsAnswer;

describe("the viewport's words", () => {
  it("names a hovered bar by id, label, item and cut; a part; a connection; a corner", () => {
    const b2 = cart.derived.bars.b2;
    expect(hoverWords(cart, "b2", [])).toEqual([`b2  TS40  ${b2?.cut_mm.toFixed(2)} mm`]);
    expect(hoverWords(cart, "p6", [])[0]).toMatch(/^p6 /);
    expect(hoverWords(cart, "c23", [])).toEqual(["c23  ⊕ face"]);
    const corners = cornersOf(cart);
    expect(hoverWords(cart, "corner:0,0,900", corners)).toEqual([
      "Corner (0, 0, 900)",
      "⊥ c1 butt",
      "b5 runs through",
      "joined",
    ]);
  });

  it("labels a selected bar with its cut and its ends, square or angled", () => {
    expect(barWords(cart, "b9")).toBe(
      `${cart.derived.bars.b9?.cut_mm.toFixed(2)} mm  square · square`,
    );
    // The corner diagonals b27 to b30 are cut at 45° at both ends; b32 at one.
    expect(barWords(cart, "b27")).toBe("153.14 mm  45.00° · 45.00°");
    expect(barWords(cart, "b32")).toBe("291.53 mm  square · 45.00°");
    expect(barWords(cart, "c1")).toBeUndefined();
  });

  it("lists the BOM's items once each, in its order, for the legend", () => {
    const items = legendItems(cart).map((x) => x.item);
    expect(items).toEqual([...new Set(cart.bom.groups.flatMap((g) => g.lines.map((l) => l.item)))]);
    expect(items).toContain("test:TS40");
  });
});

describe("badgesOf", () => {
  it("badges each problem but notes on the bodies its targets stand for", () => {
    const b = badgesOf(PROBLEMS, cart);
    // 6 problems block the order, 4 warn, 2 are notes. The splice stud and the power supply's
    // estimate name items nothing drawn uses alone: they badge what uses them, or nothing.
    expect(b.filter((x) => x.severity === "warn")).toEqual([
      { ids: ["b18", "b9"], severity: "warn" },
      { ids: ["b18", "b10"], severity: "warn" },
      { ids: ["b32", "b31"], severity: "warn" },
      ...b.filter((x) => x.severity === "warn").slice(3),
    ]);
    // O2 and the bracket's missing price both land on p7, the bracket.
    const p7 = b.filter((x) => x.ids.includes("p7"));
    expect(p7.map((x) => x.severity)).toEqual(["block", "block"]);
    // No badge names what has no body (a connection, an item, an open item).
    for (const x of b) {
      for (const id of x.ids) {
        expect(id in cart.derived.bars || id in cart.derived.parts, id).toBe(true);
      }
    }
    expect(badgesOf(undefined, cart)).toEqual([]);
  });

  it("badges the check's warnings while they stand in for the problems (S4's fromCheck)", () => {
    // The cart's check warns on three connections, the overhanging butts c21 and c22 and the
    // handle's end plate c33; its notes badge nothing.
    expect(badgesOf(fromCheck(cart), cart)).toEqual([
      { ids: ["b18", "b9"], severity: "warn" },
      { ids: ["b18", "b10"], severity: "warn" },
      { ids: ["b32", "b31"], severity: "warn" },
    ]);
  });
});
