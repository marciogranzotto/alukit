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

  // Place: a foot from the catalog on the front base rail's top face, 300 from its end a. The
  // click places it, as one step (D-UX-16).
  await page.getByTestId("left-catalog").click();
  await page.getByTestId("catalog-search").fill("FOOT");
  await page.locator('.card[data-id="test:FOOT-M8"]').click();
  await page.getByTestId("palette-set").click();
  await expect(page.getByTestId("tool-place")).toHaveClass(/on/);
  // A face is said with the way it looks in the world (review m9).
  await click(page, [300, 20, 120], /^b9 (\+y face \(world \+Z\)|groove \+y\.1) at 300$/);
  await waitDrawn(page, 1);
  expect(await derivedParts(served.dir)).toMatchObject({
    p1: { item: "test:FOOT-M8", bar: "b9", s_mm: 300 },
  });

  // Pattern: the foot, selected in the tree, every 200 along b9, three in all.
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

test("the joint preview says what auto-connect will cut before the click; Tab flips it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // A post b1, 800 up from the origin, in the CLI; then a rail drawn onto its top.
  served = await serve("base-frame/empty");
  const post = { cmd: "addBar", args: { a: [0, 0, 0], b: [0, 0, 800] } };
  expect((await cli(["do", served.dir, JSON.stringify(post)])).code).toBe(0);
  await openTab(page, served, 1);
  // The post in view, clear of the command bar at the canvas foot: zoom out over it.
  const vb = await page.getByTestId("viewport").boundingBox();
  if (!vb) throw new Error("no viewport");
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(async () => page.evaluate(() => window.__alukit?.camera()?.moving), { timeout: 10_000 })
    .toBe(false);
  await page.getByTestId("tool-draw").click();
  const tool = () => page.evaluate(() => window.__alukit?.tool());
  // The rail starts in the air, at a point typed from the keyboard.
  await page.keyboard.press("[");
  await page.keyboard.type("-600, 0, 800]");
  await page.keyboard.press("Enter");
  expect((await tool())?.start).toBe("typed [-600, 0, 800]");
  const [x, y] = await screen(page, [0, 0, 800]);
  await page.mouse.move(x, y, { steps: 4 });
  await expect.poll(async () => (await tool())?.snap ?? "").toBe("end b1.b");
  // The project's rule: the upright runs through, 20 past the corner; the rail butts on it and
  // stops 20 short.
  await expect
    .poll(async () => (await tool())?.joint ?? "", { timeout: 5000 })
    .toMatch(/^will butt on b1 · cut 580 · b1 800 → 820$/);
  await expect(page.getByTestId("joint-preview")).toContainText("Tab: flip");
  // Tab: the rail runs through, and the post loses half a profile instead.
  await page.keyboard.press("Tab");
  await expect
    .poll(async () => (await tool())?.joint ?? "", { timeout: 5000 })
    .toMatch(/^b1 will butt on it · cut 620 · b1 800 → 780$/);
  expect((await tool())?.prefer).toBeUndefined();
  await page.mouse.click(x, y);
  await waitDrawn(page, 2);
  // The cut lengths the preview gave are the ones derive gives.
  const d = JSON.parse((await cli(["derive", served.dir, "--json"])).out) as {
    bars: Record<string, { cut_mm: number }>;
  };
  expect([d.bars.b1?.cut_mm, d.bars.b2?.cut_mm]).toEqual([780, 620]);
  // What the step came to, in the command bar.
  await expect(page.getByTestId("tool-result")).toContainText("b2");
});
