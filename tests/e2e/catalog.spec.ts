import { expect, test } from "@playwright/test";
import { openTab, type Served, serve } from "./helpers.ts";

/**
 * The catalog browser (design §8): it lists the project's own items (§4.8), read only, with
 * their card.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

test("the catalog browser lists the project's own items, read only", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTab(page, served, 0);
  await page.getByTestId("left-catalog").click();
  await page.getByTestId("catalog-search").fill("motor plate");
  await page.locator('.card[data-id="project:plate-a"]').click();
  const card = page.getByTestId("catalog-card");
  await expect(card).toHaveAttribute("data-id", "project:plate-a");
  await expect(card).toContainText("the project's own, read only");
  await expect(card).toContainText("test:s235");
  expect(errors).toEqual([]);
});
