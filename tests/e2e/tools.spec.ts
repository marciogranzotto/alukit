import { expect, type Page, test } from "@playwright/test";
import { cli, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The other tools of M4b (design §8): place part on a face, pattern the selection along a bar,
 * measure between snap points, and the camera's orthographic and standard views and fit to
 * selection, on the CLI-built base frame. Each edit is one revision, checked with the CLI.
 */

type V3 = [number, number, number];

let served: Served;
test.beforeEach(async () => {
  served = await serve("base-frame/cli");
});
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

test("looks from standard views, orthographic or not, and fits to the selection", async ({
  page,
}) => {
  await openTab(page, served, 0);
  const settle = async () => {
    let last = "";
    for (let i = 0; i < 100; i++) {
      const now = JSON.stringify(await screen(page, [0, 0, 0]));
      if (now === last) return;
      last = now;
      await page.waitForTimeout(120);
    }
  };
  // Top, orthographic: world X to the right, Y up the screen.
  await page.getByTestId("projection").click();
  await expect(page.getByTestId("projection")).toHaveText("Ortho");
  await page.getByTestId("view-top").click();
  await settle();
  const o = await screen(page, [0, 0, 0]);
  const x = await screen(page, [1200, 0, 0]);
  const y = await screen(page, [0, 600, 0]);
  const z = await screen(page, [0, 0, 900]);
  expect(x[0] - o[0]).toBeGreaterThan(100);
  expect(Math.abs(x[1] - o[1])).toBeLessThan(1);
  expect(o[1] - y[1]).toBeGreaterThan(50);
  // Orthographic, looking straight down: height does not move a point.
  expect(Math.hypot(z[0] - o[0], z[1] - o[1])).toBeLessThan(1);
  // The ratio of the frame's sides is kept: an orthographic projection.
  expect((x[0] - o[0]) / (o[1] - y[1])).toBeCloseTo(2, 2);

  // Front: X to the right, Z up.
  await page.getByTestId("view-front").click();
  await settle();
  const fo = await screen(page, [0, 0, 0]);
  const fz = await screen(page, [0, 0, 900]);
  expect(fo[1] - fz[1]).toBeGreaterThan(50);
  expect(Math.abs(fz[0] - fo[0])).toBeLessThan(1);

  // Fit to one base rail: it then spans most of the viewport's width.
  await page.getByTestId("tree").locator('[data-id="b9"]').click();
  const before = (await screen(page, [1200, 0, 100]))[0] - (await screen(page, [0, 0, 100]))[0];
  await page.getByTestId("fit").click();
  await settle();
  const after = (await screen(page, [1200, 0, 100]))[0] - (await screen(page, [0, 0, 100]))[0];
  const box = await page.getByTestId("viewport").boundingBox();
  expect(after).toBeGreaterThanOrEqual(before);
  expect(after).toBeGreaterThan((box?.width ?? 0) * 0.7);
});
