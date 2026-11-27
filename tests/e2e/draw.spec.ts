import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { lockStamp, oldestCutRead, withStamp } from "../../src/core/testing.ts";
import { cli, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * M4b, done when (design §12): a script draws the cart's base frame with the mouse, and its
 * derived cut list and BOM equal those of the CLI-built fixture.
 *
 * The base frame is the cart's bars b1–b10 and the connections that cut them (see
 * src/core/base-frame.test.ts, which holds the cart to the same lines): four posts, the front
 * and back top rails (40x80 rolled 90°) with the side rails between them, all butting through
 * the front and back rails, and two base rails butting through the posts. The script starts
 * from tests/fixtures/base-frame/empty (the cart's settings, no entities), sets the palette in
 * the catalog browser, draws each bar with the mouse (lengths typed, rolls and anchors keyed),
 * connects the top frame with the connect tool, and lets auto-connect butt the base rails into
 * the posts. The CLI-built fixture is tests/fixtures/base-frame/cli.
 */

const FIXTURE = fileURLToPath(new URL("../fixtures/base-frame/cli", import.meta.url));
const BARS = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10"];

type V3 = [number, number, number];

let served: Served;
test.beforeEach(async () => {
  served = await serve("base-frame/empty");
});
test.afterEach(async () => {
  await served.stop();
});

/** Where a world point is on the page. */
async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is not on the screen`);
  return s;
}

async function tool(page: Page) {
  return page.evaluate(() => window.__alukit?.tool());
}

/** Waits until the camera has come to rest: a point stays where it is on the page. */
async function settle(page: Page): Promise<void> {
  let last = "";
  for (let i = 0; i < 100; i++) {
    const now = JSON.stringify(await screen(page, [0, 0, 0]));
    if (now === last) return;
    last = now;
    await page.waitForTimeout(120);
  }
  throw new Error("the camera never came to rest");
}

/**
 * Moves the mouse onto a world point, and checks what the tool says is there: its `snap`, the
 * machine label of what the pointer is on, which the hint words for the person.
 */
async function hover(page: Page, p: V3, says?: string | RegExp): Promise<void> {
  const [x, y] = await screen(page, p);
  await page.mouse.move(x, y, { steps: 4 });
  if (says !== undefined) {
    await expect.poll(async () => (await tool(page))?.snap ?? "", { timeout: 2000 }).toMatch(says);
  }
}

async function click(page: Page, p: V3, says?: string | RegExp): Promise<void> {
  await hover(page, p, says);
  const [x, y] = await screen(page, p);
  await page.mouse.click(x, y);
}

/** Presses a key until the tool shows the option wanted (A cycles anchors, R rolls). */
async function keyUntil(page: Page, key: "a" | "r", want: string | number): Promise<void> {
  for (let i = 0; i < 16; i++) {
    const t = await tool(page);
    if ((key === "a" ? t?.anchor : t?.roll) === want) return;
    await page.keyboard.press(key);
  }
  throw new Error(`${key} never reached ${want}`);
}

/** Join ends is in the command bar's Options (review M5): open them, set it, close them. */
async function joinEnds(page: Page, on: boolean): Promise<void> {
  const options = page.getByTestId("draw-options");
  await options.click();
  await page.getByTestId("draw-autoconnect").setChecked(on);
  await options.click();
  await expect(page.getByTestId("draw-autoconnect")).toBeHidden();
}

async function setPalette(page: Page, code: string): Promise<void> {
  await page.getByTestId("left-catalog").click();
  await page.getByTestId("catalog-search").fill(code);
  await page.locator(`.card[data-id="test:${code}"]`).click();
  await expect(page.getByTestId("catalog-card")).toHaveAttribute("data-id", `test:${code}`);
  await page.getByTestId("palette-set").click();
  await expect(page.getByTestId("palette-bar")).toHaveAttribute("data-id", `test:${code}`);
}

test("draws the cart's base frame with the mouse; its cut list and BOM equal the CLI-built fixture's", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTab(page, served, 0);
  // An empty project shows the start card over the viewport: Esc closes it first (plan §5.10).
  await expect(page.getByTestId("start-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("start-card")).toBeHidden();
  let rev = 0;
  const next = async () => {
    rev++;
    await waitDrawn(page, rev);
  };

  /** One bar: a click at the start, then a typed length along the axis under the pointer. */
  const typedBar = async (
    from: V3,
    says: string | RegExp,
    toward: V3,
    axis: RegExp,
    len: string,
  ) => {
    await click(page, from, says);
    await hover(page, toward, axis);
    await page.keyboard.type(len);
    await page.keyboard.press("Enter");
    await next();
  };
  /** One bar from a snap point to a snap point. */
  const pointBar = async (from: V3, fromSays: string, to: V3, toSays: string) => {
    await click(page, from, fromSays);
    await click(page, to, toSays);
    await next();
  };

  // An empty project shows a metre of ground: zoom out over it to make room for the frame.
  const viewport = page.getByTestId("viewport");
  const vb = await viewport.boundingBox();
  if (!vb) throw new Error("no viewport");
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.mouse.wheel(0, 400);
  await settle(page);

  // The posts: 40x40, 900 up from the ground's grid, each anchored on its outer corner.
  await setPalette(page, "TS40");
  await expect(page.getByTestId("tool-draw")).toHaveClass(/on/);
  const posts: [V3, string][] = [
    [[0, 0, 0], "-x-y"],
    [[1200, 0, 0], "+x-y"],
    [[0, 600, 0], "-x+y"],
    [[1200, 600, 0], "+x+y"],
  ];
  for (const [p, anchor] of posts) {
    await keyUntil(page, "a", anchor);
    await typedBar(p, `grid (${p.join(", ")})`, [p[0], p[1], 450], /^\+z /, "900");
  }
  // Everything drawn so far in view.
  await page.getByTestId("view-iso").click();
  await settle(page);

  // The front and back top rails: 40x80 rolled flat, on the posts, flush outside and on top.
  // Their ends close on the posts' tops; the connect tool joins them after.
  await setPalette(page, "TS4080");
  await joinEnds(page, false);
  await keyUntil(page, "r", 90);
  await keyUntil(page, "a", "+x+y");
  await pointBar([0, 0, 900], "end b1.b", [1200, 0, 900], "end b2.b");
  await keyUntil(page, "a", "+x-y");
  await pointBar([0, 600, 900], "end b3.b", [1200, 600, 900], "end b4.b");

  // The side top rails, between them.
  await setPalette(page, "TS40");
  await keyUntil(page, "r", 0);
  await keyUntil(page, "a", "+x+y");
  await pointBar([0, 0, 900], "end b1.b", [0, 600, 900], "end b3.b");
  await keyUntil(page, "a", "-x+y");
  await pointBar([1200, 0, 900], "end b2.b", [1200, 600, 900], "end b4.b");

  // Connect: the posts and side rails butt through each long top rail (picked on the bodies).
  await page.getByTestId("tool-connect").click();
  const pick = async (p: V3, ref: string) => click(page, p, new RegExp(`^(bar|end) ${ref}$`));
  await pick([600, 40, 900], "b5");
  await pick([20, 0, 780], "b1\\.b");
  await pick([1180, 0, 780], "b2\\.b");
  await pick([20, 120, 900], "b7\\.a");
  await pick([1180, 120, 900], "b8\\.a");
  await expect(page.getByTestId("connect-picks").locator("li")).toHaveCount(5);
  await page.getByTestId("connect-apply").click();
  await next();
  await pick([600, 560, 900], "b6");
  await pick([40, 580, 780], "b3\\.b");
  await pick([1200, 580, 780], "b4\\.b");
  await pick([20, 480, 900], "b7\\.b");
  await pick([1180, 480, 900], "b8\\.b");
  await page.getByTestId("connect-apply").click();
  await next();

  // The base rails: 100 above the ground on the posts' lines, typed 1200 along X; auto-connect
  // butts each end through the post it lands on.
  await page.getByTestId("tool-draw").click();
  await joinEnds(page, true);
  await keyUntil(page, "a", "-x");
  await typedBar([0, 0, 100], "on b1 at 100", [600, 0, 100], /^\+x /, "1200");
  await keyUntil(page, "a", "+x");
  await typedBar([0, 600, 100], "on b3 at 100", [600, 600, 100], /^\+x /, "1200");

  // The drawn frame: its cut list and BOM, from the CLI, equal the CLI-built fixture's.
  const restrict = (json: string) => {
    const o = JSON.parse(json) as {
      groups: { lines: { sources: string[] }[] }[];
    };
    for (const g of o.groups)
      g.lines = g.lines.filter((l) => l.sources.every((s) => BARS.includes(s)));
    return o;
  };
  for (const [cmd, file] of [
    ["cutlist", "expected-cutlist.json"],
    ["bom", "expected-bom.json"],
  ] as const) {
    const r = await cli([cmd, served.dir, "--format", "json"]);
    expect(r.code, r.err).toBe(0);
    const expected = await readFile(join(FIXTURE, file), "utf8");
    // The outputs state the lock they derived from (design §5.4), and the cut list its oldest
    // price read date: the golden plus the stamp's lines.
    const lock = lockStamp(served.dir);
    const stamped =
      cmd === "cutlist"
        ? withStamp(expected, "price_basis", {
            oldest_read: oldestCutRead(JSON.parse(expected), served.dir),
            lock,
          })
        : withStamp(expected, "schema", { lock });
    expect(restrict(r.out)).toEqual(restrict(stamped));
    // Restricting changes nothing: the drawn project is the base frame and nothing else.
    expect(`${r.out.trimEnd()}\n`).toBe(stamped);
  }
  expect(errors).toEqual([]);
});
