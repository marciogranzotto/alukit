import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { cli, docOf, openTab, type Served, serveNew, waitDrawn } from "./helpers.ts";

/**
 * The anchor's dots on any section (docs/ux/integration-editing.md, defect 3): every dot of a
 * 40 × 80 and of a 20 × 80 can be pressed, in the inspector's row and in the draw tool's picker,
 * each press area at least 24 × 24 px and none overlapping another (WCAG 2.2, 2.5.8). Before,
 * the pad drew a 40 × 80 26 px tall, so the narrow face's dots sat 6.5 px apart and a press on
 * `-x+y` went to `+y`.
 */

/** The section's box points, as the catalog lists a bar's anchors. */
const BOX = ["c", "-x-y", "+x-y", "+x+y", "-x+y", "-x", "+x", "-y", "+y"];

/** A project-local catalog (design §3.1) of one flat bar 20 × 80: no built-in one is that shape. */
async function flatCatalog(dir: string): Promise<void> {
  const cat = join(dir, "flat");
  await mkdir(join(cat, "sections"), { recursive: true });
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  await writeFile(
    join(cat, "catalog.json"),
    json({
      schema: "alukit.catalog/1",
      id: "flat",
      name: "A flat bar 20 x 80 (synthetic)",
      vendor: "none",
      currency: "BRL",
      prov: { src: "est", note: "synthetic, for a test of the anchor's dots" },
      items: {
        "FB-20x80": {
          kind: "bar",
          name: "Flat bar 20x80",
          shape: "flat",
          section: "FB-20x80",
          material: "std:A36",
        },
      },
    }),
  );
  await writeFile(
    join(cat, "sections", "FB-20x80.json"),
    json({
      schema: "alukit.section/1",
      id: "FB-20x80",
      fidelity: "parametric",
      props_ok: true,
      generator: "flat",
      params: { b_mm: 20, t_mm: 80 },
    }),
  );
  await writeFile(join(cat, "offers.json"), json({ schema: "alukit.offers/1", offers: {} }));
  const file = join(dir, "alukit.json");
  const doc = JSON.parse(await readFile(file, "utf8")) as { catalogs: string[] };
  doc.catalogs.push("./flat");
  await writeFile(file, json(doc));
}

/** Two posts by the CLI: b1 a 40 × 80 (Forseti PF40-02), b2 the flat 20 × 80. */
async function prepare(dir: string): Promise<void> {
  await flatCatalog(dir);
  const r = await cli([
    "do",
    dir,
    JSON.stringify([
      { cmd: "addBar", args: { item: "forseti:PF40-02", a: [0, 0, 0], b: [0, 0, 500] } },
      { cmd: "addBar", args: { item: "flat:FB-20x80", a: [300, 0, 0], b: [300, 0, 500] } },
    ]),
  ]);
  expect(r.code, r.err).toBe(0);
}

/** Every dot's press area is at least 24 × 24 px, and no two overlap. */
async function targetsApart(dots: Locator): Promise<void> {
  const boxes = await dots.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { a: e.getAttribute("data-anchor"), x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  expect(boxes.length).toBeGreaterThanOrEqual(BOX.length);
  for (const b of boxes) {
    expect(b.w, `${b.a} wide`).toBeGreaterThanOrEqual(24);
    expect(b.h, `${b.a} tall`).toBeGreaterThanOrEqual(24);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i] as (typeof boxes)[number];
      const q = boxes[j] as (typeof boxes)[number];
      const apart = p.x + p.w <= q.x + 0.5 || q.x + q.w <= p.x + 0.5;
      const apartY = p.y + p.h <= q.y + 0.5 || q.y + q.h <= p.y + 0.5;
      expect(apart || apartY, `${p.a} and ${q.a} overlap`).toBe(true);
    }
  }
}

let served: Served | undefined;
test.afterEach(async () => {
  await served?.stop();
  served = undefined;
});

/** Presses every dot of the selected bar's anchor row; each press writes its anchor. */
async function pressEach(page: Page, id: string, rev: number): Promise<number> {
  const row = page.getByTestId("row-anchor");
  await targetsApart(row.locator("[data-anchor]"));
  // From the default centre: each other dot in turn, then the centre again (which removes it).
  for (const a of [...BOX.slice(1), "c"]) {
    // Playwright presses the dot's centre only once no other element would take the press.
    await row.locator(`[data-anchor="${a}"]`).click();
    await waitDrawn(page, ++rev);
    const bar = ((await docOf(served?.dir as string)).bars as Record<string, { anchor?: string }>)[
      id
    ];
    expect(bar?.anchor ?? "c", `${id} anchored by its ${a} dot`).toBe(a);
    await expect(page.getByTestId("field-anchor")).toHaveValue(a);
  }
  return rev;
}

test("every anchor dot of a 40 × 80 and of a 20 × 80 can be pressed in the inspector", async ({
  page,
}) => {
  test.setTimeout(180_000);
  served = await serveNew(["--catalog", "forseti", "--currency", "BRL"], prepare);
  await openTab(page, served, 0);
  let rev = 0;
  for (const id of ["b1", "b2"]) {
    await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().click();
    await expect(page.getByTestId("row-anchor")).toBeVisible();
    rev = await pressEach(page, id, rev);
  }
});

test("every anchor dot of a 20 × 80 can be pressed in the draw tool's picker", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveNew(["--catalog", "forseti", "--currency", "BRL"], prepare);
  await openTab(page, served, 0);
  for (const item of ["forseti:PF40-02", "flat:FB-20x80"]) {
    await page.locator(`.bin-arm[data-id="${item}"]`).click();
    await expect(page.getByTestId("palette-bar")).toHaveAttribute("data-id", item);
    await page.keyboard.press("b");
    const picker = page.getByTestId("draw-anchor");
    for (const a of BOX) {
      await page.getByTestId("draw-anchor-open").click();
      await targetsApart(picker.locator("[data-anchor]"));
      await picker.locator(`[data-anchor="${a}"]`).click();
      await expect(picker).toHaveAttribute("data-anchor", a);
      expect(await page.evaluate(() => window.__alukit?.tool().anchor)).toBe(a);
    }
    await page.keyboard.press("Escape");
  }
});
