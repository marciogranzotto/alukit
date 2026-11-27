import { expect, type Page, test } from "@playwright/test";
import { cli, contextMenu, docOf, openTab, type Served, selectByIds, serve } from "./helpers.ts";

/**
 * The context menu (docs/ux/editing-audit.md E-UX-1, E-UX-2, E0.4): a right-click that does not
 * move opens it on what is under the pointer, selecting that first; it lists the action
 * registry's actions by group, each with its keys, one that cannot run now greyed with why;
 * Esc closes it and gives the focus back, and nothing is written. On the cart, whose b1 is the
 * post at the origin (end a open, end b butted by c1).
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

/** A point on one of b1's side faces that the view shows on top, found by hovering it. */
async function onB1(page: Page): Promise<V3> {
  const r = await cli(["derive", served.dir, "--json"]);
  const b1 = (
    JSON.parse(r.out) as {
      bars: Record<string, { a: V3; frame: { x: V3; y: V3; z: V3 }; box_mm: [V3, V3] }>;
    }
  ).bars.b1;
  if (!b1) throw new Error("no b1");
  const [[x0, y0], [x1, y1]] = b1.box_mm;
  const at = (lx: number, ly: number): V3 =>
    [0, 1, 2].map(
      (i) =>
        (b1.a[i] as number) +
        (b1.frame.x[i] as number) * lx +
        (b1.frame.y[i] as number) * ly +
        (b1.frame.z[i] as number) * 300,
    ) as V3;
  const cx = ((x0 as number) + (x1 as number)) / 2;
  const cy = ((y0 as number) + (y1 as number)) / 2;
  for (const p of [
    at(x1 as number, cy),
    at(x0 as number, cy),
    at(cx, y1 as number),
    at(cx, y0 as number),
  ]) {
    const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
    if (!s) continue;
    await page.mouse.move(s[0], s[1]);
    const shown = await expect
      .poll(() => page.evaluate(() => window.__alukit?.hovered()), { timeout: 1_000 })
      .toEqual(["b1"])
      .then(
        () => true,
        () => false,
      );
    if (shown) return p;
  }
  throw new Error("no face of b1 is on top in this view");
}

test("a right-click opens the menu on b1 with the seeded actions; Esc closes it", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const before = await docOf(served.dir);
  await selectByIds(page, ["b2"]);
  const at = await onB1(page);

  const menu = await contextMenu(page, at);
  // What was under the pointer is selected first (E-UX-2), and the menu names it.
  expect(await page.evaluate(() => window.__alukit?.selection())).toEqual(["b1"]);
  await expect(menu).toHaveAttribute("aria-label", "Actions on b1");
  const items = menu.getByRole("menuitem");
  await expect(items).toHaveText([
    /^Delete\s*Delete/,
    /^Join b1\.a/,
    /^Replace profile…/,
    /^Split b1 here, \d+ mm from end a/,
    /^Split b1 at…/,
    /^Reverse b1/,
    /^Fit to the selection\s*F/,
    /^Show/,
  ]);
  const hook = await page.evaluate(() => window.__alukit?.menu());
  expect(hook?.title).toBe("b1");
  expect(hook?.entries.map((e) => [e.id, e.enabled])).toEqual([
    ["delete", true],
    ["join-end", true],
    ["replace", true],
    ["split-here", true],
    ["split-at", true],
    ["reverse", true],
    ["fit", true],
    ["show", true],
  ]);
  // The first entry has the focus; the arrow keys move it, and a letter jumps to its entry.
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("s");
  await expect(items.nth(3)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => window.__alukit?.menu())).toBeUndefined();
  // Esc closed the menu and nothing else: b1 stays selected, and no step was made.
  expect(await page.evaluate(() => window.__alukit?.selection())).toEqual(["b1"]);
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
  expect(await docOf(served.dir)).toEqual(before);
});
