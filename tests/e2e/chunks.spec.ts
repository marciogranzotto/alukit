import { expect, test } from "@playwright/test";
import { openTab, type Served, serve } from "./helpers.ts";

/**
 * The app's chunks (docs/ux/integration-decisions.md): the page loads the app and three.js's two
 * chunks, and nothing a flow it has not opened needs; each sheet but the cut list, project
 * settings and the corner inspector load the first time they open, from the server's own origin,
 * under its Content-Security-Policy (`default-src 'self'`), with nothing refused, thrown or
 * logged as an error.
 */

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

/** A lazy chunk's file, by the module it starts from (Vite names a chunk after it). */
const LAZY =
  /\/assets\/(Bom|Machining|OrderCosts|ProblemsSheet|Records|Settings|CornerInspector|SKILL|schema)-[\w-]+\.js$/;

test("the page loads the app and three.js; each flow's chunk loads when it opens, under the policy", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || /content security policy/i.test(m.text())) problems.push(m.text());
  });
  const scripts: { url: string; status: number }[] = [];
  page.on("response", (r) => {
    if (r.url().endsWith(".js")) scripts.push({ url: r.url(), status: r.status() });
  });
  served = await serve("cart");
  await openTab(page, served, 0);
  const origin = new URL(served.appUrl).origin;
  const names = () => scripts.map((s) => new URL(s.url).pathname.replace(/-[\w-]{8}\.js$/, ""));
  // At the first draw: the app's chunk and three.js's two, and no flow's.
  expect(names().sort()).toEqual(["/assets/index", "/assets/three", "/assets/three-core"]);

  // Each sheet's body comes with its first showing.
  for (const [tab, testid, chunk] of [
    [/^BOM/, "bom", "Bom"],
    [/^Machining/, "machining", "Machining"],
    [/^Order & costs/, "order", "OrderCosts"],
    [/^Problems/, "problems", "ProblemsSheet"],
    [/^Records/, "records", "Records"],
  ] as const) {
    expect(names(), chunk).not.toContain(`/assets/${chunk}`);
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByTestId(testid).first()).toBeVisible();
    expect(names(), chunk).toContain(`/assets/${chunk}`);
  }

  // Project settings.
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("settings-form")).toBeVisible();
  expect(names()).toContain("/assets/Settings");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings")).toBeHidden();

  // The corner inspector, on a corner chosen in the outline's Joints group.
  const corner = await page.evaluate(() => window.__alukit?.corners()[0]);
  if (!corner) throw new Error("the cart has no corner");
  await page.locator(`[data-id="corner:${corner.key}"]`).click();
  await expect(page.getByTestId("properties")).toHaveAttribute("data-corner", corner.key);
  expect(names()).toContain("/assets/CornerInspector");

  // Every script came from the server's origin, whole, and the lazy ones are what loaded late.
  for (const s of scripts) {
    expect(new URL(s.url).origin, s.url).toBe(origin);
    expect(s.status, s.url).toBe(200);
  }
  expect(scripts.filter((s) => LAZY.test(s.url)).length).toBeGreaterThanOrEqual(7);
  expect(problems).toEqual([]);
});
