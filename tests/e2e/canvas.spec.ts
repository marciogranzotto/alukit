import { expect, test } from "@playwright/test";

test("the built app draws a non-blank canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText("server: up")).toBeVisible();

  // Copy the WebGL canvas into a 2D one and count pixels that differ from the background.
  // (The renderer keeps its drawing buffer, so this is valid between frames.)
  const stats = await page.evaluate(async () => {
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

  expect(stats.total).toBeGreaterThan(0);
  expect(stats.differing).toBeGreaterThan(stats.total * 0.005);
  expect(stats.distinct).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});
