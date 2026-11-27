import { expect, type Page, test } from "@playwright/test";
import { cli, docOf, openTab, type Served, serve } from "./helpers.ts";

/**
 * Hide, isolate and show all (docs/ux/editing-audit.md E-UX-9, E2.4; owner E2): view state, like
 * the section plane, never a step. H hides the selection and a click there picks what lies
 * behind; Shift+H isolates it (hides the rest); Alt+H shows everything again; a strip says how
 * many are hidden, with Show all. No material is made or changed: the shader-link count stays
 * where the model's first frame left it.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function atRest(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => window.__alukit?.camera()?.moving), { timeout: 10_000 })
    .toBe(false);
}

const hovered = (page: Page) => page.evaluate(() => window.__alukit?.hovered());
const hidden = (page: Page) => page.evaluate(() => window.__alukit?.hidden());
const selection = (page: Page) => page.evaluate(() => window.__alukit?.selection());

interface Placed {
  a: V3;
  frame: { x: V3; y: V3; z: V3 };
  box_mm: [V3, V3];
}

/** The middles of a bar's four side faces at a distance along it, from the derived model. */
async function sideFaces(dir: string, id: string, at_mm: number): Promise<V3[]> {
  const r = await cli(["derive", dir, "--json"]);
  const b = (JSON.parse(r.out) as { bars: Record<string, Placed> }).bars[id];
  if (!b) throw new Error(`no ${id}`);
  const [[x0, y0], [x1, y1]] = b.box_mm as [V3, V3];
  const p = (lx: number, ly: number): V3 =>
    [0, 1, 2].map(
      (i) =>
        (b.a[i] as number) +
        (b.frame.x[i] as number) * lx +
        (b.frame.y[i] as number) * ly +
        (b.frame.z[i] as number) * at_mm,
    ) as V3;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return [p(x1, cy), p(x0, cy), p(cx, y1), p(cx, y0)];
}

/** A face point of a bar that the view shows on top, by hovering each; its page point. */
async function onTop(page: Page, dir: string, id: string, stations: readonly number[]) {
  const seen: string[] = [];
  for (const at_mm of stations) {
    for (const p of await sideFaces(dir, id, at_mm)) {
      const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
      if (!s) continue;
      await page.mouse.move(s[0], s[1]);
      const ok = await expect
        .poll(() => hovered(page), { timeout: 1_000 })
        .toEqual([id])
        .then(
          () => true,
          () => false,
        );
      if (ok) return { world: p, page: s as [number, number] };
      seen.push(`${at_mm}: ${JSON.stringify(await hovered(page))}`);
    }
  }
  throw new Error(`no face of ${id} is on top in this view (${seen.join("; ")})`);
}

/** The canvas's pixels in a small square about a point, as RGB. */
async function pixels(page: Page, at: [number, number]): Promise<number[]> {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="viewport"] canvas');
    if (!c) return [];
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const g = document.createElement("canvas");
    g.width = c.width;
    g.height = c.height;
    const ctx = g.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(
      Math.round((x - r.left) * k) - 2,
      Math.round((y - r.top) * k) - 2,
      5,
      5,
    );
    return [...d.data].filter((_, i) => i % 4 !== 3);
  }, at);
}

test("H hides b9 and a click there picks what is behind; Shift+H isolates; Alt+H shows all", async ({
  page,
}) => {
  // Count the WebGL program links: hiding is visibility, never a material (view.spec's rule).
  await page.addInitScript(() => {
    const w = window as unknown as { __links: number };
    w.__links = 0;
    const link = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (p) {
      w.__links++;
      link.call(this, p);
    };
  });
  served = await serve("cart");
  await openTab(page, served, 0);
  const links = () => page.evaluate(() => (window as unknown as { __links: number }).__links);
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.frames()?.modelFrame ?? 0))
    .toBeGreaterThan(0);
  const before = await links();
  const doc = await docOf(served.dir);
  // The problem badges and the joint markers off, so only bodies draw (and pick) where b9 is.
  await page.getByTestId("toggle-problems").click();
  await page.getByTestId("toggle-joints").click();
  await expect(page.getByTestId("toggle-joints")).toHaveAttribute("data-state", "off");

  // In the iso view, b9's face; selected, then hidden: nothing of it is drawn, and it is no
  // longer selected.
  const iso = (await onTop(page, served.dir, "b9", [400, 250, 700, 900])).page;
  const shown = await pixels(page, iso);
  await page.mouse.click(iso[0], iso[1]);
  expect(await selection(page)).toEqual(["b9"]);
  await page.mouse.move(0, 0);
  const lit = await pixels(page, iso);
  await page.keyboard.press("h");
  expect(await hidden(page)).toEqual(["b9"]);
  expect(await selection(page)).toEqual([]);
  await expect(page.getByTestId("hidden-strip")).toContainText("1 hidden");
  await expect.poll(() => pixels(page, iso)).not.toEqual(lit);
  expect(await pixels(page, iso)).not.toEqual(shown);

  // From the front, b10 lies behind b9: the pick goes through the hidden bar to it. (The face
  // nearest the camera at y's least, 400 along b9.)
  await page.getByTestId("projection").click();
  await page.getByTestId("view-front").click();
  await atRest(page);
  const near = (await sideFaces(served.dir, "b9", 400)).sort((p, q) => p[1] - q[1])[0] as V3;
  const front = await page.evaluate((p) => window.__alukit?.screen(p), near);
  if (!front) throw new Error("b9 is off the screen");
  await page.mouse.move(front[0], front[1]);
  await expect.poll(() => hovered(page)).toEqual(["b10"]);
  await page.mouse.click(front[0], front[1]);
  expect(await selection(page)).toEqual(["b10"]);

  // Shift+H: b10 alone is shown; every other body is hidden.
  await page.keyboard.press("Shift+H");
  const all = Object.keys(
    (JSON.parse((await cli(["derive", served.dir, "--json"])).out) as { bars: object }).bars,
  );
  const after = (await hidden(page)) ?? [];
  expect(after).not.toContain("b10");
  expect(after).toEqual(expect.arrayContaining(all.filter((b) => b !== "b10")));
  await expect(page.getByTestId("hidden-strip")).toContainText(/\d+ hidden/);

  // Alt+H: everything again, and b9 is on top at the front once more.
  await page.keyboard.press("Alt+H");
  expect(await hidden(page)).toEqual([]);
  await expect(page.getByTestId("hidden-strip")).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.mouse.move(front[0], front[1]);
  await expect.poll(() => hovered(page)).toEqual(["b9"]);

  // View state only: no step, the document as it was, and no shader program linked.
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
  expect(await docOf(served.dir)).toEqual(doc);
  expect(await links()).toBe(before);
});

test("the menu offers Hide and Isolate on the selection, and Show all on the strip", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  await page.getByTestId("tree").locator('[data-id="b5"]').click();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-action="hide"]')).toContainText("H");
  await expect(menu.locator('[data-action="isolate"]')).toContainText("Shift+H");
  await menu.locator('[data-action="hide"]').click();
  expect(await hidden(page)).toEqual(["b5"]);
  // Show all is the strip's button too, and the menu's when anything is hidden.
  await page.getByTestId("hidden-strip").getByRole("button", { name: "Show all" }).click();
  expect(await hidden(page)).toEqual([]);
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
});
