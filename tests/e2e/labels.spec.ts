import { expect, type Page, test } from "@playwright/test";
import { openTab, type Served, serve } from "./helpers.ts";

/**
 * The labels and tips in the 3D view keep WCAG 2.2 AA contrast (1.4.3, 4.5:1 for their small
 * text) in both themes (docs/ux/review-editing.md M5): the selection's label, the hover label,
 * the joint preview and the tip by the pointer during a drag, a locked end's note, the size box,
 * a move's readout and Show's callout, each measured as the page draws it, its text colour
 * against what it sits on. A translucent box over the canvas is measured over both white and
 * black, the worst taken, since the scene behind it may be either. On tests/fixtures/ux/ends.
 */

type V3 = [number, number, number];

let served: Served;
test.afterEach(async () => {
  await served.stop();
});

/** The text in the view's labels and tips: the colour drawn, on what, and the ratio. */
interface Reading {
  what: string;
  text: string;
  fg: string;
  bg: string;
  ratio: number;
}

const LABELS = [
  ".view-label",
  ".tool-hint",
  ".hover-label",
  ".sel-label",
  ".end-note",
  ".callout",
  ".gizmo-end",
].join(", ");

/** Every visible piece of text in the view's labels and tips, with its contrast. */
async function readings(page: Page): Promise<Reading[]> {
  return page.evaluate((selector) => {
    type C = [number, number, number, number];
    const parse = (s: string): C | undefined => {
      const rgb = /rgba?\(([^)]+)\)/.exec(s);
      if (rgb) {
        const p = (rgb[1] as string)
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
      }
      const srgb = /color\(srgb ([^)]+)\)/.exec(s);
      if (srgb) {
        const p = (srgb[1] as string)
          .split(/[\s/]+/)
          .filter(Boolean)
          .map(Number);
        return [(p[0] ?? 0) * 255, (p[1] ?? 0) * 255, (p[2] ?? 0) * 255, p[3] ?? 1];
      }
      return undefined;
    };
    const over = (top: C, under: C): C => {
      const a = top[3];
      return [
        top[0] * a + under[0] * (1 - a),
        top[1] * a + under[1] * (1 - a),
        top[2] * a + under[2] * (1 - a),
        1,
      ];
    };
    const lum = (c: C) => {
      const ch = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
    };
    const ratio = (a: C, b: C) => {
      const x = lum(a);
      const y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const hex = (c: C) =>
      `#${c
        .slice(0, 3)
        .map((v) => Math.round(v).toString(16).padStart(2, "0"))
        .join("")}`;
    /** The backgrounds from the element out, until an opaque one. */
    const layers = (el: Element): C[] => {
      const out: C[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c[3] > 0) {
          out.push(c);
          if (c[3] >= 1) break;
        }
      }
      return out;
    };
    const out: {
      what: string;
      text: string;
      fg: string;
      bg: string;
      ratio: number;
    }[] = [];
    for (const box of document.querySelectorAll(selector)) {
      const all = [box, ...box.querySelectorAll("*")];
      for (const el of all) {
        const own = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
        );
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (!own || r.width === 0 || style.visibility === "hidden" || style.display === "none")
          continue;
        const ls = layers(el);
        const opaque = ls.length > 0 && (ls[ls.length - 1] as C)[3] >= 1;
        const bases: C[] = opaque
          ? [ls[ls.length - 1] as C]
          : [
              [255, 255, 255, 1],
              [0, 0, 0, 1],
            ];
        const stack = opaque ? ls.slice(0, -1) : ls;
        // A text coloured on its first line (the gizmo's letters) is drawn in that colour.
        const fgRaw = parse(getComputedStyle(el, "::first-line").color || style.color) as C;
        let worst: { r: number; fg: C; bg: C } | undefined;
        for (const base of bases) {
          const bg = stack.reduceRight<C>((under, top) => over(top, under), base);
          const fg = fgRaw[3] < 1 ? over(fgRaw, bg) : fgRaw;
          const r2 = ratio(fg, bg);
          if (!worst || r2 < worst.r) worst = { r: r2, fg, bg };
        }
        if (!worst) continue;
        out.push({
          what: `${(box as HTMLElement).className}${box === el ? "" : ` ${el.tagName.toLowerCase()}`}`,
          text: (el.textContent ?? "").trim().slice(0, 60),
          fg: hex(worst.fg),
          bg: hex(worst.bg),
          ratio: Math.round(worst.r * 100) / 100,
        });
      }
    }
    return out;
  }, LABELS);
}

/** The readings of every label shown now that match `what`, at least one, none under AA. */
async function holds(page: Page, what: string, seen: Reading[]): Promise<void> {
  const r = await readings(page);
  const these = r.filter((x) => x.what.includes(what));
  expect(these.length, `${what} is shown`).toBeGreaterThan(0);
  seen.push(...r);
}

async function screen(page: Page, p: V3): Promise<[number, number]> {
  const s = await page.evaluate((q) => window.__alukit?.screen(q), p);
  if (!s) throw new Error(`${p} is off the screen`);
  return s;
}

async function pick(page: Page, id: string): Promise<void> {
  await page.getByTestId("tree").locator(`[data-id="${id}"]`).first().click();
  await expect(page.getByTestId("properties").locator("h2")).toContainText(id);
}

async function handle(page: Page, end: "a" | "b"): Promise<[number, number]> {
  await page.waitForFunction((e) => window.__alukit?.handles().some((h) => h.end === e), end);
  const h = ((await page.evaluate(() => window.__alukit?.handles())) ?? []).find(
    (x) => x.end === end,
  );
  if (!h) throw new Error(`no handle at end ${end}`);
  return screen(page, h.p as V3);
}

for (const theme of ["dark", "light"] as const) {
  test(`every label and tip in the view holds AA contrast in the ${theme} theme`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    served = await serve("ux/ends");
    await openTab(page, served, 0);
    await page.getByTestId("theme-switch").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const seen: Reading[] = [];

    // The selection's label, and the gizmo's axis letters.
    await pick(page, "b3");
    await expect(page.getByTestId("selection-label")).toBeVisible();
    await holds(page, "sel-label", seen);
    await holds(page, "gizmo-end", seen);

    // What a click would select, by the pointer.
    const onB1 = await screen(page, [800, 0, 0]);
    await page.mouse.move(onB1[0], onB1[1]);
    await expect(page.getByTestId("hover-label")).toBeVisible();
    await holds(page, "hover-label", seen);

    // A drag of b3's end onto b1: the joint preview by the end, the tip by the pointer.
    const b = await handle(page, "b");
    await page.mouse.move(b[0], b[1]);
    await page.mouse.down();
    const target = await screen(page, [500, 0, 0]);
    await page.mouse.move(target[0], target[1], { steps: 12 });
    await expect(page.getByTestId("joint-preview")).toContainText("will butt on b1");
    await expect(page.locator('.view-label[data-label="joint"]')).toBeVisible();
    await holds(page, "view-label", seen);
    await holds(page, "tool-hint", seen);
    await page.keyboard.press("Escape");
    await page.mouse.up();

    // A locked end's note: b4's end b, which L drives.
    await pick(page, "b4");
    const locked = await handle(page, "b");
    await page.mouse.click(locked[0], locked[1]);
    await expect(page.getByTestId("end-note")).toContainText("driven by L");
    await holds(page, "end-note", seen);

    // The size box while Alt is held.
    await page.keyboard.down("Alt");
    await expect(page.locator('.view-label[data-label="size-w"]')).toBeVisible();
    await holds(page, "view-label", seen);
    await page.keyboard.up("Alt");

    // A move's readout: b3 moved by a typed offset, its words by the pointer.
    await pick(page, "b3");
    await page.getByTestId("viewport").hover();
    await page.keyboard.press("d");
    await page.keyboard.type("0, 50, 0");
    await expect(page.locator('.view-label[data-label="joint"]')).toBeVisible();
    await holds(page, "view-label", seen);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // Show's callout, on the fixture's one warning.
    await page.getByRole("tab", { name: /^Problems/ }).click();
    await page.locator("li.problem").first().getByTestId("show").click();
    await expect(page.getByTestId("callout")).toBeVisible();
    await holds(page, "callout", seen);

    const under = seen.filter((r) => r.ratio < 4.5);
    expect(under).toEqual([]);
  });
}
