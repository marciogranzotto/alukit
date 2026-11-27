import { expect, type Page, test } from "@playwright/test";
import { openTab, type Served, serve } from "./helpers.ts";

/**
 * Navigation (docs/ux/editing-audit.md E-UX-17, E2.6; owner E2): a preference, Mouse (the default)
 * or Trackpad, in the help. With Mouse the wheel dollies; with Trackpad a two-finger scroll (a
 * wheel without Ctrl) pans. A pinch, which the browser sends as a wheel with Ctrl, zooms in both:
 * in perspective it moves the camera closer, as the wheel does, so fitting and the gizmo's size
 * stay true. The choice is kept per browser.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function camera(page: Page): Promise<{ target: V3; distance: number }> {
  await expect
    .poll(async () => page.evaluate(() => window.__alukit?.camera()?.moving), { timeout: 10_000 })
    .toBe(false);
  const c = await page.evaluate(() => window.__alukit?.camera());
  if (!c) throw new Error("no camera");
  const d = [0, 1, 2].map((i) => (c.position[i] as number) - (c.target[i] as number));
  return { target: c.target as V3, distance: Math.hypot(...d) };
}

const moved = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("Mouse: the wheel dollies; Trackpad: two fingers pan; a pinch zooms in both", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const vb = await page.getByTestId("viewport").boundingBox();
  if (!vb) throw new Error("no viewport");
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);

  // Mouse, the default: the wheel moves the camera along its view; the target stays.
  let a = await camera(page);
  await page.mouse.wheel(0, 300);
  let b = await camera(page);
  expect(moved(a.target, b.target)).toBeLessThan(1);
  expect(b.distance).toBeGreaterThan(a.distance * 1.05);
  // A pinch (Ctrl + wheel): closer, the target where it was.
  a = b;
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  b = await camera(page);
  expect(moved(a.target, b.target)).toBeLessThan(1);
  expect(b.distance).toBeLessThan(a.distance * 0.95);

  // Trackpad, chosen in the help: the same wheel pans, the distance as it was.
  await page.locator("body").press("?");
  await page.getByTestId("nav-trackpad").check();
  await page.keyboard.press("Escape");
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  a = await camera(page);
  await page.mouse.wheel(120, 200);
  b = await camera(page);
  expect(moved(a.target, b.target)).toBeGreaterThan(10);
  expect(Math.abs(b.distance - a.distance)).toBeLessThan(a.distance * 0.01);
  // A pinch still zooms.
  a = b;
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  b = await camera(page);
  expect(moved(a.target, b.target)).toBeLessThan(1);
  expect(b.distance).toBeLessThan(a.distance * 0.95);

  // Kept for the browser: a new tab starts in Trackpad.
  await openTab(page, served, 0);
  await page.locator("body").press("?");
  await expect(page.getByTestId("nav-trackpad")).toBeChecked();
});
