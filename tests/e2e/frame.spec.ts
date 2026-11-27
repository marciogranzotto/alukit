import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cli, openTab, type Served, scratchProject, serve, waitDrawn } from "./helpers.ts";

/**
 * The box frame (docs/ux/plan.md D-UX-8, S5.7): the `G` tool makes a frame from a corner click,
 * `W, D` typed and the height typed, as one `addFrame` step; the start card offers the same form.
 * Either way the project's cut list is `alukit add frame`'s with the same arguments, byte for
 * byte. On the cart's empty base frame, whose default bar is test:TS40.
 */

type V3 = [number, number, number];

let served: Served;
test.beforeEach(async () => {
  served = await serve("base-frame/empty");
});
test.afterEach(async () => {
  await served.stop();
});

interface Derived {
  bars: Record<string, unknown>;
  connections?: Record<string, unknown>;
  diagnostics: { code: string }[];
}

async function derived(dir: string): Promise<Derived> {
  const r = await cli(["derive", dir, "--json"]);
  return JSON.parse(r.out) as Derived;
}

async function connections(dir: string): Promise<string[]> {
  const doc = JSON.parse(await readFile(join(dir, "alukit.json"), "utf8")) as {
    connections?: Record<string, unknown>;
  };
  return Object.keys(doc.connections ?? {});
}

/** The cut list of `alukit add frame` with these arguments, on a fresh copy of the fixture. */
async function cliFrameCutlist(args: string[]): Promise<string> {
  const other = await scratchProject("base-frame/empty");
  try {
    const made = await cli(["add", "frame", other.dir, ...args]);
    expect(made.code, made.err).toBe(0);
    const r = await cli(["cutlist", other.dir, "--format", "json"]);
    expect(r.code, r.err).toBe(0);
    return r.out;
  } finally {
    await other.remove();
  }
}

async function cutlist(dir: string): Promise<string> {
  const r = await cli(["cutlist", dir, "--format", "json"]);
  expect(r.code, r.err).toBe(0);
  return r.out;
}

async function tool(page: Page) {
  return page.evaluate(() => window.__alukit?.tool());
}

test("G, a click at the origin, 1000,600 Enter, 800 Enter: a closed frame, as alukit add frame makes it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTab(page, served, 0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("start-card")).toBeHidden();

  await page.keyboard.press("g");
  expect(await tool(page)).toMatchObject({ name: "frame", stage: "corner" });
  const panel = page.getByTestId("panel-frame");
  await expect(panel).toBeVisible();
  // The command bar holds the prompt, the value and its result; the options are the panel's
  // alone (review M6).
  await expect(page.getByTestId("command-bar").locator("select, input[type=checkbox]")).toHaveCount(
    0,
  );
  // The project names no butt connector, so the frame asks how its corners are joined (review
  // B1): nothing here, as `alukit add frame` without --connector.
  await panel.getByTestId("frame-joint").selectOption("-");
  const p: V3 = [0, 0, 0];
  const at = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!at) throw new Error("the origin is not on the screen");
  await page.mouse.move(at[0], at[1], { steps: 4 });
  await expect.poll(async () => (await tool(page))?.snap ?? "").toBe("grid (0, 0, 0)");
  await page.mouse.click(at[0], at[1]);
  expect((await tool(page))?.stage).toBe("size");

  await page.keyboard.type("1000,600");
  await expect(page.getByTestId("command-result")).toContainText("1000 mm × 600 mm");
  await page.keyboard.press("Enter");
  expect((await tool(page))?.stage).toBe("height");
  await page.keyboard.type("800");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);

  // 12 bars (4 posts, a base and a top ring), 8 butts, no open end.
  const d = await derived(served.dir);
  expect(Object.keys(d.bars)).toHaveLength(12);
  expect(await connections(served.dir)).toHaveLength(8);
  expect(d.diagnostics.filter((x) => x.code === "unconnected-end")).toEqual([]);
  // One step, in words, in the command bar.
  await expect(page.getByTestId("tool-result")).toContainText("frame");

  expect(await cutlist(served.dir)).toBe(
    await cliFrameCutlist(["--at", "0,0,0", "--size", "1000,600,800", "--item", "test:TS40"]),
  );
  expect(errors).toEqual([]);
});

test("the start card's box frame makes the same frame, with its numbers from a dry run", async ({
  page,
}) => {
  await openTab(page, served, 0);
  const card = page.getByTestId("start-card");
  const form = card.getByTestId("frame-form");
  await expect(form).toBeVisible();
  await form.getByTestId("frame-w").fill("1000");
  await form.getByTestId("frame-d").fill("600");
  await form.getByTestId("frame-h").fill("W - 400");
  // Until the corners' joint is chosen, the frame says so rather than being made (review B1).
  const numbers = form.getByTestId("frame-numbers");
  await expect(numbers).toContainText("Joined with");
  await expect(form.getByTestId("frame-create")).toBeDisabled();
  await form.getByTestId("frame-joint").selectOption("-");
  // The numbers come from the dry run: 800 posts, 1000 and 520 rails (40 lost at each butt).
  await expect(numbers).toContainText("posts 4 × 800");
  await expect(numbers).toContainText("8 butts");
  await form.getByTestId("frame-create").click();
  await waitDrawn(page, 1);
  await expect(card).toBeHidden();
  expect(await cutlist(served.dir)).toBe(
    await cliFrameCutlist(["--at", "0,0,0", "--size", "1000,600,800", "--item", "test:TS40"]),
  );
});
