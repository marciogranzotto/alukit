import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { exampleCommands, workedExample } from "../../src/cli/skill-example.ts";
import { cli, type Served, scratchProject, serve } from "./helpers.ts";
import { coverage, decodePng, differing, type Image } from "./png.ts";

/**
 * `alukit snapshot` (design §7.3, M5's command, built with M4b's views): a named view rendered
 * in headless Chromium from a fresh page on the project's server, the running one or an
 * ephemeral one. Deterministic enough for tests: a fixed size, a named view, no animation.
 */

/** Pixels allowed to differ between two snapshots of the same state (antialiasing aside). */
const SAME = 0.002;

async function shot(dir: string, out: string, ...extra: string[]) {
  const r = await cli(["snapshot", dir, "-o", out, "--size", "800x500", ...extra]);
  return { ...r, png: r.code === 0 ? decodePng(await readFile(out)) : undefined };
}

test("renders a non-blank PNG of the size asked for; the same state twice gives the same image", async () => {
  test.setTimeout(120_000);
  const p = await scratchProject("cart");
  try {
    const a = await shot(p.dir, join(p.dir, "a.png"));
    expect(a.code, a.err).toBe(0);
    expect(a.out).toContain("800x500, view iso, from an ephemeral server");
    const img = a.png as Image;
    expect([img.width, img.height]).toEqual([800, 500]);
    // The background is not everything: the grid and the cart are drawn.
    expect(coverage(img)).toBeGreaterThan(0.1);

    const b = await shot(p.dir, join(p.dir, "b.png"), "--view", "iso");
    expect(b.code, b.err).toBe(0);
    const twice = differing(img, b.png as Image);
    test.info().annotations.push({ type: "pixels", description: `twice: ${twice} differ` });
    expect(twice).toBeLessThanOrEqual(SAME);

    // Another view is another picture; an unknown one is an error.
    const top = await shot(p.dir, join(p.dir, "top.png"), "--view", "top");
    expect(top.code, top.err).toBe(0);
    expect(differing(img, top.png as Image)).toBeGreaterThan(0.05);
    const none = await shot(p.dir, join(p.dir, "x.png"), "--view", "nope");
    expect(none.code).toBe(1);
    expect(none.err).toContain('no view named "nope"');
    const bad = await cli(["snapshot", p.dir, "-o", join(p.dir, "y.png"), "--size", "big"]);
    expect(bad.code).toBe(2);
  } finally {
    await p.remove();
  }
});

test("the skill's worked example runs whole, as written, and its snapshot shows the table", async () => {
  test.setTimeout(180_000);
  // The unit suite runs the example but its snapshot, which needs the built app (skill.test.ts).
  const skill = await readFile(
    fileURLToPath(new URL("../../skills/alukit/SKILL.md", import.meta.url)),
    "utf8",
  );
  const dir = await mkdtemp(join(tmpdir(), "alukit-e2e-skill-"));
  try {
    const shots: string[][] = [];
    for (const words of exampleCommands(workedExample(skill))) {
      const args = words.slice(1);
      const r = await cli(args, dir);
      expect(r.code, `alukit ${args.join(" ")}\n${r.err}`).toBe(0);
      if (args[0] === "snapshot") shots.push(args);
    }
    expect(shots).toHaveLength(1);
    // As the skill says: 1600 x 1000 at the iso view, the table drawn over the background.
    const img = decodePng(await readFile(join(dir, "table", "exports", "table.png")));
    expect([img.width, img.height]).toEqual([1600, 1000]);
    expect(coverage(img)).toBeGreaterThan(0.1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

let served: Served;
test.describe("with a server running", () => {
  test.beforeEach(async () => {
    served = await serve("cart");
  });
  test.afterEach(async () => {
    await served.stop();
  });

  test("renders on it, the same image as an ephemeral server's, and a view the document names", async () => {
    test.setTimeout(120_000);
    const p = await scratchProject("cart");
    try {
      const ephemeral = await shot(p.dir, join(p.dir, "e.png"));
      expect(ephemeral.code, ephemeral.err).toBe(0);
      const running = await shot(served.dir, join(p.dir, "r.png"));
      expect(running.code, running.err).toBe(0);
      expect(running.out).toContain("from the running server");
      // One code path: the user's tab, camera and selection play no part.
      const across = differing(ephemeral.png as Image, running.png as Image);
      test.info().annotations.push({ type: "pixels", description: `servers: ${across} differ` });
      expect(across).toBeLessThanOrEqual(SAME);

      // A view the document names (§4.2), saved through the server like any edit.
      const view = { pos: [600, -2500, 450], target: [600, 300, 450] };
      const saved = await cli([
        "do",
        served.dir,
        JSON.stringify({ cmd: "saveView", args: { name: "front-low", view } }),
      ]);
      expect(saved.code, saved.err).toBe(0);
      const named = await shot(served.dir, join(p.dir, "n.png"), "--view", "front-low");
      expect(named.code, named.err).toBe(0);
      expect(differing(running.png as Image, named.png as Image)).toBeGreaterThan(0.05);
      const again = await shot(served.dir, join(p.dir, "n2.png"), "--view", "front-low");
      expect(differing(named.png as Image, again.png as Image)).toBeLessThanOrEqual(SAME);
    } finally {
      await p.remove();
    }
  });
});
