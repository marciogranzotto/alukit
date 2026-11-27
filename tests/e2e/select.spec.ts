import { expect, type Page, test } from "@playwright/test";
import { cli, openTab, type Served, selectByIds, serve } from "./helpers.ts";

/**
 * Selecting (docs/ux/editing-audit.md E2.2, E2.3; owner E2): select all, similar, the same tag
 * and connected, from the menu and the keys; a click on an outline group's head selects its
 * members while the twisty still opens and closes it; a box drawn right to left takes what it
 * touches, left to right only what lies inside. And the selected bar's label, kept inside the view.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

interface DerivedBar {
  a: V3;
  b: V3;
  cut_mm: number;
}

async function derivedBars(dir: string): Promise<Record<string, DerivedBar>> {
  const r = await cli(["derive", dir, "--json"]);
  return (JSON.parse(r.out) as { bars: Record<string, DerivedBar> }).bars;
}

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is not on the screen`);
  return s;
}

async function atRest(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => window.__alukit?.camera()?.moving), { timeout: 10_000 })
    .toBe(false);
}

const middle = (b: DerivedBar): V3 => [
  (b.a[0] + b.b[0]) / 2,
  (b.a[1] + b.b[1]) / 2,
  (b.a[2] + b.b[2]) / 2,
];

test("the selected bar's label stays inside the view at its right edge", async ({ page }) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const b2 = (await derivedBars(served.dir)).b2 as DerivedBar;
  // Orthographic, so a right-drag pans every point by the same amount.
  await page.getByTestId("projection").click();
  await atRest(page);
  await selectByIds(page, ["b2"]);
  const vb = await page.getByTestId("viewport").boundingBox();
  if (!vb) throw new Error("no viewport");
  const edge = vb.x + vb.width;
  // Pan until b2's middle is 20 px from the view's right edge: a right-drag pans, by some gain
  // (camera-controls' truck speed), which the first drag measures; each drag stays in the view.
  let gain = 1;
  for (let i = 0; i < 6; i++) {
    const s = await screen(page, middle(b2));
    const want = edge - 20 - s[0];
    if (Math.abs(want) < 6) break;
    const drag = Math.max(-vb.width * 0.6, Math.min(vb.width * 0.6, want / gain));
    const from = vb.x + vb.width / 2 - drag / 2;
    const y = vb.y + vb.height / 2;
    await page.mouse.move(from, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(from + drag, y, { steps: 8 });
    await page.mouse.up({ button: "right" });
    await atRest(page);
    const moved = (await screen(page, middle(b2)))[0] - s[0];
    if (Math.abs(drag) > 2 && Math.abs(moved) > 2) gain = moved / drag;
  }
  const s = await screen(page, middle(b2));
  expect(s[0]).toBeGreaterThan(edge - 30);
  // A right-drag pans and opens no menu.
  await expect(page.getByTestId("context-menu")).toHaveCount(0);

  const label = page.getByTestId("selection-label");
  await expect(label).toContainText(`cut ${b2.cut_mm.toFixed(2)} mm`);
  const lb = await label.boundingBox();
  if (!lb) throw new Error("no label");
  expect(lb.x + lb.width).toBeLessThanOrEqual(edge);
  expect(lb.x).toBeGreaterThanOrEqual(vb.x);
});
