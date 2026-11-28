import { expect, type Page, test } from "@playwright/test";
import {
  cli,
  contextMenu,
  openTab,
  type Served,
  selectByIds,
  serve,
  waitDrawn,
} from "./helpers.ts";

/**
 * The designer's re-check of the editing review's fixes, the app's side
 * (docs/ux/review-editing.md §9.4; docs/ux/recheck-fixes-app-decisions.md): what each finding
 * was, held. On tests/fixtures/ux/move: b1 a rail along +X, b2 up +Y from b1's end b, butted on
 * it by c1, b3 a free brace, b4 a free post, p1 a bracket on b1 at 300.
 */

let served: Served | undefined;
test.afterEach(async () => {
  await served?.stop();
  served = undefined;
});

/** Counts the steps the app posts from now on: the commands sent without `dryRun`. */
function countSteps(page: Page): () => number {
  let n = 0;
  page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().endsWith("/api/commands")) return;
    const body = JSON.parse(r.postData() ?? "{}") as { dryRun?: boolean };
    if (!body.dryRun) n++;
  });
  return () => n;
}

/**
 * After Enter on a step its preview refused: nothing was sent, the gesture is still on, and the
 * command bar holds the refusal once, as Enter's answer (N9), in the preview's words, never the
 * API's or a toast's.
 */
async function heldOnce(page: Page, steps: () => number, kind: string, says: string) {
  const bar = page.getByTestId("command-bar");
  await expect(page.getByTestId("tool-result")).toContainText(says);
  await expect(page.getByTestId("joint-preview")).toHaveCount(0);
  const text = (await bar.textContent()) ?? "";
  expect(text.split(says).length - 1).toBe(1);
  expect(await page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe(kind);
  // A refusal the server would answer arrives in well under a second; none was asked.
  await page.waitForTimeout(500);
  expect(steps()).toBe(0);
  expect(await page.evaluate(() => window.__alukit?.drawnRev())).toBe(0);
  await expect(page.locator(".toast.error")).toHaveCount(0);
}

test("N4, N9: a Mirror its preview refuses is not sent on Enter, and the bar says so once", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await selectByIds(page, ["p1"]);
  const menu = await contextMenu(page, [800, 400, 0]);
  await menu.getByRole("menuitem", { name: /^Mirror/ }).click();
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("mirror");
  // Across y = 500, b1 has no image: the core refuses the bracket's mirror, and the preview says so.
  await page.keyboard.press("y");
  await page.keyboard.type("500");
  await expect(page.getByTestId("command-result")).toContainText("across y = 500");
  const says = "no bar stands at its image across y = 500";
  await expect(page.getByTestId("joint-preview")).toContainText(says);
  const steps = countSteps(page);
  await page.keyboard.press("Enter");
  await heldOnce(page, steps, "mirror", says);
  // Changing the plane moves on: the held answer goes with the preview it answered. Esc takes
  // the typed value back and the keyboard with it, so X turns the plane.
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("mirror");
  await page.keyboard.press("x");
  await page.keyboard.type("500");
  await expect(page.getByTestId("joint-preview")).toContainText("makes p2");
  await expect(page.getByTestId("tool-result")).toHaveCount(0);
});

test("N4: a Rotate its preview refuses is not sent on Enter either, by the same gate", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  // b2 is butted on b1: turning it about its own centre would break c1.
  await selectByIds(page, ["b2"]);
  await page.keyboard.press("q");
  await page.keyboard.press("z");
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("rotate");
  await page.keyboard.type("90");
  const says = "would break a joint";
  await expect(page.getByTestId("joint-preview")).toContainText(says);
  const steps = countSteps(page);
  await page.keyboard.press("Enter");
  await heldOnce(page, steps, "rotate", says);
});

test("N4: Pattern's Create is not offered while its preview says the core refuses it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await selectByIds(page, ["b3"]);
  await page.keyboard.press("x");
  await expect(page.getByTestId("pattern-template")).toHaveText("b3");
  await page.getByTestId("pattern-along").fill("b1");
  await page.getByTestId("pattern-pitch").fill("100");
  await page.getByTestId("pattern-count").fill("3");
  await expect(page.getByTestId("pattern-preview")).toContainText("makes 2 copies");
  await expect(page.getByTestId("pattern-apply")).toBeEnabled();
  // Another hand removes the template meanwhile: the form still holds b3, which the core refuses.
  const r = await cli(["do", served.dir, '{"cmd":"removeEntity","args":{"id":"b3"}}']);
  expect(r.code, r.err).toBe(0);
  await waitDrawn(page, 1);
  await expect(page.getByTestId("pattern-preview")).toContainText(
    "Create would be refused: template/0: there is no bar b3",
  );
  await expect(page.getByTestId("pattern-apply")).toBeDisabled();
  await expect(page.getByTestId("pattern-apply")).toHaveAttribute(
    "title",
    /^Create would be refused: template\/0: there is no bar b3/,
  );
});
