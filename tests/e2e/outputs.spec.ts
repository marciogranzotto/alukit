import { expect, test } from "@playwright/test";
import { holeSize, partLines } from "../../src/core/machining/format.ts";
import type { MachiningSheet } from "../../src/core/machining/machining.ts";
import { money } from "../../src/core/order/format.ts";
import { cli, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The drawer's Machining, Order and Costs tabs (design §8), fed by the server: they show what
 * `alukit machining`, `alukit order` and `alukit costs` print (the last two for the same date), a
 * reason's or a part's entities select in the scene, and an edit from the CLI reaches them live.
 */

const AS_OF = "2026-11-26";

interface MoneyOut {
  low_minor: number;
  likely_minor: number;
  high_minor: number;
}

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

test("the order tab shows each supplier's status, reasons and total, as alukit order does", async ({
  page,
}) => {
  await openTab(page, served, 0);
  await page.getByRole("tab", { name: "Order" }).click();
  const order = page.getByTestId("order");
  await order.getByTestId("as-of").fill(AS_OF);
  await expect(order.getByTestId("as-of")).toHaveValue(AS_OF);

  const printed = await cli(["order", served.dir, "--format", "json", "--as-of", AS_OF]);
  const o = JSON.parse(printed.out) as {
    status: string;
    lock: string;
    suppliers: {
      supplier: string | null;
      status: string;
      reasons: { rule: string }[];
      totals: MoneyOut;
    }[];
  };
  await expect(order.locator(".status").first()).toHaveText(o.status);
  await expect(order).toContainText(o.lock.slice(0, 19));
  expect(o.suppliers.length).toBeGreaterThan(1);
  for (const s of o.suppliers) {
    const section = order.locator(`section[data-supplier="${s.supplier ?? ""}"]`);
    await expect(section.locator("h4 .status")).toHaveText(s.status);
    await expect(section.locator("h4")).toContainText(money(s.totals.likely_minor));
    await expect(section.locator(".diagnostics li")).toHaveCount(s.reasons.length);
  }

  // The open item that holds a supplier names its connection: the link selects it.
  const held = order.locator('section[data-supplier="test-gen-vendor"]');
  await expect(held).toContainText("open-item");
  await held.getByRole("button", { name: "c35" }).click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText("c35");
});

test("the costs tab shows the totals of alukit costs, and follows a CLI edit live", async ({
  page,
}) => {
  await openTab(page, served, 0);
  await page.getByRole("tab", { name: "Costs" }).click();
  const costs = page.getByTestId("costs");
  await costs.getByTestId("as-of").fill(AS_OF);

  const printed = await cli(["costs", served.dir, "--format", "json", "--as-of", AS_OF]);
  const c = JSON.parse(printed.out) as { costs: { id: string }[]; totals: { total: MoneyOut } };
  const total = costs.getByTestId("totals").locator("tr.total");
  await expect(total).toContainText(money(c.totals.total.likely_minor));
  await expect(total).toContainText(money(c.totals.total.low_minor));
  await expect(total).toContainText(money(c.totals.total.high_minor));
  const lines = costs.getByTestId("cost-lines");
  for (const x of c.costs) await expect(lines).toContainText(x.id);
  await expect(lines).not.toContainText("touch-up paint");

  // A cost line added from the CLI goes through the server; the tab shows the next revision.
  const added = await cli([
    "do",
    served.dir,
    JSON.stringify({
      cmd: "addCost",
      args: {
        cost: {
          label: "touch-up paint",
          kind: "other",
          low_minor: 10000,
          likely_minor: 10000,
          high_minor: 10000,
        },
      },
    }),
  ]);
  expect(added.code).toBe(0);
  await waitDrawn(page, 1);
  await expect(costs).toHaveAttribute("data-rev", "1");
  await expect(lines).toContainText("touch-up paint");
  const after = await cli(["costs", served.dir, "--format", "json", "--as-of", AS_OF]);
  const t = (JSON.parse(after.out) as { totals: { total: MoneyOut } }).totals.total;
  expect(t.likely_minor).toBeGreaterThan(c.totals.total.likely_minor);
  await expect(total).toContainText(money(t.likely_minor));
});

test("the machining tab shows alukit machining's sheet, and follows a CLI edit live", async ({
  page,
}) => {
  await openTab(page, served, 0);
  const tabs = page.getByRole("tab");
  await expect(tabs.nth(0)).toHaveText("Cut list");
  await expect(tabs.nth(1)).toHaveText("Machining");
  await page.getByRole("tab", { name: "Machining" }).click();
  const tab = page.getByTestId("machining");
  await expect(tab).toHaveAttribute("data-rev", "0");

  // Each custom part in the sheet's words, every hole from its datum, as the CLI prints them.
  const printed = await cli(["machining", served.dir, "--format", "json"]);
  const sheet = JSON.parse(printed.out) as MachiningSheet;
  expect(sheet.parts.map((p) => p.item)).toEqual(["project:angle-a", "project:plate-a"]);
  for (const p of sheet.parts) {
    const section = tab.locator(`section[data-item="${p.item}"]`);
    for (const line of partLines(p)) await expect(section).toContainText(line);
    await expect(section.locator("tbody tr")).toHaveCount(p.holes.length);
    for (const h of p.holes) {
      await expect(section.locator(`tr[data-hole="${h.id}"]`)).toContainText(holeSize(h));
    }
  }
  // The bars' machining is cross-referenced, not repeated.
  expect(sheet.bars.length).toBeGreaterThan(0);
  await expect(tab.locator("section").last().locator("tbody tr")).toHaveCount(sheet.bars.length);

  // A part's entity selects in the scene.
  const plate = tab.locator('section[data-item="project:plate-a"]');
  await plate.getByRole("button", { name: "p6" }).click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText("p6");

  // The plate made 10 mm thick from the CLI: the tab shows the next revision's sheet.
  await expect(plate).toContainText("Plate, 8.00 mm");
  const edited = await cli([
    "do",
    served.dir,
    JSON.stringify({ cmd: "setItem", args: { id: "project:plate-a", set: { thickness_mm: 10 } } }),
  ]);
  expect(edited.code).toBe(0);
  await waitDrawn(page, 1);
  await expect(tab).toHaveAttribute("data-rev", "1");
  await expect(plate).toContainText("Plate, 10.00 mm");
});
