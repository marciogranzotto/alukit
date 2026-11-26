import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cli, openTab, type Served, serve, waitDrawn } from "./helpers.ts";
import { decodePng } from "./png.ts";

/**
 * The top bar and the viewport's section plane (design §8): the variant every view derives, the
 * GLB export, the revision saved and verified through the server, and a section clipping plane
 * that changes the view only. Each is checked against the CLI.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

interface CutList {
  groups: { lines: { cut_mm: number; sources: string[] }[] }[];
}

/** The cut length of the piece `id` in a cut list, as the drawer prints it. */
function cutOf(cl: CutList, id: string): string {
  for (const g of cl.groups)
    for (const l of g.lines) if (l.sources.includes(id)) return l.cut_mm.toFixed(2);
  throw new Error(`${id} is not on the cut list`);
}

test("the variant switch derives every view in that variant, as --variant does", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Two variants, made through the running server: one step.
  const made = await cli([
    "do",
    served.dir,
    JSON.stringify([
      { cmd: "addVariant", args: { name: "base", variant: {}, default: true } },
      { cmd: "addVariant", args: { name: "tall", variant: { params: { H: "1100" } } } },
      { cmd: "setBar", args: { id: "b13", set: { not_in: ["tall"] } } },
    ]),
  ]);
  expect(made.code).toBe(0);
  await openTab(page, served, 1);

  const sw = page.getByTestId("variant");
  await expect(sw).toHaveAttribute("data-drawn", "base");
  // The drawer opens on the cut list.
  await expect(page.getByRole("tab", { name: "Cut list" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const drawer = page.getByTestId("cutlist");
  const row = (id: string) =>
    drawer.locator("tr", { has: page.getByRole("button", { name: id, exact: true }) });

  const base = JSON.parse((await cli(["cutlist", served.dir, "--format", "json"])).out) as CutList;
  await expect(row("b1")).toContainText(cutOf(base, "b1"));
  await expect(row("b13")).toHaveCount(1);

  await sw.selectOption("tall");
  await expect(sw).toHaveAttribute("data-drawn", "tall");
  const tall = JSON.parse(
    (await cli(["cutlist", served.dir, "--variant", "tall", "--format", "json"])).out,
  ) as CutList;
  expect(cutOf(tall, "b1")).not.toBe(cutOf(base, "b1"));
  await expect(row("b1")).toContainText(cutOf(tall, "b1"));
  // The hanger is not in the tall variant: not on its cut list, not in its scene.
  await expect(row("b13")).toHaveCount(0);
  const bars = await page.evaluate(() => window.__alukit?.stats()?.bars);
  const derived = JSON.parse(
    (await cli(["derive", served.dir, "--json", "--variant", "tall"])).out,
  ) as { bars: Record<string, unknown> };
  expect(bars).toBe(Object.keys(derived.bars).length);

  // Back to the default.
  await sw.selectOption("");
  await expect(sw).toHaveAttribute("data-drawn", "base");
  await expect(row("b1")).toContainText(cutOf(base, "b1"));
  expect(errors).toEqual([]);
});

test("the export button downloads the GLB alukit export glb writes", async ({ page }) => {
  await openTab(page, served, 0);
  const downloading = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const d = await downloading;
  expect(d.suggestedFilename()).toBe("Cart-synthetic.glb");
  const got = join(served.dir, "..", "from-the-tab.glb");
  await d.saveAs(got);
  const want = join(served.dir, "..", "from-the-cli.glb");
  expect((await cli(["export", "glb", served.dir, "-o", want])).code).toBe(0);
  expect((await readFile(got)).equals(await readFile(want))).toBe(true);
  await expect(page.getByTestId("notice")).toHaveText("exported Cart-synthetic.glb");
});

test("saves a revision from the top bar and verifies it, as alukit revision does", async ({
  page,
}) => {
  await openTab(page, served, 0);
  const button = page.getByTestId("revision");
  await expect(button).toHaveText("Revision: unsaved");
  await button.click();
  const panel = page.getByTestId("revisions");
  await panel.getByTestId("revision-name").fill("Quote 1");
  await panel.getByTestId("revision-save").click();
  await expect(button).toHaveText("Revision: Quote 1");
  const list = JSON.parse((await cli(["revision", "list", served.dir, "--json"])).out) as {
    name: string;
  }[];
  expect(list.map((r) => r.name)).toEqual(["Quote 1"]);

  await panel.locator('[data-revision="Quote 1"]').getByTestId("revision-verify").click();
  await expect(panel.getByTestId("revision-verified")).toHaveText("verified: zero drift");
  expect((await cli(["revision", "verify", served.dir, "Quote 1"])).code).toBe(0);

  // An edit from the CLI moves the project away from what was saved.
  await cli(["do", served.dir, '{"cmd":"setParam","args":{"name":"W","value":"1250"}}']);
  await waitDrawn(page, 1);
  await expect(button).toHaveText("Revision: unsaved");
});

async function viewportPng(page: Page) {
  await page.mouse.move(0, 0);
  return decodePng(await page.getByTestId("viewport").locator("canvas").screenshot());
}

function differing(a: ReturnType<typeof decodePng>, b: ReturnType<typeof decodePng>): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2]
    )
      n++;
  }
  return n;
}

test("the section plane cuts the view along an axis, and nothing else", async ({ page }) => {
  await openTab(page, served, 0);
  const whole = await viewportPng(page);

  // b2 stands at x 1200 to 1240, y −40 to 0 (anchored +x−y): a click on it picks it.
  const [x, y] = (await page.evaluate(() => window.__alukit?.screen([1220, -20, 450]))) as [
    number,
    number,
  ];
  await page.mouse.click(x, y);
  await expect(page.getByTestId("properties").locator("h2")).toContainText("b2");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("properties")).toHaveCount(0);

  await page.getByTestId("section").click();
  await expect(page.getByTestId("section-tools")).toBeVisible();
  const on = await page.evaluate(() => window.__alukit?.section());
  expect(on).toMatchObject({ axis: "x", flip: false });

  // Drag the plane along X to 300 mm: the right-hand post is cut away, the left one stays.
  await page.getByTestId("section-at").fill("300");
  await expect.poll(() => page.evaluate(() => window.__alukit?.section()?.at_mm)).toBe(300);
  expect(await page.evaluate(() => window.__alukit?.clipped([1200, 0, 450]))).toBe(true);
  expect(await page.evaluate(() => window.__alukit?.clipped([0, 0, 450]))).toBe(false);
  const cut = await viewportPng(page);
  expect(differing(whole, cut)).toBeGreaterThan(1000);

  // The same click now picks nothing: the post is cut away, and nothing drawn is behind it.
  await page.mouse.click(x, y);
  await expect(page.getByTestId("properties")).toHaveCount(0);

  await page.getByTestId("section-flip").click();
  expect(await page.evaluate(() => window.__alukit?.clipped([1200, 0, 450]))).toBe(false);
  await page.getByTestId("section-y").click();
  expect(await page.evaluate(() => window.__alukit?.section()?.axis)).toBe("y");

  // Off again: the same picture as before, and the document never changed.
  await page.getByTestId("section").click();
  await expect(page.getByTestId("section-tools")).toHaveCount(0);
  expect(differing(whole, await viewportPng(page))).toBe(0);
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
});
