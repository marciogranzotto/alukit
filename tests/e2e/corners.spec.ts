import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cli, lastStepWords, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The corner inspector (docs/ux/plan.md S5.5, D-UX-9): a ground rectangle drawn and joined as
 * the draw tool joins it, one corner's marker clicked, its arrangements read with the cut
 * lengths a dry run gives, one applied as one step; Flip and Undo go back and forth. The numbers
 * are checked against `alukit do --dry-run` and `alukit cutlist` on the served project.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

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

/** The cut lengths an arrangement's card shows, by bar. */
async function shown(page: Page, title: string): Promise<Record<string, number>> {
  const card = page.getByTestId("arrangement").filter({ hasText: title });
  const pairs = await card
    .locator("[data-bar]")
    .evaluateAll((els) => els.map((e) => [e.getAttribute("data-bar"), e.getAttribute("data-cut")]));
  return Object.fromEntries(pairs.map(([b, c]) => [b as string, Number(c)]));
}

test("a corner's arrangements: the dry run's cut lengths, applied as one step; Flip and Undo round-trip", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("base-frame/empty");
  // Drawn bar by bar, then joined at every corner by the project's rule, as Draw does.
  expect((await cli(["do", served.dir, JSON.stringify(RECTANGLE)])).code).toBe(0);
  const joins = CORNERS.map((at) => ({ cmd: "autoConnect", args: { at } }));
  expect((await cli(["do", served.dir, JSON.stringify(joins)])).code).toBe(0);
  await openTab(page, served, 2);
  const drawn = await cuts(served.dir);
  // No post at (1000, 600, 0): the lowest id, b2 (along Y), runs through there.
  expect(drawn).toMatchObject({ b1: 1040, b2: 600, b3: 1000, b4: 560 });

  // Click the corner's marker.
  const corner = await page.evaluate(() =>
    window.__alukit?.corners().find((c) => c.key === "1000,600,0"),
  );
  expect(corner?.state).toBe("joined");
  const at = await page.evaluate((p) => window.__alukit?.screen(p), corner?.at as V3);
  if (!at) throw new Error("the corner is not on the screen");
  await page.mouse.click(at[0], at[1]);
  const props = page.getByTestId("properties");
  await expect(props).toHaveAttribute("data-corner", "1000,600,0");
  await expect(page.getByTestId("arrangement")).toHaveCount(2);
  await expect(
    page.getByTestId("arrangement").filter({ hasText: "Rail Y runs through" }),
  ).toContainText("(now)");

  // "Rail X runs through": its numbers are the dry run's of taking c3 out and joining by x.
  const conn = corner?.connections[0] as string;
  const batch = [
    { cmd: "removeEntity", args: { id: conn } },
    { cmd: "autoConnect", args: { at: corner?.at, prefer: "x" } },
  ];
  const dry = JSON.parse(
    (await cli(["do", served.dir, "--dry-run", "--json", JSON.stringify(batch)])).out,
  ) as { effects: { cuts: Record<string, [number, number]> } };
  expect(dry.effects.cuts).toEqual({ b2: [600, 560], b3: [1000, 1040] });
  const x = await shown(page, "Rail X runs through");
  expect(x).toEqual({ b2: dry.effects.cuts.b2?.[1], b3: dry.effects.cuts.b3?.[1] });

  await page.getByTestId("arrangement").filter({ hasText: "Rail X runs through" }).click();
  await page.getByTestId("arrangement-apply").click();
  await waitDrawn(page, 3);
  // One step, and the cut list now says what the dry run said.
  expect(await cuts(served.dir)).toMatchObject({ ...drawn, ...x });
  // The log's words for the step (BE-4 folds the autoConnect into "joined at 1 end").
  expect(await lastStepWords(served.dir)).toBe(`remove ${conn}, joined at 1 end`);
  const doc = JSON.parse(await readFile(join(served.dir, "alukit.json"), "utf8")) as {
    connections: Record<string, { through: string; ends: string[] }>;
  };
  expect(doc.connections[conn]).toBeUndefined();
  expect(Object.values(doc.connections)).toContainEqual({
    type: "butt",
    through: "b3",
    ends: ["b2.b"],
  });
  await expect(
    page.getByTestId("arrangement").filter({ hasText: "Rail X runs through" }),
  ).toContainText("(now)");

  // Flip: the next arrangement, Rail Y again, as one step.
  await page.getByTestId("arrangement-flip").click();
  await waitDrawn(page, 4);
  expect(await cuts(served.dir)).toEqual(drawn);
  await expect(
    page.getByTestId("arrangement").filter({ hasText: "Rail Y runs through" }),
  ).toContainText("(now)");

  // Undo takes the flip back, then the arrangement: as drawn.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 5);
  expect(await cuts(served.dir)).toMatchObject({ ...drawn, ...x });
  await page.getByTestId("undo").click();
  await waitDrawn(page, 6);
  expect(await cuts(served.dir)).toEqual(drawn);
  await expect(
    page.getByTestId("arrangement").filter({ hasText: "Rail Y runs through" }),
  ).toContainText("(now)");
  expect(errors).toEqual([]);
});
