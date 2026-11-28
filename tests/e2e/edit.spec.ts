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
  scratchProject,
  selectByIds,
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

test("Replace's Find keeps what is typed when the bar's card arrives late (no '40x40' prepended)", async ({
  page,
}) => {
  // The card of the bar's item (its size, the suggested search) held until the field has focus:
  // a person who clicks Find and then types, with the card arriving in between.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(/\/api\/catalog\/item\?id=test%3ATS40$/, async (route) => {
    await held;
    await route.continue();
  });
  served = await serve("base-frame/cli");
  await openTab(page, served, 0);
  await pick(page, "b7");
  await page.getByTestId("replace-open").click();
  const find = page.getByTestId("replace-form").getByTestId("replace-query");
  await find.click();
  const card = page.waitForResponse((r) => /\/api\/catalog\/item\?id=test%3ATS40$/.test(r.url()));
  release();
  // The card has come and been drawn into the form (two frames after its answer).
  await card;
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.keyboard.type("40x80");
  await expect(find).toHaveValue("40x80");
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
  // The bar's own size is offered as the field's suggestion, searched while the field is empty.
  await expect(form.getByTestId("replace-query")).toHaveValue("");
  await expect(form.getByTestId("replace-query")).toHaveAttribute(
    "placeholder",
    /^40x40, its size/,
  );
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

/** A bar as `alukit derive --json` gives it, errors or not (it exits 1 on an error). */
async function derivedBar(dir: string, id: string): Promise<unknown> {
  const r = await cli(["derive", dir, "--json"]);
  return (JSON.parse(r.out) as { bars: Record<string, unknown> }).bars[id];
}

/** `alukit check --json`'s errors, as `code entity`. */
async function errorsOf(dir: string): Promise<string[]> {
  const r = await cli(["check", dir, "--json"]);
  const out = JSON.parse(r.out) as {
    diagnostics: { severity: string; code: string; entity?: string }[];
  };
  return out.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.entity}`);
}

test("an offset in the bar's plane, and the anchor on the section's dots (E4.2), as setBar gives them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The audit's brace on the default centre anchor: half outside the frame's back plane, so its
  // butts miss the posts' edges.
  const brace = [
    { cmd: "addBar", args: { a: [0, 600, 0], b: [1000, 600, 750] } },
    { cmd: "autoConnect", args: { at: [0, 600, 0], optional: true } },
    { cmd: "autoConnect", args: { at: [1000, 600, 750], optional: true } },
  ];
  served = await serve("brace");
  await cliDo(served.dir, brace);
  expect(await errorsOf(served.dir)).toEqual(["butt-miss c9", "butt-miss c10"]);
  // The same edit on the CLI, on a scratch copy: the oracle.
  const oracle = await scratchProject("brace");
  await cliDo(oracle.dir, brace);
  await cliDo(oracle.dir, { cmd: "setBar", args: { id: "b13", set: { off_mm: [-20, 0] } } });
  await openTab(page, served, 1);
  await pick(page, "b13");
  // The brace's section x is world +Y (it runs in the XZ plane): −20 along it, into the frame.
  await expect(page.getByTestId("row-offset")).toContainText("x (world +Y)");
  await page.getByTestId("field-off-x").fill("-20");
  await page.getByTestId("field-off-x").press("Enter");
  await waitDrawn(page, 2);
  expect((await written(served.dir)).bars?.b13).toMatchObject({ off_mm: [-20, 0] });
  // The butts now meet the posts' faces; what remains is the angled cuts to declare (E4.1).
  expect(await errorsOf(served.dir)).toEqual(await errorsOf(oracle.dir));
  expect(await errorsOf(served.dir)).toEqual(["angled-end b13.a", "angled-end b13.b"]);
  // The brace derives where the CLI's does (its errors make `cutlist` refuse, not `derive`).
  expect(await derivedBar(served.dir, "b13")).toEqual(await derivedBar(oracle.dir, "b13"));
  await oracle.remove();

  // The anchor, picked on the section's dots: the middle of face +x.
  await page.getByTestId("row-anchor").locator('[data-anchor="+x"]').click();
  await waitDrawn(page, 3);
  expect((await written(served.dir)).bars?.b13).toMatchObject({ anchor: "+x", off_mm: [-20, 0] });
  await expect(page.getByTestId("field-anchor")).toHaveValue("+x");
});

test("several selected: four legs set to finish black in one step, which one Undo takes back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("base-frame/cli");
  await openTab(page, served, 0);
  const was = await bomLines(served.dir);
  await selectByIds(page, ["b1", "b2", "b3", "b4"]);
  const finish = page.getByTestId("many-opt-finish");
  // They share the project's default finish and the tag post; none has a label.
  await expect(finish).toHaveValue("");
  await expect(page.getByTestId("many-tags")).toHaveValue("post");
  await expect(page.getByTestId("many-label")).toHaveValue("");
  await finish.selectOption("black");
  await waitDrawn(page, 1);
  const bars = (await written(served.dir)).bars as Record<string, { opt?: unknown }>;
  for (const id of ["b1", "b2", "b3", "b4"]) expect(bars[id]?.opt).toEqual({ finish: "black" });
  // One BOM line of four black posts, as the CLI counts it.
  const black = (await bomLines(served.dir)).find(
    (l) => l.item === "test:TS40" && l.sources?.includes("b1"),
  );
  expect(black).toMatchObject({ qty: 4, sources: ["b1", "b2", "b3", "b4"] });
  await expect(finish).toHaveValue("black");
  // One change of four bars, said once (the editing review's n2).
  expect(await lastStepWords(served.dir)).toBe("change the options of b1, b2, b3 and b4");

  // One Undo takes all four back.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 2);
  expect(await bomLines(served.dir)).toEqual(was);
});

type V3 = [number, number, number];

/**
 * A point in the middle of one of a bar's side faces, `at` along it, that the view shows on top
 * (found by hovering each, as menu.spec does).
 */
async function sideOf(page: Page, dir: string, id: string, at: number): Promise<V3> {
  const r = await cli(["derive", dir, "--json"]);
  const b = (
    JSON.parse(r.out) as {
      bars: Record<
        string,
        { a: V3; frame: { x: V3; y: V3; z: V3 }; box_mm: [[number, number], [number, number]] }
      >;
    }
  ).bars[id];
  if (!b) throw new Error(`no ${id}`);
  const [[x0, y0], [x1, y1]] = b.box_mm;
  const point = (lx: number, ly: number): V3 =>
    [0, 1, 2].map(
      (i) =>
        (b.a[i] as number) +
        (b.frame.x[i] as number) * lx +
        (b.frame.y[i] as number) * ly +
        (b.frame.z[i] as number) * at,
    ) as V3;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  for (const p of [point(x1, cy), point(x0, cy), point(cx, y1), point(cx, y0)]) {
    const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
    if (!s) continue;
    await page.mouse.move(s[0], s[1]);
    const shown = await expect
      .poll(() => page.evaluate(() => window.__alukit?.hovered()), { timeout: 1_000 })
      .toEqual([id])
      .then(
        () => true,
        () => false,
      );
    if (shown) return p;
  }
  throw new Error(`no side of ${id} is on top in this view`);
}

/** `alukit machining` as Markdown: the sheet a shop reads, one line per bar's holes. */
async function machining(dir: string): Promise<string> {
  const r = await cli(["machining", dir]);
  expect(r.code, r.err).toBe(0);
  return r.out;
}

test("holes (E-UX-22): a Ø7 hole 20 from end a's cut on b1's +x face, as the CLI's setBar ops; edited, removed", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("base-frame/cli");
  const oracle = await scratchProject("base-frame/cli");
  await cliDo(oracle.dir, {
    cmd: "setBar",
    args: {
      id: "b1",
      set: { ops: [{ op: "hole", face: "+x", at_mm: 20, from: "a.cut", d_mm: 7 }] },
    },
  });
  await openTab(page, served, 0);

  // The menu on b1's side offers a hole there; its form opens prefilled with the face and the
  // station, counted from end a's cut (review M3), which typed values then set exactly.
  await pick(page, "b1");
  const menu = await contextMenu(page, await sideOf(page, served.dir, "b1", 300));
  await menu
    .getByRole("menuitem", {
      name: /^Add a hole on b1's face [+-][xy] \(world [+-][XYZ]\), \d+ mm from end a's cut…/,
    })
    .click();
  const form = page.getByTestId("hole-form");
  await form.getByTestId("hole-face").selectOption("+x");
  await form.getByTestId("hole-at").fill("20");
  await form.getByTestId("hole-size").fill("7");
  await form.getByTestId("hole-add").click();
  await waitDrawn(page, 1);
  expect((await written(served.dir)).bars?.b1).toMatchObject({
    ops: [{ op: "hole", face: "+x", at_mm: 20, from: "a.cut", d_mm: 7 }],
  });
  expect(await machining(served.dir)).toEqual(await machining(oracle.dir));
  await oracle.remove();
  await expect(page.getByTestId("hole-0")).toContainText("Ø7 on face +x, 20 mm from end a's cut");

  // Edited in its row: a tapped M6 instead, one step; then removed, one step.
  await page.getByTestId("hole-0-size").fill("M6");
  await page.getByTestId("hole-0-size").press("Enter");
  await waitDrawn(page, 2);
  expect((await written(served.dir)).bars?.b1).toMatchObject({
    ops: [{ op: "hole", face: "+x", at_mm: 20, from: "a.cut", thread: "M6" }],
  });
  await page.getByTestId("hole-0-remove").click();
  await waitDrawn(page, 3);
  expect((await written(served.dir)).bars?.b1).not.toHaveProperty("ops");
});

test("the hole form keeps the focus where the person types (review M2): typed 20 is stored as 20", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("base-frame/cli");
  await openTab(page, served, 0);
  await pick(page, "b1");
  const menu = await contextMenu(page, await sideOf(page, served.dir, "b1", 300));
  await menu.getByRole("menuitem", { name: /^Add a hole on b1's face/ }).click();
  const form = page.getByTestId("hole-form");
  // Typed key by key, as a hand does (`fill` sets the value without keystrokes): each key stays
  // in the field it was typed in.
  await form.getByTestId("hole-at").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("20");
  await expect(form.getByTestId("hole-at")).toHaveValue("20");
  await expect(form.getByTestId("hole-at")).toBeFocused();
  await form.getByTestId("hole-size").click();
  await page.keyboard.type("M6");
  await expect(form.getByTestId("hole-size")).toHaveValue("M6");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect((await written(served.dir)).bars?.b1).toMatchObject({
    ops: [{ op: "hole", at_mm: 20, thread: "M6" }],
  });
  // Opened again from its button: the distance has the focus, selected, so typing replaces it.
  await page.getByTestId("hole-new").click();
  const at = page.getByTestId("hole-form").getByTestId("hole-at");
  await expect(at).toBeFocused();
  await page.keyboard.type("35");
  await expect(at).toHaveValue("35");
});

test("a node's fields: moving the point three legs share moves every leg's end, as moveNode does", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // A tripod: three legs whose ends b are node n1 (the skill's worked example uses no node).
  const tripod = [
    { cmd: "addNode", args: { at: [500, 0, 600] } },
    { cmd: "addBar", args: { a: [0, 0, 0], b: "n1" } },
    { cmd: "addBar", args: { a: [1000, 0, 0], b: "n1" } },
    { cmd: "addBar", args: { a: [500, 300, 0], b: "n1" } },
  ];
  served = await serve("base-frame/empty");
  await cliDo(served.dir, tripod);
  const oracle = await scratchProject("base-frame/empty");
  await cliDo(oracle.dir, tripod);
  await cliDo(oracle.dir, { cmd: "moveNode", args: { id: "n1", at: [500, 0, 700] } });
  await openTab(page, served, 1);

  // n1 from the outline's Nodes group, opened by its twisty (a click on the head selects its
  // members): what uses it, and where it is.
  const tree = page.getByTestId("tree");
  await tree.locator('[data-key="g:nodes"] .twisty').click();
  await tree.locator('[data-id="n1"]').first().click();
  await expect(page.getByTestId("row-node-users")).toContainText("b1.b, b2.b and b3.b");
  await page.getByTestId("field-node-z").fill("700");
  await page.getByTestId("field-node-z").press("Enter");
  await waitDrawn(page, 2);
  expect((await written(served.dir)).nodes).toEqual({ n1: [500, 0, 700] });
  // Every leg's end followed, as the CLI's moveNode moves them: the same cut list.
  expect(await cutList(served.dir)).toEqual(await cutList(oracle.dir));
  expect(await lastStepWords(served.dir)).toBe("move point n1");
  await oracle.remove();
});
