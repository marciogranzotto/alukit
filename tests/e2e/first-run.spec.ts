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

interface OrderJson {
  status: string;
  oldest_read: string;
  suppliers: { reasons: { rule: string }[] }[];
  diagnostics: { code: string }[];
}

interface ProblemsJson {
  problems: { code: string; group: string; from: string[] }[];
}

/** `alukit order --format json` on the served project, as of a date. */
async function order(asOf?: string): Promise<OrderJson> {
  const r = await cli([
    "order",
    served.dir,
    "--format",
    "json",
    ...(asOf ? ["--as-of", asOf] : []),
  ]);
  return JSON.parse(r.out) as OrderJson;
}

/** `alukit problems --json` today: the readiness pill's warnings are its order-judged ones. */
async function orderWarnings(): Promise<string[]> {
  const r = await cli(["problems", served.dir, "--json"]);
  return (JSON.parse(r.out) as ProblemsJson).problems
    .filter((p) => p.from.includes("order") && p.group !== "blocks-order")
    .map((p) => p.code);
}

/** The box frame from the start card, 1000 × 600 × 800 of the 40 × 40 size, joined as given. */
async function boxFrame(page: Page, joint: string): Promise<void> {
  await open(page);
  const card = page.getByTestId("start-card");
  // Step 1, shared by both ways (review M1): the size, and its commonest profile first (M8).
  await card.locator('.profile-chip[data-size="40 × 40"]').click();
  await expect(card.getByTestId("start-profile")).toHaveValue("forseti:PF40-01");
  await expect(card.getByTestId("option-finish")).toHaveValue("anodised");
  // Step 2: the frame, its corners joined with what fits the profile first (review B1).
  const form = card.getByTestId("frame-form");
  await form.getByTestId("frame-w").fill("1000");
  await form.getByTestId("frame-d").fill("600");
  await form.getByTestId("frame-h").fill("800");
  const fits = form.locator('[data-testid="frame-joint"] optgroup[label="Fits these bars"] option');
  await expect(fits.first()).toBeAttached();
  await expect(fits.filter({ hasText: "CT38-06" })).toHaveCount(1);
  await form.getByTestId("frame-joint").selectOption(joint);
  await expect(form.getByTestId("frame-numbers")).toContainText("posts 4 × 800");
  await form.getByTestId("frame-create").click();
  await waitDrawn(page, 1);
  await expect(card).toBeHidden();
  // Made from the card, the frame shows its cut list: Select, and the sheets open (review m11).
  expect(await page.evaluate(() => window.__alukit?.tool().name)).toBe("select");
  expect(await logLength()).toBe(1);
}

test("the box frame way, joined with a bracket that fits, reads READY and buys the brackets", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boxFrame(page, "forseti:CT38-06");
  // One step: the profile and the connector became the project's defaults, with the frame.
  expect((await doc()).defaults).toMatchObject({
    bar: { item: "forseti:PF40-01", opt: { finish: "anodised" } },
    butt: { connector: "forseti:CT38-06" },
  });
  // What the person sees: READY, and no warning about joining, as the CLI says today.
  const pill = page.getByTestId("readiness");
  await expect(pill).toHaveAttribute("data-status", "READY");
  const warned = await orderWarnings();
  expect(warned).not.toContain("butt-no-connector");
  await expect(pill).toHaveAttribute("data-warnings", String(warned.length));
  // The order is complete, its date pinned to the oldest price read: the brackets bought (16, as
  // `alukit add frame --connector` buys them), and no rule judging the joints.
  const pinned = (await order()).oldest_read;
  const o = await order(pinned);
  expect(o.status).toBe("READY");
  expect(o.suppliers.flatMap((s) => s.reasons.map((r) => r.rule))).toEqual([]);
  expect(o.diagnostics.map((d) => d.code)).not.toContain("butt-no-connector");
  const text = (await cli(["order", served.dir, "--as-of", pinned])).out;
  expect(text).toContain("16 forseti:CT38-06");
  await page.getByRole("tab", { name: "Order & costs" }).click();
  const sheet = page.getByTestId("order");
  await sheet.getByTestId("as-of").fill(pinned);
  await expect(sheet.getByTestId("verdict")).toHaveAttribute("data-status", "READY");
  await expect(sheet.getByTestId("verdict")).toHaveAttribute("data-warnings", "0");
  await sheet.getByRole("button", { name: /^Show \d+ lines$/ }).click();
  await expect(sheet).toContainText("CT38-06");
  expect(errors).toEqual([]);
});

test("the box frame way, joined with nothing, reads ready with a warning, and its fix joins it", async ({
  page,
}) => {
  await boxFrame(page, "-");
  expect((await doc()).defaults).not.toHaveProperty("butt");
  // Never a plain READY while nothing joins the butts (review B1): the pill warns, and says why.
  const pill = page.getByTestId("readiness");
  await expect(pill).toHaveAttribute("data-status", "READY");
  const warned = await orderWarnings();
  expect(warned).toContain("butt-no-connector");
  await expect(pill).toHaveAttribute("data-warnings", String(warned.length));
  await expect(pill).toContainText(/Ready, \d+ warnings?/);
  await expect(pill).toHaveAttribute("title", /no connector/);
  // The order says the same, as the CLI does: the rule warns, the verdict asks to check first.
  const pinned = (await order()).oldest_read;
  const o = await order(pinned);
  expect(o.status).toBe("READY");
  expect(o.suppliers.flatMap((s) => s.reasons.map((r) => r.rule))).toContain("no-connector");
  await page.getByRole("tab", { name: "Order & costs" }).click();
  const sheet = page.getByTestId("order");
  await sheet.getByTestId("as-of").fill(pinned);
  const verdict = sheet.getByTestId("verdict");
  await expect(verdict).toHaveAttribute("data-status", "READY");
  await expect(verdict).toContainText("Ready, but check first");
  await expect(sheet.getByTestId("verdict-warnings")).toContainText("no connector");

  // The problem's fix: a connector, fit first, as the project's default butt connector, one step.
  await page.getByRole("tab", { name: "Problems" }).click();
  const row = page
    .getByTestId("problems")
    .locator('li.problem[data-problem^="butt-no-connector"]')
    .first();
  await row.getByRole("button", { name: "Set a connector for all 8…" }).click();
  await row.getByTestId("connector-fix").selectOption("forseti:CT38-06");
  await row.getByTestId("connector-apply").click();
  await waitDrawn(page, 2);
  expect((await doc()).defaults).toMatchObject({ butt: { connector: "forseti:CT38-06" } });
  expect(await orderWarnings()).not.toContain("butt-no-connector");
  await expect(pill).toHaveAttribute("data-warnings", String((await orderWarnings()).length));
  expect((await cli(["order", served.dir, "--as-of", pinned])).out).toContain("16 forseti:CT38-06");
});

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
