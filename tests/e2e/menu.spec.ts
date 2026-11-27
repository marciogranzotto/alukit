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
    /^Copy\s*Ctrl\+C/,
    /^Duplicate\s*Ctrl\+D/,
    /^Mirror…/,
    /^Align to a face…/,
    /^Join b1\.a/,
    /^Replace profile…/,
    /^Fit to the selection\s*F/,
    /^Show/,
  ]);
  const hook = await page.evaluate(() => window.__alukit?.menu());
  expect(hook?.title).toBe("b1");
  expect(hook?.entries.map((e) => [e.id, e.enabled])).toEqual([
    ["delete", true],
    ["copy", true],
    ["duplicate", true],
    ["mirror", true],
    ["align", true],
    ["join-end", true],
    ["replace", true],
    ["fit", true],
    ["show", true],
  ]);
  // The first entry has the focus; the arrow keys move it, and a letter jumps to its entry.
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("s");
  await expect(items.nth(8)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => window.__alukit?.menu())).toBeUndefined();
  // Esc closed the menu and nothing else: b1 stays selected, and no step was made.
  expect(await page.evaluate(() => window.__alukit?.selection())).toEqual(["b1"]);
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
  expect(await docOf(served.dir)).toEqual(before);
});

test("a joint marker's menu offers its joint's Edit and Change connector, which take the inspector to the field (E5.6)", async ({
  page,
}) => {
  served = await serve("base-frame/empty");
  // A ground rectangle drawn and joined as the draw tool joins it: one butt at each corner.
  const bars = [
    { cmd: "addBar", args: { a: [0, 0, 0], b: [1000, 0, 0] } },
    { cmd: "addBar", args: { a: [1000, 0, 0], b: [1000, 600, 0] } },
    { cmd: "addBar", args: { a: [1000, 600, 0], b: [0, 600, 0] } },
    { cmd: "addBar", args: { a: [0, 600, 0], b: [0, 0, 0] } },
  ];
  const joins = [
    [0, 0, 0],
    [1000, 0, 0],
    [1000, 600, 0],
    [0, 600, 0],
  ].map((at) => ({ cmd: "autoConnect", args: { at } }));
  expect((await cli(["do", served.dir, JSON.stringify(bars)])).code).toBe(0);
  expect((await cli(["do", served.dir, JSON.stringify(joins)])).code).toBe(0);
  await openTab(page, served, 2);
  const before = await docOf(served.dir);
  const corner = await page.evaluate(() =>
    window.__alukit?.corners().find((c) => c.key === "1000,600,0"),
  );
  if (!corner) throw new Error("no corner at (1000, 600, 0)");
  const joint = corner.connections[0] as string;

  const menu = await contextMenu(page, corner.at as V3);
  const hook = await page.evaluate(() => window.__alukit?.menu());
  const mine = new Set(["edit-connection", "change-connector"]);
  expect(
    hook?.entries.filter((e) => mine.has(e.id)).map((e) => [e.id, e.title, e.enabled]),
  ).toEqual([
    ["edit-connection", `Edit ${joint}…`, true],
    ["change-connector", "Change connector…", true],
  ]);
  await menu.getByRole("menuitem", { name: /^Change connector/ }).click();
  await expect(menu).toHaveCount(0);
  // The joint is selected, and its Connector field has the focus.
  expect(await page.evaluate(() => window.__alukit?.selection())).toEqual([joint]);
  await expect(page.getByTestId("properties").getByTestId("field-connector")).toBeFocused();

  // Edit, from the menu of the joint itself, takes the focus to its first field.
  await contextMenu(page, corner.at as V3);
  await page
    .getByTestId("context-menu")
    .getByRole("menuitem", { name: /^Edit / })
    .click();
  await expect(page.getByTestId("properties").getByTestId("field-through")).toBeFocused();
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(2);
  expect(await docOf(served.dir)).toEqual(before);
});
