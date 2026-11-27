import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cli, lastStepWords, openTab, type Served, serve, waitDrawn } from "./helpers.ts";

/**
 * The end handles and the length label (docs/ux/drag-ends-decisions.md), on tests/fixtures/ux/ends:
 * b1 a rail along +X, 1000 long; b2 up +Y from b1's end b, butted on it by c1 (cut 580); b3 a free
 * brace down −Y at x = 500, 300 long, ending 280 short of b1's near face; b4 a post whose top is at
 * z = L (400). 40 × 40 bars on centre anchors. Every outcome is checked against the CLI on the
 * served project.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function cutOf(dir: string, id: string): Promise<number> {
  const r = await cli(["cutlist", dir, "--format", "json"]);
  expect(r.code, r.err).toBe(0);
  const cl = JSON.parse(r.out) as { groups: { lines: { cut_mm: number; sources: string[] }[] }[] };
  for (const g of cl.groups) for (const l of g.lines) if (l.sources.includes(id)) return l.cut_mm;
  throw new Error(`${id} is not on the cut list`);
}

async function doc(dir: string): Promise<{
  bars: Record<string, Record<string, unknown>>;
  connections?: Record<string, { type: string; through: string; ends: string[] }>;
}> {
  return JSON.parse(await readFile(join(dir, "alukit.json"), "utf8"));
}

async function pick(page: Page, id: string): Promise<void> {
  await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText(id);
}

/** A world point on the page. */
async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is off the screen`);
  return s;
}

/** The selected bar's handle at an end, on the page, once drawn. */
async function handle(page: Page, end: "a" | "b") {
  await page.waitForFunction((e) => window.__alukit?.handles().some((h) => h.end === e), end);
  const h = ((await page.evaluate(() => window.__alukit?.handles())) ?? []).find(
    (x) => x.end === end,
  );
  if (!h) throw new Error(`no handle at end ${end}`);
  return { ...h, at: await screen(page, h.p as V3) };
}

/** Drags with the button held, in steps, as a hand does. */
async function dragTo(page: Page, from: [number, number], to: [number, number], steps = 12) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
}

test("dragging an end onto another bar butts it there: one step, the cut list the CLI's", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  await pick(page, "b3");
  const b = await handle(page, "b");
  expect(b.locked).toBe(false);
  // Onto b1's line, in the middle of its body.
  const target = await screen(page, [500, 0, 0]);
  await dragTo(page, b.at, target);
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.snap)).toBe("on b1");
  // The joint preview says what the release will do, before it.
  await expect(page.getByTestId("joint-preview")).toContainText("will butt on b1 · cut 580");
  await expect(page.getByTestId("selection-label")).toContainText("on b1 · cut 580 mm");
  await page.mouse.up();
  await waitDrawn(page, 1);
  expect(await cutOf(served.dir, "b3")).toBe(580);
  const d = await doc(served.dir);
  expect(d.bars.b3?.b).toEqual([500, 0, 0]);
  expect(d.connections?.c2).toEqual({ type: "butt", through: "b1", ends: ["b3.b"] });
  expect(await lastStepWords(served.dir)).toBe("lengthen b3 at end b to 600 mm, joined at 1 end");
  // One undo takes the whole drag back.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 2);
  expect(await cutOf(served.dir, "b3")).toBe(300);
  expect((await doc(served.dir)).connections?.c2).toBeUndefined();
  expect(errors).toEqual([]);
});

test("Esc cancels a drag: no step, nothing written", async ({ page }) => {
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  await pick(page, "b3");
  const b = await handle(page, "b");
  const before = await readFile(join(served.dir, "alukit.json"), "utf8");
  await dragTo(page, b.at, await screen(page, [500, 100, 0]));
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("end");
  await expect(page.getByTestId("command-bar")).toHaveAttribute("data-tool", "drag-end");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture())).toBeUndefined();
  await page.mouse.up();
  // Still selected, still at revision 0, the file as it was.
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__alukit?.drawnRev())).toBe(0);
  expect(await readFile(join(served.dir, "alukit.json"), "utf8")).toBe(before);
  await expect(page.getByTestId("properties").locator("h2")).toContainText("b3");
});

test("a length typed during a drag sets the cut: click the handle, type, Enter", async ({
  page,
}) => {
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  await pick(page, "b3");
  const b = await handle(page, "b");
  // A click (no drag) leaves the gesture following the pointer; a digit goes to the command bar.
  await page.mouse.click(b.at[0], b.at[1]);
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("end");
  await page.keyboard.type("0.45m");
  await expect(page.getByTestId("command-value")).toBeFocused();
  await expect(page.getByTestId("command-result")).toContainText("cut 450 mm · length 450");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 1);
  expect(await cutOf(served.dir, "b3")).toBe(450);
  expect((await doc(served.dir)).bars.b3?.b).toEqual([500, 150, 0]);
});

test("the length label: click it, type a cut, Enter; a cut into b1 joins it, as the preview says", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  await pick(page, "b3");
  await expect(page.getByTestId("selection-label")).toHaveText("cut 300.00 mm  square · square");
  await page.getByTestId("length-label").click();
  const field = page.getByTestId("length-field");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("300");
  // End b moves (the inspector's end); its handle is drawn larger.
  await expect(page.getByTestId("length-end")).toHaveText("moves end b");
  await field.fill("450");
  await field.press("Enter");
  await waitDrawn(page, 1);
  expect(await cutOf(served.dir, "b3")).toBe(450);
  expect(await lastStepWords(served.dir)).toBe("lengthen b3 at end b to 450 mm");

  // 590 would reach 10 into b1's body: the end joins b1 and is cut at its face, said first.
  await page.getByTestId("length-label").click();
  await page.getByTestId("length-field").fill("590");
  await expect(page.getByTestId("length-preview")).toContainText("will butt on b1 · cut 580");
  await page.getByTestId("length-field").press("Enter");
  await waitDrawn(page, 2);
  expect(await cutOf(served.dir, "b3")).toBe(580);
  expect((await doc(served.dir)).connections?.c2).toEqual({
    type: "butt",
    through: "b1",
    ends: ["b3.b"],
  });
});

test("a cut typed on the label over a param keeps the param driving it (D-UX-17)", async ({
  page,
}) => {
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  await pick(page, "b3");
  await page.getByTestId("length-label").click();
  await page.getByTestId("length-field").fill("=L - 40");
  await page.getByTestId("length-field").press("Enter");
  await waitDrawn(page, 1);
  // b3 is a free brace: its length is its cut, written over L from end a's y.
  expect((await doc(served.dir)).bars.b3?.b).toEqual([500, "600 - (L - 40)", 0]);
  expect(await cutOf(served.dir, "b3")).toBe(360);
  // L changed on the CLI: the cut follows it.
  const r = await cli([
    "do",
    served.dir,
    JSON.stringify({ cmd: "setParam", args: { name: "L", value: "500" } }),
  ]);
  expect(r.code, r.err).toBe(0);
  expect(await cutOf(served.dir, "b3")).toBe(460);
});

test("a held end: dragging b2's butted end away frees it from c1, said before the release", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  await pick(page, "b2");
  const a = await handle(page, "a");
  expect(a.state).toBe("detach");
  await page.mouse.move(a.at[0], a.at[1]);
  await expect(page.getByTestId("tool-hint")).toContainText(
    "b2.a butts on b1 (c1): dragging frees it",
  );
  await dragTo(page, a.at, await screen(page, [1000, -150, 0]));
  await expect(page.getByTestId("joint-preview")).toContainText("frees it from c1");
  const reading = await page.evaluate(() => window.__alukit?.gesture()?.reading ?? "");
  const cut = Number(/cut ([\d.]+) mm/.exec(reading)?.[1]);
  expect(cut).toBeGreaterThan(600);
  await page.mouse.up();
  await waitDrawn(page, 1);
  const d = await doc(served.dir);
  expect(d.connections).toEqual({});
  expect(await cutOf(served.dir, "b2")).toBe(cut);
  expect(await lastStepWords(served.dir)).toMatch(
    /^lengthen b2 at end a to [\d.]+ mm, freed from c1$/,
  );
});

test("a length a param drives: the handle is locked and says 'driven by L', and so does the label", async ({
  page,
}) => {
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  await pick(page, "b4");
  const b = await handle(page, "b");
  expect(b).toMatchObject({ locked: true, state: "driven" });
  // Pressing it starts no drag: it says what drives it, with the param to edit.
  await page.mouse.click(b.at[0], b.at[1]);
  await expect(page.getByTestId("end-note")).toContainText("driven by L");
  expect(await page.evaluate(() => window.__alukit?.gesture())).toBeUndefined();
  await page.getByTestId("length-label").click();
  await expect(page.getByTestId("length-note")).toContainText("driven by L: edit L");
  await page.getByTestId("label-edit-param-L").click();
  await expect(page.getByTestId("param-edit")).toHaveValue("400");
  expect(await page.evaluate(() => window.__alukit?.drawnRev())).toBe(0);
});

// ---------------------------------------------------------------------------------------------
// Editable ends (docs/ux/editing-audit.md E4.1; docs/ux/e4-decisions.md): the cut, the
// extension, the plane and the joint that claims an end, each from the end's row, one step each.

/** `alukit check --json`'s errors, as `code entity`. */
async function errorsOf(dir: string): Promise<string[]> {
  const r = await cli(["check", dir, "--json"]);
  const out = JSON.parse(r.out) as {
    diagnostics: { severity: string; code: string; entity?: string }[];
  };
  return out.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.entity}`);
}

test("the audit's brace: its rows name the butts that claim its ends (D2), and declare both cuts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("brace");
  // The draw tool's batch for the brace, then its cuts undeclared: the state the audit measured,
  // two angled ends that declare no cut, each claim failing (`by: "default"`).
  const drawn = await cli(["do", served.dir, "-f", join(served.dir, "brace.json")]);
  expect(drawn.code, drawn.err).toBe(0);
  const bare = { cmd: "setBar", args: { id: "b13", set: { ends: null } } };
  expect((await cli(["do", served.dir, JSON.stringify(bare)])).code).toBe(0);
  expect(await errorsOf(served.dir)).toEqual(["angled-end b13.a", "angled-end b13.b"]);
  await openTab(page, served, 2);
  await pick(page, "b13");
  const a = page.getByTestId("row-end-a");
  await expect(a).toContainText("butts on b3 (c9); the joint fails, so it is square");
  await expect(page.getByTestId("row-end-b")).toContainText("butts on b4 (c10)");
  // Claimed, so not open: no Join.
  await expect(page.getByTestId("join-end-a")).toHaveCount(0);

  // The cut, from each end's row: one step each.
  await page.getByTestId("end-cut-a").selectOption("angle");
  await waitDrawn(page, 3);
  await page.getByTestId("end-cut-b").selectOption("angle");
  await waitDrawn(page, 4);
  const d = await doc(served.dir);
  expect(d.bars.b13?.ends).toEqual({ a: { cut: "angle" }, b: { cut: "angle" } });
  expect(await errorsOf(served.dir)).toEqual([]);
  await expect(a).toContainText("butts on b3 (c9), cut at 36.87°");
  // The brace's cut, 920 / 0.8 = 1150 by hand (tests/fixtures/brace), is the CLI's.
  expect(await cutOf(served.dir, "b13")).toBe(1150);
  expect(errors).toEqual([]);
});

test("stop at a face: b3's end b stops on b1's near face, from its row or picked in the view", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  await pick(page, "b3");
  // From the row: the faces b3's line meets, the nearest first.
  await page.getByTestId("end-plane-b").selectOption("face");
  const faces = page.getByTestId("end-face-b");
  await expect(faces.locator("option").nth(1)).toHaveText("b1's face +x · 280 mm longer");
  await faces.selectOption({ index: 1 });
  await waitDrawn(page, 1);
  expect((await doc(served.dir)).bars.b3?.ends).toEqual({
    b: { plane: { face: { bar: "b1", face: "+x" } } },
  });
  // b1's +x face is at y = 20: the cut runs from y = 600 to 20.
  expect(await cutOf(served.dir, "b3")).toBe(580);
  await expect(page.getByTestId("row-end-b")).toContainText("stops at b1's face +x");
  await page.getByTestId("undo").click();
  await waitDrawn(page, 2);
  expect((await doc(served.dir)).bars.b3?.ends).toBeUndefined();

  // Picked in the view: the next click on b1 stops the end at the face of b1 its line meets
  // first, whichever side of b1 the click lands on (here its top, which the line never meets).
  // The row has caught up with the undo (the view may draw it first).
  await expect(page.getByTestId("end-plane-b")).toHaveValue("joint");
  await page.getByTestId("end-plane-b").selectOption("face");
  await page.getByTestId("end-pick-b").click();
  await expect(page.getByTestId("end-pick-note")).toContainText("click the face b3.b stops at");
  const s = await screen(page, [300, 0, 20]);
  await page.mouse.move(s[0], s[1]);
  await page.mouse.click(s[0], s[1]);
  await waitDrawn(page, 3);
  expect((await doc(served.dir)).bars.b3?.ends).toEqual({
    b: { plane: { face: { bar: "b1", face: "+x" } } },
  });
  await expect(page.getByTestId("end-pick-note")).toHaveCount(0);
});

test("an end's extension, and freeing a butted end from its butt, each one step", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  // b3's end b 10 longer than its design point: the cut follows, as the CLI cuts it.
  await pick(page, "b3");
  const ext = page.getByTestId("end-extend-b");
  await ext.fill("10");
  await ext.press("Enter");
  await waitDrawn(page, 1);
  expect((await doc(served.dir)).bars.b3?.ends).toEqual({ b: { extend_mm: 10 } });
  expect(await cutOf(served.dir, "b3")).toBe(310);

  // b2.a butts on b1 by c1, its only end: freeing it removes c1, and the end is open.
  await pick(page, "b2");
  await expect(page.getByTestId("row-end-a")).toContainText("butts on b1 (c1)");
  await page.getByTestId("end-detach-a").click();
  await waitDrawn(page, 2);
  expect((await doc(served.dir)).connections).toEqual({});
  await expect(page.getByTestId("row-end-a")).toContainText("open: nothing joins it");
  await expect(page.getByTestId("join-end-a")).toBeVisible();
  // One Undo puts c1 back.
  await page.getByTestId("undo").click();
  await waitDrawn(page, 3);
  expect((await doc(served.dir)).connections?.c1).toEqual({
    type: "butt",
    through: "b1",
    ends: ["b2.a"],
  });
});
