import { expect, test } from "@playwright/test";
import { cli, lastStepWords, openTab, type Served, serve } from "./helpers.ts";

/**
 * Presence and another source's steps (docs/ux/plan.md S2.8, D-UX-14; U16, U17): an agent's step
 * shows in every tab as a toast naming it, with Show; the outline marks what it made; Undo says
 * whose step it takes back, and asks first; confirming takes the step back in every tab.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

test("an agent's step is told in every tab, and undoing it asks first", async ({ context }) => {
  const tabs = [await context.newPage(), await context.newPage()];
  const errors: string[] = [];
  for (const t of tabs) t.on("pageerror", (e) => errors.push(e.message));
  for (const t of tabs) await openTab(t, served, 0);
  const before = await tabs[0]?.evaluate(() => window.__alukit?.stats()?.bars);

  const r = await cli([
    "add",
    "bar",
    served.dir,
    "--a",
    "0,0,0",
    "--b",
    "0,-300,0",
    "--as",
    "agent:claude",
  ]);
  expect(r.code, r.err).toBe(0);
  const words = await lastStepWords(served.dir);
  expect(words).toBe("add bar b35");

  for (const t of tabs) {
    const toast = t.getByTestId("step-toast");
    await expect(toast).toContainText(`claude: ${words}`);
    await expect(toast).toHaveAttribute("data-source", "agent:claude");
    await expect(t.getByTestId("undo")).toHaveText(`Undo · claude: ${words}`);
    // The outline marks what the agent made, until the person's next step.
    await expect(
      t.getByTestId("tree").locator('[data-id="b35"] [data-testid="new-mark"]'),
    ).toHaveText("new · claude");
    await expect(t.getByTestId("presence")).toContainText("claude");
  }

  // Show selects what the step made.
  const first = tabs[0];
  if (!first) throw new Error("no tab");
  await first.getByTestId("step-toast").getByRole("button", { name: "Show" }).click();
  await expect(first.getByTestId("properties").locator("h2")).toContainText("b35");

  // Undo names the agent's step and asks first; confirming takes it back in both tabs.
  await first.getByTestId("undo").click();
  const dialog = first.getByTestId("undo-confirm-dialog");
  await expect(dialog).toContainText("This step was claude's");
  await expect(dialog).toContainText(words);
  await first.getByTestId("undo-confirm").click();
  await Promise.all(
    tabs.map((t) =>
      t.waitForFunction(
        (n) => window.__alukit?.drawnRev() === 2 && window.__alukit?.stats()?.bars === n,
        before as number,
        { timeout: 3000, polling: 10 },
      ),
    ),
  );
  await expect(first.getByTestId("tree").locator('[data-id="b35"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("cancelling the question leaves the step; Ctrl+Z asks as the button does", async ({
  page,
}) => {
  await openTab(page, served, 0);
  expect(
    (
      await cli([
        "add",
        "bar",
        served.dir,
        "--a",
        "0,0,0",
        "--b",
        "0,-300,0",
        "--as",
        "agent:claude",
      ])
    ).code,
  ).toBe(0);
  await expect(page.getByTestId("undo")).toContainText("claude");
  await page.locator("body").press("Control+z");
  const dialog = page.getByTestId("undo-confirm-dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(1);
});
