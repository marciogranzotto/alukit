import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cli, lastStepWords, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The drawer's record sheets (design §8, §4.12): open items (in Problems), params and decisions
 * (in Records), edited through their commands. Each edit is one step, which the top bar's undo takes back; what a command
 * refuses is shown in the tab.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

interface Doc {
  open?: { id: string; text: string; blocks?: string | null; scope?: string[] }[];
  decisions?: { id: string; text: string; why?: string; resolves?: string }[];
  params?: Record<string, unknown>;
}

async function doc(): Promise<Doc> {
  return JSON.parse(await readFile(join(served.dir, "alukit.json"), "utf8")) as Doc;
}

test("adds an open item and resolves it, each one step that undo takes back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTab(page, served, 0);
  await page.getByRole("tab", { name: "Problems" }).click();
  const tab = page.getByTestId("open-items");
  await expect(tab.locator("tr[data-open]")).toHaveCount(2);

  // Add: one batch, one step.
  await tab.getByTestId("open-text").fill("check the casters' load rating");
  await tab.getByTestId("open-scope").fill("b1, b2");
  await tab.getByTestId("open-apply").click();
  await waitDrawn(page, 1);
  await expect(tab.locator('tr[data-open="O3"]')).toContainText("check the casters' load rating");
  expect((await doc()).open?.find((o) => o.id === "O3")).toEqual({
    id: "O3",
    text: "check the casters' load rating",
    blocks: "order",
    scope: ["b1", "b2"],
  });
  // It holds the order of the suppliers of what it names, as alukit order says.
  const order = JSON.parse(
    (await cli(["order", served.dir, "--format", "json", "--as-of", "2026-11-26"])).out,
  ) as { suppliers: { reasons: { rule: string; message: string }[] }[] };
  expect(
    order.suppliers.some((s) =>
      s.reasons.some((r) => r.rule === "open-item" && r.message.includes("O3")),
    ),
  ).toBe(true);

  // Resolve: the item leaves the list and a dated decision records how.
  await tab.locator('tr[data-open="O3"]').getByTestId("resolve").click();
  await tab.getByTestId("resolve-why").fill("the supplier's sheet says 80 kg each");
  await tab.getByTestId("resolve-apply").click();
  await waitDrawn(page, 2);
  await expect(tab.locator('tr[data-open="O3"]')).toHaveCount(0);
  await page.getByRole("tab", { name: "Records" }).click();
  const decisions = page.getByTestId("decisions");
  await expect(decisions.locator('tr[data-decision="D1"]')).toContainText(
    "resolved: check the casters' load rating",
  );
  await expect(decisions.locator('tr[data-decision="D1"]')).toContainText("O3");
  const d = await doc();
  expect(d.open?.map((o) => o.id)).toEqual(["O1", "O2"]);
  expect(d.decisions).toMatchObject([{ id: "D1", resolves: "O3" }]);

  // Undo takes back the resolution, then the item itself; it names the step in words.
  await expect(page.getByTestId("undo")).toHaveText(
    `Undo · you: ${await lastStepWords(served.dir)}`,
  );
  await page.getByTestId("undo").click();
  await waitDrawn(page, 3);
  await expect(decisions.locator("tr[data-decision]")).toHaveCount(0);
  await page.getByRole("tab", { name: "Problems" }).click();
  await expect(tab.locator('tr[data-open="O3"]')).toHaveCount(1);
  expect((await doc()).open?.map((o) => o.id)).toEqual(["O1", "O2", "O3"]);
  await page.getByTestId("undo").click();
  await waitDrawn(page, 4);
  await expect(tab.locator('tr[data-open="O3"]')).toHaveCount(0);
  expect((await doc()).open?.map((o) => o.id)).toEqual(["O1", "O2"]);
  const log = JSON.parse((await cli(["log", served.dir, "--json"])).out) as {
    entries: { source: string }[];
  };
  expect(log.entries.map((e) => e.source)).toEqual(["ui", "ui", "ui", "ui"]);
  expect(errors).toEqual([]);
});

test("sets a param and records a decision; a refusal is shown in the tab", async ({ page }) => {
  await openTab(page, served, 0);
  // The params are in the project panel, the inspector with nothing selected (D-UX-4, S2.12).
  const tab = page.getByTestId("project-panel").getByTestId("params");
  const w = tab.locator('tr[data-param="W"]');
  await expect(w.getByTestId("param-value")).toHaveText("1200");

  await w.getByTestId("param-change").click();
  await w.getByTestId("param-edit").fill("1300");
  await w.getByTestId("param-set").click();
  await waitDrawn(page, 1);
  await expect(w.getByTestId("param-value")).toHaveText("1300");
  expect((await doc()).params?.W).toBe(1300);
  const b5 = JSON.parse((await cli(["derive", served.dir, "--json"])).out) as {
    bars: Record<string, { len_mm: number }>;
  };
  expect(b5.bars.b5?.len_mm).toBe(1300);

  // A valued field keeps its provenance when its value is edited.
  const h = tab.locator('tr[data-param="H"]');
  await h.getByTestId("param-change").click();
  await h.getByTestId("param-edit").fill("950");
  await h.getByTestId("param-set").click();
  await waitDrawn(page, 2);
  expect((await doc()).params?.H).toEqual({ v: 950, src: "meas", note: "under a bench top" });

  // Removing a param something reads is refused, and the tab says why.
  await h.getByTestId("param-remove").click();
  await expect(tab.getByTestId("form-errors")).toContainText("H is read by");
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(2);

  await page.getByRole("tab", { name: "Records" }).click();
  const decisions = page.getByTestId("decisions");
  await decisions.getByTestId("decision-text").fill("widen the cart to 1300");
  await decisions.getByTestId("decision-why").fill("the new bench is wider");
  await decisions.getByTestId("decision-date").fill("2026-11-20");
  await decisions.getByTestId("decision-apply").click();
  await waitDrawn(page, 3);
  await expect(decisions.locator('tr[data-decision="D1"]')).toContainText("20 Nov 2026");
  expect((await doc()).decisions).toEqual([
    { id: "D1", date: "2026-11-20", text: "widen the cart to 1300", why: "the new bench is wider" },
  ]);
});
