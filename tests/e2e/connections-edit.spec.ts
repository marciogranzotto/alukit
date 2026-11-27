import { expect, type Page, test } from "@playwright/test";
import { cli, docOf, openTab, type Served, scratchProject, serve, waitDrawn } from "./helpers.ts";

/**
 * Editing connections and parts after they are made (docs/ux/editing-audit.md E5.1, E5.2, E5.4,
 * E5.5): a face joint's form filled from the joint, a pivot's, a mitre's, a splice's and a butt's
 * fields, a part's groove and offset, and a corner's mitre. Each edit is one step that writes
 * what `alukit do` writes for the same change, and one Undo takes it back.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

interface CutList {
  groups: { lines: { cut_mm: number; sources: string[] }[] }[];
}

/** Each bar's cut, mm, as `alukit cutlist` gives it. */
async function cuts(dir: string): Promise<Record<string, number>> {
  const r = await cli(["cutlist", dir, "--format", "json"]);
  expect(r.code, r.err).toBe(0);
  const out: Record<string, number> = {};
  for (const g of (JSON.parse(r.out) as CutList).groups)
    for (const l of g.lines) for (const s of l.sources) out[s] = l.cut_mm;
  return out;
}

/** The commands through `alukit do` on another copy of a fixture, one batch per step. */
async function viaCli(project: string, ...batches: unknown[][]): Promise<Record<string, unknown>> {
  const other = await scratchProject(project);
  try {
    for (const b of batches) {
      const r = await cli(["do", other.dir, JSON.stringify(b)]);
      expect(r.code, r.err).toBe(0);
    }
    return await docOf(other.dir);
  } finally {
    await other.remove();
  }
}

/** A 1000 × 600 rectangle on the ground, b1 to b4, one addBar each, as Draw sends them. */
const RECTANGLE = [
  { cmd: "addBar", args: { a: [0, 0, 0], b: [1000, 0, 0] } },
  { cmd: "addBar", args: { a: [1000, 0, 0], b: [1000, 600, 0] } },
  { cmd: "addBar", args: { a: [1000, 600, 0], b: [0, 600, 0] } },
  { cmd: "addBar", args: { a: [0, 600, 0], b: [0, 0, 0] } },
];
const CORNERS: V3[] = [
  [0, 0, 0],
  [1000, 0, 0],
  [1000, 600, 0],
  [0, 600, 0],
];
const JOINS = CORNERS.map((at) => ({ cmd: "autoConnect", args: { at } }));

/** The cut lengths an arrangement's card shows, by bar. */
async function shown(page: Page, kind: string): Promise<Record<string, number>> {
  const card = page.locator(`[data-testid="arrangement"][data-kind="${kind}"]`);
  const pairs = await card
    .locator("[data-bar]")
    .evaluateAll((els) => els.map((e) => [e.getAttribute("data-bar"), e.getAttribute("data-cut")]));
  return Object.fromEntries(pairs.map(([b, c]) => [b as string, Number(c)]));
}

test("a ground rectangle's corner takes a mitre in one step, with the cuts its dry run showed; then the three like it (E5.5)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("base-frame/empty");
  expect((await cli(["do", served.dir, JSON.stringify(RECTANGLE)])).code).toBe(0);
  expect((await cli(["do", served.dir, JSON.stringify(JOINS)])).code).toBe(0);
  await openTab(page, served, 2);
  const drawn = await cuts(served.dir);
  expect(drawn).toMatchObject({ b1: 1040, b2: 600, b3: 1000, b4: 560 });

  const corner = await page.evaluate(() =>
    window.__alukit?.corners().find((c) => c.key === "1000,600,0"),
  );
  const at = await page.evaluate((p) => window.__alukit?.screen(p), corner?.at as V3);
  if (!at || !corner) throw new Error("the corner is not on the screen");
  await page.mouse.click(at[0], at[1]);
  await expect(page.getByTestId("properties")).toHaveAttribute("data-corner", "1000,600,0");
  const mitre = page.locator('[data-testid="arrangement"][data-kind="miter"]');
  await expect(mitre).toContainText("Mitre");
  // A splice joins two ends in line: not these, and the inspector says why.
  await expect(page.getByTestId("arrangements-refused")).toContainText("No splice here");

  // Its numbers are the dry run's of taking the corner's butt out and mitring the two ends.
  const batch = [
    { cmd: "removeEntity", args: { id: corner.connections[0] } },
    { cmd: "addConnection", args: { type: "miter", ends: ["b2.b", "b3.a"] } },
  ];
  const dry = JSON.parse(
    (await cli(["do", served.dir, "--dry-run", "--json", JSON.stringify(batch)])).out,
  ) as { effects: { cuts: Record<string, [number, number]> } };
  // By hand: b3 stopped 20 short of the corner and its long point now reaches 20 past it.
  expect(dry.effects.cuts).toEqual({ b3: [1000, 1040] });
  expect(await shown(page, "miter")).toEqual({ b2: 600, b3: 1040 });

  await mitre.click();
  await page.getByTestId("arrangement-apply").click();
  await waitDrawn(page, 3);
  expect(await cuts(served.dir)).toEqual({ ...drawn, b3: 1040 });
  expect(await docOf(served.dir)).toEqual(
    await viaCli("base-frame/empty", RECTANGLE, JOINS, batch),
  );
  await expect(mitre).toContainText("(now)");

  // The three other corners are Ls of the same profile: one step mitres them, once derive has
  // accepted each. By hand, every long point reaches 20 past its corner: 1040 and 640.
  const all = page.getByTestId("arrangement-apply-all");
  await expect(all).toHaveText("Apply to 3 matching corners");
  await all.click();
  await waitDrawn(page, 4);
  expect(await cuts(served.dir)).toEqual({ b1: 1040, b2: 640, b3: 1040, b4: 640 });

  // Undo takes back the three, then the one.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 5);
  expect(await cuts(served.dir)).toEqual({ ...drawn, b3: 1040 });
  await page.getByTestId("undo").click();
  await waitDrawn(page, 6);
  expect(await cuts(served.dir)).toEqual(drawn);
  expect(errors).toEqual([]);
});
