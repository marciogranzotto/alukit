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
  ends: { a: { by: string }; b: { by: string } };
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

/** The served project's steps, as `alukit log --json` lists them. */
async function logEntries(dir: string): Promise<{ what: string; text: string }[]> {
  const r = await cli(["log", dir, "--json"]);
  expect(r.code, r.err).toBe(0);
  return (JSON.parse(r.out) as { entries: { what: string; text: string }[] }).entries;
}

const diagnosticsOf = async (dir: string) =>
  (await derived(dir)).diagnostics.map((d) => `${d.severity} ${d.code} ${d.entity ?? ""}`).sort();

/**
 * The ends of `ids` that no connection holds (docs/ux/review-editing.md B1–B3): derive names the
 * provider of each end's plane, a connection (`c17`, a copy's `c17@2`) or none (`default`).
 */
function unjoined(d: Derived, ids: readonly string[]): string[] {
  return ids.flatMap((id) =>
    (["a", "b"] as const).flatMap((e) => {
      const by = d.bars[id]?.ends[e].by ?? "missing";
      return /^c\d+(@\d+)?$/.test(by) ? [] : [`${id}.${e} (${by})`];
    }),
  );
}

/** The project's open ends, as `alukit check` warns of them (§5.5's unconnected ends). */
async function openEnds(dir: string): Promise<string[]> {
  const r = await cli(["check", dir, "--json"]);
  const out = JSON.parse(r.out) as { diagnostics: { code: string; entity?: string }[] };
  return out.diagnostics.filter((x) => x.code === "unconnected").map((x) => x.entity ?? "");
}

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
  // frame's form, every field of A1 up front: W, D, H, the shelf and "as params"; the corners
  // joined with the bracket it suggests, one click (docs/ux/polish-editing-ui-decisions.md).
  const card = page.getByTestId("start-card");
  await u.click(card.locator('.profile-chip[data-size="40 × 40"]'));
  const form = card.getByTestId("frame-form");
  await u.fill(form.getByTestId("frame-w"), "1000");
  await u.fill(form.getByTestId("frame-d"), "600");
  await u.fill(form.getByTestId("frame-h"), "750");
  await u.fill(form.getByTestId("frame-shelf"), "250");
  await u.check(form.getByTestId("frame-params"));
  const suggested = form.getByTestId("frame-joint-suggested");
  await expect(suggested).toHaveAttribute("value", "forseti:CT38-06");
  await u.check(suggested);
  await expect(form.getByTestId("frame-numbers")).toContainText("posts 4 × 750");
  await u.click(form.getByTestId("frame-create"));
  await waitDrawn(page, 1);
  u.done();
  u.report("A1", 1);
  // §12's targets: at most 8 clicks and 20 keys, one step: the batch FRAME holds for the
  // scenarios after this one.
  expect(u.clicks).toBeLessThanOrEqual(8);
  expect(u.keys).toBeLessThanOrEqual(20);
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

test("A2 (ii): on a frame without params, cross-select the right side and move it +100 along X", async ({
  page,
}) => {
  // A box drawn right to left over the right side is a crossing: it holds the right posts and
  // side rails whole, b2, b4, b8, b12 and b16, and crosses the front and back rails, b5, b6, b9,
  // b10, b13 and b14, with their ends b inside it. Move then stretches those (the editing
  // polish's gap 1, AutoCAD's STRETCH): the bars held whole move, the ends inside move, the
  // ends outside stay, so the frame widens.
  test.setTimeout(120_000);
  served = await serveFrame([], FRAME_NUMBERS);
  const sent = sentSteps(page);
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
  // Move, the X lock, 100, Enter (§12's keys).
  await u.press("d");
  await u.press("ArrowRight");
  await u.type("100");
  await expect(page.getByTestId("command-result")).toContainText("[100, 0, 0]");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A2 (ii)", 1);
  expect(await cutList(served.dir)).toBe(await frameCutList(1100, false));
  // One step: a transform of what the box held whole and the ends it held.
  const STRETCH = [
    "b12",
    "b16",
    "b2",
    "b4",
    "b8",
    "b10.b",
    "b13.b",
    "b14.b",
    "b5.b",
    "b6.b",
    "b9.b",
  ];
  expect(sent).toHaveLength(1);
  const step = sent[0] as { cmd: string; args: { ids?: string[] } }[];
  expect(step[0]?.cmd).toBe("transform");
  expect(step[0]?.args.ids).toEqual(STRETCH);
  // The project `alukit move` makes of the same ids.
  await sameAsCli(served.dir, async (dir) => {
    await doAll(dir, FRAME_NUMBERS);
    const r = await cli(["move", dir, "--ids", STRETCH.join(","), "--by", "100,0,0"]);
    expect(r.code, r.err).toBe(0);
  });
});

test("A3: move the shelf up 150", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  await openTab(page, served, 0);
  const before = await derived(served.dir);
  const diagnosed = await diagnosticsOf(served.dir);
  const u = new User(page);
  // The shelf ring by its tag's head in the outline, then Move (D), ↑, 150, Enter (§12's keys):
  // the arrow lock starts the move while the selection waits, with the focus still on the
  // outline's head, which no longer takes it (the editing polish's defect 4).
  await selectTag(u, page, "shelf");
  await expect.poll(() => selection(page)).toEqual(SHELF);
  await u.press("d");
  await expect(page.getByTestId("tree").locator(":focus")).toHaveCount(1);
  await u.press("ArrowUp");
  await u.type("150");
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
  // A 40 × 80 standing up has its 80 along Y (its section's y). A quarter roll in the shared Roll
  // field turns it to X, and keeps each leg on its side of its line: each anchor, a corner of the
  // section, turns with the roll, so every leg stays inside the footprint
  // (docs/ux/polish-editing-ui-decisions.md). One step for the four.
  await u.fill(props.getByTestId("many-roll"), "90");
  await u.press("Enter");
  await waitDrawn(page, 2);
  u.done();
  const steps = (await logEntries(served.dir)).length;
  u.report("A4", steps, `the legs selected in ${legClicks} clicks`);
  // §12's targets: at most 2 steps, the legs selected in at most 2 clicks.
  expect(steps).toBeLessThanOrEqual(2);
  expect(legClicks).toBeLessThanOrEqual(2);
  // Each leg's anchor turned a quarter with it, a different corner per leg, as by hand: the
  // body that lay toward +X +Y of b1's line still does.
  const anchors: Record<string, string> = { b1: "-x+y", b2: "-x-y", b3: "+x+y", b4: "+x-y" };
  const bars = (await docOf(served.dir)).bars as Record<string, { anchor?: string }>;
  for (const [id, anchor] of Object.entries(anchors)) expect(bars[id]?.anchor).toBe(anchor);
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
  // along world +Y, so its body lies in the posts' plane, y 560 to 600), picked on the dots the
  // command bar's Anchor opens, then the end typed.
  await u.press("b");
  await u.type("[0, 600, 100]");
  await u.press("Enter");
  await u.click(page.getByTestId("draw-anchor-open"));
  await u.click(page.getByTestId("draw-anchor").locator('[data-anchor="+x"]'));
  await u.type("[1000, 600, 650]");
  await expect(page.getByTestId("joint-preview")).toContainText("butt");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A5", 1);
  // No error; both ends declared `angle`, each held by a joint, and no end left open.
  const d = await derived(served.dir);
  expect(d.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
  const brace = ((await docOf(served.dir)).bars as Record<string, { ends?: unknown }>).b17;
  expect(brace?.ends).toEqual({ a: { cut: "angle" }, b: { cut: "angle" } });
  expect(unjoined(d, ["b17"])).toEqual([]);
  expect(await openEnds(served.dir)).toEqual([]);
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

test("A5 by pointer (review B3): the brace clicked from one back post's inner face to the other's is joined at both ends", async ({
  page,
}) => {
  // The path a first-time user tries first (docs/ux/review-editing.md B3): Draw, a click on the
  // back-left post's inner face at 100 up, a click on the back-right post's at 650. Each end is a
  // station on a face, which the joins must find.
  test.setTimeout(120_000);
  served = await serveFrame();
  const sent = sentSteps(page);
  await openTab(page, served, 0);
  await atRest(page);
  const u = new User(page);
  /** The pointer onto a world point, until the tool's snap is the face named (as draw.spec). */
  const onto = async (p: V3, says: RegExp) => {
    await page.mouse.move(...(await screen(page, p)), { steps: 4 });
    await expect
      .poll(async () => (await page.evaluate(() => window.__alukit?.tool()))?.snap ?? "")
      .toMatch(says);
  };
  await u.press("b");
  await onto([40, 580, 100], /b3/);
  await u.clickAt(await screen(page, [40, 580, 100]));
  await onto([960, 580, 650], /b4/);
  // The preview names the joint before the click.
  await expect(page.getByTestId("joint-preview")).toContainText("butt");
  await u.clickAt(await screen(page, [960, 580, 650]));
  await waitDrawn(page, 1);
  u.done();
  u.report("A5 by pointer", 1);
  expect(sent).toHaveLength(1);
  const bar = (sent[0] as { cmd: string; args: { a: unknown; b: unknown } }[])[0];
  expect(bar?.args.a).toEqual({ on: { bar: "b3", at_mm: 100, face: "+x" } });
  expect(bar?.args.b).toEqual({ on: { bar: "b4", at_mm: 650, face: "-x" } });
  const d = await derived(served.dir);
  expect(d.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
  expect(unjoined(d, ["b17"])).toEqual([]);
  expect(await openEnds(served.dir)).toEqual([]);
  // Its cut is the posts' inner faces' distance along it, as the CLI makes it of the same step.
  await sameAsCli(served.dir, (dir) => doAll(dir, FRAME, sent[0] as unknown[]));
});

/** A6's mirror as the CLI sends it: the bracket across x = 500 (W / 2). */
const MIRROR = [{ cmd: "mirror", args: { ids: ["p1"], plane: { axis: "x", at_mm: 500 } } }];

/** A6's bracket placed as a person does: the catalog's card, Use for placing, 300, b1's face. */
async function placeBracket(u: User, page: Page): Promise<void> {
  await u.click(page.getByTestId("left-catalog"));
  await u.fill(page.getByTestId("catalog-search"), "CT38-06");
  await u.click(page.locator('.card[data-id="forseti:CT38-06"]'));
  await u.click(page.getByTestId("palette-set"));
  await u.type("300");
  await u.clickAt(await screen(page, [40, 20, 120]));
  await waitDrawn(page, 1);
}

/** The bracket on b2's inner face at 300, and the project the CLI makes of the same steps. */
async function expectMirrored(sent: unknown[][]): Promise<void> {
  const dir = served?.dir as string;
  // `alukit derive` lands it on b2 at 300; the document names the face, b2's inner one (-x).
  expect((await derived(dir)).parts.p2).toMatchObject({ bar: "b2", s_mm: 300 });
  const parts = (await docOf(dir)).parts as Record<string, { on?: unknown }>;
  expect(parts.p2?.on).toEqual({ bar: "b2", face: "-x", at_mm: 300 });
  // The placement is A9's bracket; the mirror, one step, is `alukit do mirror`'s.
  expect(sent).toEqual([BRACKET, MIRROR]);
  await sameAsCli(dir, (d) => doAll(d, FRAME, BRACKET, MIRROR));
}

test("A6: an angle bracket on the front-left leg's inner face at 300, mirrored to the front-right leg", async ({
  page,
}) => {
  // The bracket sits on b1, which is not mirrored; b1's image across x = 500 is b2, the
  // front-right leg, so the copy lands on b2's inner face at 300 (the editing polish's gap 2).
  test.setTimeout(120_000);
  served = await serveFrame();
  const sent = sentSteps(page);
  await openTab(page, served, 0);
  const u = new User(page);
  await placeBracket(u, page);
  u.done();
  u.report("A6, place", 1);
  // The mirror, timed alone (§12: ≤ 20 s for the mirror): Esc leaves the Place tool (the menu's
  // Mirror… works in Select or Move, and says so), then the menu's Mirror…, W / 2, Enter.
  const v = new User(page);
  await v.press("Escape");
  await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");
  await selectByIds(page, ["p1"]);
  await v.clickAt(await screen(page, [500, 300, 0]), { button: "right" });
  await v.click(page.getByTestId("context-menu").getByRole("menuitem", { name: /^Mirror/ }));
  await v.type("=W / 2");
  await expect(page.getByTestId("joint-preview")).toContainText("makes p2");
  await v.press("Enter");
  await waitDrawn(page, 2);
  v.done();
  v.report("A6, mirror", 1);
  expect(await lastStepWords(served.dir)).toBe("mirror p1, making p2 on b2");
  await expectMirrored(sent);
  // Nothing mirrored is left open (docs/ux/review-editing.md B2's check, here on a part).
  expect(await openEnds(served.dir)).toEqual([]);
});

/** A5's brace as the CLI makes it: typed from 100 up the back-left post to 650 up the right. */
const BRACE = [
  {
    cmd: "addBar",
    args: { item: "forseti:PF40-01", a: [0, 600, 100], b: [1000, 600, 650], anchor: "+x" },
  },
  { cmd: "autoConnect", args: { at: [0, 600, 100], optional: true } },
  { cmd: "autoConnect", args: { at: [1000, 600, 650], optional: true } },
];

test("A6 on a bar (review B2): A5's brace mirrored across W / 2 is cut as the brace and joined at both ends", async ({
  page,
}) => {
  test.setTimeout(120_000);
  served = await serveFrame([BRACE]);
  const sent = sentSteps(page);
  await openTab(page, served, 0);
  const u = new User(page);
  await selectByIds(page, ["b17"]);
  await u.clickAt(await screen(page, [500, 300, 0]), { button: "right" });
  await u.click(page.getByTestId("context-menu").getByRole("menuitem", { name: /^Mirror/ }));
  await u.type("=W / 2");
  // The preview says what joins the image before the click (B2: it said only "makes b18").
  await expect(page.getByTestId("joint-preview")).toContainText("joins b4");
  await expect(page.getByTestId("joint-preview")).toContainText("joins b3");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A6 on a bar, mirror", 1);
  const d = await derived(served.dir);
  expect(d.bars.b18?.cut_mm).toBe(d.bars.b17?.cut_mm);
  expect(unjoined(d, ["b17", "b18"])).toEqual([]);
  expect(await openEnds(served.dir)).toEqual([]);
  expect(d.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
  // The step replays with alukit do; and `alukit do mirror` alone joins the image the same way.
  expect(sent).toHaveLength(1);
  await sameAsCli(served.dir, (dir) => doAll(dir, FRAME, BRACE, sent[0] as unknown[]));
  const copy = await scratchNew((dir) =>
    doAll(dir, FRAME, BRACE, [
      { cmd: "mirror", args: { ids: ["b17"], plane: { axis: "x", at_mm: 500 } } },
    ]),
  );
  try {
    const alone = await derived(copy.dir);
    expect(alone.bars.b18?.cut_mm).toBe(d.bars.b17?.cut_mm);
    expect(unjoined(alone, ["b18"])).toEqual([]);
  } finally {
    await copy.remove();
  }
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
  // Pattern (X) with nothing selected: along the front shelf rail, pitch 150, four in all; then
  // the slat it repeats, drawn: from the front shelf rail to the back one, its top face on their
  // tops (anchor +y). The slat and its pattern are one step
  // (docs/ux/polish-editing-ui-decisions.md).
  await u.press("x");
  await expect(page.getByTestId("pattern-template")).toHaveText("nothing");
  await u.fill(page.getByTestId("pattern-along"), "b9");
  await u.fill(page.getByTestId("pattern-pitch"), "150");
  await u.fill(page.getByTestId("pattern-count"), "4");
  await u.click(page.getByTestId("pattern-draw"));
  await expect(page.getByTestId("draw-repeat")).toContainText("4 along b9");
  await u.type("[200, 0, 250]");
  await u.press("Enter");
  await u.click(page.getByTestId("draw-anchor-open"));
  await u.click(page.getByTestId("draw-anchor").locator('[data-anchor="+y"]'));
  await u.type("[200, 600, 250]");
  await u.press("Enter");
  await waitDrawn(page, 1);
  u.done();
  u.report("A8, four", sent.length);
  // §12: one step.
  expect(sent).toHaveLength(1);
  const spacing = async (n: number) => {
    const d = await derived(served?.dir as string);
    const bars = d.bars;
    const slats = ["b17", ...Array.from({ length: n - 1 }, (_, i) => `b17@${i + 1}`)];
    const xs = slats.map((id) => bars[id]?.a[0] as number);
    expect(Object.keys(bars).filter((k) => k.startsWith("b17@"))).toHaveLength(n - 1);
    const gaps = xs.slice(1).map((x, i) => x - (xs[i] as number));
    for (const g of gaps) expect(Math.abs(g - (gaps[0] as number))).toBeLessThan(0.01);
    // Every slat is cut as the one drawn, between the shelf rails' inner faces (600 − 2 × 40,
    // by hand), and none has an end left unjoined (docs/ux/review-editing.md B1: the copies were
    // cut 600, running through both rails, and the CLI's same batch could not tell).
    expect(bars.b17?.cut_mm).toBe(520);
    for (const id of slats) expect(bars[id]?.cut_mm, id).toBe(520);
    expect(unjoined(d, slats)).toEqual([]);
    expect(await openEnds(served?.dir as string)).toEqual([]);
  };
  await spacing(4);
  // Five: the pattern, selected by the step that made it, its count in its inspector; one step.
  await expect.poll(() => selection(page)).toEqual(["pt1"]);
  const v = new User(page);
  const count = page.getByTestId("properties").getByTestId("field-count");
  await expect(count).toHaveValue("4");
  await v.fill(count, "5");
  await v.press("Enter");
  await waitDrawn(page, 2);
  v.done();
  v.report("A8, five", sent.length - 1);
  await spacing(5);
  expect(sent).toHaveLength(2);
  // The CLI's batch: the slat, a join at each end and its pattern, in one step.
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
        { cmd: "addPattern", args: { template: ["b17"], along: "b9", pitch_mm: 150, count: 4 } },
      ],
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

test("A14 (A6 by mouse): the bracket placed and mirrored with the pointer", async ({ page }) => {
  test.setTimeout(120_000);
  served = await serveFrame();
  const sent = sentSteps(page);
  await openTab(page, served, 0);
  const u = new User(page);
  // Placed by the pointer, the distance typed (allowed): A6's placement.
  await placeBracket(u, page);
  u.done();
  u.report("A14 (A6 by mouse), place", 1);
  // The mirror: Select on the rail (Mirror… works in Select or Move), a right-click on the
  // bracket's outline row selects it and opens the menu; Mirror…, the plane's place typed
  // (allowed), a click in the view commits it.
  const v = new User(page);
  await v.click(page.getByTestId("tool-select"));
  await v.click(page.getByTestId("tree").locator('[data-id="p1"]').first(), { button: "right" });
  await v.click(page.getByTestId("context-menu").getByRole("menuitem", { name: /^Mirror/ }));
  await v.type("500");
  await expect(page.getByTestId("joint-preview")).toContainText("makes p2");
  await v.clickAt(await screen(page, [500, 300, 0]));
  await waitDrawn(page, 2);
  v.done();
  v.report("A14 (A6 by mouse), mirror", 1);
  await expectMirrored(sent);
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
  await page.getByTestId("draw-anchor-open").click();
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
  // `alukit log --json` keeps each step's commands (the editing polish's defect 6): the session
  // is replayed from the log alone, one `alukit do` per step, and they are what the app sent.
  const log = JSON.parse((await cli(["log", served.dir, "--json"])).out) as {
    entries: { what: string; commands?: unknown[] }[];
  };
  const steps = log.entries.map((e) => e.commands ?? []);
  expect(steps).toHaveLength(5);
  expect(steps).toEqual(sent);
  await sameAsCli(served.dir, (dir) => doAll(dir, ...steps));
});
