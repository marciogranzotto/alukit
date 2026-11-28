import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capture } from "../cli/testing.ts";
import { checkModel } from "./check/check.ts";
import { applyBatch } from "./commands/apply.ts";
import type { RawDoc, State } from "./commands/types.ts";
import { type Derived, derive } from "./derive/derive.ts";
import { ownJoints } from "./derive/own-joints.ts";
import { LockFile } from "./lock/schema.ts";
import { lockItems } from "./lock/source.ts";
import { FIXTURES, readJson, scratchFixtures } from "./testing.ts";

/**
 * The designer review's three blockers (docs/ux/review-editing.md B1–B3), each a cut list or a
 * BOM that went wrong with no warning, on the audit's box frame (`tests/fixtures/brace`: 1000 ×
 * 600 × 750 of the test catalog's 40 × 40, posts b1–b4, base b5–b8, top b9–b12, butts c1–c8).
 *
 * - B1: a pattern's copies carry the joints that cut the template (design §4.7).
 * - B2: a mirrored bar keeps its joints, landed on the bars at their images (§6, `mirror`).
 * - B3: an end lying on a bar's face butts on that bar, and an end left so is an open end (§4.5,
 *   §5.5).
 *
 * By hand: the base rails' inner faces stand at y = 40 (b5) and y = 560 (b6), so a slat between
 * them is cut 520; a rail between the back posts' inner faces, x = 40 and x = 960, is cut 920.
 * The brace from [0, 600, 100] to [1000, 600, 650] runs along t = (1000, 0, 550) / 1141.27 and
 * meets the posts' inner faces 920 apart along x: 920 / (1000 / 1141.27) = 1049.97.
 */

const ENV = { today: "2026-11-27" };
const dir = join(FIXTURES, "brace");
const frame = (): State => ({
  doc: readJson(join(dir, "alukit.json")) as RawDoc,
  lock: LockFile.parse(readJson(join(dir, "alukit.lock.json"))),
});

function ok(state: State, ...commands: object[]) {
  const r = applyBatch(state, commands, ENV);
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.failed)}`);
  return r;
}

const derived = (s: State): Derived => derive(s.doc, lockItems(s.lock));
const check = (s: State) => {
  const d = derived(s);
  return checkModel({ raw: s.doc, derived: d, items: lockItems(s.lock) }).diagnostics;
};
const cut = (d: Derived, id: string) => Math.round((d.bars.get(id)?.lengths.cut ?? 0) * 100) / 100;
const by = (d: Derived, id: string) => {
  const b = d.bars.get(id);
  return [b?.ends.a.by, b?.ends.b.by];
};
const notInfo = (s: State) => check(s).filter((x) => x.severity !== "info");

/** A slat across the base ring at x = 200, its bottom face on the rails' (A8's, on the shelf). */
const SLAT = [
  { cmd: "addBar", args: { a: [200, 0, 0], b: [200, 600, 0], anchor: "-y" } },
  { cmd: "autoConnect", args: { at: [200, 0, 0], optional: true } },
  { cmd: "autoConnect", args: { at: [200, 600, 0], optional: true } },
];
/** The audit's A5 brace, in the back plane, as the draw tool sends it typed. */
const BRACE = [
  { cmd: "addBar", args: { a: [0, 600, 100], b: [1000, 600, 650], anchor: "+x" } },
  { cmd: "autoConnect", args: { at: [0, 600, 100], optional: true } },
  { cmd: "autoConnect", args: { at: [1000, 600, 650], optional: true } },
];
/** A rail clicked from the back-left post's inner face to the back-right post's, at 560 up. */
const FACE_RAIL = {
  cmd: "addBar",
  args: {
    a: { on: { bar: "b3", at_mm: 560, face: "+x" } },
    b: { on: { bar: "b4", at_mm: 560, face: "-x" } },
  },
};
/** What the draw tool sends after it: a join at each end, at the snapped point's coordinates. */
const FACE_JOINS = [
  { cmd: "autoConnect", args: { at: [40, 580, 560], optional: true } },
  { cmd: "autoConnect", args: { at: [960, 580, 560], optional: true } },
];

describe("B1: a pattern's copies carry the joints that cut its template", () => {
  it("four slats, each cut 520 and joined at both ends by its copy of the slat's butts", () => {
    const s = ok(frame(), ...SLAT, {
      cmd: "addPattern",
      args: { template: ["b13"], along: "b5", pitch_mm: 150, count: 4 },
    }).state;
    const d = derived(s);
    expect(by(d, "b13")).toEqual(["c9", "c10"]);
    for (const k of [1, 2, 3]) {
      expect(cut(d, `b13@${k}`), `b13@${k}`).toBe(520);
      expect(by(d, `b13@${k}`)).toEqual([`c9@${k}`, `c10@${k}`]);
    }
    expect(cut(d, "b13")).toBe(520);
    expect(notInfo(s)).toEqual([]);
  });

  it("a template's own joints are those that claim only its bars' ends", () => {
    const conns = frame().doc.connections as Record<string, unknown>;
    // c1 butts b5.a and b7.a through b1: b5 alone does not own it, b5 with b7 does.
    expect(ownJoints(conns, new Set(["b5"]))).toEqual([]);
    expect(ownJoints(conns, new Set(["b5", "b7"]))).toEqual(["c1"]);
    // A post owns none: the rails' ends butt on it, and claiming its end is the rails' butt's.
    expect(ownJoints(conns, new Set(["b1"]))).toEqual([]);
    const withSlat = ok(frame(), ...SLAT).state.doc.connections as Record<string, unknown>;
    expect(ownJoints(withSlat, new Set(["b13"]))).toEqual(["c9", "c10"]);
  });

  it("explodePattern and array make the copies' joints too, as derive does", () => {
    const s = ok(frame(), ...SLAT, {
      cmd: "addPattern",
      args: { template: ["b13"], along: "b5", pitch_mm: 150, count: 4 },
    }).state;
    const before = derived(s);
    const x = ok(s, { cmd: "explodePattern", args: { id: "pt1" } });
    expect(x.results[0]?.created).toEqual([
      "b14",
      "c11",
      "c12",
      "b15",
      "c13",
      "c14",
      "b16",
      "c15",
      "c16",
    ]);
    const after = derived(x.state);
    for (const [k, id] of [
      [1, "b14"],
      [2, "b15"],
      [3, "b16"],
    ] as const) {
      expect(cut(after, id)).toBe(cut(before, `b13@${k}`));
      expect(after.bars.get(id)?.placed.A).toEqual(before.bars.get(`b13@${k}`)?.placed.A);
    }
    expect(by(after, "b14")).toEqual(["c11", "c12"]);
    expect(notInfo(x.state)).toEqual([]);

    const a = ok(ok(frame(), ...SLAT).state, {
      cmd: "array",
      args: { ids: ["b13"], along: "b5", pitch_mm: 150, count: 3 },
    });
    expect(a.results[0]?.created).toEqual(["b14", "c11", "c12", "b15", "c13", "c14"]);
    expect(a.results[0]?.info).toEqual({
      joined: { c11: "b5", c12: "b6", c13: "b5", c14: "b6" },
    });
    const da = derived(a.state);
    expect([cut(da, "b14"), cut(da, "b15")]).toEqual([520, 520]);
    expect(notInfo(a.state)).toEqual([]);
  });
});

describe("B2: a mirrored bar keeps its joints", () => {
  it("the A5 brace mirrored across x = 500 is cut as the brace, butted on the opposite posts", () => {
    const braced = ok(frame(), ...BRACE).state;
    expect(cut(derived(braced), "b13")).toBe(1049.97);
    const m = ok(braced, {
      cmd: "mirror",
      args: { ids: ["b13"], plane: { axis: "x", at_mm: 500 } },
    });
    expect(m.results[0]?.created).toEqual(["b14", "c11", "c12"]);
    expect(m.results[0]?.info).toMatchObject({ joined: { c11: "b4", c12: "b3" } });
    const conns = m.state.doc.connections as Record<string, unknown>;
    expect(conns.c11).toEqual({ type: "butt", through: "b4", ends: ["b14.a"] });
    expect(conns.c12).toEqual({ type: "butt", through: "b3", ends: ["b14.b"] });
    const d = derived(m.state);
    expect(cut(d, "b14")).toBe(1049.97);
    expect(by(d, "b14")).toEqual(["c11", "c12"]);
    expect(notInfo(m.state)).toEqual([]);
  });

  it("a joint whose bar has no image is left out, and the image's end is reported open", () => {
    // Across y = 0 the posts' images stand in the open: nothing for the copies of c9 and c10.
    const braced = ok(frame(), ...BRACE).state;
    const m = ok(braced, { cmd: "mirror", args: { ids: ["b13"], plane: { axis: "y", at_mm: 0 } } });
    expect(m.results[0]?.created).toEqual(["b14"]);
    expect(m.results[0]?.info).toMatchObject({ open: ["b14.a", "b14.b"] });
  });
});

describe("B3: an end lying on a bar's face butts on that bar", () => {
  it("a rail clicked between the back posts' inner faces butts on both, cut 920", () => {
    const r = ok(frame(), FACE_RAIL, ...FACE_JOINS);
    expect(r.results.slice(1).map((x) => x.info)).toEqual([
      { through: "b3", ends: ["b13.a"] },
      { through: "b4", ends: ["b13.b"] },
    ]);
    const d = derived(r.state);
    expect(cut(d, "b13")).toBe(920);
    expect(by(d, "b13")).toEqual(["c9", "c10"]);
    expect(notInfo(r.state)).toEqual([]);
  });

  it("an end resting along a face, or meeting a bar's end, is not taken for one on its face", () => {
    // A strip lying on the front base rail's top: its end is on the face, its line along it.
    const strip = ok(frame(), {
      cmd: "addBar",
      args: { a: [300, 20, 40], b: [700, 20, 40], anchor: "-y" },
    }).state;
    const r = ok(strip, { cmd: "autoConnect", args: { end: "b13.a", optional: true } });
    expect(r.results[0]?.info).toEqual({
      skipped: "only b13 meets at that point: nothing butts on it",
    });
    expect(check(strip).filter((x) => x.code === "unconnected")).toEqual([]);
    // The rectangle's corners still follow the corner rule (BE-5): a rail's end at a post's end
    // is a corner, not an end on the post's face.
    const conns = frame().doc.connections as Record<string, { through?: string }>;
    expect(conns.c1?.through).toBe("b1");
  });

  it("a block's end a bar butts on is that joint's, not an open end in the bar it meets (G35)", () => {
    // G35's 40 × 80 bears on the 80 × 80 block's end b, cut on it: the block's end lies in the
    // 40 × 80's design segment, but past its cut, and the butt names it as its through member.
    const g35 = join(FIXTURES, "golden-gen", "G35");
    const s: State = {
      doc: readJson(join(g35, "alukit.json")) as RawDoc,
      lock: LockFile.parse(readJson(join(g35, "alukit.lock.json"))),
    };
    expect(check(s).filter((x) => x.code === "unconnected")).toEqual([]);
  });

  it("the check calls an end on a face, or run into a bar, open, and its fix joins it", () => {
    const rail = ok(frame(), FACE_RAIL).state;
    const open = check(rail).filter((x) => x.code === "unconnected");
    expect(open.map((x) => [x.severity, x.entity, x.message, x.refs])).toEqual([
      ["warn", "b13.a", "b13.a lies on b3's +x face with no connection", ["b13.a", "b3"]],
      ["warn", "b13.b", "b13.b lies on b4's -x face with no connection", ["b13.b", "b4"]],
    ]);
    // A slat drawn into the rails and left unjoined runs into each by its own width.
    const slat = ok(frame(), SLAT[0] as object).state;
    expect(
      check(slat)
        .filter((x) => x.code === "unconnected")
        .map((x) => x.message),
    ).toEqual([
      "b13.a runs 40 mm into b5, past its +x face, with no connection",
      "b13.b runs 40 mm into b6, past its -x face, with no connection",
    ]);
  });
});

describe("the CLI: the same commands, the same joins, and an order that warns of an open end", () => {
  let scratch: string;
  beforeAll(async () => {
    scratch = await scratchFixtures();
  });
  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("alukit do mirror joins the brace's image; problems and the order warn of a floating rail", async () => {
    const p = join(scratch, "brace");
    const step = async (batch: object[]) => {
      const r = await capture(["do", p, JSON.stringify(batch)]);
      expect(r.code, r.err).toBe(0);
    };
    await step(BRACE);
    await step([{ cmd: "mirror", args: { ids: ["b13"], plane: { axis: "x", at_mm: 500 } } }]);
    const cuts = JSON.parse((await capture(["cutlist", p, "--format", "json"])).out) as {
      pieces?: unknown;
    };
    expect(JSON.stringify(cuts)).not.toContain("1141.27");

    await step([FACE_RAIL]);
    const problems = JSON.parse(
      (await capture(["problems", p, "--json", "--as-of", "2026-11-27"])).out,
    ) as {
      order: { status: string; warnings: number };
      problems: {
        code: string;
        title: string;
        from: string[];
        rule?: string;
        fixes: { label: string; commands?: unknown[] }[];
      }[];
    };
    const open = problems.problems.filter((x) => x.code === "unconnected");
    expect(open.map((x) => x.title)).toEqual([
      "Open end: b15.a lies on b3 with no connection",
      "Open end: b15.b lies on b4 with no connection",
    ]);
    expect(open.every((x) => x.from.includes("order") && x.rule === "unconnected")).toBe(true);
    expect(problems.order.warnings).toBeGreaterThanOrEqual(2);
    const order = JSON.parse(
      (await capture(["order", p, "--format", "json", "--as-of", "2026-11-27"])).out,
    ) as { suppliers: { reasons: { rule: string; action: string }[] }[] };
    expect(
      order.suppliers.flatMap((s) => s.reasons).filter((r) => r.rule === "unconnected"),
    ).toMatchObject([{ action: "warn" }, { action: "warn" }]);

    // Each fix is one step that clears its warning.
    for (const x of open) {
      const fix = x.fixes.find((f) => f.label === "Join with the default butt");
      expect(fix?.commands).toBeDefined();
      await step(fix?.commands as object[]);
    }
    const after = JSON.parse((await capture(["check", p, "--json"])).out) as {
      diagnostics: { code: string }[];
    };
    expect(after.diagnostics.filter((x) => x.code === "unconnected")).toEqual([]);
  });
});
