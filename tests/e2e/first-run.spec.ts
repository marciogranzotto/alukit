import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cli, lastStepWords, type Served, serveNew, waitDrawn } from "./helpers.ts";

/**
 * The first run (docs/ux/plan.md S2.10, S2.11, D-UX-6, D-UX-25; U27, U13, U2), on the project
 * the README makes, `alukit new --catalog forseti --currency BRL`: the start card shows with the
 * catalog line; a size, a profile and its finish, then Start drawing, arm the palette and write
 * `defaults.bar` as one step; one bar is drawn; the server finds no option that is not sold. The
 * example loads as one step. Project settings save as one `setProject` step.
 */

type V3 = [number, number, number];

let served: Served;
test.beforeEach(async () => {
  served = await serveNew(["--catalog", "forseti", "--currency", "BRL"]);
});
test.afterEach(async () => {
  await served.stop();
});

interface Doc {
  currency?: string;
  bars?: Record<string, unknown>;
  defaults?: { bar?: unknown; cutting?: { kerf_mm?: number } };
}

async function doc(): Promise<Doc> {
  return JSON.parse(await readFile(join(served.dir, "alukit.json"), "utf8")) as Doc;
}

async function logLength(): Promise<number> {
  const r = await cli(["log", served.dir, "--json"]);
  return (JSON.parse(r.out) as { entries: unknown[] }).entries.length;
}

async function open(page: Page): Promise<void> {
  await page.goto(served.appUrl);
  await waitDrawn(page, 0);
}

/** Moves the mouse onto a world point and waits until the tool's snap says what is there. */
async function hover(page: Page, p: V3, says: string | RegExp): Promise<[number, number]> {
  const at = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!at) throw new Error(`${p} is not on the screen`);
  await page.mouse.move(at[0], at[1], { steps: 4 });
  await expect
    .poll(async () => (await page.evaluate(() => window.__alukit?.tool()))?.snap ?? "", {
      timeout: 2000,
    })
    .toMatch(says);
  return at;
}

test("the start card arms a sold profile as the default in one step, and a bar is drawn with it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const card = page.getByTestId("start-card");
  await expect(card).toBeVisible();
  // The catalog line: the catalog named, with its counts.
  await expect(card.getByTestId("start-catalogs")).toContainText("Forseti");
  await expect(card.getByTestId("start-catalogs")).toContainText(/\d+ profiles/);
  await expect(card.getByTestId("start-no-profile")).toHaveCount(0);

  // A size, the profile, a finish already chosen that is sold (U2), then Start drawing.
  let clicks = 0;
  await card.locator('.profile-chip[data-size="40 × 40"]').click();
  clicks++;
  await card.getByTestId("start-profile").selectOption("forseti:PF40-01");
  clicks++;
  await expect(card.getByTestId("option-finish")).toHaveValue("anodised");
  await card.getByTestId("start-drawing").click();
  clicks++;
  await waitDrawn(page, 1);
  test.info().annotations.push({
    type: "first-run cost",
    description: `${clicks} clicks and 0 keys to an armed, sold profile (A F1 estimated about 4 clicks and 2 keys)`,
  });

  // One step wrote the default; the palette is armed with it and the draw tool is on.
  expect(await logLength()).toBe(1);
  expect((await doc()).defaults?.bar).toEqual({
    item: "forseti:PF40-01",
    opt: { finish: "anodised" },
  });
  await expect(card).toBeHidden();
  await expect(page.getByTestId("palette-bar")).toHaveAttribute("data-id", "forseti:PF40-01");
  expect(await page.evaluate(() => window.__alukit?.tool().name)).toBe("draw");
  const coach = page.getByTestId("coach");
  await expect(coach).toBeVisible();

  // One bar: a click on the ground's origin, then 500 typed along +z.
  const at = await hover(page, [0, 0, 0], "grid (0, 0, 0)");
  await page.mouse.click(at[0], at[1]);
  await hover(page, [0, 0, 250], /^\+z /);
  await page.keyboard.type("500");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 2);
  expect(Object.keys((await doc()).bars ?? {})).toEqual(["b1"]);
  await expect(coach.locator("li.done")).toHaveCount(2);

  // The server finds no option that is not sold: the bar took the default's finish.
  const problems = JSON.parse((await cli(["problems", served.dir, "--json"])).out) as {
    problems: { code: string }[];
  };
  expect(problems.problems.map((p) => p.code)).not.toContain("option-not-sold");
  expect(errors).toEqual([]);
});

test("the example loads the skill's work table as one step", async ({ page }) => {
  await open(page);
  const card = page.getByTestId("start-card");
  await card.getByTestId("start-example").click();
  await waitDrawn(page, 1);
  await expect(card).toBeHidden();
  expect(await logLength()).toBe(1);
  // Ten bars in the document; the default variant derives the eight that are not the tall one's.
  expect(Object.keys((await doc()).bars ?? {})).toHaveLength(10);
  expect(await page.evaluate(() => window.__alukit?.stats()?.bars)).toBe(8);
  // Undo takes it back, as one step.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 2);
  expect(Object.keys((await doc()).bars ?? {})).toHaveLength(0);
});

test.fixme("the box frame way reads READY with the order's date pinned (S5.7's frame form)", () => {});

test("Esc closes the start card, and the help shows it again", async ({ page }) => {
  await open(page);
  const card = page.getByTestId("start-card");
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await page.getByTestId("help-open").click();
  await page.getByTestId("show-start").click();
  await expect(card).toBeVisible();
  await card.getByTestId("start-close").click();
  await expect(card).toBeHidden();
});

test("project settings save what changed as one setProject step", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("open-settings").click();
  const form = page.getByTestId("settings-form");
  await form.getByTestId("settings-currency").fill("EUR");
  await form.getByTestId("settings-kerf").fill("2.5");
  await form.getByTestId("settings-save").click();
  await waitDrawn(page, 1);
  await expect(page.getByTestId("settings")).toBeHidden();
  const d = await doc();
  expect(d.currency).toBe("EUR");
  expect(d.defaults?.cutting?.kerf_mm).toBe(2.5);
  expect(await logLength()).toBe(1);
  await expect(page.getByTestId("undo")).toHaveText(
    `Undo · you: ${await lastStepWords(served.dir)}`,
  );
});
