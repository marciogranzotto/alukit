import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type BuiltSection, buildSection, type CatalogSet } from "#catalog/link.ts";
import { BUILTIN_DIR, openCatalog } from "#catalog/open.ts";
import { capture } from "../cli/testing.ts";
import { checkModel } from "./check/check.ts";
import { applyBatch } from "./commands/apply.ts";
import { effectsOf } from "./commands/dry.ts";
import { stepWords } from "./commands/history.ts";
import { hasSymmetry, symmetries } from "./commands/sections.ts";
import type { RawDoc, State } from "./commands/types.ts";
import { type Derived, derive } from "./derive/derive.ts";
import { MACHINING_REASONS } from "./diagnostics.ts";
import { emptyLock, LockFile } from "./lock/schema.ts";
import { lockItems } from "./lock/source.ts";
import { openLiveCatalogs, openProject } from "./project/open.ts";
import { editJson, FIXTURES, mergePatch, readJson, scratchFixtures, subdirs } from "./testing.ts";

/**
 * The designer re-check's core findings (docs/ux/review-editing.md §9.4; decisions in
 * docs/ux/recheck-fixes-core-decisions.md):
 *
 * - N1: mirror and reverse judge a traced section's symmetry within its stated uncertainty, and a
 *   mirror refusal never advises a step that is refused in turn;
 * - N3: every message about a hole speaks in the hole's own reference;
 * - N5: mirror makes no twin of a bar, and the check warns of two bars in one place.
 */

const ENV = { today: "2026-11-28" };

/** The README's first run: an empty project of the built-in Forseti catalog (§12's session). */
const NEW: RawDoc = { schema: "alukit.project/1", catalogs: ["forseti"], currency: "BRL" };

/** What the start card's box frame sends for A1 (tests/e2e/editing.spec.ts's FRAME). */
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

/** A4 as the app sends it: the four legs to the 40 × 80, rolled a quarter, each anchor turned. */
const A4 = Object.entries({ b1: "-x+y", b2: "-x-y", b3: "+x+y", b4: "+x-y" }).map(
  ([id, anchor]) => ({
    cmd: "setBar",
    args: { id, set: { item: "forseti:PF40-02", roll_deg: 90, anchor } },
  }),
);

/** The built-in Forseti catalog, and the test catalog the brace fixture names, open live. */
let forseti: CatalogSet;
let test: CatalogSet;
beforeAll(async () => {
  forseti = (await openLiveCatalogs(BUILTIN_DIR, NEW)).set;
  const brace = join(FIXTURES, "brace");
  test = (await openLiveCatalogs(brace, readJson(join(brace, "alukit.json")))).set;
});

/** The live catalogs a state's document names: Forseti's or the test catalog. */
const liveFor = (s: State) =>
  (s.doc.catalogs as string[] | undefined)?.includes("forseti") ? forseti : test;

function run(state: State, ...commands: object[]) {
  const r = applyBatch(state, commands, { ...ENV, live: liveFor(state) });
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.failed)}`);
  return r;
}

function refused(state: State, command: object) {
  const r = applyBatch(state, [command], { ...ENV, live: liveFor(state) });
  expect(r.ok, JSON.stringify(command)).toBe(false);
  return r.ok ? [] : r.failed.errors;
}

const derived = (s: State): Derived => derive(s.doc, lockItems(s.lock));

/** The face of a placed bar whose outward normal is the world direction `dir`. */
function faceToward(d: Derived, bar: string, dir: readonly number[]): string {
  const f = d.bars.get(bar)?.placed.frame;
  if (!f) throw new Error(`${bar} is not placed`);
  const dot = (v: readonly number[]) => v.reduce((s, c, i) => s + c * (dir[i] as number), 0);
  const faces: [string, number][] = [
    ["+x", dot(f.x)],
    ["-x", -dot(f.x)],
    ["+y", dot(f.y)],
    ["-y", -dot(f.y)],
  ];
  return (faces.find(([, v]) => v > 0.99) as [string, number])[0];
}

/** §12's session to A6's placement: A1's frame, A4's legs, the bracket on b1's inner face at 300. */
function a6AfterA4(): State {
  const legs = run({ doc: NEW, lock: emptyLock() }, ...FRAME, ...A4).state;
  const face = faceToward(derived(legs), "b1", [1, 0, 0]);
  return run(legs, {
    cmd: "addPart",
    args: { item: "forseti:CT38-06", on: { bar: "b1", face, at_mm: 300 } },
  }).state;
}

describe("N1: symmetry within a section's stated uncertainty", () => {
  async function sections(): Promise<Map<string, BuiltSection>> {
    const opened = await openCatalog(join(BUILTIN_DIR, "forseti"), { cwd: BUILTIN_DIR });
    const out = new Map<string, BuiltSection>();
    for (const ls of opened.set.catalogs.get("forseti")?.sections.values() ?? []) {
      const s = buildSection(opened.set, ls);
      if (!("problems" in s)) out.set(s.id, s);
    }
    return out;
  }

  it("finds every traced Forseti profile's mirror symmetries, and the face plate's one", async () => {
    const all = await sections();
    const traced = [...all.values()].filter((s) => s.fidelity === "traced");
    expect(traced.map((s) => s.id).sort()).toEqual([
      "PF20-21",
      "PF30-01",
      "PF30-01F",
      "PF30-11",
      "PF40-02",
      "PF45-01",
      "PF45-11",
      "PF50-01",
    ]);
    const found = Object.fromEntries(traced.map((s) => [s.id, symmetries(s)]));
    // By their grooves and cores, as the catalogue draws them: the square profiles have all four
    // mirror lines, the 40 × 80 its two centre lines, and the face-plate 30 × 30 (a plate over
    // its top face, grooves on three faces) only its vertical centre line.
    expect(found).toEqual({
      "PF20-21": ["x", "y", "d", "a"],
      "PF30-01": ["x", "y", "d", "a"],
      "PF30-01F": ["x"],
      "PF30-11": ["x", "y", "d", "a"],
      "PF40-02": ["x", "y"],
      "PF45-01": ["x", "y", "d", "a"],
      "PF45-11": ["x", "y", "d", "a"],
      "PF50-01": ["x", "y", "d", "a"],
    });
    // Each states its uncertainty as data: the core reads it, not the note's prose.
    for (const s of traced) expect(s.uncertainty?.local_mm, s.id).toBeGreaterThan(0);
    // The exact outlines keep M1's 0.1 mm, and keep their symmetries.
    expect(symmetries(all.get("PF40-01") as BuiltSection)).toEqual(["x", "y", "d", "a"]);
    expect(symmetries(all.get("PF45-12") as BuiltSection)).toEqual(["x", "y"]);
  });

  /** A 40 × 40 square whose vertex at (20, 20) is moved `dx` outward along x. */
  function square(dx: number, fidelity: BuiltSection["fidelity"], local?: number): BuiltSection {
    const outline: [number, number][] = [
      [-20, -20],
      [20, -20],
      [20 + dx, 20],
      [-20, 20],
    ];
    const draw = { outline, holes: [] };
    return {
      id: "SQ",
      fidelity,
      props_ok: true,
      draw,
      props: draw,
      bbox_mm: [
        [-20, -20],
        [20, 20],
      ],
      grooves: [],
      datums: {},
      ...(local === undefined ? {} : { uncertainty: { overall_mm: 0.01, local_mm: local } }),
    };
  }

  it("holds an exact outline to 0.1 mm and a traced one to twice its local uncertainty", () => {
    // 0.15 mm off: beyond an exact outline's 0.1 mm, within a trace's twice 0.1 mm.
    expect(hasSymmetry(square(0.15, "exact"), "x")).toBe(false);
    expect(hasSymmetry(square(0.15, "traced", 0.1), "x")).toBe(true);
    expect(hasSymmetry(square(0.25, "traced", 0.1), "x")).toBe(false);
    // A trace never judges closer than an exact outline: 0.15 off with 0.03 stated is still off.
    expect(hasSymmetry(square(0.15, "traced", 0.03), "x")).toBe(false);
    expect(hasSymmetry(square(0.05, "traced", 0.03), "x")).toBe(true);
  });

  it("mirrors A6's bracket onto the opposite leg after A4 made the legs 40 × 80 (§12's order)", () => {
    const s = a6AfterA4();
    const r = run(s, { cmd: "mirror", args: { ids: ["p1"], plane: { axis: "x", at_mm: 500 } } });
    expect(r.results[0]?.created).toEqual(["p2"]);
    expect(r.results[0]?.info).toMatchObject({ onto: { b1: "b2" } });
    const d = derived(r.state);
    const face = faceToward(d, "b2", [-1, 0, 0]);
    expect((r.state.doc.parts as Record<string, unknown>).p2).toEqual({
      item: "forseti:CT38-06",
      on: { bar: "b2", face, at_mm: 300 },
    });
    // The image of the bracket: its origin reflected across x = 500.
    const p1 = d.parts.get("p1");
    const p2 = d.parts.get("p2");
    if (!p1?.placed || !p2?.placed) throw new Error("not placed");
    const r2 = (p: readonly number[]) => p.map((x) => Math.round(x * 100) / 100 + 0);
    expect(r2(p2.origin)).toEqual(
      r2([1000 - (p1.origin[0] as number), p1.origin[1], p1.origin[2]]),
    );
  });

  it("mirrors and reverses a 40 × 80 bar itself, keeping its item", () => {
    const s = a6AfterA4();
    const m = run(s, { cmd: "mirror", args: { ids: ["b1"], plane: { axis: "x", at_mm: 2000 } } });
    const bars = m.state.doc.bars as Record<string, Record<string, unknown>>;
    expect(bars.b17?.item).toBe("forseti:PF40-02");
    expect(bars.b17).not.toHaveProperty("opt.hand");
    const d0 = derived(s).bars.get("b1");
    const rev = run(s, { cmd: "reverseBar", args: { id: "b1" } });
    const d1 = derived(rev.state).bars.get("b1");
    // Reversed in place: the same body and cut, its design points swapped.
    expect(d1?.lengths.cut).toBeCloseTo(d0?.lengths.cut ?? Number.NaN, 9);
    expect(d1?.placed.A).toEqual(d0?.placed.B);
  });
});

describe("every machining diagnostic says which problem it is (the re-check's N10, in the core)", () => {
  // Every golden case, each of its patched cases, and the fixture projects: each machining
  // diagnostic derive gives carries its reason, which the problem list titles it by.
  const dirs = [
    ...subdirs(join(FIXTURES, "golden-ends")),
    ...subdirs(join(FIXTURES, "golden-gen")),
    ...["base-frame", "brace", "cart", "order"].map((f) => join(FIXTURES, f)),
  ];
  it.each(dirs.map((d) => [basename(d), d]))("%s", async (_, dir) => {
    const project = await openProject(dir);
    const expected = join(dir, "expected.json");
    const cases = existsSync(expected)
      ? ((readJson(expected) as { cases?: { patch: unknown }[] }).cases ?? [])
      : [];
    for (const raw of [project.raw, ...cases.map((c) => mergePatch(project.raw, c.patch))]) {
      for (const x of derive(raw, project.items).diagnostics) {
        if (x.code !== "machining") continue;
        expect(MACHINING_REASONS, x.message).toContain(x.reason);
      }
    }
  });
});

/**
 * tests/fixtures/brace, the review's plain box frame: 1000 × 600 × 750 of the test catalog's
 * 40 × 40, posts b1–b4, base b5–b8, top b9–b12, the posts running through.
 */
const brace = (): State => ({
  doc: readJson(join(FIXTURES, "brace", "alukit.json")) as RawDoc,
  lock: LockFile.parse(readJson(join(FIXTURES, "brace", "alukit.lock.json"))),
});
const mirror = (ids: string[], at: number) => ({
  cmd: "mirror",
  args: { ids, plane: { axis: "x", at_mm: at } },
});

describe("N1: a mirror refusal never advises a step that is refused", () => {
  /** A bar from 300 up b1 to a point, and one from 200 along it to another. */
  const chain = () =>
    run(
      brace(),
      { cmd: "addBar", args: { a: { on: { bar: "b1", at_mm: 300 } }, b: [300, 0, 600] } },
      { cmd: "addBar", args: { a: { on: { bar: "b13", at_mm: 200 } }, b: [300, 0, 100] } },
    ).state;

  it("advises including a bar where that mirror goes through, and the same advice works", () => {
    const s = chain();
    const [e] = refused(s, mirror(["b13"], 400));
    expect(e?.message).toBe(
      "b13/a: b1 is not mirrored, and no bar stands at its image across x = 400; include b1",
    );
    run(s, mirror(["b13", "b1"], 400));
  });

  it("names every bar the inclusion needs in turn, so the advice is one step", () => {
    const s = chain();
    // b14 stands on b13, which stands on b1: neither has a bar at its image across x = 400.
    const [e] = refused(s, mirror(["b14"], 400));
    expect(e?.message).toBe(
      "b14/a: b13 is not mirrored, and no bar stands at its image across x = 400; include b13 and b1",
    );
    expect(e?.refs).toEqual(["b13"]);
    run(s, mirror(["b14", "b13", "b1"], 400));
  });

  it("does not advise including a bar that cannot be mirrored, and says why", async () => {
    // A scratch copy of the test catalogs with an unequal angle, which has no mirror symmetry and
    // no other hand: its mirror image is another item.
    const root = await scratchFixtures();
    const open = join(root, "catalogs", "test-open");
    await editJson(join(open, "catalog.json"), (c) => {
      c.items["L-76.2x50.8x6.35"] = {
        kind: "bar",
        name: "Unequal angle 76.2x50.8x6.35 (synthetic)",
        shape: "angle",
        section: "L-76.2x50.8x6.35",
        material: "test:s235",
      };
    });
    const section = readJson(join(open, "sections", "L-76.2x6.35.json")) as Record<string, unknown>;
    await writeFile(
      join(open, "sections", "L-76.2x50.8x6.35.json"),
      JSON.stringify({
        ...section,
        id: "L-76.2x50.8x6.35",
        params: { a_mm: 76.2, b_mm: 50.8, t_mm: 6.35, r1_mm: 9.525, r2_mm: 4.76 },
      }),
    );
    const dir = join(root, "projects", "angle");
    const doc: RawDoc = {
      schema: "alukit.project/1",
      catalogs: ["../../catalogs/test", "../../catalogs/test-open"],
      defaults: { bar: { item: "test:TS40", opt: { finish: "anodised" } } },
    };
    const live = (await openLiveCatalogs(dir, doc)).set;
    const apply = (s: State, ...commands: object[]) => applyBatch(s, commands, { ...ENV, live });
    const made = apply(
      { doc, lock: emptyLock() },
      { cmd: "addBar", args: { item: "test-open:L-76.2x50.8x6.35", a: [0, 0, 0], b: [0, 0, 750] } },
      { cmd: "addBar", args: { a: { on: { bar: "b1", at_mm: 300 } }, b: [300, 0, 600] } },
    );
    if (!made.ok) throw new Error(JSON.stringify(made.failed));
    const r = apply(made.state, mirror(["b2"], 400));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const [e] = r.failed.errors;
    expect(e?.message).toBe(
      "b2/a: b1 is not mirrored, and no bar stands at its image across x = 400; mirroring b1 with it is refused too: b1: test-open:L-76.2x50.8x6.35 is not symmetric and has no other hand, so its mirror image is another item",
    );
    expect(e?.message).not.toContain("include");
  });

  it("does not advise including a bar whose image two bars already stand at", () => {
    // A second front-right post on b2: including b1 would stand a third body there.
    const s = run(
      brace(),
      { cmd: "addBar", args: { a: [1000, 0, 0], b: [1000, 0, 750], anchor: "+x-y" } },
      { cmd: "addPart", args: { item: "test:BRK-40", on: { bar: "b1", face: "+x", at_mm: 300 } } },
    ).state;
    const [e] = refused(s, mirror(["p1"], 500));
    expect(e?.message).toBe(
      "p1/on: b1 is not mirrored, and b2 and b13 both stand at its image across x = 500, one on another: remove all but one",
    );
  });
});

describe("N3: a hole's messages speak in its own reference", () => {
  /** Holes on b5, the front base rail, which the posts cut back 40 at each end. */
  const holed = (...ops: object[]) =>
    run(brace(), { cmd: "setBar", args: { id: "b5", set: { ops } } }).state;
  const messages = (s: State) =>
    derived(s)
      .diagnostics.filter((x) => x.code === "machining" && x.entity === "b5")
      .map((x) => x.message);

  it("names a tap counted from the cut by its distance from the cut, in the groove check", () => {
    // The review's case: "20 mm from end a's cut" read as "60.00 from design point a".
    const s = holed({ op: "hole", face: "-x", at_mm: 20, from: "a.cut", thread: "M6" });
    const [m] = messages(s);
    expect(m).toMatch(/^the tap M6 20\.00 from end a's cut on face -x, through: its Ø5\.00 tap/);
    expect(m).not.toContain("design point");
  });

  it("names a hole off its piece from its own reference, a design point or a cut", () => {
    // From design point a, 20 along: end a's cut is 40 in, so the Ø7 reaches 20 + 3.5 past it.
    const a = holed({ op: "hole", face: "+y", at_mm: 20, d_mm: 7 });
    expect(messages(a)).toEqual([
      "the Ø7.00 hole on face +y, 20.00 mm from design point a, reaches 23.50 mm past end a's cut face: off the piece, a shop cannot make it there",
    ]);
    // From end b's cut, 1 along: past end b's cut by 3.5 − 1.
    const b = holed({ op: "hole", face: "+y", at_mm: 1, from: "b.cut", d_mm: 7 });
    expect(messages(b)).toEqual([
      "the Ø7.00 hole on face +y, 1.00 mm from end b's cut, reaches 2.50 mm past end b's cut face: off the piece, a shop cannot make it there",
    ]);
  });

  it("keeps a hole written from design point b in its own words", () => {
    const s = holed(
      { op: "hole", face: "-x", at_mm: 100, from: "b", d_mm: 7 },
      { op: "hole", face: "-x", at_mm: 100, from: "b", d_mm: 7 },
    );
    expect(messages(s)).toEqual([
      "the Ø7.00 hole 100.00 from design point b on face -x, through is made 2 times at one place (2 written in ops): give each its own position, or make it once",
    ]);
  });
});

describe("N5: mirror makes no twin of a bar", () => {
  /** A bracket on b9, the front top rail, which crosses x = 500 symmetrically. */
  const BRACKET = {
    cmd: "addPart",
    args: { item: "test:BRK-40", on: { bar: "b9", face: "+y", at_mm: 300 } },
  };

  it("leaves out a bar that is its own image, and refuses a mirror that would make nothing", () => {
    // The review's mis-aimed menu: b9 alone, mirrored across the frame's middle.
    const [e] = refused(brace(), mirror(["b9"], 500));
    expect(e).toMatchObject({ code: "geometry", refs: ["b9"] });
    expect(e?.message).toBe(
      "b9 is its own image across x = 500: the mirror would make nothing, and a copy would stand on it",
    );
    // With a part on it, the part's image is made on b9 itself, and the words say why.
    const s = run(brace(), BRACKET).state;
    const r = run(s, mirror(["b9", "p1"], 500));
    expect(r.results[0]?.created).toEqual(["p2"]);
    expect(r.results[0]?.info).toMatchObject({ there: { b9: "b9" } });
    expect(stepWords({ commands: [mirror(["b9", "p1"], 500)], results: r.results })).toBe(
      "mirror b9 and p1, making p2; b9 is its own image",
    );
    // 300 from end b of the bar the plane reverses, turned over in its own y (§4.7).
    expect((r.state.doc.parts as Record<string, unknown>).p2).toEqual({
      item: "test:BRK-40",
      on: { bar: "b9", face: "+y", at_mm: 300, from: "b" },
      roll_deg: 180,
    });
    expect(Object.keys(r.state.doc.bars as object)).toHaveLength(12);
  });

  it("leaves out a bar whose image another bar already is", () => {
    // b11, the left top rail, mirrors onto b12, the right one.
    const [e] = refused(brace(), mirror(["b11"], 500));
    expect(e?.message).toBe(
      "b11's image across x = 500 is b12, already there: the mirror would make nothing, and a copy would stand on it",
    );
    const s = run(brace(), {
      cmd: "addPart",
      args: { item: "test:BRK-40", on: { bar: "b11", face: "+y", at_mm: 200 } },
    }).state;
    const r = run(s, mirror(["b11", "p1"], 500));
    expect(r.results[0]?.created).toEqual(["p2"]);
    expect(r.results[0]?.info).toMatchObject({ there: { b11: "b12" } });
    expect(stepWords({ commands: [mirror(["b11", "p1"], 500)], results: r.results })).toBe(
      "mirror b11 and p1, making p2; b11's image is b12",
    );
  });

  it("refuses to leave out a bar whose holes have no image on the bar already there", () => {
    const hole = (at_mm: number, from: string) => ({
      op: "hole",
      face: "+y",
      at_mm,
      from,
      d_mm: 7,
    });
    const one = run(
      brace(),
      { cmd: "setBar", args: { id: "b9", set: { ops: [hole(100, "a.cut")] } } },
      BRACKET,
    ).state;
    const [e] = refused(one, mirror(["b9", "p1"], 500));
    expect(e?.message).toBe(
      "b9 is its own image across x = 500, but its holes' images are not on it, and a mirror adds none to a bar: leave b9 out, or add them to it",
    );
    // With its holes' images on it (100 from each cut), it is left out as before.
    const both = run(
      brace(),
      { cmd: "setBar", args: { id: "b9", set: { ops: [hole(100, "a.cut"), hole(100, "b.cut")] } } },
      BRACKET,
    ).state;
    expect(run(both, mirror(["b9", "p1"], 500)).results[0]?.created).toEqual(["p2"]);
  });
});

describe("N5: the check warns of two bars in one place", () => {
  const coincident = (s: State) =>
    checkModel({ raw: s.doc, derived: derived(s), items: lockItems(s.lock) })
      .diagnostics.filter((x) => x.code === "coincident")
      .map((x) => [x.severity, x.entity, x.message, x.refs]);

  it("warns of a bar standing on another, drawn either way, and not of a bar beside it", () => {
    expect(coincident(brace())).toEqual([]);
    const twin = run(brace(), {
      cmd: "addBar",
      args: { a: [0, 0, 750], b: [1000, 0, 750], anchor: "-x+y" },
    }).state;
    expect(coincident(twin)).toEqual([
      [
        "warn",
        "b13",
        "b13 stands where b9 does: the same section on the same line, one body in one place, so the BOM counts it twice; remove one of them",
        ["b9", "b13"],
      ],
    ]);
    // Drawn from the other end, its anchor turned so the body is the same.
    const reversed = run(brace(), {
      cmd: "addBar",
      args: { a: [1000, 0, 750], b: [0, 0, 750], anchor: "+x+y" },
    }).state;
    expect(coincident(reversed).map((x) => x[1])).toEqual(["b13"]);
    // On the same line, but beside it (another anchor): two bodies, not one.
    const beside = run(brace(), {
      cmd: "addBar",
      args: { a: [0, 0, 750], b: [1000, 0, 750], anchor: "-x-y" },
    }).state;
    expect(coincident(beside)).toEqual([]);
  });

  it("alukit check, problems and the order say so, the order warning rather than reading Ready", async () => {
    const root = await scratchFixtures();
    const p = join(root, "brace");
    const twin = { cmd: "addBar", args: { a: [0, 0, 750], b: [1000, 0, 750], anchor: "-x+y" } };
    const r = await capture(["do", p, JSON.stringify([twin])]);
    expect(r.code, r.err).toBe(0);
    const check = await capture(["check", p]);
    expect(check.code).toBe(0);
    expect(check.out).toContain("b13 stands where b9 does");
    const problems = JSON.parse(
      (await capture(["problems", p, "--json", "--as-of", "2026-11-28"])).out,
    ) as {
      order: { warnings: number };
      problems: { code: string; title: string; from: string[]; rule?: string }[];
    };
    const two = problems.problems.filter((x) => x.code === "coincident");
    expect(two).toMatchObject([
      { title: "Two bars in one place at b13", from: ["check", "order"], rule: "coincident" },
    ]);
    expect(problems.order.warnings).toBeGreaterThanOrEqual(1);
    const order = JSON.parse(
      (await capture(["order", p, "--format", "json", "--as-of", "2026-11-28"])).out,
    ) as { suppliers: { reasons: { rule: string; action: string }[] }[] };
    expect(
      order.suppliers.flatMap((s) => s.reasons).filter((x) => x.rule === "coincident"),
    ).toMatchObject([{ action: "warn" }]);
  });
});

describe("a step says one outcome for each end (the re-check's follow-up to N2)", () => {
  /** A post on the base rail's top face and under the top rail at x = 300, joined to both as drawing joins it. */
  const post = () =>
    run(
      brace(),
      { cmd: "addBar", args: { a: [300, 20, 40], b: [300, 20, 710] } },
      { cmd: "autoConnect", args: { end: "b13.a", optional: true } },
      { cmd: "autoConnect", args: { end: "b13.b", optional: true } },
    ).state;
  /** The app's mirror step (src/ui/edit/batches.ts, `mirrorBatch`): an autoConnect at each image end. */
  const mirrorStep = (at: number, ends: readonly (readonly number[])[]) => [
    mirror(["b13"], at),
    ...ends.map((p) => ({ cmd: "autoConnect", args: { at: p, optional: true } })),
  ];
  /** A step's words, and the ends the dry run says the step claims. */
  function step(s: State, commands: object[]) {
    const r = run(s, ...commands);
    const claimed = effectsOf(derived(s), derived(r.state), r.results).claimed;
    return { r, words: stepWords({ commands, results: r.results }), claimed };
  }

  it("never says an end the step joins is left open", () => {
    // Across x = 400 the image stands at x = 500, and b5's and b9's images (across x = 400, where
    // no bar stands) give its joints nothing to land on: the mirror reports both ends open, and
    // the step's autoConnects join them to b5 and b9 themselves.
    const { r, words, claimed } = step(
      post(),
      mirrorStep(400, [
        [500, 20, 40],
        [500, 20, 710],
      ]),
    );
    expect(r.results[0]?.info).toMatchObject({ open: ["b14.a", "b14.b"] });
    expect(claimed).toEqual(expect.arrayContaining(["b14.a", "b14.b"]));
    expect(words).toBe("mirror b13, making b14, joined at 2 ends");
  });

  it("says an end is left open only when nothing in the step joins it", () => {
    // Only one autoConnect: b14.b stays open, and the words say so after what joined.
    const one = step(post(), mirrorStep(400, [[500, 20, 40]]));
    expect(one.claimed).not.toContain("b14.b");
    expect(one.words).toBe("mirror b13, making b14, joined at 1 end; b14.b left open");
    // The mirror alone, as `alukit do` sends it: nothing joins either end.
    const alone = step(post(), [mirror(["b13"], 400)]);
    expect(alone.words).toBe("mirror b13, making b14; b14.a and b14.b left open");
  });

  it("counts a corner's through end as joined, as the dry run claims it", () => {
    // Two free ends meeting at a point clear of the frame: the vertical runs through (the corner
    // rule's default), and the butt covers its end there as it joins the other's.
    const s = run(
      brace(),
      { cmd: "addBar", args: { a: [2000, 0, 0], b: [2000, 0, 750] } },
      { cmd: "addBar", args: { a: [2000, 0, 0], b: [2500, 0, 0] } },
    ).state;
    const { r, claimed } = step(s, [{ cmd: "autoConnect", args: { at: [2000, 0, 0] } }]);
    expect(r.results[0]?.info).toMatchObject({ through: "b13", ends: ["b14.a"], covers: "b13.a" });
    expect([...claimed].sort()).toEqual(["b13.a", "b14.a"]);
  });
});
