import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The phase-4 review's behaviour fixes (docs/ux/review-phase4.md; docs/ux/polish-decisions.md):
 * a length typed with no way to go says so (M2), the command bar is a row under the view, one row
 * high at 1280 px, and Fit frames into the view above it (M5), and the box frame's typed values
 * fill its panel as they are typed, its options the panel's alone (M6). On the cart's empty base
 * frame, whose default bar is test:TS40.
 */

type V3 = [number, number, number];

let served: Served;
test.beforeEach(async () => {
  served = await serve("base-frame/empty");
});
test.afterEach(async () => {
  await served.stop();
});

async function bars(): Promise<string[]> {
  const doc = JSON.parse(await readFile(join(served.dir, "alukit.json"), "utf8")) as {
    bars?: Record<string, unknown>;
  };
  return Object.keys(doc.bars ?? {});
}

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const at = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!at) throw new Error(`${p} is not on the screen`);
  return at;
}

/** Moves the mouse onto a world point and waits until the tool's snap says what is there. */
async function hover(page: Page, p: V3, says: string | RegExp): Promise<[number, number]> {
  const at = await screen(page, p);
  await page.mouse.move(at[0], at[1], { steps: 4 });
  await expect
    .poll(async () => (await page.evaluate(() => window.__alukit?.tool()))?.snap ?? "")
    .toMatch(says);
  return at;
}

async function closeCard(page: Page): Promise<void> {
  await openTab(page, served, 0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("start-card")).toBeHidden();
}

test("a length typed with no way to go says which way, and makes nothing (M2)", async ({
  page,
}) => {
  await closeCard(page);
  await page.keyboard.press("b");
  const at = await hover(page, [0, 0, 0], "grid (0, 0, 0)");
  await page.mouse.click(at[0], at[1]);
  // The pointer has not left the start, and no axis is locked: the prompt asks for a way first.
  await page.keyboard.type("500");
  await expect(page.getByTestId("command-result")).toContainText("point the way");
  await page.keyboard.press("Enter");
  const result = page.getByTestId("tool-result");
  await expect(result).toHaveAttribute("data-error", "true");
  await expect(result).toContainText("Which way? Move the pointer, or press → ← ↑");
  expect(await bars()).toEqual([]);
  // Pointed up, the same length makes the bar.
  await hover(page, [0, 0, 250], /^\+z /);
  await page.keyboard.type("500");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect(await bars()).toEqual(["b1"]);
});

test("the command bar is a row under the view, one row high at 1280 px, and Fit frames above it (M5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await closeCard(page);
  const view = page.getByTestId("viewport");
  const help = page.getByTestId("viewport-help");
  const before = await view.boundingBox();
  const helpBox = await help.boundingBox();
  if (!before || !helpBox) throw new Error("no view or help row");
  expect(helpBox.y).toBeGreaterThanOrEqual(before.y + before.height - 1);

  await page.keyboard.press("b");
  const bar = page.getByTestId("command-bar");
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  const after = await view.boundingBox();
  if (!box || !after) throw new Error("no command bar or view");
  // Under the view, not over it; the view keeps its height when the tool turns on.
  expect(box.y).toBeGreaterThanOrEqual(after.y + after.height - 1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2);
  // One row: Plane, Join ends and Corners are in Options.
  expect(box.height).toBeLessThanOrEqual(44);
  await expect(page.getByTestId("draw-autoconnect")).toBeHidden();
  await page.getByTestId("draw-options").click();
  await expect(page.getByTestId("draw-autoconnect")).toBeVisible();
  // A press anywhere else closes them.
  await page.mouse.click(after.x + after.width / 2, after.y + after.height / 2);
  await expect(page.getByTestId("draw-autoconnect")).toBeHidden();

  // A post drawn, then Fit: its top projects inside the view, never under the bar.
  const at = await hover(page, [0, 0, 0], "grid (0, 0, 0)");
  await page.mouse.click(at[0], at[1]);
  await hover(page, [0, 0, 250], /^\+z /);
  await page.keyboard.type("800");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  await page.keyboard.press("f");
  await page.waitForTimeout(400);
  for (const p of [
    [0, 0, 0],
    [0, 0, 800],
  ] as V3[]) {
    const [x, y] = await screen(page, p);
    expect(x).toBeGreaterThanOrEqual(after.x);
    expect(x).toBeLessThanOrEqual(after.x + after.width);
    expect(y).toBeGreaterThanOrEqual(after.y);
    expect(y).toBeLessThanOrEqual(after.y + after.height);
  }
});

test("the box frame's typed values fill its panel as they are typed, its options the panel's alone (M6)", async ({
  page,
}) => {
  await closeCard(page);
  await page.keyboard.press("g");
  const panel = page.getByTestId("panel-frame");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("command-bar").locator("select, input[type=checkbox]")).toHaveCount(
    0,
  );
  await panel.getByTestId("frame-joint").selectOption("-");
  const at = await hover(page, [0, 0, 0], "grid (0, 0, 0)");
  await page.mouse.click(at[0], at[1]);
  // Typed, not yet entered: the panel's W and D follow.
  await page.keyboard.type("1000,600");
  await expect(panel.getByTestId("frame-w")).toHaveValue("1000");
  await expect(panel.getByTestId("frame-d")).toHaveValue("600");
  await page.keyboard.press("Enter");
  // The height, typed: H and the dry run's cut lengths follow before Enter.
  await page.keyboard.type("800");
  await expect(panel.getByTestId("frame-h")).toHaveValue("800");
  await expect(panel.getByTestId("frame-numbers")).toContainText("posts 4 × 800");
  // Its own steps, not Draw's (review M4).
  await expect(page.getByTestId("coach")).toHaveAttribute("data-coach", "frame");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect(await bars()).toHaveLength(12);
});
