import { expect, type Page, test } from "@playwright/test";
import {
  cli,
  docOf,
  openTab,
  type Served,
  scratchProject,
  selectByIds,
  serve,
  waitDrawn,
} from "./helpers.ts";

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

/**
 * The commands through `alukit do` on another copy of a fixture, one batch per step; then `read`
 * of that copy (its document unless it says).
 */
async function onCopy<T>(
  project: string,
  batches: unknown[][],
  read: (dir: string) => Promise<T>,
): Promise<T> {
  const other = await scratchProject(project);
  try {
    for (const b of batches) {
      const r = await cli(["do", other.dir, JSON.stringify(b)]);
      expect(r.code, r.err).toBe(0);
    }
    return await read(other.dir);
  } finally {
    await other.remove();
  }
}

/** The document after the commands, through `alukit do` on another copy. */
function viaCli(project: string, ...batches: unknown[][]): Promise<Record<string, unknown>> {
  return onCopy(project, batches, docOf);
}

interface BomLine {
  item: string;
  qty: number;
}

/**
 * An output's JSON. Exit 1 says the project has errors, and the output is still written (§7.3);
 * 2, a usage error, fails.
 */
async function outputOf<T>(args: string[]): Promise<T> {
  const r = await cli(args);
  expect([0, 1], r.err).toContain(r.code);
  return JSON.parse(r.out) as T;
}

/** `alukit bom --format json`'s lines, every group's, in order. */
async function bomLines(dir: string): Promise<BomLine[]> {
  const bom = await outputOf<{ groups: { lines: BomLine[] }[] }>(["bom", dir, "--format", "json"]);
  return bom.groups.flatMap((g) => g.lines);
}

/** The errors `alukit derive` gives on one entity, in its words. */
async function errorsOn(dir: string, id: string): Promise<string[]> {
  const d = await outputOf<{
    diagnostics: { severity: string; entity?: string; message: string }[];
  }>(["derive", dir, "--json"]);
  return d.diagnostics
    .filter((x) => x.severity === "error" && x.entity === id)
    .map((x) => x.message);
}

/** A BOM line's quantity, by item. */
const qtyOf = (lines: BomLine[], item: string) => lines.find((l) => l.item === item)?.qty ?? 0;

/** `alukit derive --json`'s parts. */
async function derivedParts(dir: string): Promise<Record<string, unknown>> {
  const r = await cli(["derive", dir, "--json"]);
  expect(r.code, r.err).toBe(0);
  return (JSON.parse(r.out) as { parts: Record<string, unknown> }).parts;
}

/** Fills a field in the inspector and presses Enter: one step, the revision `rev`. */
async function commit(page: Page, testid: string, text: string, rev?: number): Promise<void> {
  const field = page.getByTestId("properties").getByTestId(testid);
  await field.fill(text);
  await field.press("Enter");
  if (rev !== undefined) await waitDrawn(page, rev);
}

/**
 * Selects a connection from the outline, as a person finds one there: its id typed in the
 * outline's filter (which lists the joints flat, not by corner), then a click on its row.
 */
async function selectJoint(page: Page, id: string): Promise<void> {
  const filter = page.getByRole("searchbox", { name: "Filter the outline" });
  await filter.fill(id);
  await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().click();
  await page.waitForFunction(
    (want) => JSON.stringify(window.__alukit?.selection()) === JSON.stringify([want]),
    id,
  );
  await filter.fill("");
}

/** Undoes `n` steps from revision `rev`, one at a time. */
async function undo(page: Page, rev: number, n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await page.getByTestId("undo").click();
    await waitDrawn(page, rev + i);
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

test("c23's stations go from (100, 200) to (100, 200, 300) in one step, and its hardware rises as alukit do's (E5.1)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("cart");
  await openTab(page, served, 0);
  const before = await docOf(served.dir);
  const bomBefore = await bomLines(served.dir);
  await selectJoint(page, "c23");
  const form = page.getByTestId("properties").getByTestId("face-edit");
  // The Connect tool's form, filled from c23: a rod through five layers at two stations.
  await expect(form.getByTestId("face-fastening")).toHaveValue("bolt");
  await expect(form.getByTestId("face-at")).toHaveValue("100, 200");
  await expect(form.getByTestId("face-across")).toHaveValue("-15, 15");
  // The sleeve in its stack is written in a form the form cannot hold: shown, kept, read only.
  await expect(form.getByTestId("face-stack")).toBeDisabled();
  await expect(form.getByTestId("face-apply")).toBeDisabled();

  const stationsAt = (at_mm: number[]) => ({
    cmd: "setConnection",
    args: { id: "c23", set: { stations: { at_mm } } },
  });
  await form.getByTestId("face-at").fill("100, 200, 300");
  await form.getByTestId("face-apply").click();
  await waitDrawn(page, 1);
  const third = stationsAt([100, 200, 300]);
  expect(await docOf(served.dir)).toEqual(await viaCli("cart", [third]));
  // What derive says is the CLI's: by hand, 300 along b20 (from y 150) is y 450, past the packer
  // b21 (y 200 to 400), so the new station's two bolts miss it, and no hardware is counted there.
  const misses = ["station 5: the fastener misses b21", "station 6: the fastener misses b21"];
  expect(await errorsOn(served.dir, "c23")).toEqual(misses);
  expect(await onCopy("cart", [[third]], (d) => errorsOn(d, "c23"))).toEqual(misses);
  const bom = await bomLines(served.dir);
  expect(bom).toEqual(await onCopy("cart", [[third]], bomLines));
  expect(qtyOf(bom, "test-geo:NUT-M10")).toBe(qtyOf(bomBefore, "test-geo:NUT-M10"));

  // A station that fits: the form is filled from the joint as it now stands, and the hardware rises
  // as the CLI's. By hand, 150 along b20 is y 300, in every layer: two more bolts across it, each
  // with the stack's two nuts, so four more nuts.
  await expect(form.getByTestId("face-at")).toHaveValue("100, 200, 300");
  await form.getByTestId("face-at").fill("100, 150, 200");
  await form.getByTestId("face-apply").click();
  await waitDrawn(page, 2);
  const fits = stationsAt([100, 150, 200]);
  expect(await docOf(served.dir)).toEqual(await viaCli("cart", [third], [fits]));
  expect(await errorsOn(served.dir, "c23")).toEqual([]);
  const risen = await bomLines(served.dir);
  expect(risen).toEqual(await onCopy("cart", [[third], [fits]], bomLines));
  expect(qtyOf(risen, "test-geo:NUT-M10") - qtyOf(bomBefore, "test-geo:NUT-M10")).toBe(4);

  // The layers are re-picked in Connect, which offers to replace c23's.
  await page.getByTestId("properties").getByTestId("face-relayer").click();
  const panel = page.getByTestId("panel-connect");
  await expect(panel.getByTestId("connect-picks").locator("li")).toHaveText([
    /b20/,
    /b21/,
    /b18/,
    /b22/,
    /b23/,
  ]);
  await expect(panel.getByTestId("connect-apply")).toHaveText("Replace c23");
  await expect(panel.getByTestId("connect-why")).toContainText("nothing changed");
  await panel.getByTestId("connect-replace-off").click();
  await expect(panel.getByTestId("connect-apply")).toHaveText("Apply");
  await page.getByTestId("tool-select").click();

  await undo(page, 2, 2);
  expect(await docOf(served.dir)).toEqual(before);
  expect(errors).toEqual([]);
});

test("a pivot's base, axis and hinge, a splice's gap and quantity, a butt's spacer and through end: one step each, Undo each (E5.2)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("cart");
  await openTab(page, served, 0);
  const before = await docOf(served.dir);
  const props = page.getByTestId("properties");

  // The pivot c13: its base 650 along b1 becomes 600, it turns along the base, on the other hinge.
  await selectJoint(page, "c13");
  await expect(props.getByTestId("field-station-at")).toHaveValue("650");
  await commit(page, "field-station-at", "600", 1);
  await props.getByTestId("field-axis").selectOption("along");
  await waitDrawn(page, 2);
  await expect(
    props.getByTestId("field-connector").locator('option[value="test:HNG-40"]'),
  ).toHaveCount(1);
  await props.getByTestId("field-connector").selectOption("test:HNG-40");
  await waitDrawn(page, 3);
  // A quantity of none is refused under its own row, and nothing is sent.
  await commit(page, "field-qty", "0");
  await expect(props.getByTestId("row-qty-errors")).toContainText(
    "the quantity is a whole number, 1 or more",
  );
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(3);

  // The splice c9: a 2 mm gap and two connectors.
  await selectJoint(page, "c9");
  await commit(page, "field-gap", "2", 4);
  await commit(page, "field-qty", "2", 5);

  // The butt c1, through b5: an 8 mm spacer, and b5's own end square at its point at a corner.
  await selectJoint(page, "c1");
  await commit(page, "field-spacer", "8", 6);
  await props.getByTestId("field-through-end").selectOption("node");
  await waitDrawn(page, 7);

  const set = (id: string, patch: Record<string, unknown>) => ({
    cmd: "setConnection",
    args: { id, set: patch },
  });
  expect(await docOf(served.dir)).toEqual(
    await viaCli(
      "cart",
      [set("c13", { base: { at_mm: 600 } })],
      [set("c13", { axis: "along" })],
      [set("c13", { connector: "test:HNG-40" })],
      [set("c9", { gap_mm: 2 })],
      [set("c9", { qty: 2 })],
      [set("c1", { spacer_mm: 8 })],
      [set("c1", { through_end: "node" })],
    ),
  );

  // Each round-trips through Undo, one at a time.
  await undo(page, 7, 7);
  expect(await docOf(served.dir)).toEqual(before);
  expect(errors).toEqual([]);
});

test("a cross hole's face, named per end on the connection, is one step, judged by derive; AluKit's choice takes it back (E5.2, F12)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // G50: a quick connector in two diagonal cores of an 80x80 post butted on a sill.
  served = await serve("golden-gen/G50");
  await openTab(page, served, 0);
  const before = await docOf(served.dir);
  await selectJoint(page, "c1");
  const props = page.getByTestId("properties");
  const field = props.getByTestId("field-hole-b2.a");
  await expect(field).toHaveValue("");
  await field.selectOption("-x");
  await waitDrawn(page, 1);
  const set = { cmd: "setConnection", args: { id: "c1", set: { hole_faces: { "b2.a": "-x" } } } };
  expect(await docOf(served.dir)).toEqual(await viaCli("golden-gen/G50", [set]));
  // From -x, the hole at (20, 20) is 60 from its core: derive says so on c1, and the row is lit.
  await expect(props.getByTestId("selection-problems")).toContainText("c1");
  await field.selectOption("");
  await waitDrawn(page, 2);
  expect(await docOf(served.dir)).toEqual(before);
  await undo(page, 2, 2);
  expect(await docOf(served.dir)).toEqual(before);
  expect(errors).toEqual([]);
});

test("a T-nut moves from face +y into groove +y.1 where the CLI puts it; Replace gives it another item (E5.4)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("cart");
  const place = {
    cmd: "addPart",
    args: { item: "test:TNUT-M8", on: { bar: "b9", at_mm: 300, face: "+y" } },
  };
  expect((await cli(["do", served.dir, JSON.stringify(place)])).code).toBe(0);
  await openTab(page, served, 1);
  const props = page.getByTestId("properties");
  await selectByIds(page, ["p9"]);
  await props.getByTestId("field-station-face").selectOption("+y.1");
  await waitDrawn(page, 2);
  const groove = {
    cmd: "setPart",
    args: { id: "p9", set: { on: { groove: "+y.1", face: null } } },
  };
  expect(await derivedParts(served.dir)).toEqual(
    await onCopy("cart", [[place], [groove]], derivedParts),
  );
  expect(await docOf(served.dir)).toEqual(await viaCli("cart", [place], [groove]));

  // Replace, from its inspector: another T-nut, as one step.
  await props.getByTestId("part-replace-open").click();
  const form = props.getByTestId("part-replace-form");
  await expect(
    form.getByTestId("part-replace-item").locator('option[value="test:TNUT-M8-C10"]'),
  ).toHaveCount(1);
  await form.getByTestId("part-replace-item").selectOption("test:TNUT-M8-C10");
  await form.getByTestId("part-replace-apply").click();
  await waitDrawn(page, 3);
  expect(((await docOf(served.dir)).parts as Record<string, { item: string }>).p9?.item).toBe(
    "test:TNUT-M8-C10",
  );
  await undo(page, 3, 2);
  expect(await docOf(served.dir)).toEqual(await viaCli("cart", [place]));
  expect(errors).toEqual([]);
});
