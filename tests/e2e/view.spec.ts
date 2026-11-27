import { expect, type Locator, type Page, test } from "@playwright/test";
import { cornersOf } from "../../src/ui/corners.ts";
import type { Model } from "../../src/ui/model.ts";
import { resolveTargets } from "../../src/ui/targets.ts";
import { cli, derivedBarCount, openTab, raw, type Served, serve, waitDrawn } from "./helpers.ts";
import { decodePng } from "./png.ts";

/**
 * The 3D view (design §8): the cart fixture draws every bar and every placed part the derived
 * model has, the project's own plate, bent angle and placeholder among them (§4.8); the camera
 * looks from the standard views, orthographic or not, and fits to the selection; and the section
 * plane cuts the view along an axis and changes nothing else.
 *
 * The UX redesign's view (docs/ux/plan.md §5.7, S3): hover tints what a click would select and
 * names it; a selection hidden behind another bar shows through (x-ray); a black profile's
 * edges stand out from the background; every corner has a marker by its state; Show frames its
 * targets and dims the rest (a problem's, or an item's from the legend); colour by item has a legend of the BOM's items; the gizmo turns the
 * view.
 */

type V3 = [number, number, number];

interface DerivedParts {
  parts: Record<string, { item: string; kind: string; unplaced?: boolean }>;
}

interface Sheet {
  parts: { item: string; holes: unknown[] }[];
}

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is not on the screen`);
  return s;
}

async function viewportPng(page: Page) {
  await page.mouse.move(0, 0);
  return decodePng(await page.getByTestId("viewport").locator("canvas").screenshot());
}

function differing(a: ReturnType<typeof decodePng>, b: ReturnType<typeof decodePng>): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2]
    )
      n++;
  }
  return n;
}

test("the cart draws its bars: a non-blank canvas, one body per derived bar", async ({ page }) => {
  served = await serve("cart");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTab(page, served, 0);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("connection")).toHaveText("live");

  const derived = await derivedBarCount(served.dir);
  expect(derived).toBe(39);
  const stats = await page.evaluate(() => window.__alukit?.stats());
  expect(stats?.bars).toBe(derived);
  // Square bars are instanced; the braces' angled ends get their own geometry.
  expect(stats?.instancedBars).toBeGreaterThan(0);
  expect(stats?.angledBars).toBeGreaterThan(0);

  // One body per placed part: the three carriages, and M6's p6 (a plate), p7 (a bent angle) and
  // p8 (a placeholder), each drawn as what it is, with the plate's and the angle's holes marked.
  const d = JSON.parse((await cli(["derive", served.dir, "--json"])).out) as DerivedParts;
  const placed = Object.entries(d.parts).filter(([, p]) => !p.unplaced);
  expect(placed.map(([id]) => id)).toEqual(["p1", "p1@1", "p1@2", "p6", "p7", "p8"]);
  expect(stats?.parts).toBe(placed.length);
  const ofKind = (k: string) => placed.filter(([, p]) => p.kind === k).length;
  expect([stats?.plates, stats?.bentAngles, stats?.placeholders]).toEqual([
    ofKind("plate"),
    ofKind("bent-angle"),
    ofKind("placeholder"),
  ]);
  expect([ofKind("plate"), ofKind("bent-angle"), ofKind("placeholder")]).toEqual([1, 1, 1]);
  const sheet = JSON.parse((await cli(["machining", served.dir, "--format", "json"])).out) as Sheet;
  const holesOf = new Map(sheet.parts.map((p) => [p.item, p.holes.length]));
  const holes = placed.reduce((n, [, p]) => n + (holesOf.get(p.item) ?? 0), 0);
  expect(holes).toBe(6);
  expect(stats?.holes).toBe(holes);
  expect(stats?.edgeSegments).toBeGreaterThan(stats?.bars as number);

  // Copy the WebGL canvas into a 2D one and count pixels that differ from the background. The
  // background is a vertical gradient, one colour a row: a pixel differs from its row's most
  // common colour. (The renderer keeps its drawing buffer, so this is valid between frames.)
  const pixels = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const gl = document.querySelector("canvas") as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = gl.width;
    copy.height = gl.height;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(gl, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    const colours = new Set<number>();
    let differing = 0;
    for (let y = 0; y < copy.height; y++) {
      const row = new Map<number, number>();
      for (let x = 0; x < copy.width; x++) {
        const i = (y * copy.width + x) * 4;
        const c =
          ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
        colours.add(c);
        row.set(c, (row.get(c) ?? 0) + 1);
      }
      differing += copy.width - Math.max(...row.values());
    }
    return { total: data.length / 4, differing, distinct: colours.size };
  });
  expect(pixels.total).toBeGreaterThan(0);
  expect(pixels.differing).toBeGreaterThan(pixels.total * 0.02);
  expect(pixels.distinct).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("looks from standard views, orthographic or not, and fits to the selection", async ({
  page,
}) => {
  served = await serve("base-frame/cli");
  await openTab(page, served, 0);
  const settle = () => atRest(page);
  // Top, orthographic: world X to the right, Y up the screen.
  await page.getByTestId("projection").click();
  await expect(page.getByTestId("projection")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("view-top").click();
  await settle();
  const o = await screen(page, [0, 0, 0]);
  const x = await screen(page, [1200, 0, 0]);
  const y = await screen(page, [0, 600, 0]);
  const z = await screen(page, [0, 0, 900]);
  expect(x[0] - o[0]).toBeGreaterThan(100);
  expect(Math.abs(x[1] - o[1])).toBeLessThan(1);
  expect(o[1] - y[1]).toBeGreaterThan(50);
  // Orthographic, looking straight down: height does not move a point.
  expect(Math.hypot(z[0] - o[0], z[1] - o[1])).toBeLessThan(1);
  // The ratio of the frame's sides is kept: an orthographic projection.
  expect((x[0] - o[0]) / (o[1] - y[1])).toBeCloseTo(2, 2);

  // Front: X to the right, Z up.
  await page.getByTestId("view-front").click();
  await settle();
  const fo = await screen(page, [0, 0, 0]);
  const fz = await screen(page, [0, 0, 900]);
  expect(fo[1] - fz[1]).toBeGreaterThan(50);
  expect(Math.abs(fz[0] - fo[0])).toBeLessThan(1);

  // Fit to one base rail: it then spans most of the viewport's width.
  await page.getByTestId("tree").locator('[data-id="b9"]').click();
  const before = (await screen(page, [1200, 0, 100]))[0] - (await screen(page, [0, 0, 100]))[0];
  await page.getByTestId("fit").click();
  await settle();
  const after = (await screen(page, [1200, 0, 100]))[0] - (await screen(page, [0, 0, 100]))[0];
  const box = await page.getByTestId("viewport").boundingBox();
  expect(after).toBeGreaterThanOrEqual(before);
  expect(after).toBeGreaterThan((box?.width ?? 0) * 0.7);
});

test("the section plane cuts the view along an axis, and nothing else", async ({ page }) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const whole = await viewportPng(page);

  // b2 stands at x 1200 to 1240, y −40 to 0 (anchored +x−y): a click on it picks it.
  const [x, y] = (await page.evaluate(() => window.__alukit?.screen([1220, -20, 450]))) as [
    number,
    number,
  ];
  await page.mouse.click(x, y);
  await expect(page.getByTestId("properties").locator("h2")).toContainText("b2");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("properties")).toHaveCount(0);

  await page.getByTestId("section").click();
  await expect(page.getByTestId("section-tools")).toBeVisible();
  const on = await page.evaluate(() => window.__alukit?.section());
  expect(on).toMatchObject({ axis: "x", flip: false });

  // Drag the plane along X to 300 mm: the right-hand post is cut away, the left one stays.
  await page.getByTestId("section-at").fill("300");
  await expect.poll(() => page.evaluate(() => window.__alukit?.section()?.at_mm)).toBe(300);
  expect(await page.evaluate(() => window.__alukit?.clipped([1200, 0, 450]))).toBe(true);
  expect(await page.evaluate(() => window.__alukit?.clipped([0, 0, 450]))).toBe(false);
  const cut = await viewportPng(page);
  expect(differing(whole, cut)).toBeGreaterThan(1000);

  // The same click now picks nothing: the post is cut away, and nothing drawn is behind it.
  await page.mouse.click(x, y);
  await expect(page.getByTestId("properties")).toHaveCount(0);

  await page.getByTestId("section-flip").click();
  expect(await page.evaluate(() => window.__alukit?.clipped([1200, 0, 450]))).toBe(false);
  await page.getByTestId("section-y").click();
  expect(await page.evaluate(() => window.__alukit?.section()?.axis)).toBe("y");

  // Off again: the same picture as before, and the document never changed. The pointer leaves
  // the viewport first, so no hover tint differs (§5.10).
  await page.getByTestId("section").click();
  await expect(page.getByTestId("section-tools")).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect.poll(() => page.evaluate(() => window.__alukit?.hovered())).toBeUndefined();
  expect(differing(whole, await viewportPng(page))).toBe(0);
  expect(await page.evaluate(() => window.__alukit?.rev())).toBe(0);
});

// ---------------------------------------------------------------------------------------------
// The UX redesign's view (S3)

interface DerivedBar {
  a: V3;
  b: V3;
  cut_mm: number;
  frame: { x: V3; y: V3; z: V3 };
  box_mm: [[number, number], [number, number]];
}

async function derivedBars(dir: string): Promise<Record<string, DerivedBar>> {
  const out = (await cli(["derive", dir, "--json"])).out;
  return (JSON.parse(out) as { bars: Record<string, DerivedBar> }).bars;
}

/** A bar's body's corners in the world: its section's box at both design points. */
function corners(b: DerivedBar): V3[] {
  const [[u0, v0], [u1, v1]] = b.box_mm;
  const out: V3[] = [];
  const { x, y } = b.frame;
  for (const p of [b.a, b.b])
    for (const u of [u0, u1])
      for (const v of [v0, v1])
        out.push([
          p[0] + u * x[0] + v * y[0],
          p[1] + u * x[1] + v * y[1],
          p[2] + u * x[2] + v * y[2],
        ]);
  return out;
}

/**
 * The camera at rest. A move (a view, a fit, a Show) marks the camera moving when it is asked for,
 * before any frame draws, so this cannot see it still before the move has begun, however slow
 * the frames are.
 */
async function atRest(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__alukit?.camera()?.moving)).toBe(false);
}

/** Where the camera looks from: eye minus target, a unit vector to two decimals. */
async function lookingFrom(page: Page): Promise<number[]> {
  const c = await page.evaluate(() => window.__alukit?.camera());
  const d = [0, 1, 2].map((i) => (c?.position[i] as number) - (c?.target[i] as number));
  const n = Math.hypot(...d);
  return d.map((x) => Math.round((x / n) * 100) / 100 + 0);
}

/** Clicks what turns the view; at rest, the camera looks from `from`. */
async function turnTo(page: Page, button: Locator, from: number[]) {
  await button.click();
  await atRest(page);
  expect(await lookingFrom(page)).toEqual(from);
}

/** Once the camera is at rest after a Show, its target lies in the box framed. */
async function framed(page: Page, box: readonly V3[]) {
  await atRest(page);
  const t = (await page.evaluate(() => window.__alukit?.camera()))?.target;
  for (let i = 0; i < 3; i++) {
    expect(t?.[i]).toBeGreaterThanOrEqual(Math.min(...box.map((c) => c[i] as number)) - 1);
    expect(t?.[i]).toBeLessThanOrEqual(Math.max(...box.map((c) => c[i] as number)) + 1);
  }
}

type RGB = [number, number, number];

/**
 * The WebGL canvas's pixels (not the page's: no label or button over it) in a rectangle of page
 * coordinates, after the next frame, as [r, g, b] each.
 */
async function canvasPixels(
  page: Page,
  rect: { x0: number; y0: number; x1: number; y1: number },
): Promise<RGB[]> {
  return page.evaluate(async (q) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const gl = document.querySelector(".viewport canvas") as HTMLCanvasElement;
    const box = gl.getBoundingClientRect();
    const k = gl.width / box.width;
    const x0 = Math.max(0, Math.floor((q.x0 - box.left) * k));
    const y0 = Math.max(0, Math.floor((q.y0 - box.top) * k));
    const x1 = Math.min(gl.width, Math.ceil((q.x1 - box.left) * k));
    const y1 = Math.min(gl.height, Math.ceil((q.y1 - box.top) * k));
    const copy = document.createElement("canvas");
    copy.width = gl.width;
    copy.height = gl.height;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(gl, 0, 0);
    const { data } = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    const out: [number, number, number][] = [];
    for (let i = 0; i < data.length; i += 4) {
      out.push([data[i] as number, data[i + 1] as number, data[i + 2] as number]);
    }
    return out;
  }, rect);
}

const around = (p: [number, number], r: number) => ({
  x0: p[0] - r,
  y0: p[1] - r,
  x1: p[0] + r + 1,
  y1: p[1] + r + 1,
});

const mean = (px: RGB[]) => px.reduce((s, [r, g, b]) => s + r + g + b, 0) / (px.length * 3 || 1);

/** The selection's amber, as it shows over grey: much more red than blue. */
const amber = ([r, , b]: RGB) => r > 150 && r - b > 60;

/** WCAG 2's contrast ratio. */
function contrast(a: RGB, b: RGB): number {
  const lum = ([r, g, bl]: RGB) => {
    const ch = (c: number) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

test("hover tints what a click would select and names it; moving off clears it", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const cut = (await derivedBars(served.dir)).b2?.cut_mm as number;
  // b2 stands at x 1200 to 1240, y −40 to 0: the middle of its front face.
  const at = await screen(page, [1220, -40, 450]);
  const rest = await canvasPixels(page, around(at, 2));

  await page.mouse.move(at[0], at[1]);
  await expect.poll(() => page.evaluate(() => window.__alukit?.hovered())).toEqual(["b2"]);
  await expect(page.getByTestId("hover-label")).toContainText("b2");
  await expect(page.getByTestId("hover-label")).toContainText(`${cut.toFixed(2)} mm`);
  // Pale amber: redder than the grey it was, and nothing selected.
  const lit = await canvasPixels(page, around(at, 2));
  const redder = (px: RGB[]) => px.reduce((s, [r, , b]) => s + r - b, 0);
  expect(redder(lit)).toBeGreaterThan(redder(rest) + lit.length * 20);
  await expect(page.getByTestId("properties")).toHaveCount(0);

  await page.mouse.move(0, 0);
  await expect.poll(() => page.evaluate(() => window.__alukit?.hovered())).toBeUndefined();
  await expect(page.getByTestId("hover-label")).toHaveCount(0);
  expect(await canvasPixels(page, around(at, 2))).toEqual(rest);
});

test("a selected bar hidden behind another shows through it; its label gives its cut", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const b9 = (await derivedBars(served.dir)).b9 as DerivedBar;
  // The problem badges off, so only the selection draws in amber.
  await page.getByTestId("toggle-problems").click();
  // From the top, the base rail b9 lies under the top rail b5 and the flat bar on it.
  await page.getByTestId("projection").click();
  await turnTo(page, page.getByTestId("view-top"), [0, 0, 1]);
  const pts = await Promise.all(corners(b9).map((c) => screen(page, c)));
  const rect = {
    x0: Math.min(...pts.map((p) => p[0])) - 2,
    y0: Math.min(...pts.map((p) => p[1])) - 2,
    x1: Math.max(...pts.map((p) => p[0])) + 2,
    y1: Math.max(...pts.map((p) => p[1])) + 2,
  };
  const middle = [(rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2] as [number, number];
  expect((await canvasPixels(page, rect)).filter(amber)).toHaveLength(0);

  await page.getByTestId("tree").locator('[data-id="b9"]').click();
  await page.mouse.move(0, 0);
  // Its outline shows over what covers it, while its middle shows what is on top, not b9.
  expect((await canvasPixels(page, rect)).filter(amber).length).toBeGreaterThan(200);
  expect((await canvasPixels(page, around(middle, 1))).filter(amber)).toHaveLength(0);
  await expect(page.getByTestId("selection-label")).toHaveText(
    `cut ${b9.cut_mm.toFixed(2)} mm  square · square`,
  );
});

test("a black profile's edges stand out from the background, at 3:1 or more", async ({ page }) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const black = [{ cmd: "setBar", args: { id: "b9", set: { opt: { finish: "black" } } } }];
  const r = await cli(["do", served.dir, JSON.stringify(black)]);
  expect(r.code, r.err).toBe(0);
  await waitDrawn(page, 1);
  // The problem badges off, so the edge measured is the edge's colour, not a badge's tint.
  await page.getByTestId("toggle-problems").click();
  // From the front, b9's underside is a silhouette against the background, between the slats.
  await page.getByTestId("projection").click();
  await turnTo(page, page.getByTestId("view-front"), [0, -1, 0]);
  const b9 = (await derivedBars(served.dir)).b9 as DerivedBar;
  const bottom = Math.min(...corners(b9).map((c) => c[2]));
  const [x, y] = await screen(page, [225, 0, bottom]);
  const edge = await canvasPixels(page, { x0: x, y0: y - 1, x1: x + 1, y1: y + 2 });
  const [below] = await canvasPixels(page, { x0: x, y0: y + 8, x1: x + 1, y1: y + 9 });
  const best = Math.max(...edge.map((p) => contrast(p, below as RGB)));
  expect(best).toBeGreaterThanOrEqual(3);
});

test("every corner has a marker by its state: a rectangle drawn unconnected has 4 open", async ({
  page,
}) => {
  served = await serve("base-frame/empty");
  await openTab(page, served, 0);
  const rect = [
    { a: [0, 0, 0], b: [1000, 0, 0] },
    { a: [1000, 0, 0], b: [1000, 600, 0] },
    { a: [1000, 600, 0], b: [0, 600, 0] },
    { a: [0, 600, 0], b: [0, 0, 0] },
  ].map((args) => ({ cmd: "addBar", args }));
  const r = await cli(["do", served.dir, JSON.stringify(rect)]);
  expect(r.code, r.err).toBe(0);
  await waitDrawn(page, 1);
  await expect
    .poll(async () => (await page.evaluate(() => window.__alukit?.stats()))?.joints)
    .toEqual({ joined: 0, open: 4, failed: 0 });
  // The page's corners are cornersOf the server's model, computed here.
  const answer = await raw(served.port, "/api/model", {
    headers: { authorization: `Bearer ${served.token}` },
  });
  const expected = cornersOf(JSON.parse(answer.body) as Model);
  expect(expected.map((c) => c.state)).toEqual(["open", "open", "open", "open"]);
  expect(await page.evaluate(() => window.__alukit?.corners())).toEqual(expected);
  // Each is drawn: the open ring in the warning's yellow, at its corner. (The problem badges
  // off: the unconnected ends' warnings would tint the bars the same yellow.)
  await page.getByTestId("toggle-problems").click();
  const yellow = ([r, g, b]: RGB) => r > 170 && g > 130 && b < 120;
  const drawn = async () => {
    const n: number[] = [];
    for (const c of expected) {
      const s = await screen(page, [...c.at] as V3);
      n.push((await canvasPixels(page, around(s, 7))).filter(yellow).length);
    }
    return n;
  };
  for (const n of await drawn()) expect(n).toBeGreaterThan(4);
  // Off, none is drawn; on again, hovering one names it.
  await page.getByTestId("toggle-joints").click();
  expect((await page.evaluate(() => window.__alukit?.stats()))?.joints.open).toBe(0);
  expect(await drawn()).toEqual([0, 0, 0, 0]);
  await page.getByTestId("toggle-joints").click();
  const s = await screen(page, [1000, 600, 0]);
  await page.mouse.move(s[0], s[1]);
  await expect
    .poll(() => page.evaluate(() => window.__alukit?.hovered()))
    .toEqual(["corner:1000,600,0"]);
  await expect(page.getByTestId("hover-label")).toContainText("open");
});

test("Show on a problem frames its targets, keeping the direction, and dims the rest", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  // The order's reason O1 is about c35, the rail's screws: Show from its row.
  const answer = await raw(served.port, "/api/model", {
    headers: { authorization: `Bearer ${served.token}` },
  });
  const box = resolveTargets(JSON.parse(answer.body) as Model, ["c35"]).box as [V3, V3];
  const before = await page.evaluate(() => window.__alukit?.camera());
  await page.getByRole("tab", { name: "Order & costs" }).click();
  await page
    .getByTestId("order")
    .locator('li.problem[data-problem*="O1"]')
    .first()
    .getByTestId("show")
    .click();
  await expect(page.getByTestId("callout")).toBeVisible();
  await expect(page.getByTestId("callout")).toContainText("Others dimmed");
  await framed(page, box);
  const after = await page.evaluate(() => window.__alukit?.camera());
  for (let i = 0; i < 3; i++) {
    expect(after?.target[i]).toBeGreaterThanOrEqual((box[0][i] as number) - 1);
    expect(after?.target[i]).toBeLessThanOrEqual((box[1][i] as number) + 1);
  }
  const dir = (c: typeof before) => {
    const d = [0, 1, 2].map((i) => (c?.position[i] as number) - (c?.target[i] as number));
    const n = Math.hypot(...d);
    return d.map((x) => x / n);
  };
  for (let i = 0; i < 3; i++) expect(dir(after)[i]).toBeCloseTo(dir(before)[i] as number, 3);
  // Ghosting: with the pulse over, leaving Show (Esc) changes only the dimmed bodies, and each
  // pixel that changes gets brighter.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1200);
  const all = { x0: 0, y0: 0, x1: 4000, y1: 4000 };
  const dim = await canvasPixels(page, all);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("callout")).toHaveCount(0);
  const lit = await canvasPixels(page, all);
  let brighter = 0;
  let darker = 0;
  for (let i = 0; i < lit.length; i++) {
    const d = mean([lit[i] as RGB]) - mean([dim[i] as RGB]);
    if (d > 8) brighter++;
    else if (d < -8) darker++;
  }
  expect(brighter).toBeGreaterThan(2000);
  expect(darker).toBeLessThan(brighter / 50);
});

test("colour by item lists the BOM's items; an entry shows what uses it, the rest dimmed", async ({
  page,
}) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  await page.getByTestId("colour-by").click();
  const bom = JSON.parse((await cli(["bom", served.dir, "--format", "json"])).out) as {
    groups: { lines: { item: string }[] }[];
  };
  const items = [...new Set(bom.groups.flatMap((g) => g.lines.map((l) => l.item)))];
  const legend = page.getByTestId("legend").locator("[data-item]");
  await expect(legend).toHaveCount(items.length);
  expect(await legend.evaluateAll((els) => els.map((e) => e.getAttribute("data-item")))).toEqual(
    items,
  );

  // The RHS beam is one bar, b18: Show frames it, keeping the direction, and dims the rest.
  const b18 = (await derivedBars(served.dir)).b18 as DerivedBar;
  const before = await page.evaluate(() => window.__alukit?.camera());
  await page.getByTestId("legend").locator('[data-item="test-geo:RHS-100x50x4"]').click();
  await expect(page.getByTestId("callout")).toBeVisible();
  const box = corners(b18);
  await framed(page, box);
  const after = await page.evaluate(() => window.__alukit?.camera());
  for (let i = 0; i < 3; i++) {
    const lo = Math.min(...box.map((c) => c[i] as number)) - 1;
    const hi = Math.max(...box.map((c) => c[i] as number)) + 1;
    expect(after?.target[i]).toBeGreaterThanOrEqual(lo);
    expect(after?.target[i]).toBeLessThanOrEqual(hi);
  }
  const dir = (c: typeof before) => {
    const d = [0, 1, 2].map((i) => (c?.position[i] as number) - (c?.target[i] as number));
    const n = Math.hypot(...d);
    return d.map((x) => x / n);
  };
  for (let i = 0; i < 3; i++) expect(dir(after)[i]).toBeCloseTo(dir(before)[i] as number, 3);

  // Ghosting: a slat beside the beam, b26@4 (not the beam), is darker while shown, and as bright
  // again after Esc. Its top face is at z 120.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1200);
  const slat = await screen(page, [750, 300, 120]);
  const dim = mean(await canvasPixels(page, around(slat, 2)));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("callout")).toHaveCount(0);
  const lit = mean(await canvasPixels(page, around(slat, 2)));
  expect(dim).toBeLessThan(lit * 0.8);
});

test("the gizmo's ends turn the view to look along their axis", async ({ page }) => {
  served = await serve("cart");
  await openTab(page, served, 0);
  const gizmo = page.getByTestId("gizmo");
  await turnTo(page, gizmo.getByRole("button", { name: "Top view" }), [0, 0, 1]);
  await turnTo(page, gizmo.getByRole("button", { name: "Right view" }), [1, 0, 0]);
  await turnTo(page, gizmo.getByRole("button", { name: "Front view" }), [0, -1, 0]);
  // At rest, still looking from the front.
  expect(await lookingFrom(page)).toEqual([0, -1, 0]);
});

test("a revision draws with the shader programs it has: none is compiled again", async ({
  page,
}) => {
  // Count the WebGL program links. A revision that released its materials' programs and linked
  // them again cost the live update up to a second on SwiftShader.
  await page.addInitScript(() => {
    const w = window as unknown as { __links: number };
    w.__links = 0;
    const link = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (p) {
      w.__links++;
      link.call(this, p);
    };
  });
  served = await serve("cart");
  await openTab(page, served, 0);
  const links = () => page.evaluate(() => (window as unknown as { __links: number }).__links);
  const frames = () => page.evaluate(() => window.__alukit?.frames()?.frames ?? 0);
  // The first frames link what the model needs; then a revision with a new bar and new corners.
  await expect.poll(frames).toBeGreaterThan(1);
  const before = await links();
  expect(before).toBeGreaterThan(0);
  const idle = await frames();
  const r = await cli(["add", "bar", served.dir, "--a", "0,0,0", "--b", "0,-300,0"]);
  expect(r.code, r.err).toBe(0);
  await waitDrawn(page, 1);
  // The revision's frame has drawn (the view draws on demand: nothing else asked for one).
  await expect.poll(frames).toBeGreaterThan(idle);
  expect(await links()).toBe(before);
  // Undo, a second revision: the bar and its corners go, and still nothing is linked. The step
  // was the CLI's, so the tab asks first (D-UX-14).
  const drawn = await frames();
  await page.getByTestId("undo").click();
  await page.getByTestId("undo-confirm").click();
  await waitDrawn(page, 2);
  await expect.poll(frames).toBeGreaterThan(drawn);
  expect(await links()).toBe(before);
});

test("context draws translucent, apart from the build; marking it or not links no shader program (X11)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __links: number };
    w.__links = 0;
    const link = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (p) {
      w.__links++;
      link.call(this, p);
    };
  });
  served = await serve("golden-gen/G51");
  const step = async (batch: unknown[]) => {
    const r = await cli(["do", served.dir, JSON.stringify(batch)]);
    expect(r.code, r.err).toBe(0);
  };
  // The wall unmarked before the tab opens: a placeholder to buy, so the tab draws a problem
  // badge from the start, as on any project with a problem. (Badges follow the model by their own
  // request, and the first one a tab draws links the markers' programs once, whatever the model.)
  await step([{ cmd: "setPart", args: { id: "p3", set: { context: null } } }]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openTab(page, served, 1);
  const links = () => page.evaluate(() => (window as unknown as { __links: number }).__links);
  const frames = () => page.evaluate(() => window.__alukit?.frames()?.frames ?? 0);
  const stats = () => page.evaluate(() => window.__alukit?.stats());
  const badges = async () => (await stats())?.badges;
  await expect.poll(badges).toBe(1);
  await expect.poll(frames).toBeGreaterThan(1);
  // Five bars and three parts drawn; the bench's three bars and the floor as context.
  expect(await stats()).toMatchObject({ bars: 5, parts: 3, context: 4 });
  const before = await links();

  // The bench's post and the floor unmarked, one step: they draw with the programs the opaque
  // bars and the translucent parts already have, and the problems they bring are badged: the two
  // placeholders, and the post's hole, now a machining service with no price, on the three
  // built posts (the item's bars the order buys).
  let drawn = await frames();
  await step([
    { cmd: "setBar", args: { id: "b3", set: { context: null } } },
    { cmd: "setPart", args: { id: "p2", set: { context: null } } },
  ]);
  await waitDrawn(page, 2);
  await expect.poll(frames).toBeGreaterThan(drawn);
  await expect.poll(badges).toBe(5);
  expect(await stats()).toMatchObject({ bars: 5, parts: 3, context: 2 });
  expect(await links()).toBe(before);

  // And back: the post marked context again joins the translucent bars' pair, and its hole, made
  // in place, asks for no price.
  drawn = await frames();
  await step([{ cmd: "setBar", args: { id: "b3", set: { context: true } } }]);
  await waitDrawn(page, 3);
  await expect.poll(frames).toBeGreaterThan(drawn);
  await expect.poll(badges).toBe(2);
  expect(await stats()).toMatchObject({ bars: 5, parts: 3, context: 3 });
  expect(await links()).toBe(before);
  expect(errors).toEqual([]);
});
