import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cli, derivedBarCount, dev, type Served, waitDrawn } from "./helpers.ts";

/**
 * `pnpm dev` with a project (design §10): the app from Vite's dev server, with hot reload, draws
 * the project its mounted server owns, and takes the CLI's edits live, as under `alukit serve`.
 */

let served: Served;
test.beforeEach(async () => {
  served = await dev("cart");
});
test.afterEach(async () => {
  await served.stop();
});

test("the app under Vite draws the project, follows a CLI edit, and shows the order", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  await page.goto(served.appUrl);
  // The first load may wait for Vite to bundle the dependencies.
  await waitDrawn(page, 0, 60_000);
  await expect(page.getByTestId("connection")).toHaveText("live");
  const stats = await page.evaluate(() => window.__alukit?.stats());
  expect(stats?.bars).toBe(await derivedBarCount(served.dir));

  // The CLI finds the dev server through the owner file; the edit reaches the tab.
  const owner = JSON.parse(await readFile(join(served.dir, ".alukit", "owner.json"), "utf8"));
  expect(owner.url).toBe(served.url);
  const d = await cli(["do", served.dir, '{"cmd":"addNode","args":{"at":[1,2,3]}}']);
  expect(d.code).toBe(0);
  await waitDrawn(page, 1);

  await page.getByRole("tab", { name: /^Order & costs/ }).click();
  await expect(page.getByTestId("order")).toHaveAttribute("data-rev", "1");
  await expect(page.getByTestId("order").locator("section").first()).toBeVisible();
  // Nothing refused by the page's policy (the HMR socket included), nothing thrown.
  expect(problems).toEqual([]);
});
