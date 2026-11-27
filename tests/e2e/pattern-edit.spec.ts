import { expect, test } from "@playwright/test";
import {
  cli,
  docOf,
  lastStepWords,
  openTab,
  type Served,
  scratchProject,
  selectByIds,
  serve,
  waitDrawn,
} from "./helpers.ts";

/**
 * Editing a live pattern (docs/ux/editing-audit.md E5.3, E-UX-13): its along, pitch, count and
 * skips edit in the inspector, each as one `setPattern` that writes what `alukit do` writes; a
 * pitch takes expressions and a param is written as typed (D5); Explode is one step and selects
 * the plain entities it made. On the cart, whose pt1 repeats the slat b26 (and its butts c26,
 * c27) every 150 along b9, seven in all, leaving copy 3 out for the beam.
 */

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

/** The same commands through `alukit do` on another copy of the cart: its document after. */
async function viaCli(commands: unknown[]): Promise<Record<string, unknown>> {
  const other = await scratchProject("cart");
  try {
    const r = await cli(["do", other.dir, JSON.stringify(commands)]);
    expect(r.code, r.err).toBe(0);
    return await docOf(other.dir);
  } finally {
    await other.remove();
  }
}

test("pt1's count, pitch and skips edit in one step each, as alukit do setPattern writes them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("cart");
  await openTab(page, served, 0);
  await selectByIds(page, ["pt1"]);
  const props = page.getByTestId("properties");
  await expect(props).toHaveAttribute("data-kind", "pattern");

  // Count 7 to 8: one step, the document `alukit do setPattern` gives.
  const count = props.getByTestId("field-count");
  await expect(count).toHaveValue("7");
  await count.fill("8");
  await count.press("Enter");
  await waitDrawn(page, 1);
  const set = { cmd: "setPattern", args: { id: "pt1", set: { count: 8 } } };
  expect(await docOf(served.dir)).toEqual(await viaCli([set]));
  expect(await lastStepWords(served.dir)).toBe("change pt1's count");

  // A pitch that reads a param is written as typed (D5): W / 8 is 150 on the cart.
  const pitch = props.getByTestId("field-pitch");
  await expect(pitch).toHaveValue("150");
  await pitch.fill("W / 8");
  await pitch.press("Enter");
  await waitDrawn(page, 2);
  expect(
    ((await docOf(served.dir)).patterns as Record<string, { pitch_mm: unknown }>).pt1?.pitch_mm,
  ).toBe("W / 8");
  // One that reads no param of the project says why under its row, and makes no step.
  await pitch.fill("V / 8");
  await pitch.press("Enter");
  await expect(props.getByTestId("row-pitch-errors")).toContainText('"V" is no param');
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(2);

  // Skips: copies 3 and 5 left out, one step.
  const skip = props.getByTestId("field-skip");
  await expect(skip).toHaveValue("3");
  await skip.fill("3, 5");
  await skip.press("Enter");
  await waitDrawn(page, 3);
  expect(await docOf(served.dir)).toEqual(
    await viaCli([
      set,
      { cmd: "setPattern", args: { id: "pt1", set: { pitch_mm: "W / 8" } } },
      { cmd: "setPattern", args: { id: "pt1", set: { skip: [3, 5] } } },
    ]),
  );

  // Along another bar: b10, the back base rail, as one step.
  await props.getByTestId("field-along").selectOption("b10");
  await waitDrawn(page, 4);
  expect(
    ((await docOf(served.dir)).patterns as Record<string, { along: unknown }>).pt1?.along,
  ).toBe("b10");

  // Undo takes each back, one at a time.
  for (const rev of [5, 6, 7, 8]) {
    await page.getByTestId("undo").click();
    await waitDrawn(page, rev);
  }
  expect(await docOf(served.dir)).toEqual(await viaCli([]));
  expect(errors).toEqual([]);
});

test("Explode makes plain entities in one step and selects them; Undo brings pt1 back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("cart");
  await openTab(page, served, 0);
  const before = await docOf(served.dir);
  await selectByIds(page, ["pt1"]);
  const props = page.getByTestId("properties");
  await props.getByTestId("pattern-explode").click();
  await waitDrawn(page, 1);
  // One step: the document `alukit do explodePattern` gives.
  expect(await docOf(served.dir)).toEqual(
    await viaCli([{ cmd: "explodePattern", args: { id: "pt1" } }]),
  );
  const doc = (await docOf(served.dir)) as {
    patterns: Record<string, unknown>;
    bars: Record<string, unknown>;
    connections: Record<string, unknown>;
  };
  expect(doc.patterns.pt1).toBeUndefined();
  // What it made is selected: five slats (copies 1, 2, 4, 5 and 6) and their ten butts, every one
  // a plain entity of the document, none a copy.
  const selected = (await page.evaluate(() => window.__alukit?.selection())) ?? [];
  const bars = selected.filter((id) => id.startsWith("b"));
  expect(bars).toHaveLength(5);
  expect(selected.filter((id) => id.startsWith("c"))).toHaveLength(10);
  for (const id of selected) {
    expect(id).not.toContain("@");
    expect({ ...doc.bars, ...doc.connections }[id], id).toBeDefined();
  }
  await expect(props).toContainText("15 selected");

  await page.getByTestId("undo").click();
  await waitDrawn(page, 2);
  expect(await docOf(served.dir)).toEqual(before);
  expect(errors).toEqual([]);
});

test("the Pattern tool takes its pitch as typed: a param stays in the document (D5)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("cart");
  await openTab(page, served, 0);
  await selectByIds(page, ["p6"]);
  await page.getByTestId("tool-pattern").click();
  await expect(page.getByTestId("pattern-template")).toHaveText("p6");
  await page.getByTestId("pattern-along").fill("b10");
  await page.getByTestId("pattern-pitch").fill("W / 12");
  await expect(page.getByTestId("pattern-pitch-words")).toHaveText("pitch W / 12 = 100 mm");
  await page.getByTestId("pattern-count").fill("2");
  await page.getByTestId("pattern-apply").click();
  await waitDrawn(page, 1);
  expect(((await docOf(served.dir)).patterns as Record<string, unknown>).pt3).toEqual({
    template: ["p6"],
    along: "b10",
    pitch_mm: "W / 12",
    count: 2,
  });
});
