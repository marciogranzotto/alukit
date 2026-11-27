import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capture } from "../cli/testing.ts";
import { checkModel } from "./check/check.ts";
import { modelOutputs, outputAccessors } from "./check/outputs.ts";
import { type Derived, derive } from "./derive/derive.ts";
import { openProject } from "./project/open.ts";
import { readJson, scratchFixtures } from "./testing.ts";

/**
 * The editing audit's brace (docs/ux/editing-audit.md §3.4, D3 and D4; E1.2): a box frame of
 * 40 × 40, 1000 × 600 × 750, made by the box frame tool (`tests/fixtures/brace`), and a diagonal
 * drawn in its back plane from the bottom-left corner to the top-right one, joined at both ends:
 * `brace.json` is the draw tool's batch, the bar and one optional `autoConnect` per end. The
 * brace's anchor sets its section in the frame's plane (its +x face on the back face).
 *
 * Each corner is joined already: its rails butt through its post, and the post's end is claimed
 * as that butt's through end. So the brace's end is the only free end there, and the corner's
 * post is what it butts on (E-UX-12): a butt of its own through the post, which leaves the post's
 * end to the corner's butt. It meets the post's inside face at 36.87° (tan = 750 / 1000), so the
 * same step declares the end's cut an angle (E-UX-11).
 *
 * By hand: the posts' inside faces stand at x = 40 and x = 960, both square to x, so every edge
 * of the brace runs between them along t = (0.8, 0, 0.6): its cut is 920 / 0.8 = 1150 mm, and
 * each end is cut at acos(0.8) = 36.87°.
 */

let scratch: string;
beforeAll(async () => {
  scratch = await scratchFixtures();
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function derived(dir: string): Promise<{ d: Derived; check: ReturnType<typeof checkModel> }> {
  const p = await openProject(dir);
  const d = derive(p.raw, p.items);
  const check = checkModel({
    raw: p.raw,
    derived: d,
    items: p.items,
    accessors: outputAccessors(modelOutputs(d, p.items)),
  });
  return { d, check };
}

describe("a brace drawn corner to corner on the box frame, and joined", () => {
  it("joins both ends through the corners' posts, its cuts declared, with no error", async () => {
    const dir = join(scratch, "brace");
    const before = await derived(dir);
    const r = await capture(["do", dir, "-f", join(dir, "brace.json"), "--json"]);
    expect(r.code, r.err).toBe(0);
    const answer = JSON.parse(r.out) as {
      results: { cmd: string; created: string[]; changed: string[]; info?: unknown }[];
    };
    expect(answer.results.map((x) => [x.cmd, x.created, x.changed, x.info])).toEqual([
      ["addBar", ["b13"], [], undefined],
      ["autoConnect", ["c9"], ["b13"], { through: "b3", ends: ["b13.a"], angled: ["b13.a"] }],
      ["autoConnect", ["c10"], ["b13"], { through: "b4", ends: ["b13.b"], angled: ["b13.b"] }],
    ]);

    const doc = readJson(join(dir, "alukit.json")) as {
      bars: Record<string, { ends?: unknown }>;
      connections: Record<string, unknown>;
    };
    // The corners' butts are untouched: each post's end stays theirs.
    expect(doc.connections.c3).toEqual({ type: "butt", through: "b3", ends: ["b6.a", "b7.b"] });
    expect(doc.connections.c9).toEqual({
      type: "butt",
      through: "b3",
      ends: ["b13.a"],
      through_end: "none",
    });
    expect(doc.connections.c10).toEqual({
      type: "butt",
      through: "b4",
      ends: ["b13.b"],
      through_end: "none",
    });
    expect(doc.bars.b13?.ends).toEqual({ a: { cut: "angle" }, b: { cut: "angle" } });

    const after = await derived(dir);
    const loud = after.check.diagnostics.filter((x) => x.severity !== "info");
    expect(loud).toEqual([]);
    const brace = after.d.bars.get("b13");
    expect(brace?.lengths.cut).toBeCloseTo(1150, 6);
    for (const e of ["a", "b"] as const) {
      expect(brace?.ends[e].angle).toBeCloseTo(36.8699, 3);
      expect(brace?.ends[e].by).toBe(e === "a" ? "c9" : "c10");
    }
    // The frame's own cuts do not move.
    for (const [id, b] of before.d.bars) {
      expect(after.d.bars.get(id)?.lengths.cut, id).toBe(b.lengths.cut);
    }
  });
});
