import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBatch } from "../commands/apply.ts";
import type { CommandEnv, RawDoc, State } from "../commands/types.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { openProject } from "../project/open.ts";
import { FIXTURES, mergePatch, readJson } from "../testing.ts";
import { derive } from "./derive.ts";

/**
 * The gaps the decided frame's ninth acceptance run found (docs/notes/f11-f12.md): a member that
 * arrives after assembly (a wall the frame is set against, a panel fitted last) could not be said
 * to arrive then, so its cover over a cross hole was an error although the tool reaches the hole
 * when the joint is made (F11); and a cross hole's face could be named only in the catalog, so a
 * project whose faces differ end to end needed a recipe per pair of faces and a butt per group of
 * ends (F12). The golden case G50 pins the faces; these tests pin the words, the refusals and the
 * edits that keep the names in step.
 */

const DIR = join(FIXTURES, "golden-gen", "G50");

async function open(dir: string, patch: unknown = {}) {
  const p = await openProject(dir);
  const raw = mergePatch(p.raw, patch);
  return derive(raw, p.items);
}

const g50 = (patch: unknown = {}) => open(DIR, patch);
const g49 = (patch: unknown = {}) => open(join(FIXTURES, "golden-gen", "G49"), patch);

const said = (d: ReturnType<typeof derive>, code: string, severity?: string) =>
  d.diagnostics
    .filter((x) => x.code === code && (severity === undefined || x.severity === severity))
    .map((x) => [x.severity, x.entity, x.message, x.refs ?? []]);

const faces = (d: ReturnType<typeof derive>, bar: string) =>
  (d.bars.get(bar)?.ops ?? [])
    .filter((o) => o.op === "hole")
    .map((o) => [o.face, (o as { across?: number }).across ?? 0]);

const QC = "connector mounts[0] test-cover:HC40 requires[0]";
const AT = "the Ø18.00 hole 25.00 from b2.a over its position (20.00, 20.00)";

describe("a cover that arrives after assembly (F11)", () => {
  it("drills the face only a member placed after assembly covers, and warns it cannot be re-tightened then", async () => {
    const d = await g50();
    expect(faces(d, "b2")).toEqual([
      ["-y", -20],
      ["+x", 20],
    ]);
    expect(said(d, "connection")).toEqual([
      [
        "warn",
        "c1",
        `${QC}: ${AT} is drilled from b2's face +x, the nearest whose mouth is clear when the joint is made, where p1, placed after assembly, stands in front of 100.0 % of its mouth, within 30.00 of the face: it cannot be re-tightened once p1 is in place`,
        ["b2", "p1"],
      ],
    ]);
  });

  it("is an error, as before, when the same wall stands with the frame", async () => {
    const d = await g50({ parts: { p1: { after_assembly: null } } });
    expect(faces(d, "b2")).toEqual([
      ["-y", -20],
      ["+y", 20],
    ]);
    expect(said(d, "connection")).toEqual([
      [
        "error",
        "c1",
        `${QC}: no face of b2 from which ${AT} reaches it is clear (+y, where b3 stands in front of 100.0 % of its mouth, within 30.00 of the face; +x, where p1 stands in front of 100.0 % of its mouth, within 30.00 of the face): it is drilled from +y, the nearest, and its mouth cannot be reached`,
        ["b2", "b3", "p1"],
      ],
    ]);
  });

  it("prefers a face no member covers to one a member placed after assembly covers", async () => {
    // The wall turned to stand 24.5 off the post's +y face, b3 gone: +y comes first in tie order,
    // but only +x stays clear for good.
    const d = await g50({
      bars: { b3: null },
      parts: { p1: { at: { pos: [300, 64.5, 0], rot_deg: [0, 0, 90] } } },
    });
    expect(faces(d, "b2")).toEqual([
      ["-y", -20],
      ["+x", 20],
    ]);
    expect(said(d, "connection")).toEqual([]);
  });

  it("takes a bar placed after assembly, and a part on it, as arriving then", async () => {
    // A 40x40 standing 2 off the post's +x face, fitted last.
    const late = { item: "test-cover:H40-B", a: [362, 20, 40], b: [362, 20, 300] };
    const bar = await g50({ parts: { p1: null }, bars: { b4: { ...late, after_assembly: true } } });
    expect(faces(bar, "b2")).toEqual([
      ["-y", -20],
      ["+x", 20],
    ]);
    expect(said(bar, "connection").map((x) => [x[0], x[3]])).toEqual([["warn", ["b2", "b4"]]]);
    // A plate on a bar 60 off the post, the plate itself 15 off it: the bar is fitted last, so
    // the plate on it is too.
    const plate = {
      item: "test-cover:HPLATE",
      on: { bar: "b4", at_mm: 25, face: "-x", off_mm: [0, 40] },
    };
    const far = { item: "test-cover:H40-B", a: [420, 20, 40], b: [420, 20, 300] };
    const onBar = await g50({
      parts: { p1: null, p2: plate },
      bars: { b4: { ...far, after_assembly: true } },
    });
    expect(faces(onBar, "b2")).toEqual([
      ["-y", -20],
      ["+x", 20],
    ]);
    expect(said(onBar, "connection").map((x) => [x[0], x[3]])).toEqual([["warn", ["b2", "p2"]]]);
    const withFrame = await g50({ parts: { p1: null, p2: plate }, bars: { b4: far } });
    expect(said(withFrame, "connection").map((x) => [x[0], x[3]])).toEqual([
      ["error", ["b2", "b3", "p2"]],
    ]);
  });

  it("counts every member over a joint made after assembly, those placed after it too", async () => {
    // The post itself is fitted after assembly, so its joint is made then, with the wall there.
    const d = await g50({ bars: { b2: { after_assembly: true } } });
    expect(faces(d, "b2")).toEqual([
      ["-y", -20],
      ["+y", 20],
    ]);
    expect(said(d, "connection")).toEqual([
      [
        "error",
        "c1",
        `${QC}: no face of b2 from which ${AT} reaches it is clear (+y, where b3 stands in front of 100.0 % of its mouth, within 30.00 of the face; +x, where p1, placed after assembly, stands in front of 100.0 % of its mouth, within 30.00 of the face): it is drilled from +y, the nearest, and its mouth cannot be reached; the joint is made after assembly, since b2 is placed after it`,
        ["b2", "b3", "p1"],
      ],
    ]);
  });

  it("orders a centre hole's faces the same way: clear for good, then clear when the joint is made", async () => {
    // G49: b3 against the post's +y face. A wall fitted last 24.5 off its -y face.
    const wall = {
      parts: { p1: { item: "project:W", at: { pos: [0, -44.5, 0] }, after_assembly: true } },
      items: {
        W: {
          kind: "placeholder",
          name: "a wall",
          bbox_mm: [
            [-500, -10, 0],
            [700, 0, 900],
          ],
        },
      },
    };
    const clear = await g49(wall);
    expect(faces(clear, "b2")).toEqual([["+x", 0]]);
    expect(said(clear, "connection")).toEqual([]);
    // +x and -x under frame members: -y, under the wall alone.
    const bar = (a: number[], b: number[]) => ({ item: "test-cover:H40-B", a, b });
    const d = await g49(
      mergePatch(wall, {
        bars: {
          b5: bar([340, -15, 45], [340, 15, 45]),
          b6: bar([260, -15, 45], [260, 15, 45]),
        },
      }),
    );
    expect(faces(d, "b2")).toEqual([["-y", 0]]);
    expect(said(d, "connection")).toEqual([
      [
        "warn",
        "c1",
        "connector requires[0]: the Ø18.00 hole 25.00 from b2.a is drilled from b2's face -y on its centre line, the nearest whose mouth is clear when the joint is made, where p1, placed after assembly, stands in front of 100.0 % of its mouth, within 30.00 of the face: it cannot be re-tightened once p1 is in place",
        ["b2", "p1"],
      ],
    ]);
  });
});

describe("a cross hole's face named on the connection (F12)", () => {
  it("names a face for every side hole at an end, over the recipe's", async () => {
    // G49's post with a recipe whose mount's hole names -x; the connection names +x.
    const recipe = { connections: { c1: { connector: "test-cover:HR-X" } } };
    expect(faces(await g49(recipe), "b2")).toEqual([["-x", 0]]);
    const named = mergePatch(recipe, { connections: { c1: { hole_faces: { "b2.a": "+x" } } } });
    const d = await g49(named);
    expect(faces(d, "b2")).toEqual([["+x", 0]]);
    expect(said(d, "connection")).toEqual([]);
    // Over the requirement's face too, and judged as a named face is: +y, under b3.
    const covered = await g49({ connections: { c1: { hole_faces: { "b2.a": "+y" } } } });
    expect(said(covered, "connection")).toEqual([
      [
        "error",
        "c1",
        "connector requires[0]: the Ø18.00 hole 25.00 from b2.a goes in from b2's face +y on its centre line, as the connection's hole_faces names it, where b3 stands in front of 100.0 % of its mouth, within 30.00 of the face: its mouth cannot be reached",
        ["b2", "b3"],
      ],
    ]);
  });

  it("names a face per hole by its position, judged with what arrives after assembly", async () => {
    const at = (face: string) => ({
      connections: { c1: { hole_faces: { "b2.a": [{ at_mm: [20, 20], face }] } } },
    });
    const later = await g50(at("+x"));
    expect(faces(later, "b2")).toEqual([
      ["-y", -20],
      ["+x", 20],
    ]);
    expect(said(later, "connection")).toEqual([
      [
        "warn",
        "c1",
        `${QC}: ${AT} goes in from b2's face +x, as the connection's hole_faces names it, where p1, placed after assembly, stands in front of 100.0 % of its mouth, within 30.00 of the face: its mouth is clear when the joint is made, but it cannot be re-tightened once p1 is in place`,
        ["b2", "p1"],
      ],
    ]);
    const frame = await g50({ ...at("+x"), parts: { p1: { after_assembly: null } } });
    expect(said(frame, "connection")).toEqual([
      [
        "error",
        "c1",
        `${QC}: ${AT} goes in from b2's face +x, as the connection's hole_faces names it, where p1 stands in front of 100.0 % of its mouth, within 30.00 of the face: its mouth cannot be reached; no face of b2 that reaches the position is clear`,
        ["b2", "p1"],
      ],
    ]);
    const y = await g50(at("+y"));
    expect(faces(y, "b2")).toEqual([
      ["-y", -20],
      ["+y", 20],
    ]);
    expect(said(y, "connection")).toEqual([
      [
        "error",
        "c1",
        `${QC}: ${AT} goes in from b2's face +y, as the connection's hole_faces names it, where b3 stands in front of 100.0 % of its mouth, within 30.00 of the face: its mouth cannot be reached; b2's face +x reaches the position clear when the joint is made, until p1 is in place`,
        ["b2", "b3"],
      ],
    ]);
  });

  it("keeps a named face its hole does not reach from, as an error, and makes no hole", async () => {
    const d = await g50({ connections: { c1: { hole_faces: { "b2.a": "-x" } } } });
    expect(faces(d, "b2")).toEqual([["-x", -20]]);
    expect(said(d, "connection")).toEqual([
      [
        "error",
        "c1",
        `${QC}: ${AT} is drilled from b2's face -x, as the connection's hole_faces names it, 60.00 from it, and is 28.00 deep: it does not reach the position, so it is not made`,
        ["b2"],
      ],
    ]);
  });

  it("refuses a face named for no end of the connection, for no hole at an end, or with no connector", async () => {
    const d = await g50({
      connections: {
        c1: {
          hole_faces: { "b3.a": "+x", "b2.a": [{ at_mm: [20, -20], face: "+x" }] },
        },
      },
    });
    expect(said(d, "connection")).toEqual([
      [
        "error",
        "c1",
        "hole_faces: no hole in b2's side at b2.a stands at (20.00, -20.00), so the face named for it is not used; its holes there stand at (-20.00, -20.00), (20.00, 20.00)",
        ["b2"],
      ],
      [
        "error",
        "c1",
        "hole_faces: b3.a is not one of c1's ends, so the face named for it is not used",
        ["b3"],
      ],
      [
        "warn",
        "c1",
        `${QC}: ${AT} is drilled from b2's face +x, the nearest whose mouth is clear when the joint is made, where p1, placed after assembly, stands in front of 100.0 % of its mouth, within 30.00 of the face: it cannot be re-tightened once p1 is in place`,
        ["b2", "p1"],
      ],
    ]);
    // A connector that drills nothing in the post's side (G43's: a tap in its end, a hole in the
    // rail), and a butt with no connector.
    const tap = await open(join(FIXTURES, "golden-gen", "G43"), {
      connections: { c1: { hole_faces: { "b2.a": "+x" } } },
    });
    expect(said(tap, "connection")).toEqual([
      [
        "error",
        "c1",
        "hole_faces: test-x:J1-SLOT drills no hole in b2's side at b2.a, so the face named for it is not used",
        ["b2"],
      ],
    ]);
    const none = await g49({
      connections: { c1: { connector: null, hole_faces: { "b2.a": "+x" } } },
    });
    expect(said(none, "connection")).toEqual([
      [
        "error",
        "c1",
        "hole_faces: c1 has no connector, so no hole in a butting bar's side to name a face for",
        [],
      ],
    ]);
  });
});

describe("hole_faces kept in step with the connection's ends (F12)", () => {
  const ENV: CommandEnv = { today: "2026-11-27" };
  const state = (patch: unknown): State => ({
    doc: mergePatch(readJson(join(DIR, "alukit.json")), patch) as RawDoc,
    lock: LockFile.parse(readJson(join(DIR, "alukit.lock.json"))),
  });
  const named = {
    connections: { c1: { hole_faces: { "b2.a": [{ at_mm: [20, 20], face: "+x" }] } } },
  };
  const conn = (s: State) => (s.doc.connections as Record<string, Record<string, unknown>>).c1;

  it("sets it with setConnection, as any connection field, and derive judges it", () => {
    const y = { "b2.a": [{ at_mm: [20, 20], face: "+y" }] };
    const r = applyBatch(
      state({}),
      [{ cmd: "setConnection", args: { id: "c1", set: { hole_faces: y } } }],
      ENV,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(conn(r.state)?.hole_faces).toEqual(y);
    const d = derive(r.state.doc, lockItems(r.state.lock));
    expect(said(d, "connection").map((x) => [x[0], x[3]])).toEqual([["error", ["b2", "b3"]]]);
    const bad = applyBatch(
      state({}),
      [{ cmd: "setConnection", args: { id: "c1", set: { hole_faces: { "b2.a": "+z" } } } }],
      ENV,
    );
    expect(bad.ok).toBe(false);
  });

  it("follows a reversed bar's end, keeping the faces and positions it names, read in its section", () => {
    const r = applyBatch(state(named), [{ cmd: "reverseBar", args: { id: "b2" } }], ENV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(conn(r.state)).toMatchObject({
      ends: ["b2.b"],
      hole_faces: { "b2.b": [{ at_mm: [20, 20], face: "+x" }] },
    });
  });

  it("drops an end's entry with the end, in a cascade and in a variant that leaves its bar out", () => {
    const x = [{ at_mm: [-20, -20], face: "-x" }];
    const two = mergePatch(named, {
      bars: { b4: { item: "test-cover:H80", a: [100, 0, 40], b: [100, 0, 640] } },
      connections: { c1: { ends: ["b2.a", "b4.a"], hole_faces: { "b4.a": x } } },
    });
    const r = applyBatch(
      state(two),
      [{ cmd: "removeEntity", args: { id: "b2", cascade: true } }],
      ENV,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(conn(r.state)?.hole_faces).toEqual({ "b4.a": x });
    expect(conn(r.state)?.ends).toEqual(["b4.a"]);
    const v = mergePatch(two, {
      bars: { b2: { only_in: ["full"] } },
      variants: { list: { full: {}, short: {} } },
    });
    const d = derive(state(v).doc, lockItems(state(v).lock), { variant: "short" });
    expect(said(d, "connection", "error")).toEqual([]);
    expect(d.doc.connections.c1).toMatchObject({ ends: ["b4.a"], hole_faces: { "b4.a": x } });
    expect(faces(d, "b4")).toEqual([
      ["-x", -20],
      ["+y", 20],
    ]);
  });
});
