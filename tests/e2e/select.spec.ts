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

const selection = (page: Page) => page.evaluate(() => window.__alukit?.selection());

/** Runs a menu entry on the selection: Shift+F10 opens the menu, a click runs the entry. */
async function fromMenu(page: Page, action: string): Promise<void> {
  await page.getByTestId("skip-link").focus();
  await page.keyboard.press("Shift+F10");
  await page.getByTestId("context-menu").locator(`[data-action="${action}"]`).click();
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `b${from + i}`);

test("on the frame: same tags, a tag's head, Ctrl+A, similar and connected select as the CLI does", async ({
  page,
}) => {
  // The editing audit's frame: 1000 × 600 × 750 of 40 × 40, made by `alukit add frame`; b1–b4
  // are its posts (tag post), b5–b8 its base, b9–b12 its top.
  served = await serve("brace");
  await openTab(page, served, 0);

  // "Select tagged post" on a post: the four posts.
  await selectByIds(page, ["b2"]);
  await fromMenu(page, "select-tagged");
  await expect.poll(() => selection(page)).toEqual(range(1, 4));

  // The outline by tag: a click on the head "post" selects its members; its twisty still opens
  // and closes it, and leaves the selection as it was.
  await page.keyboard.press("Escape");
  await expect.poll(() => selection(page)).toEqual([]);
  await page.getByRole("checkbox", { name: "by tag" }).check();
  const head = page.getByTestId("tree").locator('[data-key="g:tag:post"]');
  await head.locator(".title").click();
  await expect.poll(() => selection(page)).toEqual(range(1, 4));
  await head.locator(".twisty").click();
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("tree").locator('[data-id="b1"]')).toHaveCount(0);
  expect(await selection(page)).toEqual(range(1, 4));
  await head.locator(".twisty").click();
  await expect(head).toHaveAttribute("aria-expanded", "true");

  // Ctrl+A: the twelve bars.
  await page.getByTestId("skip-link").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect.poll(() => selection(page)).toEqual(range(1, 12));

  // Similar on a post: every bar of its item and options, as `alukit query like:b1`.
  const like = JSON.parse(
    (await cli(["query", served.dir, "like:b1", "--json", "--limit", "100"])).out,
  ) as { entities: { id: string }[] };
  await selectByIds(page, ["b1"]);
  await fromMenu(page, "select-similar");
  await expect.poll(() => selection(page)).toEqual(like.entities.map((e) => e.id));

  // Connected on the front base rail b5: the bars its joints join to it, b1 and b2 (the posts
  // it butts on) and b7 and b8 (the side rails butted with it), as `alukit query connected:b5`.
  await selectByIds(page, ["b5"]);
  await fromMenu(page, "select-connected");
  await expect.poll(() => selection(page)).toEqual(["b1", "b2", "b5", "b7", "b8"]);
  // None of it is a step.
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
});

test("a box right to left takes what it touches, left to right only what lies inside", async ({
  page,
}) => {
  served = await serve("brace");
  await openTab(page, served, 0);
  await page.getByTestId("projection").click();
  await page.getByTestId("view-front").click();
  await atRest(page);
  // A box round the frame's right side, from the front: x 940 to 1030, z −15 to 765 (the posts
  // and side rails stand at x 960 to 1000, z 0 to 750; the view's margin holds the box).
  const a = await screen(page, [940, -20, 765]);
  const b = await screen(page, [1030, -20, -15]);
  const drag = async (from: [number, number], to: [number, number], dashed: boolean) => {
    await page.keyboard.down("Shift");
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
    await expect(page.locator(".select-box")).toHaveClass(dashed ? /crossing/ : /^select-box$/);
    await page.mouse.move(to[0], to[1], { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
  };
  // Left to right, a window: the right posts and the side rails seen end on, wholly inside.
  await drag(a, b, false);
  const window = (await selection(page)) ?? [];
  expect(window).toEqual(["b2", "b4", "b8", "b12"]);
  // Right to left, a crossing: those, and the front and back rails that reach into the box.
  await page.keyboard.press("Escape");
  await drag(b, a, true);
  const crossing = (await selection(page)) ?? [];
  expect(crossing).toEqual(["b2", "b4", "b5", "b6", "b8", "b9", "b10", "b12"]);
});

test("the size readout: the model's W × D × H, or the selection's; Alt shows it in the view", async ({
  page,
}) => {
  // Count the WebGL program links: the size box is built once, with the viewer (E-UX-19).
  await page.addInitScript(() => {
    const w = window as unknown as { __links: number };
    w.__links = 0;
    const link = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (p) {
      w.__links++;
      link.call(this, p);
    };
  });
  served = await serve("brace");
  await openTab(page, served, 0);
  const links = () => page.evaluate(() => (window as unknown as { __links: number }).__links);
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.frames()?.modelFrame ?? 0))
    .toBeGreaterThan(0);
  const before = await links();
  const readout = page.getByTestId("size-readout");
  await expect(readout).toHaveText("1000 × 600 × 750 mm");
  await selectByIds(page, ["b1"]);
  await expect(readout).toHaveText("40 × 40 × 750 mm");
  // Alt held: the selection's box in the view, its three sizes by its edges; let go, it goes.
  await page.mouse.move(10, 10);
  await page.keyboard.down("Alt");
  await expect(page.locator('.view-label[data-label="size-w"]')).toHaveText("W 40");
  await expect(page.locator('.view-label[data-label="size-d"]')).toHaveText("D 40");
  await expect(page.locator('.view-label[data-label="size-h"]')).toHaveText("H 750");
  await page.keyboard.up("Alt");
  await expect(page.locator('.view-label[data-label="size-w"]')).toHaveCount(0);
  // Shown and taken away, and no shader program linked for it.
  expect(await links()).toBe(before);
});

test("the selected bar's label keeps clear of the gizmo: a press anywhere on Rotate's ring reaches it", async ({
  page,
}) => {
  // ux/move's b3, a free brace: alone selected, its label sits at its middle, which is where
  // Rotate stands its rings (the selection's centre). From the top, in orthographic, the Z ring
  // is a circle 0.78 of the 96 px arrow round that point.
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await page.getByTestId("projection").click();
  await page.getByTestId("view-top").click();
  await atRest(page);
  await selectByIds(page, ["b3"]);
  const label = page.getByTestId("selection-label");
  await expect(label).toBeVisible();
  await page.mouse.move(5, 5);
  await page.keyboard.press("q");
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.gizmo()))
    .toMatchObject({ parts: ["ring-x", "ring-y", "ring-z"] });
  const g = await page.evaluate(() => window.__alukit?.gizmo());
  if (!g || !("at" in g)) throw new Error("no rings");
  const c = await screen(page, g.at as V3);
  const r = 0.78 * 96;
  // Every point of the ring is the canvas's, not the label's: a press there reaches the ring.
  await expect
    .poll(() =>
      page.evaluate(
        ([cx, cy, rr]) => {
          const covered: number[] = [];
          for (let deg = 0; deg < 360; deg += 10) {
            const a = (deg * Math.PI) / 180;
            const el = document.elementFromPoint(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
            if (el?.closest('[data-testid="selection-label"]')) covered.push(deg);
          }
          return covered;
        },
        [c[0], c[1], r] as const,
      ),
    )
    .toEqual([]);
  // The label is still shown, inside the view, and says the bar's cut.
  await expect(label).toBeVisible();
  const vb = await page.getByTestId("viewport").boundingBox();
  const lb = await label.boundingBox();
  if (!vb || !lb) throw new Error("no box");
  expect(lb.x).toBeGreaterThanOrEqual(vb.x);
  expect(lb.x + lb.width).toBeLessThanOrEqual(vb.x + vb.width);
  expect(lb.y).toBeGreaterThanOrEqual(vb.y);
  expect(lb.y + lb.height).toBeLessThanOrEqual(vb.y + vb.height);
});

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
