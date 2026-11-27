import { expect, type Page, test } from "@playwright/test";
import { cli, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The other tools of M4b (design §8): place part on a face, pattern the selection along a bar,
 * measure between snap points, on the CLI-built base frame, each edit one revision, checked
 * with the CLI; and the tools' snap points on the project's own items (§4.8), on the cart.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is not on the screen`);
  return s;
}

async function click(page: Page, p: V3, says: RegExp): Promise<void> {
  const [x, y] = await screen(page, p);
  await page.mouse.move(x, y, { steps: 4 });
  await expect
    .poll(async () => (await page.evaluate(() => window.__alukit?.tool()))?.hint ?? "", {
      timeout: 2000,
    })
    .toMatch(says);
  await page.mouse.click(x, y);
}

async function derivedParts(dir: string): Promise<Record<string, { item: string; bar?: string }>> {
  const r = await cli(["derive", dir, "--json"]);
  return (JSON.parse(r.out) as { parts: Record<string, { item: string; bar?: string }> }).parts;
}

test("places a part on a face, patterns it along a bar, and measures", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serve("base-frame/cli");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTab(page, served, 0);

  // Place: a foot from the catalog on the front base rail's top face, 300 from its end a.
  await page.getByTestId("left-catalog").click();
  await page.getByTestId("catalog-search").fill("FOOT");
  await page.locator('.card[data-id="test:FOOT-M8"]').click();
  await page.getByTestId("palette-set").click();
  await expect(page.getByTestId("tool-place")).toHaveClass(/on/);
  await click(page, [300, 20, 120], /^b9 (\+y face|groove \+y\.1) at 300$/);
  await page.getByTestId("place-apply").click();
  await waitDrawn(page, 1);
  expect(await derivedParts(served.dir)).toMatchObject({ p1: { item: "test:FOOT-M8", bar: "b9" } });

  // Pattern: the foot, selected in the tree, every 200 along b9, three in all.
  await page.getByTestId("left-project").click();
  await page.getByTestId("tree").locator('[data-id="p1"]').click();
  await page.getByTestId("tool-pattern").click();
  await expect(page.getByTestId("pattern-template")).toHaveText("p1");
  await click(page, [600, 20, 120], /^along b9$/);
  await expect(page.getByTestId("pattern-along")).toHaveValue("b9");
  await page.getByTestId("pattern-pitch").fill("200");
  await page.getByTestId("pattern-count").fill("3");
  await page.getByTestId("pattern-apply").click();
  await waitDrawn(page, 2);
  const parts = await derivedParts(served.dir);
  expect(Object.keys(parts).sort()).toEqual(["p1", "p1@1", "p1@2"]);

  // Measure: a post from end to end.
  await page.getByTestId("tool-measure").click();
  await click(page, [0, 0, 0], /^end b1\.a$/);
  await click(page, [0, 0, 900], /^end b1\.b$/);
  await expect(page.getByTestId("measure-result")).toContainText("900.00 mm");
  expect(errors).toEqual([]);
});

test("the tools snap to the project's own items: a placeholder's face centre and origin", async ({
  page,
}) => {
  served = await serve("cart");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTab(page, served, 0);
  const clickOn = async (p: [number, number, number], says: RegExp) => {
    const at = await page.evaluate((q) => window.__alukit?.screen(q), p);
    if (!at) throw new Error(`${p} is not on the screen`);
    await page.mouse.move(at[0], at[1], { steps: 4 });
    await expect
      .poll(async () => (await page.evaluate(() => window.__alukit?.tool()))?.hint ?? "", {
        timeout: 2000,
      })
      .toMatch(says);
    await page.mouse.click(at[0], at[1]);
  };
  // Measure the gear motor p8 (a placeholder at a world pose, box 120 x 90 x 110 from its
  // origin): from its top face's centre down to its origin.
  await page.getByTestId("tool-measure").click();
  await clickOn([900, 580, 238], /^p8 \+z face centre$/);
  await clickOn([900, 580, 128], /^p8 origin$/);
  await expect(page.getByTestId("measure-result")).toContainText("110.00 mm");
  expect(errors).toEqual([]);
});
