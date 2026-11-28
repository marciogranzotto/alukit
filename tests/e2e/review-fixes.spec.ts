import { expect, type Page, test } from "@playwright/test";
import {
  cli,
  docOf,
  openTab,
  type Served,
  selectByIds,
  serve,
  serveNew,
  waitDrawn,
} from "./helpers.ts";

/**
 * The designer review's minors and nits on the app side (docs/ux/review-editing.md m3–m15, n1;
 * docs/ux/review-fixes-app-decisions.md): each test fails for the reason the review states and
 * holds the fix. The box frame is A1's, made by the CLI as editing.spec makes it.
 */

type V3 = [number, number, number];

let served: Served | undefined;
test.afterEach(async () => {
  await served?.stop();
  served = undefined;
});

const NEW = ["--catalog", "forseti", "--currency", "BRL"];
const FRAME = [
  {
    cmd: "setProject",
    args: {
      defaults: {
        bar: { item: "forseti:PF40-01", opt: { finish: "anodised" } },
        butt: { connector: "forseti:CT38-06" },
      },
    },
  },
  { cmd: "addFrame", args: { at: [0, 0, 0], size: [1000, 600, 750], shelf_mm: 250, params: true } },
];

async function serveFrame(): Promise<Served> {
  return serveNew(NEW, async (dir) => {
    const r = await cli(["do", dir, JSON.stringify(FRAME)]);
    expect(r.code, r.err || r.out).toBe(0);
  });
}

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is off the screen`);
  return s;
}

async function pickRow(page: Page, id: string): Promise<void> {
  await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText(id);
}

/** The menu of an outline row, opened by Shift+F10 from the row. */
async function rowMenu(page: Page, id: string) {
  await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByTestId("context-menu")).toBeVisible();
  return (await page.evaluate(() => window.__alukit?.menu()))?.entries ?? [];
}

const overlap = (a: DOMRect | null, b: DOMRect | null) =>
  !!a &&
  !!b &&
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

test("m3: a move the preview refuses is not sent on Enter; the bar says why in the app's words", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await pickRow(page, "b2");
  await page.keyboard.press("d");
  const from = await screen(page, [1000, 300, 0]);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0], from[1] - 10, { steps: 2 });
  await page.keyboard.press("ArrowUp");
  const up = await screen(page, [1000, 300, 120]);
  await page.mouse.move(up[0], up[1], { steps: 10 });
  await expect(page.getByTestId("joint-preview")).toContainText("would break a joint");
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.userAgent));
  await expect(page.getByTestId("joint-preview")).toContainText(
    `hold ${mac ? "Option" : "Alt"} to detach it`,
  );
  await page.keyboard.press("Enter");
  // Nothing posted: the gesture is still on, and its bar says why, never the API's syntax.
  await expect(page.getByTestId("tool-result")).toContainText("would break a joint");
  await expect(page.getByTestId("tool-result")).not.toContainText('joined: "detach"');
  // Said once (re-check N9): as Enter's answer, no longer also as the preview.
  await expect(page.getByTestId("joint-preview")).toHaveCount(0);
  expect(await page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("move");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__alukit?.drawnRev())).toBe(0);
  await expect(page.locator(".toast.error")).toHaveCount(0);
});

test("m4: the gesture's field is named for the gesture, not 'Draw bar: value'", async ({
  page,
}) => {
  served = await serve("ux/ends");
  await openTab(page, served, 0);
  await pickRow(page, "b3");
  await page.waitForFunction(() => window.__alukit?.handles().some((h) => h.end === "b"));
  const h = (await page.evaluate(() => window.__alukit?.handles()))?.find((x) => x.end === "b");
  const at = await screen(page, h?.p as V3);
  await page.mouse.click(at[0], at[1]);
  await expect.poll(() => page.evaluate(() => window.__alukit?.gesture()?.kind)).toBe("end");
  await expect(page.getByTestId("command-value")).toHaveAccessibleName("Drag end b3.b: cut length");
  await page.keyboard.press("Escape");
});

test.describe("m5: key caps on macOS", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  });
  test("say ⌘ and ⌥ in the menu and the help", async ({ page }) => {
    served = await serve("cart");
    await openTab(page, served, 0);
    await pickRow(page, "b1");
    await rowMenu(page, "b1");
    const menu = page.getByTestId("context-menu");
    await expect(menu.locator('[data-action="duplicate"] kbd')).toHaveText("⌘D");
    await expect(menu.locator('[data-action="select-all"] kbd')).toHaveText("⌘A");
    await page.keyboard.press("Escape");
    await page.locator("body").press("?");
    const help = page.getByRole("dialog");
    await expect(help).toContainText("⌘");
    await expect(help).toContainText("⌥");
    await expect(help).not.toContainText("Ctrl");
  });
});

test.describe("m5: key caps elsewhere", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  });
  test("say Ctrl and Alt", async ({ page }) => {
    served = await serve("cart");
    await openTab(page, served, 0);
    await pickRow(page, "b1");
    await rowMenu(page, "b1");
    await expect(
      page.getByTestId("context-menu").locator('[data-action="duplicate"] kbd'),
    ).toHaveText("Ctrl+D");
  });
});

test("m7: at 1000 × 700 the orientation gizmo is clear of the tool rail", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  served = await serve("cart");
  await openTab(page, served, 0);
  const rect = (b: { x: number; y: number; width: number; height: number } | null) =>
    b && ({ left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height } as DOMRect);
  const rail = rect(await page.getByTestId("tool-rail").boundingBox());
  const gizmo = rect(await page.getByTestId("gizmo").boundingBox());
  expect(rail && gizmo).toBeTruthy();
  expect(overlap(rail, gizmo)).toBe(0);
});

test("m6: at 1000 × 700 the tool's readout clears the selection's length label", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1000, height: 700 });
  served = await serveFrame();
  await openTab(page, served, 0);
  // A7's duplicate: the readout by the copy and the selected rail's length label.
  await pickRow(page, "b13");
  await page.getByTestId("viewport").hover();
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("-300");
  await expect(page.getByTestId("joint-preview")).toContainText("makes b17");
  const label = page.locator('.view-label[data-label="joint"]');
  await expect(label).toBeVisible();
  const boxes = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)?.getBoundingClientRect().toJSON() ?? null;
    return { sel: r(".sel-label"), joint: r('.view-label[data-label="joint"]') };
  });
  expect(overlap(boxes.sel, boxes.joint)).toBe(0);
  await page.keyboard.press("Escape");
});

test("m10: Show is not on a drawn entity's menu; on a hidden one it shows it again", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  await pickRow(page, "b1");
  expect((await rowMenu(page, "b1")).map((e) => e.id)).not.toContain("show");
  await page.keyboard.press("Escape");
  await page.locator("body").press("h");
  await expect.poll(() => page.evaluate(() => window.__alukit?.hidden())).toContain("b1");
  // Hidden, it left the selection: its row's right-click selects it and opens its menu.
  await page.getByTestId("tree").locator('[data-id="b1"]').first().click({ button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  const entries = (await page.evaluate(() => window.__alukit?.menu()))?.entries ?? [];
  expect(entries.find((e) => e.id === "show")).toMatchObject({ enabled: true });
  await page.getByTestId("context-menu").locator('[data-action="show"]').click();
  await expect.poll(() => page.evaluate(() => window.__alukit?.hidden())).toEqual([]);
});

test("m11, n1: the menu's access keys reach Duplicate by D; Delete's dialog focuses Cancel, names one", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  await pickRow(page, "b14");
  const focused = () =>
    page.evaluate(() => document.activeElement?.getAttribute("data-action") ?? null);
  // The review's keys, typed straight on: Shift+F10, D. The `contextmenu` event the key sends
  // after itself must not open the menu again over the letter.
  await page.getByTestId("tree").locator('[data-id="b14"]').first().focus();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("d");
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await expect.poll(focused).toBe("duplicate");
  // Each entry its own letter: D is Duplicate's (its key is ⌘D or Ctrl+D), L Delete's.
  const entries = (await page.evaluate(() => window.__alukit?.menu()))?.entries ?? [];
  const access = Object.fromEntries(entries.map((e) => [e.id, e.access]));
  expect(access).toMatchObject({ duplicate: "d", delete: "l" });
  const letters = entries.flatMap((e) => (e.access ? [e.access] : []));
  expect(new Set(letters).size).toBe(letters.length);
  await page.keyboard.press("l");
  expect(await focused()).toBe("delete");
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("delete-dialog");
  await expect(dialog).toBeVisible();
  // One thing goes: it is named, and the button says Delete; the least destructive is focused.
  await expect(dialog.getByRole("heading")).toHaveText("Delete b14?");
  await expect(dialog.getByTestId("delete-confirm")).toHaveText("Delete");
  await expect(dialog.getByTestId("delete-cancel")).toBeFocused();
  // A typed space presses Cancel, not Delete.
  await page.keyboard.press(" ");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
});

test("m8: Pattern draws its copies and reads its dry run before Create; its prompt moves on", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  await pickRow(page, "b13");
  await page.getByTestId("tool-pattern").click();
  await expect(page.getByTestId("pattern-template")).toHaveText("b13");
  const prompt = page.getByTestId("panel-pattern").locator("p.hint-text").first();
  await expect(prompt).toContainText("Click the bar to repeat along");
  await page.getByTestId("pattern-along").fill("b1");
  await page.getByTestId("pattern-pitch").fill("100");
  await page.getByTestId("pattern-count").fill("3");
  // The prompt has moved on, the reading says what Create makes, and the copies are drawn.
  await expect(prompt).toContainText("Repeats along b1");
  await expect(page.getByTestId("pattern-preview")).toHaveText(/^makes 2 copies: 2 bars more/);
  await expect.poll(() => page.evaluate(() => window.__alukit?.patternGhosts())).toBe(2);
  // Nothing was sent: the document is as it was.
  expect(Object.keys(((await docOf(served.dir)).patterns ?? {}) as object)).toEqual([]);
});

test("m13: the box frame's Joined with lists the corner joints that fit first, the rest after", async ({
  page,
}) => {
  served = await serveNew(NEW);
  await openTab(page, served, 0);
  const card = page.getByTestId("start-card");
  await card.locator('.profile-chip[data-size="40 × 40"]').click();
  const select = card.getByTestId("frame-form").getByTestId("frame-joint");
  const groupsNow = () =>
    select.evaluate((el) =>
      [...el.querySelectorAll("optgroup")].map((g) => ({
        label: g.label,
        names: [...g.querySelectorAll("option")].map((o) => o.title),
      })),
    );
  // Once the profile's system is read: the corner joints that fit, then the other fitting ones.
  await expect
    .poll(async () => (await groupsNow()).map((g) => g.label).slice(0, 2))
    .toEqual(["Corner joints that fit", "Other connectors that fit"]);
  const groups = await groupsNow();
  const corners = groups[0]?.names ?? [];
  // Every corner joint is a bracket or an end connector; the plates come after, and the review's
  // 180° extender (a splice) is not offered for a corner at all.
  expect(corners.length).toBeGreaterThan(0);
  expect(corners.filter((n) => /placa|prolongador|180°/i.test(n))).toEqual([]);
  const all = groups.flatMap((g) => g.names);
  expect(all.filter((n) => /prolongador|180°/i.test(n))).toEqual([]);
  expect(all.some((n) => /Placa X/i.test(n))).toBe(true);
  // Still the person's choice (review B1 of the phase-4 review): nothing is chosen for them.
  await expect(select).toHaveValue("");
});

test("m14: in the outline, Shift + arrow extends the selection", async ({ page }) => {
  served = await serveFrame();
  await openTab(page, served, 0);
  await pickRow(page, "b1");
  await page.getByTestId("tree").locator('[data-id="b1"]').first().focus();
  await page.keyboard.press("Shift+ArrowDown");
  const sel = (await page.evaluate(() => window.__alukit?.selection())) ?? [];
  expect(sel).toContain("b1");
  expect(sel).toHaveLength(2);
});

test("m15: a part slid by its arrow lands on the 10 mm grid; Shift slides it freely", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serve("ux/move");
  await openTab(page, served, 0);
  await selectByIds(page, ["p1"]);
  const g = await expect
    .poll(() => page.evaluate(() => window.__alukit?.gizmo()))
    .toMatchObject({ parts: ["move-x"] })
    .then(() => page.evaluate(() => window.__alukit?.gizmo() as unknown as { at: V3 }));
  const at = g.at;
  const o = await screen(page, at);
  const ten = await screen(page, [at[0] + 10, at[1], at[2]]);
  const a = 40 / (Math.hypot(ten[0] - o[0], ten[1] - o[1]) / 10);
  const press = await screen(page, [at[0] + a, at[1], at[2]]);
  // Toward 427 (300 + 127): the slide lands on 430.
  const end = await screen(page, [at[0] + a + 127, at[1], at[2]]);
  await page.mouse.move(press[0], press[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 12 });
  await page.mouse.up();
  await waitDrawn(page, 1);
  const atMm = async () =>
    ((await docOf((served as Served).dir)).parts as Record<string, { on?: { at_mm?: number } }>).p1
      ?.on?.at_mm ?? Number.NaN;
  expect(await atMm()).toBe(430);

  // With Shift held, the slide is free: 127 more lands on 557, give or take a pixel's millimetre.
  await expect
    .poll(() => page.evaluate(() => (window.__alukit?.gizmo() as { at?: V3 } | undefined)?.at?.[0]))
    .toBeCloseTo(at[0] + 130, 0);
  const at2: V3 = [at[0] + 130, at[1], at[2]];
  const press2 = await screen(page, [at2[0] + a, at2[1], at2[2]]);
  const end2 = await screen(page, [at2[0] + a + 127, at2[1], at2[2]]);
  await page.mouse.move(press2[0], press2[1]);
  // Pressed first, then Shift: a Shift-press in Select is the box's.
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(end2[0], end2[1], { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await waitDrawn(page, 2);
  expect(Math.abs((await atMm()) - 557)).toBeLessThanOrEqual(1);
});
