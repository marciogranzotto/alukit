import { expect, type Page, test } from "@playwright/test";
import { cli, docOf, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * A bar's joints and its ends' words (docs/ux/review-editing.md M7, m12): a face joint is reached
 * from the bar it holds, by the bar's Joints row and its menu; an end reads "open" only where the
 * check finds an open corner, and Join is offered only where the problem list offers the join, so
 * it is never offered and then refused. Each outcome is checked against the CLI's document.
 */

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function doAll(dir: string, ...batches: unknown[][]): Promise<void> {
  for (const b of batches) {
    const r = await cli(["do", dir, JSON.stringify(b)]);
    expect(r.code, r.err || r.out).toBe(0);
  }
}

/** Selects an entity by its outline row and waits for its inspector. */
async function pick(page: Page, id: string): Promise<void> {
  const filter = page.getByRole("searchbox", { name: "Filter the outline" });
  await filter.fill(id);
  await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText(id);
}

/** The menu of the selection, opened from its outline row by the keyboard (Shift+F10). */
async function menuOf(page: Page, id: string) {
  await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByTestId("context-menu")).toBeVisible();
  return (await page.evaluate(() => window.__alukit?.menu()))?.entries ?? [];
}

test("a T-nut plate's face joint is reached from the plate; its ends are held, not open (M7)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // A12's plate (as editing.spec builds it): a 40 × 40 rail and a flat plate on it, held by
  // T-nuts at two stations.
  served = await serve("cart");
  await doAll(
    served.dir,
    [
      {
        cmd: "addBar",
        args: { item: "test:TS40", a: [0, 2000, 0], b: [400, 2000, 0], anchor: "-y" },
      },
      {
        cmd: "addBar",
        args: { item: "test-geo:FB-50x20", a: [0, 2000, 40], b: [400, 2000, 40], anchor: "-y" },
      },
    ],
    [
      {
        cmd: "addConnection",
        args: {
          type: "face",
          bars: ["b36", "b35"],
          fastening: "tnut",
          fastener: "test-gen:SCR-M5x25",
          stack: ["test-gen:TNUT-M5"],
          stations: { at_mm: [100, 300] },
          label: "T-nut plate",
        },
      },
    ],
  );
  await openTab(page, served, 2);

  // The plate: its ends are held by the face joint, with no Join to refuse.
  await pick(page, "b36");
  for (const e of ["a", "b"]) {
    await expect(page.getByTestId(`row-end-${e}`)).toContainText("held by c36 (face joint)");
    await expect(page.getByTestId(`row-end-${e}`)).not.toContainText("open");
    await expect(page.getByTestId(`join-end-${e}`)).toHaveCount(0);
  }
  // Its joints, with Edit: the face joint's fields, focused.
  await expect(page.getByTestId("joint-c36")).toContainText(
    "face joint c36 (T-nut plate): with b35, 2 stations",
  );
  await page.getByTestId("joint-edit-c36").click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText("c36");
  await expect(page.getByTestId("face-edit")).toBeVisible();

  // The plate's menu: Edit c36…, which opens the same; no Join.
  await pick(page, "b36");
  const entries = await menuOf(page, "b36");
  expect(entries.find((x) => x.id === "join-end")).toBeUndefined();
  expect(entries.find((x) => x.id === "edit-joint")).toMatchObject({
    title: "Edit c36…",
    enabled: true,
  });
  await page.getByTestId("context-menu").locator('[data-action="edit-joint"]').click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText("c36");
  await expect(page.getByTestId("face-edit")).toBeVisible();
  // The rail it lies on lists the same joint.
  await pick(page, "b35");
  await expect(page.getByTestId("joint-c36")).toContainText("with b36, 2 stations");
  expect(await page.evaluate(() => window.__alukit?.drawnRev())).toBe(2);
});

test("Join only where the problem list joins: an open corner joins; a mitred one says why (m12)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("base-frame/empty");
  await doAll(served.dir, [
    // A corner the default butt joins: b1 and b2 meet at (500, 0, 0).
    { cmd: "addBar", args: { a: [0, 0, 0], b: [500, 0, 0] } },
    { cmd: "addBar", args: { a: [500, 0, 0], b: [500, 400, 0] } },
    // A mitred corner with a third end in it, which nothing butts on: b5 at (2000, 0, 0).
    { cmd: "addBar", args: { a: [1500, 0, 0], b: [2000, 0, 0] } },
    { cmd: "addBar", args: { a: [2000, 0, 0], b: [2000, 400, 0] } },
    { cmd: "addConnection", args: { type: "miter", ends: ["b3.b", "b4.a"] } },
    { cmd: "addBar", args: { a: [2000, 0, 0], b: [2000, 0, 400] } },
  ]);
  await openTab(page, served, 1);

  // b5: open at its foot, but the default butt cannot join it: the check's reason, no Join.
  await pick(page, "b5");
  await expect(page.getByTestId("row-end-a")).toContainText("open: nothing joins it");
  await expect(page.getByTestId("join-end-why-a")).toContainText(
    "only b5 meets at that point: nothing butts on it",
  );
  await expect(page.getByTestId("join-end-a")).toHaveCount(0);
  // Its top meets nothing: unjoined, not open.
  await expect(page.getByTestId("row-end-b")).toContainText("nothing joins it");
  await expect(page.getByTestId("row-end-b")).not.toContainText("open");
  await expect(page.getByTestId("join-end-b")).toHaveCount(0);
  const entries = await menuOf(page, "b5");
  expect(entries.find((x) => x.id === "join-end")).toMatchObject({ enabled: false });
  expect(entries.find((x) => x.id === "join-end")?.why).toContain("nothing butts on it");
  await page.keyboard.press("Escape");

  // b2: open at its end a, and Join joins it, one step.
  await pick(page, "b2");
  await expect(page.getByTestId("row-end-a")).toContainText("open: nothing joins it");
  await expect(page.getByTestId("join-end-a")).toBeEnabled();
  await page.getByTestId("join-end-a").click();
  await waitDrawn(page, 2);
  const conns = (await docOf(served.dir)).connections as Record<string, { type: string }>;
  expect(Object.values(conns).filter((c) => c.type === "butt")).toHaveLength(1);
  await expect(page.getByTestId("row-end-a")).not.toContainText("open");
});
