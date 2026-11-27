import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cli, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The keys and the command bar (docs/ux/plan.md D-UX-17, D-UX-18, S5.1, S5.2): a value typed while
 * drawing takes units and params, and its letters stay in the value (U20); the arrow keys lock the
 * axis; Space chains; Esc steps back one level; X opens Pattern; with single-key shortcuts off, a
 * tool's letter does nothing. On the cart's empty base frame, whose params hold W = 1200 and whose
 * default bar is test:TS40.
 */

type V3 = [number, number, number];

let served: Served;
test.beforeEach(async () => {
  served = await serve("base-frame/empty");
});
test.afterEach(async () => {
  await served.stop();
});

async function tool(page: Page) {
  return page.evaluate(() => window.__alukit?.tool());
}

async function hover(page: Page, p: V3, snap?: RegExp): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is not on the screen`);
  await page.mouse.move(s[0], s[1], { steps: 4 });
  if (snap) await expect.poll(async () => (await tool(page))?.snap ?? "").toMatch(snap);
  return s as [number, number];
}

async function bars(dir: string): Promise<Record<string, { a: unknown; b: unknown }>> {
  const doc = JSON.parse(await readFile(join(dir, "alukit.json"), "utf8")) as {
    bars?: Record<string, { a: unknown; b: unknown }>;
  };
  return doc.bars ?? {};
}

async function derivedBar(
  dir: string,
  id: string,
): Promise<{ len_mm: number; cut_mm: number } | undefined> {
  const r = await cli(["derive", dir, "--json"]);
  return (JSON.parse(r.out) as { bars: Record<string, { len_mm: number; cut_mm: number }> }).bars[
    id
  ];
}

async function cut(dir: string, id: string): Promise<number | undefined> {
  return (await derivedBar(dir, id))?.cut_mm;
}

/** Opens the tab, closes the start card and picks Draw bar with its key. */
async function startDrawing(page: Page): Promise<void> {
  await openTab(page, served, 0);
  await expect(page.getByTestId("start-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("start-card")).toBeHidden();
  // An empty project shows a metre of ground: zoom out over it to make room.
  const vb = await page.getByTestId("viewport").boundingBox();
  if (!vb) throw new Error("no viewport");
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(async () => page.evaluate(() => window.__alukit?.camera()?.moving), { timeout: 10_000 })
    .toBe(false);
  await expect(page.getByTestId("palette-bar")).toHaveCount(0);
  await page.keyboard.press("b");
  await expect(page.getByTestId("palette-bar")).toHaveAttribute("data-id", "test:TS40");
  expect((await tool(page))?.name).toBe("draw");
}

test("a typed value takes units and params; the arrow keys lock; Space chains", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await startDrawing(page);

  // 1.2m: the letter is the value's unit, not the Measure tool's key (U20).
  const [x, y] = await hover(page, [0, 0, 0], /^grid \(0, 0, 0\)$/);
  await page.mouse.click(x, y);
  await hover(page, [0, 0, 400], /^\+z /);
  await page.keyboard.type("1.2m");
  expect(await tool(page)).toMatchObject({ name: "draw", typed: "1.2m" });
  await expect(page.getByTestId("command-result")).toContainText("1200 mm");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect((await bars(served.dir)).b1).toMatchObject({ a: [0, 0, 0], b: [0, 0, 1200] });
  expect(await cut(served.dir, "b1")).toBe(1200);
  expect((await tool(page))?.name).toBe("draw");

  // Space: the next bar starts at the last one's end.
  await page.keyboard.press("Space");
  expect((await tool(page))?.start).toBe("end b1.b");

  // →: the line keeps to X, wherever the pointer is.
  await hover(page, [600, 0, 1500]);
  await page.keyboard.press("ArrowRight");
  expect((await tool(page))?.lock).toBe("x");
  await expect(page.getByTestId("draw-lock")).toContainText("X");
  await expect.poll(async () => (await tool(page))?.end ?? "").toMatch(/^\+x /);

  // = starts an expression: W / 2 + 20 with W = 1200 is 620, written with its param.
  await page.keyboard.press("=");
  await page.keyboard.type("W/2+20");
  await expect(page.getByTestId("command-result")).toContainText("W/2+20 = 620 mm");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 2);
  expect((await bars(served.dir)).b2).toMatchObject({ a: [0, 0, 1200], b: ["W/2+20", 0, 1200] });
  // 620 is its drawn length; auto-connect butts it on the post, so its cut is 20 less.
  expect(await derivedBar(served.dir, "b2")).toMatchObject({ len_mm: 620, cut_mm: 600 });
  // The lock ends with the gesture.
  expect((await tool(page))?.lock).toBeUndefined();
  expect(errors).toEqual([]);
});

test("Ctrl+A selects all; H hides, Shift+H isolates, Alt+H shows all; single keys off: H does nothing", async ({
  page,
}) => {
  // The editing round's keys (E2.8), on the audit's frame: twelve bars, b1–b4 its posts.
  await served.stop();
  served = await serve("brace");
  await openTab(page, served, 0);
  const selection = () => page.evaluate(() => window.__alukit?.selection());
  const hidden = () => page.evaluate(() => window.__alukit?.hidden());
  const twelve = Array.from({ length: 12 }, (_, i) => `b${i + 1}`);
  await page.locator("body").press("ControlOrMeta+a");
  expect(await selection()).toEqual(twelve);
  await page.locator("body").press("h");
  expect(await hidden()).toEqual(twelve);
  expect(await selection()).toEqual([]);
  await page.locator("body").press("Alt+h");
  expect(await hidden()).toEqual([]);
  await page.getByTestId("tree").locator('[data-id="b1"]').click();
  await page.locator("body").press("Shift+H");
  expect(await hidden()).toEqual(twelve.filter((b) => b !== "b1"));
  await page.locator("body").press("Alt+h");
  expect(await hidden()).toEqual([]);

  // The help lists them, under Selecting and View.
  await page.locator("body").press("?");
  const help = page.getByTestId("help");
  await expect(help).toContainText("Select every bar and part shown");
  await expect(help).toContainText("Hide the selection");
  await expect(help).toContainText("Show only the selection; hide the rest");
  await expect(help).toContainText("Show everything hidden again");

  // Single-key shortcuts off: H and Shift+H do nothing; the chords still work.
  await help.getByTestId("letter-keys").uncheck();
  await page.keyboard.press("Escape");
  await page.getByTestId("tree").locator('[data-id="b1"]').click();
  await page.locator("body").press("h");
  await page.locator("body").press("Shift+H");
  expect(await hidden()).toEqual([]);
  await page.locator("body").press("ControlOrMeta+a");
  expect(await selection()).toEqual(twelve);
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
});

test("Esc steps back one level; X opens Pattern; with single keys off, B does nothing", async ({
  page,
}) => {
  await startDrawing(page);
  const [x, y] = await hover(page, [0, 0, 0], /^grid \(0, 0, 0\)$/);
  await page.mouse.click(x, y);
  await hover(page, [0, 0, 400], /^\+z /);
  await page.keyboard.type("5");
  expect(await tool(page)).toMatchObject({ typed: "5", start: "grid (0, 0, 0)" });

  // What is typed, then the gesture, then the tool, then the selection.
  await page.keyboard.press("Escape");
  expect(await tool(page)).toMatchObject({ name: "draw", start: "grid (0, 0, 0)" });
  expect((await tool(page))?.typed).toBeUndefined();
  await page.keyboard.press("Escape");
  expect((await tool(page))?.start).toBeUndefined();
  expect((await tool(page))?.name).toBe("draw");
  await page.keyboard.press("Escape");
  expect((await tool(page))?.name).toBe("select");

  // X: Pattern; G: Box frame.
  await page.keyboard.press("x");
  expect((await tool(page))?.name).toBe("pattern");
  await expect(page.getByTestId("panel-pattern")).toBeVisible();
  await page.keyboard.press("g");
  expect((await tool(page))?.name).toBe("frame");
  await page.keyboard.press("Escape");
  expect((await tool(page))?.name).toBe("select");

  // Single-key shortcuts off (help's switch): B does nothing; the rail still works.
  await page.keyboard.press("?");
  const help = page.getByTestId("help");
  await help.getByTestId("letter-keys").uncheck();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await page.keyboard.press("b");
  expect((await tool(page))?.name).toBe("select");
  await page.getByTestId("tool-draw").click();
  expect((await tool(page))?.name).toBe("draw");
});
