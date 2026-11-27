import { expect, type Locator, type Page, test } from "@playwright/test";
import { cli, openTab, type Served, serve, serveNew, waitDrawn } from "./helpers.ts";

/**
 * The designer's re-check after the polish pass (docs/ux/review-phase4.md §9.4, N1 to N7;
 * docs/ux/polish-decisions.md, "After the re-check"): what each new finding was, held.
 */

type V3 = [number, number, number];

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const at = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!at) throw new Error(`${p} is not on the screen`);
  return at;
}

/** Moves the mouse onto a world point and waits until the tool's snap says what is there. */
async function hover(page: Page, p: V3, says: string | RegExp): Promise<[number, number]> {
  const at = await screen(page, p);
  await page.mouse.move(at[0], at[1], { steps: 4 });
  await expect
    .poll(async () => (await page.evaluate(() => window.__alukit?.tool()))?.snap ?? "")
    .toMatch(says);
  return at;
}

/** Whether none of an element's words are cut off, by width or by a line clamp. */
async function whole(el: Locator): Promise<boolean> {
  return el.evaluate(
    (e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1,
  );
}

test.describe("on the empty base frame (default bar test:TS40)", () => {
  let served: Served;
  test.beforeEach(async () => {
    served = await serve("base-frame/empty");
  });
  test.afterEach(async () => {
    await served.stop();
  });

  async function closeCard(page: Page): Promise<void> {
    await openTab(page, served, 0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("start-card")).toBeHidden();
  }

  test("N2: the 'Which way?' refusal goes once the pointer shows the way", async ({ page }) => {
    await closeCard(page);
    await page.keyboard.press("b");
    const at = await hover(page, [0, 0, 0], "grid (0, 0, 0)");
    await page.mouse.click(at[0], at[1]);
    await page.keyboard.type("500");
    await page.keyboard.press("Enter");
    const result = page.getByTestId("tool-result");
    await expect(result).toContainText("Which way?");
    // Pointed up: the way is known, so the refusal is stale.
    await hover(page, [0, 0, 250], /^\+z /);
    await expect(result).toHaveCount(0);
    // Back on the start it is not known again, and Enter asks again.
    await page.mouse.move(at[0], at[1], { steps: 4 });
    await expect
      .poll(async () => (await page.evaluate(() => window.__alukit?.tool()))?.snap ?? "")
      .not.toMatch(/^\+z /);
    await page.keyboard.press("Enter");
    await expect(result).toContainText("Which way?");
  });

  test("N3: at 1440 px the command bar's words are whole, in Draw and in the frame tool", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await closeCard(page);
    await page.keyboard.press("b");
    const at = await hover(page, [0, 0, 0], "grid (0, 0, 0)");
    await page.mouse.click(at[0], at[1]);
    await page.keyboard.type("800");
    const bar = page.getByTestId("command-bar");
    await expect(page.getByTestId("command-result")).toContainText("point the way");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tool-result")).toContainText("Which way?");
    for (const id of ["command-prompt", "command-result", "tool-result"]) {
      expect(await whole(page.getByTestId(id)), id).toBe(true);
    }
    expect(await bar.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // The box frame at its height: its prompt, the value's words and the numbers.
    await page.keyboard.press("g");
    const panel = page.getByTestId("panel-frame");
    await panel.getByTestId("frame-joint").selectOption("-");
    const c = await hover(page, [0, 0, 0], "grid (0, 0, 0)");
    await page.mouse.click(c[0], c[1]);
    await page.keyboard.type("1000,600");
    await page.keyboard.press("Enter");
    await page.keyboard.type("800");
    await expect(page.getByTestId("frame-result")).toContainText("posts 4 × 800");
    for (const id of ["command-prompt", "command-result", "frame-result"]) {
      expect(await whole(page.getByTestId(id)), id).toBe(true);
    }
    expect(await bar.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  });
});

test.describe("on a new forseti project", () => {
  let served: Served;
  test.beforeEach(async () => {
    served = await serveNew(["--catalog", "forseti", "--currency", "BRL"]);
  });
  test.afterEach(async () => {
    await served.stop();
  });

  /** The box frame from the start card, 1000 × 600 × 800 of the 40 × 40 size, joined as given. */
  async function boxFrame(page: Page, joint: string): Promise<void> {
    await page.goto(served.appUrl);
    await waitDrawn(page, 0);
    const card = page.getByTestId("start-card");
    await card.locator('.profile-chip[data-size="40 × 40"]').click();
    const form = card.getByTestId("frame-form");
    await form.getByTestId("frame-w").fill("1000");
    await form.getByTestId("frame-d").fill("600");
    await form.getByTestId("frame-h").fill("800");
    await form.getByTestId("frame-joint").selectOption(joint);
    await expect(form.getByTestId("frame-numbers")).toContainText("posts 4 × 800");
    await form.getByTestId("frame-create").click();
    await waitDrawn(page, 1);
    await expect(card).toBeHidden();
  }

  /**
   * Every problem row of a list: a normal height, the words in a column wide enough to read, and
   * the buttons clear of the title's box.
   */
  async function rowsAreLaidOut(list: Locator): Promise<number> {
    const rows = list.locator("li.problem");
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const [r, title, actions] = [
        await row.boundingBox(),
        await row.locator(".problem-title").boundingBox(),
        await row.locator(".problem-actions").boundingBox(),
      ];
      if (!r || !title || !actions) throw new Error(`row ${i} has no box`);
      expect(r.height, `row ${i} height`).toBeLessThan(180);
      // Words need room: well over one word's width, and never a column of single words.
      expect(title.width, `row ${i} title width`).toBeGreaterThan(120);
      const apart =
        actions.y >= title.y + title.height - 1 || // under the words
        actions.x >= title.x + title.width - 1 || // beside them
        actions.x + actions.width <= title.x + 1;
      expect(apart, `row ${i}: buttons overlap the title`).toBe(true);
    }
    return n;
  }

  test("N1: a problem row lays out in the narrow inspector, the callout and the sheet", async ({
    page,
  }) => {
    await boxFrame(page, "-");
    await page.getByRole("tab", { name: "Problems" }).click();
    const row = page
      .getByTestId("problems")
      .locator('li.problem[data-problem^="butt-no-connector"]')
      .first();
    // The wide sheet, as before.
    await expect(row).toBeVisible();
    expect(await rowsAreLaidOut(page.getByTestId("problems"))).toBeGreaterThan(0);
    // Show selects the butts: the inspector, a narrow column, holds the same row.
    await row.getByTestId("show").click();
    const insp = page.getByTestId("selection-problems");
    await expect(insp.locator('li.problem[data-problem^="butt-no-connector"]')).toBeVisible();
    expect(await rowsAreLaidOut(insp)).toBeGreaterThan(0);
    // And a narrower window still.
    await page.setViewportSize({ width: 1000, height: 700 });
    expect(await rowsAreLaidOut(insp)).toBeGreaterThan(0);
  });

  test("N4: the cut lengths show once the size is known, and say what the joint will change", async ({
    page,
  }) => {
    await page.goto(served.appUrl);
    await waitDrawn(page, 0);
    const card = page.getByTestId("start-card");
    await card.locator('.profile-chip[data-size="40 × 40"]').click();
    const form = card.getByTestId("frame-form");
    await form.getByTestId("frame-w").fill("1000");
    await form.getByTestId("frame-d").fill("600");
    await form.getByTestId("frame-h").fill("800");
    const numbers = form.getByTestId("frame-numbers");
    // No joint chosen yet: the numbers are there, with what the choice will change, and Make waits.
    await expect(numbers).toContainText("posts 4 × 800");
    await expect(form.getByTestId("frame-joint-pending")).toContainText("connectors");
    await expect(form.getByTestId("frame-create")).toBeDisabled();
    const before = await numbers.locator("li").allTextContents();
    // The claim holds: choosing a bracket leaves every cut length as it was.
    await form.getByTestId("frame-joint").selectOption("forseti:CT38-06");
    await expect(form.getByTestId("frame-joint-pending")).toHaveCount(0);
    await expect(form.getByTestId("frame-create")).toBeEnabled();
    await expect(numbers.locator("li")).toHaveText(before);
  });

  test("N5: 'Choose a profile' is ticked in First steps after a box frame", async ({ page }) => {
    await boxFrame(page, "-");
    // Nothing selected: the project panel, and its first steps (until all four tick).
    await page.keyboard.press("Escape");
    const steps = page.getByTestId("first-steps");
    await expect(steps).toBeVisible();
    const choose = steps.locator("li", { hasText: "Choose a profile" });
    await expect(choose).toHaveClass(/done/);
    await expect(steps.locator("li", { hasText: "Draw a bar" })).toHaveClass(/done/);
  });

  test("N6: the catalog browser lists profiles before linear guides, drawn lightly in the light theme", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(served.appUrl);
    await waitDrawn(page, 0);
    await page.keyboard.press("Escape");
    await page.getByTestId("left-catalog").click();
    const cards = page.getByTestId("catalog").locator("ul.cards > li > button");
    await expect(cards.first()).toBeVisible();
    // The bars of the first page: every guide after every profile.
    const r = await cli(["catalog", "search", "forseti", "--kind", "bar", "--limit", "200"]);
    const guides = new Set(
      r.out
        .split("\n")
        .filter((l) => /\brail-/.test(l))
        .map((l) => l.trim().split(/\s+/)[0]),
    );
    expect(guides.size).toBeGreaterThan(0);
    const ids = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-id") ?? ""));
    expect(guides.has(ids[0] as string)).toBe(false);
    const bars = ids.filter((id) => /^forseti:(PF|HG)/.test(id));
    const firstGuide = bars.findIndex((id) => guides.has(id));
    if (firstGuide >= 0) {
      expect(bars.slice(firstGuide).every((id) => guides.has(id))).toBe(true);
    }
    // A section that is only its box is outlined, not a solid black block.
    await page.getByTestId("catalog-search").fill("HGR15");
    const plain = page.getByTestId("catalog").locator("svg.thumb.plain path").first();
    await expect(plain).toBeVisible();
    const fill = await plain.evaluate((p) => getComputedStyle(p).fill);
    // "color(srgb r g b / a)" or "rgba(r, g, b, a)": the alpha is the last number.
    const alpha = /\/\s*([\d.]+)\s*\)$|,\s*([\d.]+)\s*\)$/.exec(fill);
    expect(alpha ? Number(alpha[1] ?? alpha[2]) : 1, fill).toBeLessThan(0.5);
  });

  test("N7: the draw coach's steps are a list, one to a line", async ({ page }) => {
    await page.goto(served.appUrl);
    await waitDrawn(page, 0);
    const card = page.getByTestId("start-card");
    await card.locator('.profile-chip[data-size="40 × 40"]').click();
    await card.getByTestId("start-drawing").click();
    const items = page.getByTestId("coach").locator("ol > li");
    await expect(items.first()).toBeVisible();
    const tops: number[] = [];
    for (const li of await items.all()) tops.push((await li.boundingBox())?.y ?? Number.NaN);
    expect(tops.length).toBeGreaterThan(1);
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1] as number);
  });
});
