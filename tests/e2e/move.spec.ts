import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { latticeBatch } from "../../src/core/testing.ts";
import {
  cli,
  lastStepWords,
  openTab,
  type Served,
  selectByIds,
  serve,
  waitDrawn,
} from "./helpers.ts";

/**
 * The Move tool, D (docs/ux/drag-ends-decisions.md, "The Move tool"), on tests/fixtures/ux/move:
 * b1 a rail along +X, 1000 long; b2 up +Y from b1's end b, butted on it by c1 (cut 580); b3 a
 * free brace at x = 500 from y = 600 to 300; b4 a free post; p1 a bracket on b1 at 300; D = 150.
 * Every outcome is checked against the project as written, and the cut list against the CLI.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function doc(dir: string): Promise<{
  bars: Record<string, { a: unknown; b: unknown }>;
  connections?: Record<string, unknown>;
  parts?: Record<string, { on?: { at_mm: unknown } }>;
}> {
  return JSON.parse(await readFile(join(dir, "alukit.json"), "utf8"));
}

async function cutOf(dir: string, id: string): Promise<number> {
  const r = await cli(["cutlist", dir, "--format", "json"]);
  expect(r.code, r.err).toBe(0);
  const cl = JSON.parse(r.out) as { groups: { lines: { cut_mm: number; sources: string[] }[] }[] };
  for (const g of cl.groups) for (const l of g.lines) if (l.sources.includes(id)) return l.cut_mm;
  throw new Error(`${id} is not on the cut list`);
}

async function pick(page: Page, id: string): Promise<void> {
  await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText(id);
}

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is off the screen`);
  return s;
}

/** Picks the Move tool with its key, the focus on the view. */
async function moveTool(page: Page): Promise<void> {
  await page.keyboard.press("d");
  await expect(page.getByTestId("tool-move")).toHaveAttribute("aria-pressed", "true");
}

/** The gesture's offset, as the command bar reads it: `by [x, y, z]`. */
async function offset(page: Page): Promise<number[]> {
  const reading = (await page.evaluate(() => window.__alukit?.gesture()?.reading)) ?? "";
  const m = /by \[([^\]]+)\]/.exec(reading);
  if (!m) throw new Error(`no offset in "${reading}"`);
  return (m[1] as string).split(",").map((x) => Number(x.trim()));
}

test("a free bar moves by a drag along a locked axis: one step, where the drag said", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await pick(page, "b3");
  await moveTool(page);
  const from = await screen(page, [500, 450, 0]);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0] + 10, from[1], { steps: 2 });
  await page.keyboard.press("ArrowRight");
  const to = await screen(page, [720, 450, 0]);
  await page.mouse.move(to[0], to[1], { steps: 10 });
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("move");
  await expect(page.getByTestId("command-bar")).toHaveAttribute("data-tool", "move");
  const [dx, dy, dz] = await offset(page);
  expect(dx).toBeGreaterThan(150);
  expect([dy, dz]).toEqual([0, 0]);
  await page.mouse.up();
  await waitDrawn(page, 1);
  expect((await doc(served.dir)).bars.b3).toMatchObject({ a: [500 + (dx as number), 600, 0] });
  expect(await lastStepWords(served.dir)).toBe(`move b3 by [${dx}, 0, 0]`);
  expect(await cutOf(served.dir, "b3")).toBe(300);
  // One undo takes it back.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 2);
  expect((await doc(served.dir)).bars.b3).toMatchObject({ a: [500, 600, 0], b: [500, 300, 0] });
  expect(errors).toEqual([]);
});

test("a joined bar moved: its joined end follows by default, as the preview says first", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await pick(page, "b1");
  await moveTool(page);
  // A click on b1 is the base point; a typed offset, then Enter.
  const at = await screen(page, [700, 0, 0]);
  await page.mouse.click(at[0], at[1]);
  await page.keyboard.type("0, -100, 0");
  await expect(page.getByTestId("command-value")).toBeFocused();
  await expect(page.getByTestId("joint-preview")).toContainText(
    "b2.a, p1 follow · cut b2 580 → 680",
  );
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  const d = await doc(served.dir);
  expect(d.bars.b2).toMatchObject({ a: [1000, -100, 0], b: [1000, 600, 0] });
  expect(Object.keys(d.connections ?? {})).toEqual(["c1"]);
  expect(await cutOf(served.dir, "b2")).toBe(680);
  expect(await lastStepWords(served.dir)).toBe("move b1 by [0, -100, 0], b2.a and p1 following");
});

test("a joined bar moved with Alt: the joint is freed, as the preview says first", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await pick(page, "b2");
  await moveTool(page);
  const from = await screen(page, [1000, 300, 0]);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0], from[1] - 10, { steps: 2 });
  await page.keyboard.press("ArrowUp");
  const up = await screen(page, [1000, 300, 120]);
  await page.mouse.move(up[0], up[1], { steps: 10 });
  // Following, b2.a would leave b1: the preview says so, and how to free it.
  await expect(page.getByTestId("joint-preview")).toContainText("would break a joint");
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.userAgent));
  await expect(page.getByTestId("joint-preview")).toContainText(
    `hold ${mac ? "Option" : "Alt"} to detach it`,
  );
  await page.keyboard.down("Alt");
  await page.mouse.move(up[0], up[1] - 2, { steps: 2 });
  await expect(page.getByTestId("joint-preview")).toContainText("frees c1");
  const [, , dz] = await offset(page);
  expect(dz).toBeGreaterThan(50);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await waitDrawn(page, 1);
  const d = await doc(served.dir);
  expect(d.connections).toEqual({});
  expect(d.bars.b2).toEqual({ a: [1000, 0, dz], b: [1000, 600, dz], label: "rail butted on b1" });
  expect(await cutOf(served.dir, "b2")).toBe(600);
  expect(await lastStepWords(served.dir)).toBe(`move b2 by [0, 0, ${dz}], freed from c1`);
});

test("a part on a bar slides along it: a typed distance moves its station", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await pick(page, "p1");
  await moveTool(page);
  // A click on open ground is the base point; the part can only go along b1.
  const at = await screen(page, [800, 300, 0]);
  await page.mouse.click(at[0], at[1]);
  await expect(page.getByTestId("command-bar")).toContainText("along b1");
  await page.keyboard.type("100");
  await expect(page.getByTestId("command-result")).toContainText("by [100, 0, 0]");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect((await doc(served.dir)).parts?.p1?.on?.at_mm).toBe(400);
  expect(await lastStepWords(served.dir)).toBe("move p1 by [100, 0, 0]");
});

test("a typed offset over a param, from the keyboard: the param is kept; Esc cancels", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await pick(page, "b3");
  await moveTool(page);
  const before = await readFile(join(served.dir, "alukit.json"), "utf8");
  // Esc first: a move begun and cancelled writes nothing.
  await page.keyboard.type("0");
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("move");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture())).toBeUndefined();
  expect(await readFile(join(served.dir, "alukit.json"), "utf8")).toBe(before);
  // Then 0, D, 0: b3 moves 150 along Y, written over D.
  await page.keyboard.type("0, D, 0");
  await expect(page.getByTestId("command-result")).toContainText("by [0, D, 0]");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect((await doc(served.dir)).bars.b3).toMatchObject({
    a: [500, "600 + D", 0],
    b: [500, "300 + D", 0],
  });
  expect(await lastStepWords(served.dir)).toBe("move b3 by [0, D, 0], keeping b3.a y: 600 + D");
});

test("on the 1,008-bar lattice a Move's preview and its step each answer within 500 ms at the server (review M6)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  served = await serve("ux/lattice", async (dir) => {
    const r = await cli(["do", dir, JSON.stringify(latticeBatch())]);
    expect(r.code, r.err).toBe(0);
  });
  await page.goto(served.appUrl);
  await waitDrawn(page, 0, 120_000);
  // The second frame, as a person picks it: its front top rail in the outline, then, from the
  // menu (Shift+F10), the whole assembly that rail is joined in.
  await selectByIds(page, ["b21"]);
  await page.getByTestId("skip-link").focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByTestId("context-menu");
  await expect(menu).toHaveAttribute("aria-label", "Actions on b21");
  await menu.locator('[data-action="select-assembly"]').click();
  await expect.poll(() => page.evaluate(() => window.__alukit?.selection().length)).toBe(12);
  // Each step request the app sends, timed by the browser from request to response: the
  // server's work, which the review measured at about 2 s each for the preview and the step.
  const answers: { dry: boolean; ms: number }[] = [];
  page.on("requestfinished", (req) => {
    if (req.method() !== "POST" || !req.url().endsWith("/api/commands")) return;
    const body = JSON.parse(req.postData() ?? "{}") as { dryRun?: boolean };
    answers.push({ dry: body.dryRun === true, ms: req.timing().responseEnd });
  });
  await moveTool(page);
  await page.keyboard.type("0, 0, 300");
  await expect
    .poll(() => answers.filter((a) => a.dry).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect(page.getByTestId("joint-preview")).not.toBeEmpty();
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1, 60_000);
  await expect.poll(() => answers.filter((a) => !a.dry).length).toBe(1);
  const said = answers.map((a) => `${a.dry ? "dry run" : "step"} ${a.ms.toFixed(0)} ms`);
  test.info().annotations.push({ type: "server times", description: said.join(", ") });
  // The frame's ends all stay joined, and no free end waits where one lands: the step is the
  // transform alone, with no join to ask for.
  const log = await cli(["log", served.dir, "--json"]);
  const entries = (JSON.parse(log.out) as { entries: { what: string }[] }).entries;
  expect(entries.at(-1)?.what).toBe("transform");
  for (const a of answers) {
    const what = a.dry ? "the preview's dry run" : "the step";
    expect(a.ms, `${what}: ${a.ms.toFixed(0)} ms`).toBeLessThan(500);
  }
});
