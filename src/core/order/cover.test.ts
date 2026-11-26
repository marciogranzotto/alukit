import { describe, expect, it } from "vitest";
import { type CoverOffer, cheapestCover } from "./cover.ts";

/** Every cover of `need` by brute force: each count from 0 to ceil(need / size). */
function bruteForce(need: number, offers: CoverOffer[]) {
  const list = [...offers].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  let best: { counts: number[]; cost: number; surplus: number; lines: number } | undefined;
  const counts = list.map(() => 0);
  const visit = (i: number) => {
    if (i === list.length) {
      const total = list.reduce((s, o, j) => s + (counts[j] as number) * o.size, 0);
      if (total < need) return;
      const c = {
        counts: [...counts],
        cost: list.reduce((s, o, j) => s + (counts[j] as number) * o.cost, 0),
        surplus: total - need,
        lines: counts.filter((n) => n > 0).length,
      };
      const better =
        !best ||
        c.cost < best.cost ||
        (c.cost === best.cost &&
          (c.surplus < best.surplus ||
            (c.surplus === best.surplus &&
              (c.lines < best.lines ||
                (c.lines === best.lines &&
                  // Rule 4: more of the earlier SKU first.
                  (() => {
                    for (let j = 0; j < c.counts.length; j++) {
                      const d = (c.counts[j] as number) - (best?.counts[j] as number);
                      if (d !== 0) return d > 0;
                    }
                    return false;
                  })())))));
      if (better) best = c;
      return;
    }
    const o = list[i] as CoverOffer;
    for (let n = 0; n <= Math.ceil(need / o.size); n++) {
      counts[i] = n;
      visit(i + 1);
    }
    counts[i] = 0;
  };
  visit(0);
  return best;
}

const screws = (sale = false): CoverOffer[] => [
  { sku: "SCR-M8x16-10", size: 10, cost: 650 },
  { sku: "SCR-M8x16-50", size: 50, cost: sale ? 2300 : 2700 },
];

describe("the cheapest cover (design §5.4)", () => {
  it("37 screws in packs of 10 and 50 pick the cheapest pack cover: 4 × 10", () => {
    // 4 × 6.50 = 26.00 against 1 × 27.00.
    const c = cheapestCover(37, screws());
    expect(c?.lines.map((l) => [l.offer.sku, l.count])).toEqual([["SCR-M8x16-10", 4]]);
    expect([c?.cost, c?.surplus]).toEqual([2600, 3]);
  });

  it("37 screws on the sale price pick 1 × 50, now the cheaper", () => {
    // 1 × 23.00 against 4 × 6.50 = 26.00.
    const c = cheapestCover(37, screws(true));
    expect(c?.lines.map((l) => [l.offer.sku, l.count])).toEqual([["SCR-M8x16-50", 1]]);
    expect([c?.cost, c?.surplus]).toEqual([2300, 13]);
  });

  it("mixes pack sizes when that is cheapest", () => {
    // 57 screws: 1 × 50 + 1 × 10 = 33.50, against 6 × 10 = 39.00 or 2 × 50 = 54.00.
    const c = cheapestCover(57, screws());
    expect(c?.lines.map((l) => [l.offer.sku, l.count])).toEqual([
      ["SCR-M8x16-10", 1],
      ["SCR-M8x16-50", 1],
    ]);
    expect([c?.cost, c?.surplus]).toEqual([3350, 3]);
  });

  it("breaks a cost tie by less surplus, then fewer lines, then SKU order", () => {
    // Same cost: 2 × 5 (surplus 2) or 1 × 8 (surplus 0): less surplus wins.
    expect(
      cheapestCover(8, [
        { sku: "a5", size: 5, cost: 100 },
        { sku: "b8", size: 8, cost: 200 },
      ])?.lines.map((l) => [l.offer.sku, l.count]),
    ).toEqual([["b8", 1]]);
    // Same cost and surplus everywhere: mixes such as 4 × 1 + 1 × 2 lose to one line, and of
    // 6 × a1 and 3 × b2, SKU order takes a1.
    expect(
      cheapestCover(6, [
        { sku: "a1", size: 1, cost: 10 },
        { sku: "b2", size: 2, cost: 20 },
      ])?.lines.map((l) => [l.offer.sku, l.count]),
    ).toEqual([["a1", 6]]);
    // Two identical packs from two SKUs: the first in SKU order.
    expect(
      cheapestCover(20, [
        { sku: "z10", size: 10, cost: 500 },
        { sku: "y10", size: 10, cost: 500 },
      ])?.lines.map((l) => [l.offer.sku, l.count]),
    ).toEqual([["y10", 2]]);
  });

  it("equals a brute-force search on every small case", () => {
    const sets: CoverOffer[][] = [
      screws(),
      screws(true),
      [
        { sku: "p1", size: 1, cost: 70 },
        { sku: "p6", size: 6, cost: 390 },
        { sku: "p25", size: 25, cost: 1500 },
      ],
      [
        { sku: "a", size: 3, cost: 300 },
        { sku: "b", size: 4, cost: 400 },
        { sku: "c", size: 7, cost: 690 },
      ],
      [
        { sku: "free", size: 2, cost: 0 },
        { sku: "paid", size: 5, cost: 10 },
      ],
    ];
    for (const offers of sets) {
      for (let need = 1; need <= 60; need++) {
        const c = cheapestCover(need, offers);
        const b = bruteForce(need, offers);
        const sorted = [...offers].sort((x, y) => (x.sku < y.sku ? -1 : x.sku > y.sku ? 1 : 0));
        const counts = sorted.map((o) => c?.lines.find((l) => l.offer.sku === o.sku)?.count ?? 0);
        expect([counts, c?.cost, c?.surplus], `${need} of ${JSON.stringify(offers)}`).toEqual([
          b?.counts,
          b?.cost,
          b?.surplus,
        ]);
      }
    }
  });

  it("is bounded by the quantity: ten thousand units in well under a second", () => {
    const t = performance.now();
    const c = cheapestCover(10_000, screws());
    expect(c?.lines.map((l) => [l.offer.sku, l.count])).toEqual([["SCR-M8x16-50", 200]]);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it("has no cover without offers, and refuses a bad need or pack", () => {
    expect(cheapestCover(3, [])).toBeUndefined();
    expect(() => cheapestCover(0, screws())).toThrow(RangeError);
    expect(() => cheapestCover(3, [{ sku: "x", size: 0, cost: 1 }])).toThrow(RangeError);
  });
});
