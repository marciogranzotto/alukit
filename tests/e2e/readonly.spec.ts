import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, test } from "@playwright/test";
import { cli, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * M4a, done when (design §12): an invalid direct edit makes both tabs read-only, with the error.
 * The watcher reads the file; every client shows why; commands are refused until the file is
 * valid again or someone chooses "restore last good" (§7.1).
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

test("an invalid direct edit makes both tabs read-only, showing the error", async ({ context }) => {
  const tabs = [await context.newPage(), await context.newPage()];
  for (const t of tabs) await openTab(t, served, 0);
  const file = join(served.dir, "alukit.json");
  const good = await readFile(file, "utf8");

  // A hand edit that breaks the JSON: a missing comma.
  await writeFile(file, good.replace('"name": "Cart (synthetic)",', '"name": "Cart (synthetic)"'));
  for (const t of tabs) {
    const banner = t.getByTestId("read-only");
    await expect(banner).toBeVisible({ timeout: 3000 });
    await expect(banner).toContainText("Read-only.");
    await expect(banner).toContainText("alukit.json");
    await expect(banner).toContainText("Expected ',' or '}' after property value");
    await expect(t.getByTestId("undo")).toBeDisabled();
    expect(await t.evaluate(() => window.__alukit?.readOnly())).toBe(true);
  }

  // Commands are refused, from the CLI too, and say why.
  const r = await cli(["add", "bar", served.dir, "--a", "0,0,0", "--b", "0,-300,0"]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("refused: the project is read-only");

  // A valid edit ends it, and is a step every tab draws.
  await writeFile(file, good.replace('"Hb": "100"', '"Hb": "150"'));
  for (const t of tabs) {
    await expect(t.getByTestId("read-only")).toBeHidden({ timeout: 3000 });
    await waitDrawn(t, 1, 3000);
  }

  // Broken again: "Restore last good" in one tab writes the state the server holds.
  await writeFile(file, "{");
  for (const t of tabs) await expect(t.getByTestId("read-only")).toBeVisible({ timeout: 3000 });
  // It asks first (D-UX-15), then names the copy the server kept of the rejected text (BE-9).
  await tabs[0]?.getByRole("button", { name: "Restore last good" }).click();
  await tabs[0]?.getByTestId("restore-confirm").click();
  for (const t of tabs) await expect(t.getByTestId("read-only")).toBeHidden({ timeout: 3000 });
  expect(await readFile(file, "utf8")).toContain('"Hb": "150"');
  const told = tabs[0]?.getByTestId("notice");
  await expect(told as Locator).toContainText("The rejected text is kept in .alukit/rejected/");
  const kept = /(\.alukit\/rejected\/\S+\.json)/.exec((await told?.textContent()) ?? "")?.[1];
  expect(kept).toBeDefined();
  expect(await readFile(join(served.dir, kept as string), "utf8")).toBe("{");
});
