import { expect, test } from "@playwright/test";
import { openTab, type Served, serve } from "./helpers.ts";

/**
 * Show (docs/ux/plan.md S2.9; U11, U12): a problem's row shows what it is about: it is
 * selected, the camera frames it, its outline row is scrolled into view, and the status bar says
 * what is shown until Esc leaves it.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

test("Show on c35's problem selects c35, frames it, reveals its row; Esc leaves it", async ({
  page,
}) => {
  await openTab(page, served, 0);
  const row = page.getByTestId("tree").locator('[data-id="c35"]');
  // Before: the joints are far down the outline, out of its view.
  await expect(row).not.toBeInViewport();

  await page.getByRole("tab", { name: "Problems" }).click();
  const problem = page.getByTestId("problems").locator('li.problem[data-problem="fit/c35"]');
  await problem.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("properties").locator("h2")).toContainText("c35");
  await expect(row).toBeInViewport();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("showing")).toContainText("Esc to leave");

  // The camera's target lies in c35's box (the 3D view's hook, S3).
  const framed = await page.evaluate(() => {
    const h = window.__alukit as unknown as {
      camera?: () => { target: [number, number, number] };
      box?: (id: string) => { min: [number, number, number]; max: [number, number, number] };
    };
    if (!h.camera || !h.box) return undefined;
    const t = h.camera().target;
    const b = h.box("c35");
    return t.every((v, i) => v >= (b.min[i] as number) - 1 && v <= (b.max[i] as number) + 1);
  });
  if (framed === undefined) {
    test.info().annotations.push({
      type: "waits on S3",
      description: "the hook has no camera() and box() yet: the framing is not checked",
    });
  } else expect(framed).toBe(true);

  // Esc leaves Show; the selection stays until the next Esc.
  await page.locator("body").press("Escape");
  await expect(page.getByTestId("showing")).toHaveCount(0);
  await expect(page.getByTestId("properties").locator("h2")).toContainText("c35");
});
