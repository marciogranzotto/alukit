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
  // Each stream adds its actions to the menu as it lands: the seeded ones are there, in their
  // groups' order (select, edit, transform, bar, view), each with its keys, enabled or saying why.
  const hook = await page.evaluate(() => window.__alukit?.menu());
  expect(hook?.title).toBe("b1");
  const ids = hook?.entries.map((e) => e.id) ?? [];
  const seeded = [
    "select-all",
    "select-similar",
    "delete",
    "copy",
    "duplicate",
    "mirror",
    "align",
    // No Join: b1's foot meets nothing and its top is joined, so the check finds no open corner
    // there (review m12); Edit for its joints (M7). No Show on a drawn bar: Fit frames it (m10).
    "replace",
    "split-here",
    "split-at",
    "reverse",
    "add-hole",
    "edit-joint",
    "fit",
  ];
  expect(ids.filter((id) => seeded.includes(id))).toEqual(seeded);
  for (const id of seeded) {
    expect(hook?.entries.find((e) => e.id === id)?.enabled, id).toBe(true);
  }
  const item = (id: string) => menu.locator(`[data-action="${id}"]`);
  // The caps are the platform's (review m5): ⌘ on macOS, Ctrl elsewhere.
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.userAgent));
  const mod = mac ? "⌘" : "Ctrl\\+";
  await expect(item("delete")).toHaveText(/^Delete\s*Delete/);
  await expect(item("copy")).toHaveText(new RegExp(`^Copy\\s*${mod}C`));
  await expect(item("duplicate")).toHaveText(new RegExp(`^Duplicate\\s*${mod}D`));
  await expect(item("mirror")).toHaveText(/^Mirror…/);
  await expect(item("align")).toHaveText(/^Align to a face…/);
  await expect(item("replace")).toHaveText(/^Replace profile…/);
  await expect(item("split-here")).toHaveText(/^Split b1 here, \d+ mm from end a/);
  await expect(item("split-at")).toHaveText(/^Split b1 at…/);
  await expect(item("reverse")).toHaveText(/^Reverse b1/);
  await expect(item("add-hole")).toHaveText(
    /^Add a hole on b1's face [+-][xy] \(world [+-][XYZ]\), \d+ mm from end a's cut…/,
  );
  await expect(item("edit-joint")).toHaveText(/^Edit (c\d+|a joint of b1)…/);
  await expect(item("fit")).toHaveText(/^Fit to the selection\s*F/);
  await expect(item("select-all")).toHaveText(new RegExp(`^Select all\\s*${mod}A`));
  // The first entry has the focus; the arrow keys move it, and a letter jumps to its entry.
  const items = menu.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("r");
  await expect(item("replace")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => window.__alukit?.menu())).toBeUndefined();
  // Esc closed the menu and nothing else: b1 stays selected, and no step was made.
  expect(await page.evaluate(() => window.__alukit?.selection())).toEqual(["b1"]);
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
  expect(await docOf(served.dir)).toEqual(before);
});

test("a right-drag pans and opens no menu; Shift+F10 opens it for the selection", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const at = await onB1(page);
  const s = await page.evaluate((p) => window.__alukit?.screen(p), at);
  if (!s) throw new Error("b1 is off the screen");
  const camera = () => page.evaluate(() => window.__alukit?.camera()?.target);
  const before = await camera();
  // A right press, a drag, a release: the camera pans (E-UX-2), and nothing opens.
  await page.mouse.move(s[0], s[1]);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(s[0] + 80, s[1] + 30, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await expect
    .poll(async () => page.evaluate(() => window.__alukit?.camera()?.moving), { timeout: 10_000 })
    .toBe(false);
  expect(await camera()).not.toEqual(before);
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
  expect(await page.evaluate(() => window.__alukit?.selection())).toEqual([]);

  // Shift+F10, with b5 selected and the focus off the outline: the menu about b5, in the view.
  await selectByIds(page, ["b5"]);
  await page.getByTestId("skip-link").focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByTestId("context-menu");
  await expect(menu).toHaveAttribute("aria-label", "Actions on b5");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  const vb = await page.getByTestId("viewport").boundingBox();
  const mb = await menu.boundingBox();
  if (!vb || !mb) throw new Error("no box");
  expect(mb.x).toBeGreaterThanOrEqual(vb.x);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  // The Menu key does the same; nothing was written.
  await page.getByTestId("skip-link").focus();
  await page.keyboard.press("ContextMenu");
  await expect(menu).toHaveAttribute("aria-label", "Actions on b5");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
});

test("a right-click on an outline row opens the menu about it; a head's, about its members", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  await selectByIds(page, ["b2"]);
  const tree = page.getByTestId("tree");
  await tree.locator('[data-id="b9"]').click({ button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toHaveAttribute("aria-label", "Actions on b9");
  expect(await page.evaluate(() => window.__alukit?.selection())).toEqual(["b9"]);
  // Shift+F10 on a focused row opens it there, about the selection.
  await page.keyboard.press("Escape");
  await tree.locator('[data-id="b9"]').focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toHaveAttribute("aria-label", "Actions on b9");
  // By the row: just right of its start, from its foot (or above, when the page ends first).
  const row = await tree.locator('[data-id="b9"]').boundingBox();
  const mb = await menu.boundingBox();
  if (!row || !mb) throw new Error("no box");
  expect(Math.abs(mb.x - (row.x + 24))).toBeLessThan(6);
  expect(mb.y).toBeLessThanOrEqual(row.y + row.height + 1);
  await page.keyboard.press("Escape");
  // A group's head: its members, the 34 bars and their pattern copies.
  const bars = await tree.locator('[data-key^="r:bars:"]').count();
  await tree.locator('[data-key="g:bars"]').click({ button: "right" });
  await expect(menu).toHaveAttribute("aria-label", `Actions on ${bars} selected`);
  await page.keyboard.press("Escape");
});

test("the selection header's buttons are the registry's edits, greyed with why", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  await selectByIds(page, ["b1"]);
  const head = page.getByTestId("properties").locator(".insp-head");
  const ids = () =>
    head
      .locator("[data-action]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-action")));
  // Delete, as the Delete action (its title, its key); in a tool it is greyed, saying why.
  expect(await ids()).toContain("delete");
  const del = head.locator('[data-action="delete"]');
  await expect(del).toHaveText(/^Delete\s*Delete$/);
  await expect(del).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("b");
  await expect(del).toHaveAttribute("aria-disabled", "true");
  await expect(del).toHaveAttribute("title", "Delete works in Select: press Esc first");
  await page.keyboard.press("Escape");
  // Several selected: the same buttons, about them all; a click runs the action: Delete's dialog
  // lists what else goes, and nothing is written yet.
  await selectByIds(page, ["b1", "b2"]);
  await head.locator('[data-action="delete"]').click();
  await expect(page.getByTestId("delete-dialog")).toBeVisible();
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
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
