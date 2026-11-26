import { expect, test } from "@playwright/test";
import { cli, derivedBarCount, openTab, type Served, serve } from "./helpers.ts";

/**
 * Rendering (design §8): the cart fixture draws every bar the derived model has, the canvas shows
 * them, and selection reaches the properties panel with its provenance popovers.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

test("the cart draws its bars: a non-blank canvas, one body per derived bar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTab(page, served, 0);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("connection")).toHaveText("live");

  const derived = await derivedBarCount(served.dir);
  expect(derived).toBe(39);
  const stats = await page.evaluate(() => window.__alukit?.stats());
  expect(stats?.bars).toBe(derived);
  // Square bars are instanced; the braces' angled ends get their own geometry.
  expect(stats?.instancedBars).toBeGreaterThan(0);
  expect(stats?.angledBars).toBeGreaterThan(0);
  expect(stats?.parts).toBe(3);
  expect(stats?.edgeSegments).toBeGreaterThan(stats?.bars as number);

  // Copy the WebGL canvas into a 2D one and count pixels that differ from the background.
  // (The renderer keeps its drawing buffer, so this is valid between frames.)
  const pixels = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const gl = document.querySelector("canvas") as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = gl.width;
    copy.height = gl.height;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(gl, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    const bg = [data[0], data[1], data[2]];
    const colours = new Set<number>();
    let differing = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      colours.add((r << 16) | (g << 8) | b);
      if (r !== bg[0] || g !== bg[1] || b !== bg[2]) differing++;
    }
    return { total: data.length / 4, differing, distinct: colours.size };
  });
  expect(pixels.total).toBeGreaterThan(0);
  expect(pixels.differing).toBeGreaterThan(pixels.total * 0.02);
  expect(pixels.distinct).toBeGreaterThan(20);
  expect(errors).toEqual([]);
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
  await expect(props.locator("h2")).toHaveText("42 selected");

  // Escape clears it; the drawer's tables are there.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Select a bar, part or connection")).toBeVisible();
  await expect(page.getByTestId("cutlist")).toContainText("test:TS40");
  await page.getByRole("tab", { name: "BOM" }).click();
  await expect(page.getByTestId("bom")).toContainText("Total mass");
  await page.getByRole("tab", { name: "Checks" }).click();
  await expect(page.getByTestId("checks")).toContainText("0 errors");
});
