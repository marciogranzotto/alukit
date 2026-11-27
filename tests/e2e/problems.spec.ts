import { expect, test } from "@playwright/test";
import { cli, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The Problems sheet, the order's to-resolve rows and the empty states (docs/ux/plan.md S4.6,
 * S4.8): each blocker has an action that is one step, a list moves with the keys, and an empty
 * project says what is missing, with the next step as a button.
 *
 * Two checks wait for BE-3 (`alukit problems`, S1.6) and skip until the CLI has it: the rail's
 * count of what blocks the order equals the server's `blocks-order` problems, and a project with a
 * bar that has no finish is offered "Set anodised" and "Set black".
 */

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

test.describe("on the cart", () => {
  test.beforeEach(async () => {
    served = await serve("cart");
  });

  test("resolving an open item from the order's blocker drops one blocker, as one step", async ({
    page,
  }) => {
    await openTab(page, served, 0);
    await page.getByRole("tab", { name: "Order & costs" }).click();
    const order = page.getByTestId("order");
    const blockers = async () =>
      new Set(
        await order
          .locator('li.problem[data-group="blocks-order"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute("data-problem"))),
      );
    await expect(order.getByTestId("verdict")).toHaveAttribute("data-status", "BLOCKED");
    const before = await blockers();
    expect(before.size).toBe(6);

    // O2 holds `local`: its row offers a Resolve, which opens its form in the row.
    const row = order.locator('li.problem[data-problem*="O2"]').first();
    await expect(row).toContainText("O2");
    await row.getByRole("button", { name: "Resolve O2…" }).click();
    await row.getByTestId("resolve-why").fill("the shop quoted it");
    await row.getByTestId("resolve-apply").click();
    await waitDrawn(page, 1);
    await expect.poll(async () => (await blockers()).size).toBe(5);
    await expect(order.locator('li.problem[data-problem*="O2"]')).toHaveCount(0);

    // One step: the log has it once, and one undo brings the blocker back.
    const log = JSON.parse((await cli(["log", served.dir, "--json"])).out) as {
      entries: unknown[];
    };
    expect(log.entries).toHaveLength(1);
    await page.getByTestId("undo").click();
    await waitDrawn(page, 2);
    await expect.poll(async () => (await blockers()).size).toBe(6);
  });

  test("the Problems list is grouped, moves with the arrow keys and shows with Enter", async ({
    page,
  }) => {
    await openTab(page, served, 0);
    await page.getByRole("tab", { name: "Problems" }).click();
    const sheet = page.getByTestId("problems");
    await expect(sheet.getByTestId("problem-counts")).toContainText("warnings");
    // Each group is a section with its heading and count; every row says its group in words.
    const warnings = sheet.locator('section[data-group="warning"]');
    await expect(warnings.locator("h4")).toContainText("Warnings");
    const rows = warnings.locator("li.problem");
    expect(await rows.count()).toBeGreaterThan(1);

    await rows.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rows.first()).toBeFocused();
    // Enter shows what the row is about: it is selected.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("properties").locator("h2")).toContainText("c21");
  });

  test("a status is a shape and a word, never a colour alone", async ({ page }) => {
    await openTab(page, served, 0);
    await page.getByRole("tab", { name: "Order & costs" }).click();
    const verdict = page.getByTestId("verdict");
    await expect(verdict).toContainText("Not ready to order");
    await expect(verdict.locator("svg.glyph.blocked")).toHaveCount(1);
    const cards = page.locator("section[data-supplier]");
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const status = await card.getAttribute("data-status");
      await expect(card.locator(".card-head .status-mark")).toContainText(
        status === "BLOCKED" ? "Blocked" : "Ready",
      );
      await expect(card.locator(".card-head svg.glyph")).toHaveCount(1);
    }
  });

  test("the rail's Problems badge counts what blocks the order, from the server's answer", async ({
    page,
  }) => {
    const printed = await cli(["problems", served.dir, "--json"]);
    test.skip(printed.code !== 0, "alukit problems is not built yet (BE-3, S1.6)");
    const answer = JSON.parse(printed.out) as {
      order: { blocks: number };
      problems: { group: string }[];
    };
    expect(answer.order.blocks).toBe(
      answer.problems.filter((p) => p.group === "blocks-order").length,
    );
    await openTab(page, served, 0);
    await expect(page.getByRole("tab", { name: /Problems/ })).toContainText(
      String(answer.order.blocks),
    );
  });
});

test.describe("on an empty project", () => {
  test.beforeEach(async () => {
    served = await serve("base-frame/empty");
  });

  test("each sheet says what is missing and offers the next step", async ({ page }) => {
    await openTab(page, served, 0);
    const cut = page.getByTestId("cutlist");
    await expect(cut).toContainText("Nothing to cut yet");
    await expect(cut.getByRole("button", { name: /Draw a bar/ })).toBeVisible();
    await expect(cut.getByRole("button", { name: "Open the catalog" })).toBeVisible();

    await page.getByRole("tab", { name: "Problems" }).click();
    await expect(page.getByTestId("all-clear")).toContainText("Every check passes");

    await page.getByRole("tab", { name: "Records" }).click();
    await expect(page.getByTestId("decisions")).toContainText("No decisions recorded");

    // The next step is a button that works: Draw a bar arms the tool.
    await page.getByRole("tab", { name: "Cut list" }).click();
    await cut.getByRole("button", { name: /Draw a bar/ }).click();
    await expect.poll(() => page.evaluate(() => window.__alukit?.tool().name)).toBe("draw");
  });
});
