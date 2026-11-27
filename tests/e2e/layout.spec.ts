import { expect, type Page, test } from "@playwright/test";
import { cli, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The app's layout (docs/ux/plan.md S2.1, S2.2, S2.5, S2.7, S2.13, S2.16): it fits with no
 * horizontal scroll; the tools are one row or column; the sheets collapse, split and maximize,
 * and keep their size; Tab reaches the tools through the skip link; the outline is one tree the
 * arrow keys walk; help lists the keys and turns single-key shortcuts off.
 */

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

const TOOLS = ["select", "draw", "connect", "place", "pattern", "measure"];

async function noHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    body: [document.body.scrollWidth, document.body.clientWidth],
  }));
  expect(widths.doc[0]).toBeLessThanOrEqual(widths.doc[1] as number);
  expect(widths.body[0]).toBeLessThanOrEqual(widths.body[1] as number);
}

test("fits at 1280 and 1440 with no horizontal scroll; the tools are one row or column", async ({
  page,
}) => {
  served = await serve("cart");
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await openTab(page, served, 0);
    await noHorizontalScroll(page);
    const boxes = await Promise.all(
      TOOLS.map(async (t) => page.getByTestId(`tool-${t}`).boundingBox()),
    );
    const ys = new Set(boxes.map((b) => Math.round(b?.y ?? -1)));
    const xs = new Set(boxes.map((b) => Math.round(b?.x ?? -1)));
    expect(ys.size === 1 || xs.size === 1, `the tools at ${width}: ${JSON.stringify(boxes)}`).toBe(
      true,
    );
    // The catalog, wide, fits too.
    await page.getByTestId("left-catalog").click();
    await expect(page.getByTestId("catalog")).toBeVisible();
    await noHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("catalog")).toBeHidden();
  }
});

test("the sheets collapse, split and maximize, and keep their size over a reload", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const sheets = page.getByTestId("sheets");
  await expect(sheets).toHaveAttribute("data-state", "split");

  // Collapse and open: the button, then the key.
  await page.getByTestId("sheets-toggle").click();
  await expect(sheets).toHaveAttribute("data-state", "collapsed");
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
  await page.locator("body").press("t");
  await expect(sheets).toHaveAttribute("data-state", "split");

  // Resize with the splitter's keys: three presses up, 48 px taller.
  const before = (await sheets.boundingBox())?.height ?? 0;
  const splitter = page.getByTestId("sheets-splitter");
  await splitter.focus();
  for (let i = 0; i < 3; i++) await splitter.press("ArrowUp");
  await expect.poll(async () => (await sheets.boundingBox())?.height).toBe(before + 48);

  // Maximized, the sheets cover the main area, and the canvas keeps its size under them.
  const canvas = await page.getByTestId("viewport").boundingBox();
  await page.getByTestId("sheets-max").click();
  await expect(sheets).toHaveAttribute("data-state", "max");
  const panel = await page.locator(".sheets-panel").boundingBox();
  expect(Math.round(panel?.y ?? 0)).toBeLessThanOrEqual(Math.round(canvas?.y ?? 0));
  expect(await page.getByTestId("viewport").boundingBox()).toEqual(canvas);
  await page.locator("body").press("Shift+T");
  await expect(sheets).toHaveAttribute("data-state", "split");

  // The size and the open state are the person's, kept per browser.
  await page.reload();
  await waitDrawn(page, 0);
  await expect(sheets).toHaveAttribute("data-state", "split");
  await expect.poll(async () => (await sheets.boundingBox())?.height).toBe(before + 48);
});

test("an empty project's sheets start collapsed and open once, on the cut list, on its first output", async ({
  page,
}) => {
  served = await serve("base-frame/empty");
  await openTab(page, served, 0);
  const sheets = page.getByTestId("sheets");
  await expect(sheets).toHaveAttribute("data-state", "collapsed");
  // The rail reads closed: every sheet's tab is there.
  await expect(page.getByRole("tab", { name: /Cut list/ })).toBeVisible();
  const r = await cli([
    "add",
    "bar",
    served.dir,
    "--a",
    "0,0,0",
    "--b",
    "0,0,900",
    "--item",
    "test:TS40",
  ]);
  expect(r.code, r.err).toBe(0);
  await waitDrawn(page, 1);
  await expect(sheets).toHaveAttribute("data-state", "split");
  await expect(page.getByRole("tab", { name: /Cut list/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("cutlist")).toContainText("900");
});

test("Tab reaches the tools in a few stops through the skip link; the columns resize", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  let stops = 0;
  await page.keyboard.press("Tab");
  stops++;
  await expect(page.getByTestId("skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  stops++;
  await expect(page.locator("#canvas")).toBeFocused();
  await page.keyboard.press("Tab");
  stops++;
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  expect(focused).toMatch(/^tool-/);
  expect(stops).toBeLessThanOrEqual(5);

  // The left column, wider by the splitter's keys, stays so over a reload.
  const left = page.locator("aside.left");
  const w = (await left.boundingBox())?.width ?? 0;
  await page.getByTestId("splitter-left").focus();
  await page.getByTestId("splitter-left").press("ArrowRight");
  await expect.poll(async () => (await left.boundingBox())?.width).toBe(w + 16);
  await page.reload();
  await waitDrawn(page, 0);
  await expect.poll(async () => (await left.boundingBox())?.width).toBe(w + 16);
});

test("the outline is one tree: rows in words, arrow keys to walk it, Enter to select", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const tree = page.getByRole("tree", { name: "Model outline" });
  // A row reads label · item name · cut length (U19).
  await expect(tree.locator('[data-id="b5"]')).toContainText("top rail, front");
  await expect(tree.locator('[data-id="b5"]')).toContainText("mm");
  // One stop for the whole tree: only one item takes Tab.
  expect(await tree.locator('[role="treeitem"][tabindex="0"]').count()).toBe(1);
  await tree.locator('[role="treeitem"][tabindex="0"]').focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("properties").locator("h2")).toContainText("b1");
  // Left on a row goes to its group; Left again closes it.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(tree.locator('[data-id="b1"]')).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(tree.locator('[data-id="b1"]')).toBeVisible();
});

test("help lists the keys; single-key shortcuts can be turned off and on", async ({ page }) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  await page.locator("body").press("?");
  const help = page.getByTestId("help");
  await expect(help).toBeVisible();
  // The tools' letters, the sheets' T, the catalog's /.
  for (const k of ["B", "T", "/"])
    await expect(help.locator("kbd", { hasText: k }).first()).toBeVisible();
  await help.getByTestId("letter-keys").uncheck();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();

  // Off: B picks no tool, and ? opens nothing; the help button still does.
  await page.locator("body").press("b");
  expect(await page.evaluate(() => window.__alukit?.tool().name)).toBe("select");
  await page.locator("body").press("?");
  await expect(help).toBeHidden();
  await page.getByTestId("help-open").click();
  await help.getByTestId("letter-keys").check();
  await page.keyboard.press("Escape");
  await page.locator("body").press("b");
  expect(await page.evaluate(() => window.__alukit?.tool().name)).toBe("draw");
});
