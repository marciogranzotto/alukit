import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  cli,
  lastStepWords,
  openTab,
  type Served,
  scratchProject,
  selectByIds,
  serve,
  waitDrawn,
} from "./helpers.ts";

/**
 * The copy tools (docs/ux/editing-audit.md §7.7, E3.3 and E3.4; docs/ux/e3-decisions.md):
 * Duplicate (Ctrl/Cmd+D) is a Move session on a copy, one `array` step with a join at each new
 * bar's ends, and `4x` or `/4` typed in the session makes more; Copy and Paste (Ctrl/Cmd+C, V)
 * start one from the pointer. On tests/fixtures/brace, the 1000 × 600 × 750 box frame of 40 × 40:
 * posts b1–b4, base rails b5–b8, top rails b9 (front) to b12. Cut lists are compared with the CLI
 * sending the same batches to a scratch copy.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function doc(dir: string): Promise<{
  bars: Record<string, { a: unknown; b: unknown }>;
  connections: Record<string, { type: string; through?: string; ends?: string[] }>;
}> {
  return JSON.parse(await readFile(join(dir, "alukit.json"), "utf8"));
}

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is off the screen`);
  return s;
}

async function cutList(dir: string): Promise<string> {
  const r = await cli(["cutlist", dir, "--format", "json"]);
  expect(r.code, r.err).toBe(0);
  return r.out;
}

test("Duplicate: the top front rail 300 down, joined to the posts; then /3 on another: the CLI's cuts and counts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("brace");
  await openTab(page, served, 0);
  await selectByIds(page, ["b9"]);
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("duplicate");
  await expect(page.getByTestId("command-bar")).toHaveAttribute("data-tool", "duplicate");
  // Locked to Z, 300 down: one step, a new rail butted at both ends.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("-300");
  await expect(page.getByTestId("command-result")).toContainText("by [0, 0, -300]");
  await expect(page.getByTestId("joint-preview")).toContainText("makes b13");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect(await lastStepWords(served.dir)).toBe("copy b9, making b13, joined at 2 ends");
  const d = await doc(served.dir);
  expect(d.bars.b13).toMatchObject({ a: [0, 0, 450], b: [1000, 0, 450] });
  const butts = Object.values(d.connections).filter((c) => c.type === "butt");
  expect(butts.filter((c) => c.ends?.includes("b13.a") || c.ends?.includes("b13.b"))).toHaveLength(
    2,
  );

  // The back top rail, 600 down divided into three gaps: three rails at 200, 400 and 600 down.
  await selectByIds(page, ["b10"]);
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("duplicate");
  await page.keyboard.type("0, 0, -600 /3");
  await expect(page.getByTestId("command-result")).toContainText("3 copies");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 2);
  expect(await lastStepWords(served.dir)).toBe(
    "copy b10, making b14, b15 and b16, joined at 6 ends",
  );

  // The same two batches from the CLI: the same cut list, byte for byte.
  const copy = await scratchProject("brace");
  try {
    const first = [
      { cmd: "array", args: { ids: ["b9"], along: { dir: [0, 0, -1] }, pitch_mm: 300, count: 2 } },
      { cmd: "autoConnect", args: { at: [0, 0, 450], optional: true } },
      { cmd: "autoConnect", args: { at: [1000, 0, 450], optional: true } },
    ];
    const second = [
      { cmd: "array", args: { ids: ["b10"], along: { dir: [0, 0, -1] }, pitch_mm: 200, count: 4 } },
      ...[550, 350, 150].flatMap((z) => [
        { cmd: "autoConnect", args: { at: [0, 600, z], optional: true } },
        { cmd: "autoConnect", args: { at: [1000, 600, z], optional: true } },
      ]),
    ];
    for (const b of [first, second]) {
      const r = await cli(["do", copy.dir, JSON.stringify(b)]);
      expect(r.code, r.err).toBe(0);
    }
    expect(await cutList(served.dir)).toBe(await cutList(copy.dir));
  } finally {
    await copy.remove();
  }
  expect(errors).toEqual([]);
});

test("Copy and paste: Ctrl+C on b9, Ctrl+V, a click on a snap: one step, one new bar", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("brace");
  await openTab(page, served, 0);
  await selectByIds(page, ["b9"]);
  await page.keyboard.press("ControlOrMeta+c");
  // The pointer over the view, then paste: the copy hangs from it by b9's end a.
  const at = await screen(page, [0, 600, 0]);
  await page.mouse.move(at[0], at[1]);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("duplicate");
  await page.mouse.move(at[0] + 1, at[1]);
  await page.mouse.move(at[0], at[1]);
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.gesture()?.snap))
    .toMatch(/b3\.a|b6\.a|b7\.b/);
  const before = Object.keys((await doc(served.dir)).bars).length;
  await page.mouse.click(at[0], at[1]);
  await waitDrawn(page, 1);
  const bars = (await doc(served.dir)).bars;
  expect(Object.keys(bars)).toHaveLength(before + 1);
  expect(bars.b13).toMatchObject({ a: [0, 600, 0], b: [1000, 600, 0] });
  expect(await lastStepWords(served.dir)).toMatch(/^copy b9, making b13/);
});
