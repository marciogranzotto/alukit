import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  cli,
  docOf,
  lastStepWords,
  openTab,
  type Served,
  scratchProject,
  selectByIds,
  serve,
  serveNew,
  waitDrawn,
} from "./helpers.ts";

/**
 * The editing round's acceptance scenarios (docs/ux/editing-audit.md §12, A1–A15), each driven as a
 * person would (pointer, keys, menu) and each ending in a comparison with the CLI: `alukit diff`
 * empty against a scratch copy the CLI built, or a byte-identical cut list. §12 runs them in one
 * session, each from the one before; here each test starts from the state the scenarios before it
 * leave, built by the CLI with the commands the app sends (the start card's frame, `FRAME`), so a
 * test can run alone. A scenario the app cannot do as built is `test.fixme`, with why.
 *
 * Each test prints one `[editing]` line: the in-app steps' time (the script's, from the first
 * click or key: a floor for a person's, not a person's), its clicks, keys and steps. Those lines
 * fill the table in docs/ux/integration-editing.md.
 */

type V3 = [number, number, number];

/** The README's first run: an empty project of the built-in Forseti catalog. */
const NEW = ["--catalog", "forseti", "--currency", "BRL"];

/**
 * What the start card's box frame sends for A1 (measured: A1's test reads it off the request): the
 * 40 × 40 profile and the bracket become the defaults, then the frame, W, D and H as params.
 */
const DEFAULTS = {
  cmd: "setProject",
  args: {
    defaults: {
      bar: { item: "forseti:PF40-01", opt: { finish: "anodised" } },
      butt: { connector: "forseti:CT38-06" },
    },
  },
};
const FRAME_ARGS = { at: [0, 0, 0], size: [1000, 600, 750], shelf_mm: 250 };
const FRAME: unknown[] = [DEFAULTS, { cmd: "addFrame", args: { ...FRAME_ARGS, params: true } }];
/** The same frame without params (A2 (ii)). */
const FRAME_NUMBERS: unknown[] = [
  DEFAULTS,
  { cmd: "addFrame", args: { ...FRAME_ARGS, params: false } },
];

/**
 * The frame's bars, as `addFrame` numbers them: posts b1 (front left), b2 (front right), b3 (back
 * left), b4 (back right); base b5 (front), b6 (back), b7 (left), b8 (right); shelf b9–b12 and top
 * b13–b16 in the same order. Butts c1–c12, the posts running through.
 */
const SHELF = ["b9", "b10", "b11", "b12"];

let served: Served | undefined;
test.afterEach(async () => {
  await served?.stop();
  served = undefined;
});

/** Counts what a person does (clicks, keys) and the time from the first of them. */
class User {
  clicks = 0;
  keys = 0;
  private t0 = 0;
  private t1 = 0;
  private readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }
  private start() {
    if (this.t0 === 0) this.t0 = Date.now();
  }
  async click(l: Locator, opts?: Parameters<Locator["click"]>[0]) {
    this.start();
    this.clicks++;
    await l.click(opts);
  }
  async clickAt(p: readonly [number, number], opts?: Parameters<Page["mouse"]["click"]>[2]) {
    this.start();
    this.clicks++;
    await this.page.mouse.click(p[0], p[1], opts);
  }
  async press(key: string) {
    this.start();
    this.keys++;
    await this.page.keyboard.press(key);
  }
  async type(text: string) {
    this.start();
    this.keys += text.length;
    await this.page.keyboard.type(text);
  }
  async fill(l: Locator, text: string) {
    this.start();
    this.clicks++;
    this.keys += text.length;
    await l.fill(text);
  }
  /** A select: a click to open it, one to choose. */
  async select(l: Locator, value: string) {
    this.start();
    this.clicks += 2;
    await l.selectOption(value);
  }
  async check(l: Locator) {
    this.start();
    this.clicks++;
    await l.check();
  }
  /** The in-app steps are done: the time stops here. */
  done() {
    this.t1 = Date.now();
  }
  report(id: string, steps: number, extra = "") {
    const s = ((this.t1 || Date.now()) - this.t0) / 1000;
    console.log(
      `[editing] ${id}: ${s.toFixed(1)} s, ${this.clicks} clicks, ${this.keys} keys, ${steps} step${steps === 1 ? "" : "s"}${extra ? `; ${extra}` : ""}`,
    );
  }
}

/** The commands the app sends as steps (not dry runs), one batch per step, in order. */
function sentSteps(page: Page): unknown[][] {
  const sent: unknown[][] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().endsWith("/api/commands")) return;
    const body = JSON.parse(r.postData() ?? "{}") as { dryRun?: boolean; commands?: unknown[] };
    if (!body.dryRun && body.commands) sent.push(body.commands);
  });
  return sent;
}

/** `alukit do <dir> <batch>`, one step per batch; fails the test on a refusal. */
async function doAll(dir: string, ...batches: unknown[][]): Promise<void> {
  for (const b of batches) {
    const r = await cli(["do", dir, JSON.stringify(b)]);
    expect(r.code, r.err || r.out).toBe(0);
  }
}

/** A project `alukit new` makes as the served one was made (the same folder name), then `prepare`. */
async function scratchNew(
  prepare?: (dir: string) => Promise<void>,
): Promise<{ dir: string; remove(): Promise<void> }> {
  const base = await mkdtemp(join(tmpdir(), "alukit-e2e-cli-"));
  const dir = join(base, "project");
  const made = await cli(["new", dir, ...NEW]);
  expect(made.code, made.err).toBe(0);
  if (prepare) await prepare(dir);
  return { dir, remove: () => rm(base, { recursive: true, force: true }) };
}

async function cutList(dir: string): Promise<string> {
  const r = await cli(["cutlist", dir, "--format", "json"]);
  expect(r.code, r.err).toBe(0);
  return r.out;
}

/** `alukit diff a b` finds nothing between them. */
async function expectSame(a: string, b: string): Promise<void> {
  const d = await cli(["diff", a, b, "--format", "json"]);
  expect(d.code, d.err).toBe(0);
  const out = JSON.parse(d.out) as { same: boolean; entities: unknown[] };
  expect(out.entities).toEqual([]);
  expect(out.same).toBe(true);
}

/** The app's project against a copy the CLI built: `alukit diff` empty. */
async function sameAsCli(dir: string, prepare: (dir: string) => Promise<void>): Promise<void> {
  const copy = await scratchNew(prepare);
  try {
    await expectSame(dir, copy.dir);
  } finally {
    await copy.remove();
  }
}

interface DerivedBar {
  a: V3;
  b: V3;
  cut_mm: number;
}
interface Derived {
  bars: Record<string, DerivedBar>;
  parts: Record<string, { item: string; bar?: string; face?: string; s_mm?: number }>;
  diagnostics: { severity: string; code: string; entity?: string; message: string }[];
}

async function derived(dir: string): Promise<Derived> {
  const r = await cli(["derive", dir, "--json"]);
  expect([0, 1], r.err).toContain(r.code);
  return JSON.parse(r.out) as Derived;
}

const diagnosticsOf = async (dir: string) =>
  (await derived(dir)).diagnostics.map((d) => `${d.severity} ${d.code} ${d.entity ?? ""}`).sort();

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is off the screen`);
  return s;
}

async function atRest(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => window.__alukit?.camera()?.moving), { timeout: 10_000 })
    .toBe(false);
}

const selection = (page: Page) => page.evaluate(() => window.__alukit?.selection());
const rev = (page: Page) => page.evaluate(() => window.__alukit?.rev());

/** The outline grouped by tag, then a click on a tag's head: its members, selected. */
async function selectTag(u: User, page: Page, tag: string): Promise<void> {
  const byTag = page.getByRole("checkbox", { name: "by tag" });
  if (!(await byTag.isChecked())) await u.check(byTag);
  await u.click(page.getByTestId("tree").locator(`[data-key="g:tag:${tag}"] .title`));
}

/** The served project from `alukit new`, the frame of A1 already in it (by the CLI). */
async function serveFrame(more: unknown[][] = [], batch: unknown[] = FRAME): Promise<Served> {
  return serveNew(NEW, (dir) => doAll(dir, batch, ...more));
}

// ---------------------------------------------------------------------------------------------

test("A1: a 1000 × 600 × 750 table frame of 40 × 40, a shelf ring 250 up, W, D and H as params", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  served = await serveNew(NEW);
  const sent = sentSteps(page);
  await openTab(page, served, 0);
  const u = new User(page);
  // The start card: the 40 × 40 size (its commonest profile, PF40-01, anodised), then the box
  // frame's form: W, D, H, and under More options the shelf and "as params"; the corners joined
  // with the bracket that fits first.
  const card = page.getByTestId("start-card");
  await u.click(card.locator('.profile-chip[data-size="40 × 40"]'));
  const form = card.getByTestId("frame-form");
  await u.fill(form.getByTestId("frame-w"), "1000");
  await u.fill(form.getByTestId("frame-d"), "600");
  await u.fill(form.getByTestId("frame-h"), "750");
  await u.click(form.locator("summary"));
  await u.fill(form.getByTestId("frame-shelf"), "250");
  await u.check(form.getByTestId("frame-params"));
  await u.select(form.getByTestId("frame-joint"), "forseti:CT38-06");
  await expect(form.getByTestId("frame-numbers")).toContainText("posts 4 × 750");
  await u.click(form.getByTestId("frame-create"));
  await waitDrawn(page, 1);
  u.done();
  u.report("A1", 1);
  // One step, the batch FRAME holds for the scenarios after this one.
  expect(sent).toEqual([FRAME]);
  expect((await docOf(served.dir)).params).toEqual({ D: 600, H: 750, W: 1000 });

  // The cut list is `alukit add frame --shelf 250 --params`'s, byte for byte.
  const copy = await scratchNew(async (dir) => {
    const r = await cli([
      "add",
      "frame",
      dir,
      "--size",
      "1000,600,750",
      "--shelf",
      "250",
      "--params",
      "--item",
      "forseti:PF40-01",
      "--opt",
      "finish=anodised",
      "--connector",
      "forseti:CT38-06",
    ]);
    expect(r.code, r.err).toBe(0);
  });
  try {
    expect(await cutList(served.dir)).toBe(await cutList(copy.dir));
  } finally {
    await copy.remove();
  }
  expect(errors).toEqual([]);
});

/** `alukit add frame` of the A1 frame at another width, on a fresh project: its cut list. */
async function frameCutList(width: number, params: boolean): Promise<string> {
  const copy = await scratchNew(async (dir) => {
    const r = await cli([
      "add",
      "frame",
      dir,
      "--size",
      `${width},600,750`,
      "--shelf",
      "250",
      ...(params ? ["--params"] : []),
      "--item",
      "forseti:PF40-01",
      "--opt",
      "finish=anodised",
      "--connector",
      "forseti:CT38-06",
    ]);
    expect(r.code, r.err).toBe(0);
  });
  try {
    return await cutList(copy.dir);
  } finally {
    await copy.remove();
  }
}

test("A2 (i): widen it by 100 by editing W", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const u = new User(page);
  // With nothing selected the inspector is the project panel, its params editable in place.
  const params = page.getByTestId("params");
  await u.click(params.locator('tr[data-param="W"]').getByTestId("param-change"));
  await u.fill(params.getByTestId("param-edit"), "1100");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A2 (i)", 1);
  expect(await cutList(served.dir)).toBe(await frameCutList(1100, true));
});

test.fixme("A2 (ii): on a frame without params, cross-select the right side and move it +100 along X", async ({
  page,
}) => {
  // As built, Move moves whole entities; it does not stretch. A box drawn right to left over the
  // right side also takes the front and back rails that reach into it, so they move whole: their
  // left ends land 60 mm off the left posts (six `end-far` warnings) and the cut list is not the
  // 1100-wide frame's (measured: this test, run). A window (left to right) takes only the right
  // posts and side rails, b2, b4, b8, b12 and b16, and the rails butted on them follow,
  // stretching: with the same steps that cut list is the 1100-wide frame's, byte for byte
  // (measured, the window's corners swapped). A stretch for a crossing box is not built. The
  // offset is typed: Move's arrow locks act once a move is on, not while a selection waits.
  test.setTimeout(120_000);
  served = await serveFrame([], FRAME_NUMBERS);
  await openTab(page, served, 0);
  const u = new User(page);
  await u.click(page.getByTestId("projection"));
  await u.click(page.getByTestId("view-front"));
  await atRest(page);
  const a = await screen(page, [1030, -20, -15]);
  const b = await screen(page, [940, -20, 765]);
  await page.keyboard.down("Shift");
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move(b[0], b[1], { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  u.clicks++;
  await u.press("d");
  await u.type("100, 0, 0");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A2 (ii)", 1);
  expect(await cutList(served.dir)).toBe(await frameCutList(1100, false));
});

test("A3: move the shelf up 150", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const before = await derived(served.dir);
  const diagnosed = await diagnosticsOf(served.dir);
  const u = new User(page);
  // The shelf ring by its tag's head in the outline, then Move (D), the offset typed, Enter. Not
  // ↑ then 150: Move's arrow locks act once a move is on, and before it ↑ went to the outline's
  // head (measured: the lock was not set, and the move asked for a direction).
  await selectTag(u, page, "shelf");
  await expect.poll(() => selection(page)).toEqual(SHELF);
  await u.press("d");
  await u.type("0, 0, 150");
  await expect(page.getByTestId("command-result")).toContainText("[0, 0, 150]");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A3", 1);
  // The shelf rails' cuts are as they were, their ends 150 higher, and no diagnostic is new.
  const after = await derived(served.dir);
  for (const id of SHELF) {
    const was = before.bars[id] as DerivedBar;
    const now = after.bars[id] as DerivedBar;
    expect(now.cut_mm).toBe(was.cut_mm);
    expect(now.a).toEqual([was.a[0], was.a[1], was.a[2] + 150]);
    expect(now.b).toEqual([was.b[0], was.b[1], was.b[2] + 150]);
  }
  expect(await diagnosticsOf(served.dir)).toEqual(diagnosed);
  // The project `alukit move` makes of the same move.
  await sameAsCli(served.dir, async (dir) => {
    await doAll(dir, FRAME);
    const r = await cli(["move", dir, "--ids", SHELF.join(","), "--by", "0,0,150"]);
    expect(r.code, r.err).toBe(0);
  });
});

test("A4: all four legs to 40 × 80, the 80 along X", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const u = new User(page);
  // The legs by their tag's head (two clicks: "by tag", then the head).
  await selectTag(u, page, "post");
  await expect.poll(() => selection(page)).toEqual(["b1", "b2", "b3", "b4"]);
  const legClicks = u.clicks;
  // Replace… for the four: the 40 × 80 profile, as `alukit catalog search 40x80` ranks it first.
  const props = page.getByTestId("properties");
  await u.click(props.getByTestId("replace-open"));
  const form = props.getByTestId("replace-form");
  await u.fill(form.getByTestId("replace-query"), "40x80");
  await u.select(form.getByTestId("replace-item"), "forseti:PF40-02");
  await u.click(form.getByTestId("replace-apply"));
  await waitDrawn(page, 1);
  // A 40 × 80 standing up has its 80 along Y (its section's y). A quarter roll turns it to X, and
  // each leg's anchor, a corner of the section, has to follow it round to keep the leg inside the
  // footprint: the roll for the four is one field, the anchors differ by leg, so §12's two steps
  // are six here. Each anchor is chosen in the row's list: on a 40 × 80 the section's dots sit
  // 6.5 px apart, and the face dot's press area covers the corner dot (measured: the press goes
  // to `+y`), so the dots cannot pick a corner of the narrow face.
  await u.fill(props.getByTestId("many-roll"), "90");
  await u.press("Enter");
  await waitDrawn(page, 2);
  const anchors: Record<string, string> = { b1: "-x+y", b2: "-x-y", b3: "+x+y", b4: "+x-y" };
  let r = 2;
  for (const [id, anchor] of Object.entries(anchors)) {
    await u.click(page.getByTestId("tree").locator(`[data-id="${id}"]`).first());
    await u.select(props.getByTestId("field-anchor"), anchor);
    await waitDrawn(page, ++r);
  }
  u.done();
  u.report("A4", r, `the legs selected in ${legClicks} clicks`);
  const d = await derived(served.dir);
  // By hand: each leg 80 along X, so the front and back rails lose 80 more (840), the side rails
  // gain back 40 (520).
  expect(d.bars.b5?.cut_mm).toBe(840);
  expect(d.bars.b7?.cut_mm).toBe(520);
  // The CLI's same edit gives the same cut list.
  const copy = await scratchNew(async (dir) => {
    await doAll(
      dir,
      FRAME,
      Object.entries(anchors).map(([id, anchor]) => ({
        cmd: "setBar",
        args: { id, set: { item: "forseti:PF40-02", roll_deg: 90, anchor } },
      })),
    );
  });
  try {
    expect(await cutList(served.dir)).toBe(await cutList(copy.dir));
  } finally {
    await copy.remove();
  }
});

test("A5: a diagonal brace in the back plane, 100 above the bottom-left corner to 100 below the top-right, joined at both ends", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  const sent = sentSteps(page);
  await openTab(page, served, 0);
  const u = new User(page);
  // Draw (B): the start typed, the anchor on the section's face +x (the brace's section x runs
  // along world +Y, so its body lies in the posts' plane, y 560 to 600), then the end typed.
  await u.press("b");
  await u.type("[0, 600, 100]");
  await u.press("Enter");
  await u.click(page.getByTestId("draw-anchor").locator('[data-anchor="+x"]'));
  await u.type("[1000, 600, 650]");
  await expect(page.getByTestId("joint-preview")).toContainText("butt");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A5", 1);
  // No error; both ends declared `angle`.
  const d = await derived(served.dir);
  expect(d.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
  const brace = ((await docOf(served.dir)).bars as Record<string, { ends?: unknown }>).b17;
  expect(brace?.ends).toEqual({ a: { cut: "angle" }, b: { cut: "angle" } });
  // The brace's cut is a dry run's of the same batch on the frame.
  expect(sent).toHaveLength(1);
  const copy = await scratchNew((dir) => doAll(dir, FRAME));
  try {
    const dry = await cli(["do", copy.dir, "--dry-run", "--json", JSON.stringify(sent[0])]);
    expect(dry.code, dry.err).toBe(0);
    const added = (JSON.parse(dry.out) as { effects: { added: Record<string, number> } }).effects
      .added;
    expect(d.bars.b17?.cut_mm).toBe(added.b17);
  } finally {
    await copy.remove();
  }
});

test.fixme("A6: an angle bracket on the front-left leg's inner face at 300, mirrored to the front-right leg", async ({
  page,
}) => {
  // Placing it works (the Place tool, 300 typed, a click on b1's face +x). Mirroring it does not:
  // `mirror` keeps a part on its bar's station, so a bracket on b1 mirrored across x = 500 is
  // refused unless b1 is mirrored with it ("p1/on: b1 is not mirrored and the plane does not map
  // it onto itself; include it"), and with b1 it makes a copy of the leg, not a bracket on b2. A
  // mirror that re-homes a station part onto the bar at its image is not built.
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const u = new User(page);
  await u.click(page.getByTestId("left-catalog"));
  await u.fill(page.getByTestId("catalog-search"), "CT38-06");
  await u.click(page.locator('.card[data-id="forseti:CT38-06"]'));
  await u.click(page.getByTestId("palette-set"));
  await u.type("300");
  await u.clickAt(await screen(page, [40, 20, 120]));
  await waitDrawn(page, 1);
  await selectByIds(page, ["p1"]);
  const s = await screen(page, [500, 300, 0]);
  await u.clickAt(s, { button: "right" });
  await u.click(page.getByTestId("context-menu").getByRole("menuitem", { name: /^Mirror/ }));
  await u.type("=W / 2");
  await u.press("Enter");
  await waitDrawn(page, 2);
  u.done();
  u.report("A6", 2);
  const parts = (await derived(served.dir)).parts;
  expect(parts.p2).toMatchObject({ bar: "b2", face: "-x", s_mm: 300 });
});

test("A7: duplicate the top front rail 300 down, joined to the legs", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const u = new User(page);
  await u.click(page.getByTestId("tree").locator('[data-id="b13"]').first());
  await u.press("ControlOrMeta+d");
  await u.press("ArrowUp");
  await u.type("-300");
  await expect(page.getByTestId("joint-preview")).toContainText("makes b17");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A7", 1);
  expect(await lastStepWords(served.dir)).toBe("copy b13, making b17, joined at 2 ends");
  // Butts at both ends, and its cut is the top rail's.
  const doc = await docOf(served.dir);
  const butts = Object.values(
    doc.connections as Record<string, { type: string; ends?: string[] }>,
  ).filter((c) => c.type === "butt" && c.ends?.some((e) => e.startsWith("b17.")));
  expect(butts.flatMap((c) => c.ends?.filter((e) => e.startsWith("b17.")))?.sort()).toEqual([
    "b17.a",
    "b17.b",
  ]);
  const d = await derived(served.dir);
  expect(d.bars.b17?.cut_mm).toBe(d.bars.b13?.cut_mm);
  // The CLI's batch: one array 300 down, then a join at each new end.
  await sameAsCli(served.dir, (dir) =>
    doAll(dir, FRAME, [
      { cmd: "array", args: { ids: ["b13"], along: { dir: [0, 0, -1] }, pitch_mm: 300, count: 2 } },
      { cmd: "autoConnect", args: { at: [0, 0, 450], optional: true } },
      { cmd: "autoConnect", args: { at: [1000, 0, 450], optional: true } },
    ]),
  );
});

test("A8: four slats across the shelf, evenly spaced; then five, by editing the pattern", async ({
  page,
}) => {
  test.setTimeout(150_000);
  served = await serveFrame();
  const sent = sentSteps(page);
  await openTab(page, served, 0);
  const u = new User(page);
  // A slat from the front shelf rail to the back one, its top face on their tops (anchor +y).
  await u.press("b");
  await u.type("[200, 0, 250]");
  await u.press("Enter");
  await u.click(page.getByTestId("draw-anchor").locator('[data-anchor="+y"]'));
  await u.type("[200, 600, 250]");
  await u.press("Enter");
  await waitDrawn(page, 1);
  // Pattern (X) of the slat along the front shelf rail: pitch 150, four in all.
  await u.press("Escape");
  await u.click(page.getByTestId("tree").locator('[data-id="b17"]').first());
  await u.press("x");
  await expect(page.getByTestId("pattern-template")).toHaveText("b17");
  await u.fill(page.getByTestId("pattern-along"), "b9");
  await u.fill(page.getByTestId("pattern-pitch"), "150");
  await u.fill(page.getByTestId("pattern-count"), "4");
  await u.click(page.getByTestId("pattern-apply"));
  await waitDrawn(page, 2);
  u.done();
  u.report("A8, four", 2);
  const spacing = async (n: number) => {
    const bars = (await derived(served?.dir as string)).bars;
    const xs = ["b17", ...Array.from({ length: n - 1 }, (_, i) => `b17@${i + 1}`)].map(
      (id) => bars[id]?.a[0] as number,
    );
    expect(Object.keys(bars).filter((k) => k.startsWith("b17@"))).toHaveLength(n - 1);
    const gaps = xs.slice(1).map((x, i) => x - (xs[i] as number));
    for (const g of gaps) expect(Math.abs(g - (gaps[0] as number))).toBeLessThan(0.01);
  };
  await spacing(4);
  // Five: the pattern's count in its inspector, one step.
  const v = new User(page);
  await v.click(page.getByTestId("tree").locator('[data-id="pt1"]').first());
  const count = page.getByTestId("properties").getByTestId("field-count");
  await expect(count).toHaveValue("4");
  await v.fill(count, "5");
  await v.press("Enter");
  await waitDrawn(page, 3);
  v.done();
  v.report("A8, five", 1);
  await spacing(5);
  expect(sent).toHaveLength(3);
  await sameAsCli(served.dir, (dir) =>
    doAll(
      dir,
      FRAME,
      [
        {
          cmd: "addBar",
          args: { item: "forseti:PF40-01", a: [200, 0, 250], b: [200, 600, 250], anchor: "+y" },
        },
        { cmd: "autoConnect", args: { at: [200, 0, 250], optional: true } },
        { cmd: "autoConnect", args: { at: [200, 600, 250], optional: true } },
      ],
      [{ cmd: "addPattern", args: { template: ["b17"], along: "b9", pitch_mm: 150, count: 4 } }],
      [{ cmd: "setPattern", args: { id: "pt1", set: { count: 5 } } }],
    ),
  );
});

/** A6's bracket, placed by the CLI on b1's inner face (+x) at 300. */
const BRACKET = [
  { cmd: "addPart", args: { item: "forseti:CT38-06", on: { bar: "b1", face: "+x", at_mm: 300 } } },
];

test("A9: slide the bracket from 300 to 450 along its leg", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame([BRACKET]);
  await openTab(page, served, 0);
  const u = new User(page);
  // Move (D) on the bracket alone: the lock is its leg's axis; 150 typed, Enter.
  await u.click(page.getByTestId("tree").locator('[data-id="p1"]').first());
  await u.press("d");
  await u.type("150");
  await expect(page.getByTestId("command-result")).toContainText("[0, 0, 150]");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A9", 1);
  const parts = (await docOf(served.dir)).parts as Record<string, { on?: { at_mm?: unknown } }>;
  expect(parts.p1?.on?.at_mm).toBe(450);
  await sameAsCli(served.dir, async (dir) => {
    await doAll(dir, FRAME, BRACKET);
    const r = await cli(["move", dir, "--ids", "p1", "--by", "0,0,150"]);
    expect(r.code, r.err).toBe(0);
  });
});

test("A10: delete the back top rail and its joints; Undo restores it all", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const u = new User(page);
  await u.click(page.getByTestId("tree").locator('[data-id="b14"]').first());
  await u.press("Delete");
  // The dialog lists what goes and what changes: b14, and the two butts it leaves.
  const dialog = page.getByTestId("delete-dialog");
  await expect(dialog).toBeVisible();
  const listed = async (testid: string) =>
    dialog
      .getByTestId(testid)
      .locator("li")
      .evaluateAll((lis) => lis.map((li) => li.getAttribute("data-id")));
  expect(await listed("delete-removed")).toEqual(["b14"]);
  expect(await listed("delete-changed")).toEqual(["c11", "c12"]);
  await u.click(dialog.getByTestId("delete-confirm"));
  await waitDrawn(page, 1);
  u.done();
  u.report("A10", 1);
  // No end left open: the butts keep their other ends, and nothing is unconnected.
  const d = await derived(served.dir);
  expect(d.diagnostics.filter((x) => x.code === "unconnected")).toEqual([]);
  await sameAsCli(served.dir, (dir) =>
    doAll(dir, FRAME, [{ cmd: "removeEntity", args: { id: "b14", cascade: true } }]),
  );
  // Undo restores it all: the frame as the CLI made it.
  await page.keyboard.press("ControlOrMeta+z");
  await waitDrawn(page, 2);
  await sameAsCli(served.dir, (dir) => doAll(dir, FRAME));
});

test("A11: hide the top ring, isolate one corner, show all: no step", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const hidden = () => page.evaluate(() => [...(window.__alukit?.hidden() ?? [])].sort());
  const u = new User(page);
  // The top ring by its tag's head, then H.
  await selectTag(u, page, "top");
  await u.press("h");
  await expect.poll(hidden).toEqual(["b13", "b14", "b15", "b16"]);
  await expect(page.getByTestId("hidden-strip")).toContainText("4 hidden");
  // One corner, its marker clicked: the front-left base corner; Shift+H isolates its bars.
  const corner = await page.evaluate(() =>
    window.__alukit?.corners().find((c) => c.key === "0,0,0"),
  );
  if (!corner) throw new Error("no corner at the origin");
  await u.clickAt(await screen(page, corner.at as V3));
  await expect(page.getByTestId("properties")).toHaveAttribute("data-corner", "0,0,0");
  await u.press("Shift+H");
  await expect
    .poll(hidden)
    .toEqual(
      ["b2", "b3", "b4", "b6", "b8", "b9", "b10", "b11", "b12", "b13", "b14", "b15", "b16"].sort(),
    );
  // Alt+H: everything again.
  await u.press("Alt+H");
  await expect.poll(hidden).toEqual([]);
  u.done();
  u.report("A11", 0);
  expect(await rev(page)).toBe(0);
  await sameAsCli(served.dir, (dir) => doAll(dir, FRAME));
});

test("A12: a T-nut plate's face joint from 2 bolts to 3", async ({ page }) => {
  test.setTimeout(120_000);
  // On the cart (test catalogs): a 40 × 40 rail away from the cart and a flat plate on it, held
  // by T-nuts at two stations, by the CLI.
  served = await serve("cart");
  const PLATE = [
    {
      cmd: "addBar",
      args: { item: "test:TS40", a: [0, 2000, 0], b: [400, 2000, 0], anchor: "-y" },
    },
    {
      cmd: "addBar",
      args: { item: "test-geo:FB-50x20", a: [0, 2000, 40], b: [400, 2000, 40], anchor: "-y" },
    },
  ];
  const JOINT = [
    {
      cmd: "addConnection",
      args: {
        type: "face",
        bars: ["b36", "b35"],
        fastening: "tnut",
        fastener: "test-gen:SCR-M5x25",
        stack: ["test-gen:TNUT-M5"],
        stations: { at_mm: [100, 300] },
        label: "T-nut plate",
      },
    },
  ];
  await doAll(served.dir, PLATE, JOINT);
  await openTab(page, served, 2);
  const u = new User(page);
  // The joint, found by its id in the outline's filter; its form, stations 100, 200, 300.
  const filter = page.getByRole("searchbox", { name: "Filter the outline" });
  await u.fill(filter, "c36");
  await u.click(page.getByTestId("tree").locator('[data-id="c36"]').first());
  const form = page.getByTestId("properties").getByTestId("face-edit");
  await expect(form.getByTestId("face-at")).toHaveValue("100, 300");
  await u.fill(form.getByTestId("face-at"), "100, 200, 300");
  await u.click(form.getByTestId("face-apply"));
  await waitDrawn(page, 3);
  u.done();
  u.report("A12", 1);
  // The hardware rises as `alukit do setConnection` says: one screw and one T-nut more.
  const bom = async (dir: string) => {
    const r = await cli(["bom", dir, "--format", "json"]);
    return JSON.parse(r.out) as { groups: { lines: { item: string; qty: number }[] }[] };
  };
  const copy = await scratchProject("cart");
  try {
    await doAll(copy.dir, PLATE, JOINT, [
      { cmd: "setConnection", args: { id: "c36", set: { stations: { at_mm: [100, 200, 300] } } } },
    ]);
    const mine = await bom(served.dir);
    expect(mine).toEqual(await bom(copy.dir));
    const qty = (item: string) =>
      mine.groups.flatMap((g) => g.lines).find((l) => l.item === item)?.qty;
    // The cart's own rail screws (c35) are 10 of each; the plate's three make 13.
    expect(qty("test-gen:SCR-M5x25")).toBe(13);
    expect(qty("test-gen:TNUT-M5")).toBe(13);
    await expectSame(served.dir, copy.dir);
  } finally {
    await copy.remove();
  }
});

test("A13: undo all of it, one key per step, each Undo naming its step", async ({ page }) => {
  test.setTimeout(180_000);
  served = await serveNew(NEW);
  const pristine = await scratchNew();
  try {
    await openTab(page, served, 0);
    // Three steps made in the app: the frame (A1), the shelf up 150 (A3), the top front rail
    // duplicated 300 down (A7).
    const card = page.getByTestId("start-card");
    await card.locator('.profile-chip[data-size="40 × 40"]').click();
    const form = card.getByTestId("frame-form");
    await form.getByTestId("frame-w").fill("1000");
    await form.getByTestId("frame-d").fill("600");
    await form.getByTestId("frame-h").fill("750");
    await form.locator("summary").click();
    await form.getByTestId("frame-shelf").fill("250");
    await form.getByTestId("frame-params").check();
    await form.getByTestId("frame-joint").selectOption("forseti:CT38-06");
    await expect(form.getByTestId("frame-numbers")).toContainText("posts 4 × 750");
    await form.getByTestId("frame-create").click();
    await waitDrawn(page, 1);
    await selectByIds(page, SHELF);
    await page.keyboard.press("d");
    await page.keyboard.type("0, 0, 150");
    await page.keyboard.press("Enter");
    await waitDrawn(page, 2);
    await selectByIds(page, ["b13"]);
    await page.keyboard.press("ControlOrMeta+d");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.type("-300");
    await expect(page.getByTestId("joint-preview")).toContainText("makes b17");
    await page.keyboard.press("Enter");
    await waitDrawn(page, 3);
    // Undo, one key per step: before each, the button names the step it takes back, in the
    // words `alukit log` gives that step.
    const log = JSON.parse((await cli(["log", served.dir, "--json"])).out) as {
      entries: { text: string }[];
    };
    const words = log.entries.map((e) => e.text);
    expect(words).toHaveLength(3);
    const u = new User(page);
    await page.getByTestId("skip-link").focus();
    let r = 3;
    for (const w of [...words].reverse()) {
      await expect(page.getByTestId("undo")).toHaveText(`Undo · you: ${w}`);
      await u.press("ControlOrMeta+z");
      await waitDrawn(page, ++r);
    }
    u.done();
    u.report("A13", 3, "3 Undos");
    await expect(page.getByTestId("undo")).toBeDisabled();
    // The project is the empty one again.
    await expectSame(served.dir, pristine.dir);
  } finally {
    await pristine.remove();
  }
});

test("A14 (A3 by mouse): the shelf up 150 with the pointer and a typed value", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const u = new User(page);
  await selectTag(u, page, "shelf");
  await expect.poll(() => selection(page)).toEqual(SHELF);
  // Move from the tool rail; the offset typed (allowed), a click in the view commits it.
  await u.click(page.getByTestId("tool-move"));
  await u.type("0, 0, 150");
  await expect(page.getByTestId("command-result")).toContainText("[0, 0, 150]");
  await u.clickAt(await screen(page, [500, 300, 0]));
  await waitDrawn(page, 1);
  u.done();
  u.report("A14 (A3 by mouse)", 1);
  await sameAsCli(served.dir, async (dir) => {
    await doAll(dir, FRAME);
    const r = await cli(["move", dir, "--ids", SHELF.join(","), "--by", "0,0,150"]);
    expect(r.code, r.err).toBe(0);
  });
});

test.fixme("A14 (A6 by mouse): the bracket placed and mirrored with the pointer", async () => {
  // Waits on A6: the mirror of a part on one leg onto the other is refused by the core (A6's
  // reason). Placing it by the pointer works: the catalog's card, Use for placing, a click on the
  // face with the distance typed.
});

test("A14 (A10 by mouse): the back top rail deleted from the menu, undone from the top bar", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const u = new User(page);
  // A right-click on its outline row selects it and opens the menu; Delete; the dialog's button.
  await u.click(page.getByTestId("tree").locator('[data-id="b14"]').first(), { button: "right" });
  const menu = page.getByTestId("context-menu");
  await u.click(menu.locator('[data-action="delete"]'));
  const dialog = page.getByTestId("delete-dialog");
  await expect(dialog).toBeVisible();
  await u.click(dialog.getByTestId("delete-confirm"));
  await waitDrawn(page, 1);
  u.done();
  u.report("A14 (A10 by mouse)", 1);
  await sameAsCli(served.dir, (dir) =>
    doAll(dir, FRAME, [{ cmd: "removeEntity", args: { id: "b14", cascade: true } }]),
  );
  await page.getByTestId("undo").click();
  await waitDrawn(page, 2);
  await sameAsCli(served.dir, (dir) => doAll(dir, FRAME));
});

test("A15: agent parity: the session's commands replayed with alukit do give the same project", async ({
  page,
}) => {
  test.setTimeout(180_000);
  served = await serveNew(NEW);
  const sent = sentSteps(page);
  await openTab(page, served, 0);
  // A session: the frame (A1), the shelf up (A3), a brace (A5), the top front rail duplicated
  // (A7), the back top rail deleted (A10).
  const card = page.getByTestId("start-card");
  await card.locator('.profile-chip[data-size="40 × 40"]').click();
  const form = card.getByTestId("frame-form");
  await form.getByTestId("frame-w").fill("1000");
  await form.getByTestId("frame-d").fill("600");
  await form.getByTestId("frame-h").fill("750");
  await form.locator("summary").click();
  await form.getByTestId("frame-shelf").fill("250");
  await form.getByTestId("frame-params").check();
  await form.getByTestId("frame-joint").selectOption("forseti:CT38-06");
  await expect(form.getByTestId("frame-numbers")).toContainText("posts 4 × 750");
  await form.getByTestId("frame-create").click();
  await waitDrawn(page, 1);
  await selectByIds(page, SHELF);
  await page.keyboard.press("d");
  await page.keyboard.type("0, 0, 150");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 2);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("b");
  await page.keyboard.type("[0, 600, 100]");
  await page.keyboard.press("Enter");
  await page.getByTestId("draw-anchor").locator('[data-anchor="+x"]').click();
  await page.keyboard.type("[1000, 600, 650]");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 3);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await selectByIds(page, ["b13"]);
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("-300");
  await expect(page.getByTestId("joint-preview")).toContainText("makes b18");
  await page.keyboard.press("Enter");
  await waitDrawn(page, 4);
  await selectByIds(page, ["b14"]);
  await page.keyboard.press("Delete");
  await page.getByTestId("delete-dialog").getByTestId("delete-confirm").click();
  await waitDrawn(page, 5);
  // `alukit log` names each step's commands but not their arguments, so what is replayed is what
  // the app sent, read off its requests: one `alukit do` per step.
  const log = JSON.parse((await cli(["log", served.dir, "--json"])).out) as {
    entries: { what: string }[];
  };
  expect(log.entries.map((e) => e.what)).toEqual(
    sent.map((b) => (b as { cmd: string }[]).map((c) => c.cmd).join(", ")),
  );
  await sameAsCli(served.dir, (dir) => doAll(dir, ...sent));
});
