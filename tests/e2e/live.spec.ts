import { expect, test } from "@playwright/test";
import { cli, openTab, type Served, serve } from "./helpers.ts";

/**
 * M4a, done when (design §12): a CLI command appears in two open tabs within 1 s, at the same
 * revision. The command runs as its own process, finds the server through `.alukit/owner.json`
 * and goes through it (§7.1); the server broadcasts the revision and each tab redraws.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

test("a CLI command appears in two open tabs within 1 s, at the same revision", async ({
  context,
}) => {
  const tabs = [await context.newPage(), await context.newPage()];
  const errors: string[] = [];
  for (const t of tabs) t.on("pageerror", (e) => errors.push(e.message));
  for (const t of tabs) await openTab(t, served, 0);
  const before = await tabs[0]?.evaluate(() => window.__alukit?.stats()?.bars);
  expect(before).toBeGreaterThan(0);

  const started = Date.now();
  const r = await cli(["add", "bar", served.dir, "--a", "0,0,0", "--b", "0,-300,0", "--as", "e2e"]);
  expect(r.code, r.err).toBe(0);
  expect(r.out).toContain("addBar: created b35");
  expect(r.out).toMatch(/^rev 1: /m);

  // Both tabs: the server's revision, the scene drawn at it, and the new bar in the scene.
  await Promise.all(
    tabs.map((t) =>
      t.waitForFunction(
        (n) =>
          window.__alukit?.rev() === 1 &&
          window.__alukit?.drawnRev() === 1 &&
          window.__alukit?.stats()?.bars === n,
        (before as number) + 1,
        { timeout: 1000, polling: 10 },
      ),
    ),
  );
  const shown = Date.now();
  test.info().annotations.push({
    type: "timing",
    description: `in both tabs ${shown - r.exitedAt} ms after the CLI exited (${shown - started} ms from its start, Node startup included)`,
  });
  expect(shown - r.exitedAt).toBeLessThan(1000);

  for (const t of tabs) {
    await expect(t.getByTestId("rev")).toHaveText("rev 1");
    await expect(t.getByTestId("undo")).toHaveText("Undo addBar");
    await expect(t.getByTestId("tree").locator('[data-id="b35"]')).toBeVisible();
  }

  // Undo from one tab is the server's undo: both tabs follow.
  await tabs[1]?.getByTestId("undo").click();
  await Promise.all(
    tabs.map((t) =>
      t.waitForFunction(
        (n) => window.__alukit?.drawnRev() === 2 && window.__alukit?.stats()?.bars === n,
        before as number,
        { timeout: 2000, polling: 10 },
      ),
    ),
  );
  // `alukit log` prints each step in words (BE-4); `--json` keeps the command names as `what`.
  const log = await cli(["log", served.dir]);
  expect(log.out).toMatch(/1 {2}cli:e2e +add bar b35$/m);
  expect(log.out).toMatch(/2 {2}ui +undo add bar b35$/m);
  expect(errors).toEqual([]);
});
