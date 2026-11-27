import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  cli,
  contextMenu,
  lastStepWords,
  numberText,
  openTab,
  type Served,
  serve,
  waitDrawn,
} from "./helpers.ts";

/**
 * Editing in the inspector (docs/ux/plan.md S5.3, S5.4): a bar's length, typed or through the
 * param that drives it; Replace profile for every bar like it; Delete, at once when nothing else
 * goes, through the dry run's list when something does. Each edit is one step that one Undo takes
 * back, and every outcome is checked against the CLI on the served project.
 */

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

interface CutList {
  groups: { lines: { cut_mm: number; sources: string[] }[] }[];
}

interface BomLine {
  item: string;
  qty: number;
  sources?: string[];
}

/** `alukit bom --format json`'s lines, every group's, in order. */
async function bomLines(dir: string): Promise<BomLine[]> {
  const r = await cli(["bom", dir, "--format", "json"]);
  expect(r.code, r.err).toBe(0);
  return (JSON.parse(r.out) as { groups: { lines: BomLine[] }[] }).groups.flatMap((g) => g.lines);
}

async function cutList(dir: string): Promise<CutList> {
  const r = await cli(["cutlist", dir, "--format", "json"]);
  expect(r.code, r.err).toBe(0);
  return JSON.parse(r.out) as CutList;
}

/** The cut length of the piece `id`, as the CLI prints it. */
function cutOf(cl: CutList, id: string): string {
  for (const g of cl.groups)
    for (const l of g.lines) if (l.sources.includes(id)) return l.cut_mm.toFixed(2);
  throw new Error(`${id} is not on the cut list`);
}

async function written(dir: string): Promise<Record<string, Record<string, unknown>>> {
  return JSON.parse(await readFile(join(dir, "alukit.json"), "utf8"));
}

/** The cut list sheet's row that lists a bar. */
function sheetRow(page: Page, id: string) {
  return page
    .getByTestId("cutlist")
    .locator("tr", { has: page.getByRole("button", { name: id, exact: true }) });
}

async function pick(page: Page, id: string): Promise<void> {
  await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText(id);
}

test("a bar's length: driven by its param, or typed; the cut list follows the CLI's", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("base-frame/cli");
  // A post written as numbers, beside the frame: no param drives it.
  const add = { cmd: "addBar", args: { a: [1400, 0, 0], b: [1400, 0, 900] } };
  expect((await cli(["do", served.dir, JSON.stringify(add)])).code).toBe(0);
  await openTab(page, served, 1);
  const before = await cutList(served.dir);

  // b1 stands from (0, 0, 0) to (0, 0, H): its length is H's, 900, and the field says so.
  await pick(page, "b1");
  const length = page.getByTestId("row-length");
  await expect(length).toContainText("900.00");
  await expect(page.getByTestId("length-driven")).toContainText("driven by H");
  await page.getByTestId("edit-param-H").click();
  const edit = page.getByTestId("param-edit");
  await expect(edit).toHaveValue("900");
  await edit.fill("950");
  await page.getByTestId("param-set").click();
  await waitDrawn(page, 2);
  const tall = await cutList(served.dir);
  // Every post grew by 50, and the sheet says what the CLI says.
  for (const id of ["b1", "b2", "b3", "b4"]) {
    expect(Number(cutOf(tall, id)) - Number(cutOf(before, id))).toBeCloseTo(50, 6);
    await expect(sheetRow(page, id)).toContainText(numberText(cutOf(tall, id)));
  }

  // b11 is written as numbers: the typed length moves its end b along it, one step.
  await pick(page, "b11");
  const field = page.getByTestId("field-length");
  await expect(field).toHaveValue("900");
  await field.fill("950");
  await field.press("Enter");
  await waitDrawn(page, 3);
  expect((await written(served.dir)).bars?.b11).toMatchObject({
    a: [1400, 0, 0],
    b: [1400, 0, 950],
  });
  const typed = await cutList(served.dir);
  expect(cutOf(typed, "b11")).toBe("950.00");
  await expect(sheetRow(page, "b11")).toContainText(numberText(cutOf(typed, "b11")));
  expect(await lastStepWords(served.dir)).toBe("change b11's end b");

  // One Undo takes it back.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 4);
  expect(cutOf(await cutList(served.dir), "b11")).toBe("900.00");
  await expect(page.getByTestId("field-length")).toHaveValue("900");
  expect(errors).toEqual([]);
});

test("Replace profile, all like it, moves the BOM line in one step that one Undo takes back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("base-frame/cli");
  await openTab(page, served, 0);
  const was = await bomLines(served.dir);
  const ts40 = was.find((l) => l.item === "test:TS40");
  expect(ts40?.qty).toBe(8);

  // b7, a TS40 rail: Replace…, the 40 × 40 bars offered first, TS40E chosen, every bar like it.
  await pick(page, "b7");
  await page.getByTestId("replace-open").click();
  const form = page.getByTestId("replace-form");
  await expect(form.getByTestId("replace-query")).toHaveValue("40x40");
  await form.getByTestId("replace-item").selectOption("test:TS40E");
  await form.getByTestId("replace-like").check();
  await expect(form.getByTestId("replace-like").locator("xpath=..")).toContainText("all 8 like it");
  await form.getByTestId("replace-apply").click();
  await waitDrawn(page, 1);

  const now = await bomLines(served.dir);
  expect(now.find((l) => l.item === "test:TS40")).toBeUndefined();
  expect(now.find((l) => l.item === "test:TS40E")).toMatchObject({
    qty: 8,
    sources: ts40?.sources,
  });
  await page.getByRole("tab", { name: /^BOM/ }).click();
  await expect(page.getByTestId("bom")).toContainText("test:TS40E");
  await expect(page.getByTestId("bom")).not.toContainText(/test:TS40\b/);

  // One step: one Undo brings the line back as it was.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 2);
  expect(await bomLines(served.dir)).toEqual(was);
});

test("Delete: an unreferenced bar goes at once; a referenced one lists what the dry run says, and that goes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("base-frame/cli");
  const add = { cmd: "addBar", args: { a: [1400, 0, 0], b: [1400, 0, 900] } };
  expect((await cli(["do", served.dir, JSON.stringify(add)])).code).toBe(0);
  await openTab(page, served, 1);

  // b11 is named by nothing: Delete removes it at once, one step, with Undo in its toast.
  await pick(page, "b11");
  await page.keyboard.press("Delete");
  await waitDrawn(page, 2);
  // The toast goes after 5 s (TOAST_MS.own): read it before the CLI's slower checks.
  await expect(page.getByTestId("step-toast").getByTestId("toast-undo")).toBeVisible();
  await expect(page.getByTestId("delete-dialog")).toHaveCount(0);
  expect((await written(served.dir)).bars?.b11).toBeUndefined();
  expect(await lastStepWords(served.dir)).toBe("remove b11");

  // b9, the front base rail, holds c3's and c4's only ends: the dialog lists the dry run's list.
  const doc = await written(served.dir);
  const cmd = JSON.stringify([{ cmd: "removeEntity", args: { id: "b9", cascade: true } }]);
  const dry = JSON.parse((await cli(["do", served.dir, "--dry-run", "--json", cmd])).out) as {
    effects: { removed: string[] };
  };
  expect(dry.effects.removed).toEqual(["b9", "c3", "c4"]);
  await pick(page, "b9");
  await page.keyboard.press("Backspace");
  const dialog = page.getByTestId("delete-dialog");
  await expect(dialog).toBeVisible();
  const listed = await dialog
    .getByTestId("delete-removed")
    .locator("li")
    .evaluateAll((lis) => lis.map((li) => li.getAttribute("data-id")));
  expect(listed).toEqual(dry.effects.removed);
  await expect(dialog.getByTestId("delete-confirm")).toHaveText("Delete all 3");
  await dialog.getByTestId("delete-confirm").click();
  await waitDrawn(page, 3);
  await expect(dialog).toHaveCount(0);

  // Exactly those went, and nothing else changed.
  const after = await written(served.dir);
  const without = (o: Record<string, unknown> | undefined, ids: string[]) =>
    Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !ids.includes(k)));
  expect(after.bars).toEqual(without(doc.bars, ["b9"]));
  expect(after.connections).toEqual(without(doc.connections, ["c3", "c4"]));

  // One Undo restores all of it.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 4);
  const back = await written(served.dir);
  expect(back.bars).toEqual(doc.bars);
  expect(back.connections).toEqual(doc.connections);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// The editing round's bar edits (docs/ux/editing-audit.md §7.8, E4.2–E4.7; e4-decisions.md).

/** Runs `alukit do` on the served project; fails the test on a refusal. */
async function cliDo(dir: string, commands: unknown): Promise<void> {
  const r = await cli(["do", dir, JSON.stringify(commands)]);
  expect(r.code, r.err).toBe(0);
}

test("a length typed as =D binds the param (E-UX-16); from the middle keeps the centre", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("brace");
  // D as a param, and a free bar beside the frame (b13).
  await cliDo(served.dir, [
    { cmd: "setParam", args: { name: "D", value: 600 } },
    { cmd: "addBar", args: { a: [1400, 0, 0], b: [1400, 600, 0] } },
  ]);
  await openTab(page, served, 1);
  const before = await cutList(served.dir);

  // The left base rail b7 runs from y = 0 to 600: `=D` writes D in its end b, and nothing moves.
  await pick(page, "b7");
  await expect(page.getByTestId("field-length-end")).toHaveValue("b");
  await page.getByTestId("field-length").fill("=D");
  await page.getByTestId("field-length").press("Enter");
  await waitDrawn(page, 2);
  expect((await written(served.dir)).bars?.b7).toMatchObject({ a: [0, 0, 0], b: [0, "D", 0] });
  expect(cutOf(await cutList(served.dir), "b7")).toBe(cutOf(before, "b7"));
  await expect(page.getByTestId("length-driven")).toContainText("driven by D");

  // From the middle: b13, 600 long about y = 300, made 400 long about the same centre.
  await pick(page, "b13");
  await page.getByTestId("field-length-end").selectOption("middle");
  await page.getByTestId("field-length").fill("400");
  await page.getByTestId("field-length").press("Enter");
  await waitDrawn(page, 3);
  expect((await written(served.dir)).bars?.b13).toMatchObject({
    a: [1400, 100, 0],
    b: [1400, 500, 0],
  });
  expect(cutOf(await cutList(served.dir), "b13")).toBe("400.00");
});

test("split and reverse from the menu (E-UX-21): one step each, as the CLI cuts them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("base-frame/cli");
  await openTab(page, served, 0);
  const before = await cutList(served.dir);
  expect(cutOf(before, "b9")).toBe("1120.00");

  // A right-click on the front base rail b9 (z = Hb = 100, its top at 120) offers a split where
  // the menu opened, and a split at a typed distance.
  const menu = await contextMenu(page, [400, 20, 120]);
  await expect(
    menu.getByRole("menuitem", { name: /^Split b9 here, \d+ mm from end a/ }),
  ).toBeVisible();
  await menu.getByRole("menuitem", { name: /^Split b9 at…/ }).click();
  const form = page.getByTestId("split-form");
  await form.getByTestId("split-at").fill("400");
  await form.getByTestId("split-at").press("Enter");
  await waitDrawn(page, 1);
  // Two bars whose cuts sum to b9's: from b1's face to 400, and on to b2's face.
  const split = await cutList(served.dir);
  expect(cutOf(split, "b9")).toBe("360.00");
  expect(cutOf(split, "b11")).toBe("760.00");
  expect(await lastStepWords(served.dir)).toBe("split b9 at 400 mm, making n1 and b11");
  // One Undo restores b9.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 2);
  expect(await cutList(served.dir)).toEqual(before);

  // Reverse, from the inspector's action row: the ends swap, the body and its cut stay.
  await pick(page, "b9");
  await page.getByTestId("action-reverse").click();
  await waitDrawn(page, 3);
  expect((await written(served.dir)).bars?.b9).toMatchObject({
    a: ["W", 0, "Hb"],
    b: [0, 0, "Hb"],
  });
  expect(cutOf(await cutList(served.dir), "b9")).toBe("1120.00");
  expect(errors).toEqual([]);
});
