import { expect, type Page, test } from "@playwright/test";
import { cli, derivedBarCount, openTab, type Served, serve } from "./helpers.ts";
import { decodePng } from "./png.ts";

/**
 * The 3D view (design §8): the cart fixture draws every bar and every placed part the derived
 * model has, the project's own plate, bent angle and placeholder among them (§4.8); the camera
 * looks from the standard views, orthographic or not, and fits to the selection; and the section
 * plane cuts the view along an axis and changes nothing else.
 */

type V3 = [number, number, number];

interface DerivedParts {
  parts: Record<string, { item: string; kind: string; unplaced?: boolean }>;
}

interface Sheet {
  parts: { item: string; holes: unknown[] }[];
}

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is not on the screen`);
  return s;
}

async function viewportPng(page: Page) {
  await page.mouse.move(0, 0);
  return decodePng(await page.getByTestId("viewport").locator("canvas").screenshot());
}

function differing(a: ReturnType<typeof decodePng>, b: ReturnType<typeof decodePng>): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2]
    )
      n++;
  }
  return n;
}

test("the cart draws its bars: a non-blank canvas, one body per derived bar", async ({ page }) => {
  served = await serve("cart");
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

  // One body per placed part: the three carriages, and M6's p6 (a plate), p7 (a bent angle) and
  // p8 (a placeholder), each drawn as what it is, with the plate's and the angle's holes marked.
  const d = JSON.parse((await cli(["derive", served.dir, "--json"])).out) as DerivedParts;
  const placed = Object.entries(d.parts).filter(([, p]) => !p.unplaced);
  expect(placed.map(([id]) => id)).toEqual(["p1", "p1@1", "p1@2", "p6", "p7", "p8"]);
  expect(stats?.parts).toBe(placed.length);
  const ofKind = (k: string) => placed.filter(([, p]) => p.kind === k).length;
  expect([stats?.plates, stats?.bentAngles, stats?.placeholders]).toEqual([
    ofKind("plate"),
    ofKind("bent-angle"),
    ofKind("placeholder"),
  ]);
  expect([ofKind("plate"), ofKind("bent-angle"), ofKind("placeholder")]).toEqual([1, 1, 1]);
  const sheet = JSON.parse((await cli(["machining", served.dir, "--format", "json"])).out) as Sheet;
  const holesOf = new Map(sheet.parts.map((p) => [p.item, p.holes.length]));
  const holes = placed.reduce((n, [, p]) => n + (holesOf.get(p.item) ?? 0), 0);
  expect(holes).toBe(6);
  expect(stats?.holes).toBe(holes);
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

test("looks from standard views, orthographic or not, and fits to the selection", async ({
  page,
}) => {
  served = await serve("base-frame/cli");
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

test("the section plane cuts the view along an axis, and nothing else", async ({ page }) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const whole = await viewportPng(page);

  // b2 stands at x 1200 to 1240, y −40 to 0 (anchored +x−y): a click on it picks it.
  const [x, y] = (await page.evaluate(() => window.__alukit?.screen([1220, -20, 450]))) as [
    number,
    number,
  ];
  await page.mouse.click(x, y);
  await expect(page.getByTestId("properties").locator("h2")).toContainText("b2");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("properties")).toHaveCount(0);

  await page.getByTestId("section").click();
  await expect(page.getByTestId("section-tools")).toBeVisible();
  const on = await page.evaluate(() => window.__alukit?.section());
  expect(on).toMatchObject({ axis: "x", flip: false });

  // Drag the plane along X to 300 mm: the right-hand post is cut away, the left one stays.
  await page.getByTestId("section-at").fill("300");
  await expect.poll(() => page.evaluate(() => window.__alukit?.section()?.at_mm)).toBe(300);
  expect(await page.evaluate(() => window.__alukit?.clipped([1200, 0, 450]))).toBe(true);
  expect(await page.evaluate(() => window.__alukit?.clipped([0, 0, 450]))).toBe(false);
  const cut = await viewportPng(page);
  expect(differing(whole, cut)).toBeGreaterThan(1000);

  // The same click now picks nothing: the post is cut away, and nothing drawn is behind it.
  await page.mouse.click(x, y);
  await expect(page.getByTestId("properties")).toHaveCount(0);

  await page.getByTestId("section-flip").click();
  expect(await page.evaluate(() => window.__alukit?.clipped([1200, 0, 450]))).toBe(false);
  await page.getByTestId("section-y").click();
  expect(await page.evaluate(() => window.__alukit?.section()?.axis)).toBe("y");

  // Off again: the same picture as before, and the document never changed.
  await page.getByTestId("section").click();
  await expect(page.getByTestId("section-tools")).toHaveCount(0);
  expect(differing(whole, await viewportPng(page))).toBe(0);
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
});
