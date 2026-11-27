import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { derive } from "../derive/derive.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { projectText } from "../project/canonical.ts";
import { FIXTURES, readJson } from "../testing.ts";
import { applyBatch } from "./apply.ts";
import { stepWords } from "./history.ts";
import type { CommandEnv, RawDoc, State } from "./types.ts";

/**
 * `transform` (design §6, *2.3*; the editing audit's E-UX-3 to E-UX-5 and task E1.1). G01: b1
 * along +X from the origin, 1000 long; b2 up +Y from b1's end b, butted through b1 by c1 (cut
 * 580). The cart: posts b1–b4 of height H, top rails b5–b8, base rails b9 and b10 at Hb, the
 * slats' pattern pt1 on the base rails, a part p7 on b7 and a part p8 at a world pose.
 */

const ENV: CommandEnv = { today: "2026-11-27" };

function stateOf(dir: string): State {
  return {
    doc: readJson(join(dir, "alukit.json")) as RawDoc,
    lock: LockFile.parse(readJson(join(dir, "alukit.lock.json"))),
  };
}
const g01 = () => stateOf(join(FIXTURES, "golden-ends", "G01"));
const cart = () => stateOf(join(FIXTURES, "cart"));
const withDoc = (s: State, patch: Record<string, unknown>): State => ({
  ...s,
  doc: { ...s.doc, ...patch },
});
/** G01 plus a free brace b3 along −Y at x = 500, from y = 600 to y = 300. */
const braced = () =>
  withDoc(g01(), {
    bars: { ...(g01().doc.bars as object), b3: { a: [500, 600, 0], b: [500, 300, 0] } },
  });

function run(s: State, ...commands: object[]) {
  const r = applyBatch(s, commands, ENV);
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.failed)}`);
  return { ...r, text: stepWords({ commands, results: r.results }) };
}
function refused(s: State, ...commands: object[]) {
  const r = applyBatch(s, commands, ENV);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.failed.errors;
}
const move = (ids: string[], by: unknown[], joined?: string) => ({
  cmd: "transform",
  args: { ids, by, ...(joined ? { joined } : {}) },
});
const turn = (ids: string[], axis: string, deg: number, about: number[]) => ({
  cmd: "transform",
  args: { ids, rotate: { axis, deg, about } },
});
const bars = (s: State) => s.doc.bars as Record<string, Record<string, unknown>>;
const derived = (s: State) => derive(s.doc, lockItems(s.lock));
const errors = (s: State) =>
  derived(s)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => `${d.code} ${d.entity}`);
const diagnostics = (s: State) =>
  derived(s)
    .diagnostics.map((d) => `${d.severity} ${d.code} ${d.entity}`)
    .sort();
const canonical = (s: State) => {
  const text = projectText(s.doc);
  expect(projectText(JSON.parse(text))).toBe(text);
};

describe("transform: moving", () => {
  it("moves a free bar by an offset: one step, in words", () => {
    const r = run(braced(), move(["b3"], [100, 0, 0]));
    expect(bars(r.state).b3).toEqual({ a: [600, 600, 0], b: [600, 300, 0] });
    expect(r.text).toBe("move b3 by [100, 0, 0]");
    expect(r.results[0]?.info).toEqual({ moved: ["b3"], followed: [], freed: [], kept: [] });
    canonical(r.state);
  });

  it("keeps a param a coordinate reads: W moved by 100 is W + 100, and the words say so", () => {
    const s = withDoc(braced(), {
      params: { W: "500" },
      bars: { ...(g01().doc.bars as object), b3: { a: ["W", 600, 0], b: ["W", 300, 0] } },
    });
    const r = run(s, move(["b3"], [100, 0, 0]));
    expect(bars(r.state).b3).toEqual({ a: ["W + 100", 600, 0], b: ["W + 100", 300, 0] });
    expect(r.text).toBe("move b3 by [100, 0, 0], keeping b3.a x: W + 100");
    // A typed offset over a param is kept too.
    const d = run(withDoc(s, { params: { W: "500", D: "50" } }), move(["b3"], [0, "D", 0]));
    expect(bars(d.state).b3).toEqual({ a: ["W", "600 + D", 0], b: ["W", "300 + D", 0] });
  });

  it("moves a node as moveNode does: every bar at it follows", () => {
    const s = withDoc(g01(), {
      nodes: { n1: [1000, 0, 0] },
      bars: { b1: { a: [0, 0, 0], b: "n1" }, b2: { a: "n1", b: [1000, 600, 0] } },
      connections: {},
    });
    const r = run(s, move(["n1"], [0, 0, 100]));
    expect(r.state.doc.nodes).toEqual({ n1: [1000, 0, 100] });
    expect(bars(r.state)).toEqual(bars(s));
    expect(derived(r.state).bars.get("b2")?.placed.A).toEqual([1000, 0, 100]);
    // A bar moved alone at a shared node: follow takes the node, and b2 with it; detach leaves
    // it, writing b1's end where it goes.
    const follow = run(s, move(["b1"], [0, 0, 100]));
    expect(follow.state.doc.nodes).toEqual({ n1: [1000, 0, 100] });
    expect(follow.results[0]?.info).toMatchObject({ followed: ["b2.a"] });
    const detach = run(s, move(["b1"], [0, 0, 100], "detach"));
    expect(detach.state.doc.nodes).toEqual({ n1: [1000, 0, 0] });
    expect(bars(detach.state).b1).toEqual({ a: [0, 0, 100], b: [1000, 0, 100] });
  });

  it("moves a part on a station along its bar, and refuses to take it off", () => {
    const r = run(cart(), move(["p7"], [0, 100, 0]));
    expect((r.state.doc.parts as Record<string, { on: unknown }>).p7?.on).toEqual({
      bar: "b7",
      at_mm: 400,
      face: "+y",
    });
    expect(diagnostics(r.state)).toEqual(diagnostics(cart()));
    const [e] = refused(cart(), move(["p7"], [100, 0, 0]));
    expect(e?.message).toBe("p7 is on b7: it moves along b7 only");
  });

  it("moves a part at a world pose: its position, and under a turn its rotation", () => {
    const r = run(cart(), move(["p8"], [10, 0, 0]));
    expect((r.state.doc.parts as Record<string, { at: unknown }>).p8?.at).toEqual({
      pos: [910, 580, 128],
    });
    const t = run(cart(), turn(["p8"], "z", 90, [900, 580, 0]));
    expect((t.state.doc.parts as Record<string, { at: unknown }>).p8?.at).toEqual({
      pos: [900, 580, 128],
      rot_deg: [0, 0, 90],
    });
  });

  it("moves a pattern's template, and its copies follow", () => {
    const before = derived(cart());
    const r = run(cart(), move(["pt1"], [50, 0, 0]));
    expect(bars(r.state).b26).toMatchObject({
      a: { on: { bar: "b9", at_mm: 200 } },
      b: { on: { bar: "b10", at_mm: 200 } },
    });
    const after = derived(r.state);
    const copy = (d: typeof before) => d.bars.get("b26@2")?.placed.A;
    expect(copy(after)?.[0]).toBeCloseTo((copy(before)?.[0] ?? 0) + 50, 6);
    expect(diagnostics(r.state)).toEqual(diagnostics(cart()));
  });
});

describe("transform: what joins the moved set to the rest", () => {
  it("follow: a joined end slides along its own bar to stay on what moved", () => {
    const r = run(g01(), move(["b1"], [0, -100, 0]));
    expect(bars(r.state).b1).toEqual({ a: [0, -100, 0], b: [1000, -100, 0] });
    expect(bars(r.state).b2).toEqual({ a: [1000, -100, 0], b: [1000, 600, 0] });
    expect(r.state.doc.connections).toEqual(g01().doc.connections);
    expect(derived(r.state).bars.get("b2")?.lengths.cut).toBe(680);
    expect(r.text).toBe("move b1 by [0, -100, 0], b2.a following");
  });

  it("follow on the cart: the base rails rise, what bears on them comes along, no new problem", () => {
    const ids = ["b9", "b10", "b18", "b20", "b21", "b22", "b23"];
    const r = run(cart(), move(ids, [0, 0, 50]));
    expect(bars(r.state).b9).toMatchObject({ a: [0, 0, "Hb + 50"], b: ["W", 0, "Hb + 50"] });
    expect(diagnostics(r.state)).toEqual(diagnostics(cart()));
    expect(r.state.doc.connections).toEqual(cart().doc.connections);
    // The braces' ends at the pivots on the base rails come along, and the slats on them.
    const z = (s: State, id: string, e: "A" | "B") => derived(s).bars.get(id)?.placed[e]?.[2] ?? 0;
    expect(z(r.state, "b14", "B")).toBeCloseTo(z(cart(), "b14", "B") + 50, 6);
    expect(z(r.state, "b26@2", "A")).toBeCloseTo(z(cart(), "b26@2", "A") + 50, 6);
    expect(r.results[0]?.info).toMatchObject({
      followed: expect.arrayContaining(["b14.b", "b15.b", "b26.a", "b26.b"]),
    });
  });

  it("follow refuses a move that would break a joint, naming it; detach removes the joint", () => {
    const [e] = refused(g01(), move(["b2"], [0, 0, 100]));
    expect(e?.code).toBe("geometry");
    expect(e?.message).toContain('give joined: "detach"');
    const r = run(g01(), move(["b2"], [0, 0, 100], "detach"));
    expect(r.state.doc.connections).toEqual({});
    expect(bars(r.state).b2).toEqual({ a: [1000, 0, 100], b: [1000, 600, 100] });
    expect(r.text).toBe("move b2 by [0, 0, 100], freed from c1");
    expect(errors(r.state)).toEqual([]);
    // Moving the through bar away, detached: b2 stays, and c1 goes with its last end.
    const t = run(g01(), move(["b1"], [0, -100, 0], "detach"));
    expect(bars(t.state).b2).toEqual(bars(g01()).b2);
    expect(t.state.doc.connections).toEqual({});
  });

  it("refuses what it cannot move, saying why", () => {
    const [e] = refused(cart(), move(["p2"], [10, 0, 0]));
    expect(e?.message).toBe("p2 is not placed: there is nothing to move");
    const [f] = refused(cart(), { cmd: "transform", args: { ids: ["b1"] } });
    expect(f?.code).toBe("args");
  });
});

describe("transform: turning", () => {
  it("turns a bar a quarter turn exactly: points, and a body that is the old one turned", () => {
    const r = run(braced(), turn(["b3"], "z", 90, [500, 600, 0]));
    expect(bars(r.state).b3).toEqual({ a: [500, 600, 0], b: [800, 600, 0] });
    expect(r.text).toBe("turn b3 90° about z through [500, 600, 0]");
    // Along +X turned about Y: it points down, and its roll keeps the faces where they turned to.
    const s = withDoc(g01(), { connections: {}, bars: { b1: { a: [0, 0, 0], b: [1000, 0, 0] } } });
    const y = run(s, turn(["b1"], "y", 90, [0, 0, 0]));
    expect(bars(y.state).b1).toEqual({ a: [0, 0, 0], b: [0, 0, -1000], roll_deg: 90 });
    const f0 = derived(s).bars.get("b1")?.placed.frame;
    const f1 = derived(y.state).bars.get("b1")?.placed.frame;
    // Turning about +Y by 90°: x → −z, z → x.
    const turned = (v: readonly number[]) => [v[2] ?? 0, v[1] ?? 0, -(v[0] ?? 0)].map((x) => x + 0);
    expect(f1?.t.map((x) => x + 0)).toEqual(turned(f0?.t ?? []));
    expect(f1?.x.map((x) => x + 0)).toEqual(turned(f0?.x ?? []));
    expect(f1?.y.map((x) => x + 0)).toEqual(turned(f0?.y ?? []));
  });

  it("keeps an expression under a quarter turn, and refuses one at another angle", () => {
    const s = withDoc(braced(), {
      params: { W: "500" },
      bars: { ...(g01().doc.bars as object), b3: { a: ["W", 600, 0], b: ["W", 300, 0] } },
    });
    const q = run(s, turn(["b3"], "z", 180, [500, 600, 0]));
    expect(bars(q.state).b3).toEqual({ a: ["1000 - W", 600, 0], b: ["1000 - W", 900, 0] });
    const [e] = refused(s, turn(["b3"], "z", 30, [500, 600, 0]));
    expect(e?.code).toBe("expr");
    expect(e?.message).toContain("b3.a x is W");
    // Plain numbers turn at any angle.
    const n = run(braced(), turn(["b3"], "z", 30, [500, 600, 0]));
    expect(bars(n.state).b3).toEqual({ a: [500, 600, 0], b: [650, 340.19, 0] });
  });
});
