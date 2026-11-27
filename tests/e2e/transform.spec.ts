import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  cli,
  contextMenu,
  lastStepWords,
  openTab,
  type Served,
  scratchProject,
  selectByIds,
  serve,
  waitDrawn,
} from "./helpers.ts";

/**
 * The transform tools (docs/ux/editing-audit.md §7.7, E3.1, E3.2 and E3.5–E3.8;
 * docs/ux/e3-decisions.md): Rotate (Q), Mirror and Align from the menu, point to point in Move,
 * a part slid along its bar by its gizmo arrow, and the previews' cost. On tests/fixtures/ux/move
 * (b1 a rail along +X, 1000 long; b2 up +Y from b1's end b, butted on it by c1; b3 a free brace
 * at x = 500 from y = 600 to 300; b4 a free post at (200, 300) up to z = 400; p1 a bracket on b1
 * at 300) and tests/fixtures/brace (the 1000 × 600 × 750 box frame of 40 × 40). Each outcome is
 * checked against what the CLI makes of the same step on a scratch copy (`alukit diff`).
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function doc(dir: string): Promise<{
  bars: Record<string, { a: unknown; b: unknown }>;
  parts?: Record<string, { on?: { at_mm: unknown } }>;
}> {
  return JSON.parse(await readFile(join(dir, "alukit.json"), "utf8"));
}

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is off the screen`);
  return s;
}

/** `alukit diff` of the app's project against a scratch copy the CLI edited: the same project. */
async function sameAsCli(dir: string, fixture: string, steps: string[][]): Promise<void> {
  const copy = await scratchProject(fixture);
  try {
    for (const s of steps) {
      const r = await cli([s[0] as string, copy.dir, ...s.slice(1)]);
      expect(r.code, r.err).toBe(0);
    }
    const d = await cli(["diff", dir, copy.dir, "--format", "json"]);
    expect(d.code, d.err).toBe(0);
    const out = JSON.parse(d.out) as { same: boolean; entities: unknown[] };
    expect(out.entities).toEqual([]);
    expect(out.same).toBe(true);
  } finally {
    await copy.remove();
  }
}

/** Counts the dry runs the app posts from now on. */
function countDryRuns(page: Page): () => number {
  let n = 0;
  page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().endsWith("/api/commands")) return;
    const body = JSON.parse(r.postData() ?? "{}") as { dryRun?: boolean };
    if (body.dryRun) n++;
  });
  return () => n;
}

test("Rotate (Q): b1 and its bracket, with b2, turned 90° about Z through b1's end, as alukit rotate turns them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await selectByIds(page, ["b1", "b2"]);
  await page.keyboard.press("q");
  await expect(page.getByTestId("tool-rotate")).toHaveAttribute("aria-pressed", "true");
  // The rings stand at the selection's centre until a centre is picked.
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.gizmo()))
    .toMatchObject({ parts: ["ring-x", "ring-y", "ring-z"] });
  // A click on b1's end a is the centre (point to point, E3.5).
  const at = await screen(page, [0, 0, 0]);
  await page.mouse.click(at[0], at[1]);
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("rotate");
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.gizmo()))
    .toMatchObject({
      at: [0, 0, 0],
    });
  await page.keyboard.press("z");
  await page.keyboard.type("90");
  await expect(page.getByTestId("command-result")).toContainText("90° about Z through [0, 0, 0]");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect(await lastStepWords(served.dir)).toBe(
    "turn b1 and b2 90° about z through [0, 0, 0], p1 following",
  );
  await sameAsCli(served.dir, "ux/move", [
    ["rotate", "--ids", "b1,b2", "--axis", "z", "--deg", "90", "--about", "0,0,0"],
  ]);
  expect(errors).toEqual([]);
});

test("Rotate from the keyboard: Q, X, 90, Enter turns about X through the selection's centre", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  // The focus stays on the outline's row: the turn's keys still reach it.
  await selectByIds(page, ["b3"]);
  await page.keyboard.press("q");
  await page.keyboard.press("x");
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("rotate");
  await page.keyboard.type("90");
  await expect(page.getByTestId("command-result")).toContainText(
    "90° about X through [500, 450, 0]",
  );
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect(await lastStepWords(served.dir)).toBe("turn b3 90° about x through [500, 450, 0]");
  expect((await doc(served.dir)).bars.b3).toMatchObject({
    a: [500, 450, 150],
    b: [500, 450, -150],
  });
});

test("a ring's drag turns in 15° steps, previewed locally: few dry runs, no shader linked", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __links: number };
    w.__links = 0;
    const link = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (p) {
      w.__links++;
      link.call(this, p);
    };
  });
  served = await serve("ux/move");
  await openTab(page, served, 0);
  const links = () => page.evaluate(() => (window as unknown as { __links: number }).__links);
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.frames()?.modelFrame ?? 0))
    .toBeGreaterThan(0);
  await selectByIds(page, ["b3"]);
  await page.keyboard.press("q");
  // The rings stand at the selection's centre, b3's middle: a ring dragged turns about it.
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.gizmo()))
    .toMatchObject({
      at: [500, 450, 0],
    });
  const before = await links();
  const dryRuns = countDryRuns(page);
  // The Z ring lies in the ground plane round the centre, 0.78 of the 96 px arrow out: found
  // through the ground's map to the screen near the centre, then swept a quarter round, 60
  // moves 16 ms apart, from where it crosses the screen's horizontal on the left (the bar's
  // label sits over its right side).
  const c: V3 = [500, 450, 0];
  const o = await screen(page, c);
  const ex = await screen(page, [510, 450, 0]);
  const ey = await screen(page, [500, 460, 0]);
  // Ground (dx, dy) → screen: J = [[a, b], [c, d]] per 10 mm.
  const J = [
    [(ex[0] - o[0]) / 10, (ey[0] - o[0]) / 10],
    [(ex[1] - o[1]) / 10, (ey[1] - o[1]) / 10],
  ] as const;
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  const px = -0.78 * 96;
  // The world offset that comes out px to the right on the screen (to the left: px < 0).
  const w: [number, number] = [(J[1][1] * px) / det, (-J[1][0] * px) / det];
  const r = Math.hypot(w[0], w[1]);
  const phi0 = Math.atan2(w[1], w[0]);
  const on = (deg: number): V3 => [
    c[0] + r * Math.cos(phi0 + (deg * Math.PI) / 180),
    c[1] + r * Math.sin(phi0 + (deg * Math.PI) / 180),
    0,
  ];
  const start = await screen(page, on(0));
  await page.mouse.move(start[0], start[1]);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    const s = await screen(page, on((i * 90) / 60));
    await page.mouse.move(s[0], s[1]);
    await page.waitForTimeout(16);
  }
  await expect(page.getByTestId("command-result")).toContainText("90° about Z");
  expect(dryRuns()).toBeLessThanOrEqual(8);
  await page.mouse.up();
  await waitDrawn(page, 1);
  expect(await lastStepWords(served.dir)).toBe("turn b3 90° about z through [500, 450, 0]");
  expect((await doc(served.dir)).bars.b3).toMatchObject({ a: [350, 450, 0], b: [650, 450, 0] });
  // The rings, the turned ghost and the revision linked no program.
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.frames()?.modelFrame ?? 0))
    .toBeGreaterThan(0);
  expect(await links()).toBe(before);
});

test("Move's drag asks few dry runs: 60 pointer moves, at most 8", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await selectByIds(page, ["b1"]);
  await page.keyboard.press("d");
  const dryRuns = countDryRuns(page);
  const from = await screen(page, [700, 0, 0]);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    const s = await screen(page, [700, -i * 5, 0]);
    await page.mouse.move(s[0], s[1]);
    await page.waitForTimeout(16);
  }
  expect(dryRuns()).toBeLessThanOrEqual(8);
  await page.keyboard.press("Escape");
  await page.mouse.up();
});

test("Mirror from the menu: the bracket across x = 500, as alukit do mirror makes it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await selectByIds(page, ["p1"]);
  // A right-click on open ground opens the menu on the selection.
  const menu = await contextMenu(page, [800, 400, 0]);
  await menu.getByRole("menuitem", { name: /^Mirror/ }).click();
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("mirror");
  // The plane is square to X by default; a value typed is where it crosses X.
  await page.keyboard.type("500");
  await expect(page.getByTestId("command-result")).toContainText("across x = 500");
  await expect(page.getByTestId("joint-preview")).toContainText("makes p2");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect(await lastStepWords(served.dir)).toBe("mirror p1, making p2");
  await sameAsCli(served.dir, "ux/move", [
    ["do", '{"cmd":"mirror","args":{"ids":["p1"],"plane":{"axis":"x","at_mm":500}}}'],
  ]);
});

test("Move point to point: a brace moved from its end to the post's end lands on it exactly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await selectByIds(page, ["b3"]);
  await page.keyboard.press("d");
  const from = await screen(page, [500, 300, 0]);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0] - 10, from[1], { steps: 2 });
  const to = await screen(page, [200, 300, 400]);
  await page.mouse.move(to[0], to[1], { steps: 10 });
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.snap)).toMatch(/b4\.b/);
  await page.mouse.up();
  await waitDrawn(page, 1);
  expect((await doc(served.dir)).bars.b3).toMatchObject({ b: [200, 300, 400] });
});

test("Align: a top rail 7 mm below the posts' tops is flush after one Align", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serve("brace");
  await openTab(page, served, 0);
  const r = await cli(["move", served.dir, "--ids", "b9", "--by", "0,0,-7"]);
  expect(r.code, r.err).toBe(0);
  await waitDrawn(page, 1);
  await selectByIds(page, ["b9"]);
  const menu = await contextMenu(page, [500, 300, 0]);
  await menu.getByRole("menuitem", { name: /^Align/ }).click();
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("align");
  // The front-left post's top, an end face (its body spans x and y 0 to 40), is the target.
  const top = await screen(page, [20, 20, 750]);
  await page.mouse.move(top[0], top[1]);
  await expect(page.getByTestId("command-result")).toContainText("b1's top");
  await page.mouse.click(top[0], top[1]);
  await waitDrawn(page, 2);
  expect(await lastStepWords(served.dir)).toMatch(/^move b9 by \[0, 0, 7\]/);
  expect((await doc(served.dir)).bars.b9).toMatchObject({ a: [0, 0, 750], b: [1000, 0, 750] });
});

test("a part selected alone slides along its bar by its gizmo arrow: from 300 to 450", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await selectByIds(page, ["p1"]);
  // The arrow is along b1, X, at the bracket.
  const g = await expect
    .poll(() => page.evaluate(() => window.__alukit?.gizmo()))
    .toMatchObject({ parts: ["move-x"] })
    .then(() => page.evaluate(() => window.__alukit?.gizmo() as unknown as { at: V3 }));
  const at = g.at;
  // A press on the arrow's shaft, 40 px out along it, then a drag of 150 mm along X.
  const o = await screen(page, at);
  const ten = await screen(page, [at[0] + 10, at[1], at[2]]);
  const pxPerMm = Math.hypot(ten[0] - o[0], ten[1] - o[1]) / 10;
  const a = 40 / pxPerMm;
  const press = await screen(page, [at[0] + a, at[1], at[2]]);
  const end = await screen(page, [at[0] + a + 150, at[1], at[2]]);
  await page.mouse.move(press[0], press[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 12 });
  await expect(page.getByTestId("command-result")).toContainText("by [150, 0, 0]");
  await page.mouse.up();
  await waitDrawn(page, 1);
  expect((await doc(served.dir)).parts?.p1?.on?.at_mm).toBe(450);
});
