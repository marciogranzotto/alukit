import { expect, test } from "@playwright/test";
import { failures, PAIRS, rgbToHex } from "../../src/ui/theme/contrast.ts";
import { openTab, type Served, serve } from "./helpers.ts";

/**
 * The theme and the fonts (docs/ux/plan.md D-UX-21, D-UX-22, S4.1 and S4.11): the app follows the
 * system's scheme with a switch that overrides it, every text token pair keeps its WCAG ratio in
 * both themes as the running app computes it, IBM Plex loads from the app's own origin, and the
 * page's policy refuses nothing.
 */

let served: Served;
test.beforeEach(async () => {
  served = await serve("cart");
});
test.afterEach(async () => {
  await served.stop();
});

/** Every colour token as the page computes it, as `#rrggbb`: a probe element per token. */
async function tokens(page: import("@playwright/test").Page): Promise<Record<string, string>> {
  const names = [...new Set(PAIRS.flatMap((p) => [p.fg, ...p.on]))];
  const computed = await page.evaluate((list) => {
    const out: Record<string, string> = {};
    for (const n of list) {
      const el = document.createElement("div");
      el.style.color = `var(--${n})`;
      document.body.append(el);
      out[n] = getComputedStyle(el).color;
      el.remove();
    }
    return out;
  }, names);
  return Object.fromEntries(
    Object.entries(computed).map(([k, v]) => [k, rgbToHex(v) ?? `unreadable ${v}`]),
  );
}

test("follows the system's scheme, and the switch overrides it and is remembered", async ({
  page,
}) => {
  const root = page.locator("html");
  await openTab(page, served, 0);
  // The e2e config pins the system to dark (D-UX-21).
  await expect(root).toHaveAttribute("data-theme", "dark");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "dark");

  const sw = page.getByTestId("theme-switch");
  await sw.selectOption("light");
  await expect(root).toHaveAttribute("data-theme", "light");
  // A choice beats the system's scheme, and survives a reload.
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(sw).toHaveValue("light");
  await sw.selectOption("system");
  await expect(root).toHaveAttribute("data-theme", "dark");
});

test("a snapshot page is pinned dark, light only when asked", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const at = new URL(served.appUrl);
  for (const [query, theme] of [
    ["snapshot=iso", "dark"],
    ["snapshot=iso&theme=light", "light"],
  ] as const) {
    at.search = query;
    await page.goto(at.href);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
});

for (const theme of ["dark", "light"] as const) {
  test(`every text and status pair holds its contrast ratio in the ${theme} theme`, async ({
    page,
  }) => {
    await openTab(page, served, 0);
    await page.getByTestId("theme-switch").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const value = await tokens(page);
    const unreadable = Object.entries(value).filter(([, v]) => !v.startsWith("#"));
    expect(unreadable).toEqual([]);
    expect(failures((t) => value[t] as string)).toEqual([]);
  });
}

test("IBM Plex loads from the app's own origin, and the policy refuses nothing", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || /content security policy/i.test(m.text())) problems.push(m.text());
  });
  const fonts: string[] = [];
  page.on("response", (r) => {
    if (/\.woff2(\?|$)/.test(r.url())) fonts.push(r.url());
  });
  await openTab(page, served, 0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('13px "IBM Plex Sans"'))).toBe(true);
  // Every weight the app sets loads on demand: ask for each, and they are all there.
  for (const w of [400, 500, 600]) {
    await page.evaluate((x) => document.fonts.load(`${x} 13px "IBM Plex Sans"`), w);
    expect(await page.evaluate((x) => document.fonts.check(`${x} 13px "IBM Plex Sans"`), w)).toBe(
      true,
    );
  }
  // The body is set in it, and every file came from the server's origin (never a data: URI).
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(
    "IBM Plex Sans",
  );
  expect(fonts.length).toBeGreaterThan(0);
  const origin = new URL(served.appUrl).origin;
  for (const f of fonts) expect(new URL(f).origin).toBe(origin);
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType("resource").some((e) => e.name.startsWith("data:")),
    ),
  ).toBe(false);
  // Nothing the Content-Security-Policy refused, nothing thrown, nothing logged.
  expect(problems).toEqual([]);
});
