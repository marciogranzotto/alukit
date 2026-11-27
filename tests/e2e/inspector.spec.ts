import { expect, test } from "@playwright/test";
import { cli, openTab, type Served, serve } from "./helpers.ts";

/**
 * The inspector (design §8): selection from the tree and by a box reaches the properties panel,
 * with derived values and their provenance popovers; Escape clears it.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

test("selection: the tree and a box pick entities; properties show derived values and provenance", async ({
  page,
}) => {
  await openTab(page, served, 0);

  // From the tree: a post, its derived cut and its mass with where the mass per metre came from.
  await page.getByTestId("tree").locator('[data-id="b1"]').click();
  const props = page.getByTestId("properties");
  await expect(props.locator("h2")).toContainText("b1");
  const d = await cli(["derive", served.dir, "--json"]);
  const b1 = (JSON.parse(d.out) as { bars: Record<string, { cut_mm: number }> }).bars.b1;
  await expect(props.getByTestId("derived")).toContainText(`${b1?.cut_mm} mm`);
  await props.getByTestId("derived").getByRole("button", { name: /kg$/ }).click();
  await expect(props.getByTestId("provenance")).toContainText("estimated");
  await expect(props.getByTestId("provenance")).toContainText("1.493 kg/m");
  // The catalog item's numbers carry theirs too.
  await expect(props).toContainText("Catalog: test:TS40");

  // A part made from a project item shows the item as written and its computed mass.
  await page.getByTestId("tree").locator('[data-id="p6"]').click();
  await expect(props.locator("h2")).toContainText("p6");
  const item = props.getByTestId("project-item");
  await expect(item).toContainText("Project item: project:plate-a");
  await expect(item).toContainText("Motor plate");
  await item.getByRole("button", { name: /kg$/ }).click();
  await expect(props.getByTestId("provenance")).toContainText("computed");

  // A box over the whole viewport (Shift-drag) picks every body inside it.
  const box = await page.getByTestId("viewport").boundingBox();
  if (!box) throw new Error("no viewport");
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  // 39 bars and 6 parts: the carriages, and M6's plate, bent angle and placeholder.
  await expect(props.locator("h2")).toHaveText("45 selected");

  // Escape clears it; the drawer's tables are there.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Select a bar, part or connection")).toBeVisible();
  await expect(page.getByTestId("cutlist")).toContainText("test:TS40");
  await page.getByRole("tab", { name: "BOM" }).click();
  await expect(page.getByTestId("bom")).toContainText("Total mass");
  await page.getByRole("tab", { name: "Problems" }).click();
  await expect(page.getByTestId("problems")).toContainText("0 errors");
});
