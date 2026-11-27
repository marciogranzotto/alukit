import { expect, test } from "@playwright/test";
import { openTab, type Served, serve } from "./helpers.ts";

/**
 * The table system (docs/ux/plan.md S4.4): one grid for a whole sheet, rows that hover and select
 * the entities they are about in both directions, and the selection-only filter every sheet
 * honours.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

const chipRow = (page: import("@playwright/test").Page, id: string) =>
  page.locator("tr.cut-row", { has: page.getByRole("button", { name: id, exact: true }) });

test("the cut list's Cut length column has the same x in every group", async ({ page }) => {
  await openTab(page, served, 0);
  const sheet = page.getByTestId("cutlist");
  // Several groups, each with rows of its own.
  expect(await sheet.locator("tbody[data-group]").count()).toBeGreaterThan(2);
  const xs = await sheet
    .locator("tr.cut-row td:nth-child(2)")
    .evaluateAll((cells) => cells.map((c) => Math.round(c.getBoundingClientRect().left)));
  expect(xs.length).toBeGreaterThan(10);
  expect(new Set(xs).size).toBe(1);
  // The head is the column's own, at the same x.
  const head = await sheet
    .locator("thead th")
    .nth(1)
    .evaluate((c) => Math.round(c.getBoundingClientRect().left));
  expect(head).toBe(xs[0]);
});

test("hovering a row or a chip sets what the 3D view hovers, and leaving clears it", async ({
  page,
}) => {
  await openTab(page, served, 0);
  const hovered = () => page.evaluate(() => window.__alukit?.hovered());
  const row = chipRow(page, "b31");
  await row.locator("td").first().hover();
  expect(await hovered()).toEqual(["b31"]);
  await page.mouse.move(2, 2);
  expect(await hovered()).toBeUndefined();

  // A row about several entities hovers all of them; one of its chips only that one.
  const posts = chipRow(page, "b1");
  await posts.locator("td").first().hover();
  const ids = await posts.getByRole("button").allInnerTexts();
  expect(ids).toEqual(expect.arrayContaining(["b1", "b2", "b3", "b4"]));
  expect(await hovered()).toEqual(ids.filter((t) => /^b\d+$/.test(t)));
  await posts.getByRole("button", { name: "b2", exact: true }).hover();
  expect(await hovered()).toEqual(["b2"]);
});

test("clicking a row selects its entities and F frames them", async ({ page }) => {
  await openTab(page, served, 0);
  const props = page.getByTestId("properties");
  const posts = chipRow(page, "b1");
  await posts.locator("td").first().click();
  await expect(props.locator("h2")).toHaveText("4 selected");
  await expect(posts).toHaveClass(/selected/);
  await expect(posts.getByRole("button", { name: "b1", exact: true })).toHaveClass(/selected/);

  // One bar: its row, then F brings it to the middle of the view.
  const handle = chipRow(page, "b31");
  await handle.locator("td").first().click();
  await expect(props.locator("h2")).toContainText("b31");
  const box = await page.getByTestId("viewport").boundingBox();
  if (!box) throw new Error("no viewport");
  const mid = [1275, 20, 800] as [number, number, number]; // b31's middle, from alukit derive
  const away = async () => {
    const at = await page.evaluate((p) => window.__alukit?.screen(p), mid);
    if (!at) throw new Error("no screen point");
    return Math.hypot(at[0] - (box.x + box.width / 2), at[1] - (box.y + box.height / 2));
  };
  const before = await away();
  await page.keyboard.press("f");
  await expect.poll(away, { timeout: 8000 }).toBeLessThan(Math.min(before, 40));
});

test("a chip selects its entity, and the selection lights it", async ({ page }) => {
  await openTab(page, served, 0);
  const chip = chipRow(page, "b31").getByRole("button", { name: "b31", exact: true });
  await chip.click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText("b31");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(chipRow(page, "b31")).toHaveClass(/selected/);
});

test("selection only filters every sheet", async ({ page }) => {
  await openTab(page, served, 0);
  const rows = (testid: string) => page.getByTestId(testid).locator("tr.pick");
  const counts = async () => ({
    cutlist: await rows("cutlist").count(),
  });
  const all = await counts();
  expect(all.cutlist).toBeGreaterThan(10);

  // b20 is machined, sits on the BOM and the order, and has no problem of its own.
  await chipRow(page, "b20").getByRole("button", { name: "b20", exact: true }).click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText("b20");
  await page.getByTestId("cutlist").getByTestId("selection-only").check();
  await expect(rows("cutlist")).toHaveCount(1);
  await expect(rows("cutlist").first()).toContainText("b20");

  const sheets: [string, string][] = [
    ["BOM", "bom"],
    ["Machining", "machining"],
    ["Order & costs", "order"],
  ];
  for (const [tab, testid] of sheets) {
    await page.getByRole("tab", { name: tab }).click();
    const sheet = page.getByTestId(testid);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("selection-only")).toBeChecked();
    // Every row that is left is about the selection.
    const left = await sheet.locator("tr.pick").count();
    const lit = await sheet.locator("tr.pick.selected").count();
    expect(left, `${tab} keeps some row of b20`).toBeGreaterThan(0);
    expect(lit, `${tab}: every row left is selected`).toBe(left);
  }

  // The problems of other entities are gone; turning the filter off brings everything back.
  await page.getByRole("tab", { name: "Problems" }).click();
  await expect(page.getByTestId("problems").locator("li.problem")).toHaveCount(0);
  await page.getByTestId("problems").getByTestId("selection-only").uncheck();
  expect(await page.getByTestId("problems").locator("li.problem").count()).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Cut list" }).click();
  await expect(rows("cutlist")).toHaveCount(all.cutlist);
});
