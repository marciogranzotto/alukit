import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  cli,
  lastStepWords,
  openTab,
  type Served,
  scratchProject,
  serve,
  waitDrawn,
} from "./helpers.ts";

/**
 * The connect tool's pivots and fastened face joints (design §8, §4.5). A face connection made
 * with the mouse writes what `alukit do` writes for the same fields, so both derive the same;
 * a pivot points the ends it carries at itself in the same step; a refusal and derive's verdict
 * on the new connection are shown in the panel.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function hover(page: Page, p: V3, says: RegExp): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is not on the screen`);
  const [x, y] = s;
  await page.mouse.move(x, y, { steps: 4 });
  await expect
    .poll(async () => (await page.evaluate(() => window.__alukit?.tool()))?.hint ?? "", {
      timeout: 2000,
    })
    .toMatch(says);
  return [x, y];
}

async function click(page: Page, p: V3, says: RegExp): Promise<void> {
  const [x, y] = await hover(page, p, says);
  await page.mouse.click(x, y);
}

async function derived(dir: string): Promise<unknown> {
  const r = await cli(["derive", dir, "--json"]);
  return JSON.parse(r.out);
}

async function written(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, "alukit.json"), "utf8")) as Record<string, unknown>;
}

/** The cart without c24, the kick strip b24 resting on the front rail b5: free to fasten. */
const UNREST = JSON.stringify({ cmd: "removeEntity", args: { id: "c24" } });

test("a face connection made with the connect tool derives as the CLI's", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serve("cart");
  expect((await cli(["do", served.dir, UNREST])).code).toBe(0);
  await openTab(page, served, 1);

  await page.getByTestId("tool-connect").click();
  await page.getByTestId("connect-type").selectOption("face");
  // Head to nut: the strip on top (z 900 to 910, y 15 to 65), then the rail under it.
  await click(page, [600, 40, 909], /^bar b24$/);
  await click(page, [600, 0.5, 880], /^bar b5$/);
  await expect(page.getByTestId("connect-picks").locator("li")).toHaveCount(2);
  const panel = page.getByTestId("panel-connect");
  await panel.getByTestId("face-fastening").selectOption("screw");
  await expect(panel.getByTestId("connect-why")).toHaveText("name the fastener: an item id");
  await panel.getByTestId("face-fastener").fill("test-gen:SCR-M5x25");
  await panel.getByTestId("face-at").fill("100, 1000");
  await panel.getByTestId("connect-apply").click();
  await waitDrawn(page, 2);
  await expect(panel.getByTestId("connect-outcome")).toContainText("made c36");
  // Derive finds nothing wrong with it. The panel shows every diagnostic the step added (U6),
  // here one note: the screw's seats go unchecked, which names c36 beside c35.
  await expect(panel.getByTestId("new-diagnostics").locator("li:not(.info)")).toHaveCount(0);

  // The same connection through alukit do, on another copy of the cart.
  const other = await scratchProject("cart");
  try {
    const args = {
      type: "face",
      bars: ["b24", "b5"],
      fastening: "screw",
      fastener: "test-gen:SCR-M5x25",
      stations: { at_mm: [100, 1000] },
    };
    const r = await cli([
      "do",
      other.dir,
      JSON.stringify([JSON.parse(UNREST), { cmd: "addConnection", args }]),
    ]);
    expect(r.code).toBe(0);
    expect((await written(served.dir)).connections).toEqual((await written(other.dir)).connections);
    const ui = (await derived(served.dir)) as { fastenings: Record<string, unknown> };
    expect(ui.fastenings.c36).toBeDefined();
    expect(ui).toEqual(await derived(other.dir));
  } finally {
    await other.remove();
  }
  expect(errors).toEqual([]);
});

test("a refused or invalid connection says why in the panel", async ({ page }) => {
  served = await serve("cart");
  expect((await cli(["do", served.dir, UNREST])).code).toBe(0);
  await openTab(page, served, 1);
  await page.getByTestId("tool-connect").click();
  await page.getByTestId("connect-type").selectOption("face");
  await click(page, [600, 40, 909], /^bar b24$/);
  await click(page, [600, 0.5, 880], /^bar b5$/);
  const panel = page.getByTestId("panel-connect");

  // The command refuses an item no catalog holds, and names the field.
  await panel.getByTestId("face-fastening").selectOption("tnut");
  await panel.getByTestId("face-fastener").fill("test-gen:NOPE");
  await panel.getByTestId("face-at").fill("100");
  await panel.getByTestId("connect-apply").click();
  await expect(panel.getByTestId("form-errors")).toContainText("test-gen:NOPE");
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(1);

  // A T-nut where the rail has no groove is made, and derive says what is wrong with it.
  await panel.getByTestId("face-fastener").fill("test-gen:SCR-M5x25");
  await panel.getByTestId("face-stack").fill("test-gen:TNUT-M5");
  await panel.getByTestId("connect-apply").click();
  await waitDrawn(page, 2);
  await expect(panel.getByTestId("new-diagnostics")).toContainText(
    "no groove of b5's face +x where the T-nut goes",
  );
});

test("a pivot carries the ends picked, pointing them at itself in one step", async ({ page }) => {
  served = await serve("cart");
  // A strut standing inside the frame, whose foot the pivot will carry: at x 980, clear of the
  // slats (every 150 from 150) and of the brace b15 over the front base rail, and seen past the
  // front posts from the iso view.
  const add = await cli([
    "do",
    served.dir,
    JSON.stringify({ cmd: "addBar", args: { a: [980, 150, 100], b: [980, 150, 500] } }),
  ]);
  expect(add.code).toBe(0);
  await openTab(page, served, 1);

  await page.getByTestId("tool-connect").click();
  await page.getByTestId("connect-type").selectOption("pivot");
  const panel = page.getByTestId("panel-connect");
  // The hinge the document's pivots use is suggested.
  await expect(panel.getByTestId("pivot-connector")).toHaveValue("test-geo:HNG-15");
  // The base: a station on the front base rail's top face, its +y (b9: y 0 to 40, z 80 to 120).
  await click(page, [980, 20, 120], /^base: b9 \+y face at 980$/);
  await expect(panel.getByTestId("pivot-base")).toContainText("b9");
  // The strut's foot: its lower quarter picks its end a.
  await click(page, [980, 150, 150], /^end b35\.a$/);
  await panel.getByTestId("connect-apply").click();
  await waitDrawn(page, 2);
  await expect(panel.getByTestId("connect-outcome")).toContainText("made c36");

  const doc = await written(served.dir);
  expect((doc.connections as Record<string, unknown>).c36).toEqual({
    type: "pivot",
    base: { bar: "b9", at_mm: 980, face: "+y" },
    axis: "across",
    ends: ["b35.a"],
    connector: "test-geo:HNG-15",
  });
  expect((doc.bars as Record<string, { a: unknown }>).b35?.a).toEqual({ pivot: "c36" });
  const d = (await derived(served.dir)) as {
    bars: Record<string, { ends: { a: { by: string } } }>;
    diagnostics: { severity: string; entity?: string }[];
  };
  expect(d.bars.b35?.ends.a.by).toBe("c36");
  expect(d.diagnostics.filter((x) => x.severity === "error" && x.entity === "c36")).toEqual([]);
  // One step: undo takes back the connection and the end it set, and names the step in words.
  await expect(page.getByTestId("undo")).toHaveText(
    `Undo · you: ${await lastStepWords(served.dir)}`,
  );
});

test("a connection that breaks another bar's end shows that error in the panel (U6)", async ({
  page,
}) => {
  // The CLI-built base frame: c1 butts b1.b (the front left post's top) through b5.
  served = await serve("base-frame/cli");
  await openTab(page, served, 0);
  await page.getByTestId("tool-connect").click();
  const panel = page.getByTestId("panel-connect");
  // A second butt claiming b1.b, through the left top rail b7: b1.b then has two providers.
  await click(page, [20, 300, 900], /^bar b7$/);
  await click(page, [20, 0, 780], /^end b1\.b$/);
  // A second through bar is not a butt's: the tool leaves it out and says why (U38).
  await hover(page, [600, 40, 900], /^bar b5: a butt has one through bar/);
  await page.mouse.click(...(await hover(page, [600, 40, 900], /^bar b5/)));
  await expect(panel.getByTestId("connect-picks").locator("li")).toHaveCount(2);
  await panel.getByTestId("connect-apply").click();
  await waitDrawn(page, 1);
  await expect(panel.getByTestId("connect-outcome")).toContainText("made c7");
  // The error is on b1.b, not on the new connection: before, the panel left it out.
  await expect(
    panel
      .getByTestId("new-diagnostics")
      .locator("li.error", { hasText: "b1.b has 2 providers (c1, c7)" }),
  ).toHaveCount(1);
});
