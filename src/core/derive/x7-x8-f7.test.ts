import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectorItem } from "#catalog/schema/items.ts";
import { catalogItems, type ItemSource } from "../items.ts";
import { openLiveCatalogs, openProject } from "../project/open.ts";
import { FIXTURES, mergePatch } from "../testing.ts";
import { derive } from "./derive.ts";
import { headRoom } from "./hardware.ts";

/**
 * The gaps the round-3 acceptance found (docs/notes/x7-x8-f7.md): an access hole placed at its
 * connector's core (X7), a connector's own head seated under the lips, its dome read from its dims
 * (X8), and a far-face head seated only round the hole F2 makes (F7). The golden cases G46–G48 pin
 * the numbers; these tests pin the words, the refusals and the edge cases.
 */

async function project(name: string, patch: unknown = {}) {
  const p = await openProject(join(FIXTURES, "golden-gen", name));
  const raw = mergePatch(p.raw, patch);
  return { open: p.diagnostics, d: derive(raw, p.items) };
}

const said = (d: ReturnType<typeof derive>, code: string, severity?: string) =>
  d.diagnostics
    .filter((x) => x.code === code && (severity === undefined || x.severity === severity))
    .map((x) => [x.severity, x.entity, x.message]);

const holes = (d: ReturnType<typeof derive>, bar: string) =>
  (d.bars.get(bar)?.ops ?? []).filter((o) => o.op === "hole");

const conn = (c: string) => ({ connections: { c1: { connector: `test-qc:${c}` } } });

describe("an access hole at its connector's core (X7)", () => {
  it("loads a butting-side hole with positions", async () => {
    const { open } = await project("G46");
    expect(open).toEqual([]);
  });

  it("drills each position's hole from the butting bar's face nearest it, over the position", async () => {
    const { d } = await project("G46");
    expect(d.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    expect(holes(d, "b2")).toEqual([
      { op: "hole", face: "-y", from: "a", at: 25, across: -20, d: 18, depth: 28, by: "c1" },
      { op: "hole", face: "+y", from: "a", at: 25, across: 20, d: 18, depth: 28, by: "c1" },
    ]);
  });

  it("brings a connector's own machining to each hole of the recipe's mount that holds it", async () => {
    const { d } = await project("G46", conn("QC-2"));
    expect(d.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    expect(holes(d, "b2")).toEqual([
      { op: "hole", face: "-y", from: "a", at: 25, across: -20, d: 18, depth: 28, by: "c1" },
      { op: "hole", face: "+y", from: "a", at: 25, across: 20, d: 18, depth: 28, by: "c1" },
    ]);
    expect(d.hardware).toEqual([{ item: "test-qc:QC40", opt: {}, qty: 2, source: "c1" }]);
  });

  it("keeps an unplaced hole on +y at the centre line, as a connector as sold makes it", async () => {
    const { d } = await project("G46", {
      bars: { b1: { item: "test-qc:Q40" }, b2: { item: "test-qc:Q40", a: [300, 0, 20] } },
      ...conn("QC40"),
    });
    expect(holes(d, "b2")).toEqual([
      { op: "hole", face: "+y", from: "a", at: 25, d: 18, depth: 28, by: "c1" },
    ]);
  });

  it("puts a 40x80's two holes on its two 40-wide faces, one over each core", async () => {
    const { d } = await project("G46", {
      bars: { b2: { item: "test-qc:Q4080" } },
      ...conn("QC-4080"),
    });
    expect(holes(d, "b2")).toEqual([
      { op: "hole", face: "-y", from: "a", at: 25, d: 18, depth: 28, by: "c1" },
      { op: "hole", face: "+y", from: "a", at: 25, d: 18, depth: 28, by: "c1" },
    ]);
  });

  it("refuses a hole too shallow to reach its position, one off the end, and a mount off the joint's plane", async () => {
    const short = (await project("G46", conn("QH-SHORT"))).d;
    expect(said(short, "connection")).toEqual([
      [
        "error",
        "c1",
        "connector requires[0]: the Ø18.00 hole 25.00 from b2.a over its position (20.00, 20.00) is drilled from b2's face +y, the nearest, 20.00 from it, and is 15.00 deep: it does not reach the position, so it is not made",
      ],
    ]);
    expect(holes(short, "b2")).toEqual([]);
    const off = (await project("G46", conn("QH-OFF"))).d;
    expect(said(off, "connection")).toEqual([
      [
        "error",
        "c1",
        "connector requires[0]: a position falls off b2.a's end (80.00 x 80.00): (50.00, 0.00)",
      ],
    ]);
    const tilted = (await project("G46", conn("QC-2-TILTED"))).d;
    expect(said(tilted, "connection")).toEqual([
      [
        "error",
        "c1",
        "connector mounts[0]: test-qc:QC40 in its fastener set sits at each of its holes, but the mount's plane is not square to the connector's z, so its holes are no place in the joint's plane: test-qc:QC40's machining and head are not placed",
      ],
    ]);
    expect(holes(tilted, "b2")).toEqual([]);
  });

  it("refuses a connector in a set that has fastener sets of its own, which v1 does not bring", async () => {
    const { d } = await project("G46", conn("QNEST-BRACKET"));
    expect(said(d, "connection")).toEqual([
      [
        "error",
        "c1",
        "connector mounts[0]: test-qc:QBRACKET in its fastener set has fastener sets of its own, which v1 does not bring for a connector in a set: write its parts into the outer connector's set",
      ],
    ]);
  });
});

describe("a connector's own head under the lips (X8)", () => {
  it("seats a quick connector's domed head under the lips, with the room it leaves", async () => {
    const { d } = await project("G47");
    expect(d.diagnostics).toEqual([]);
    const heads = d.butts.get("c1")?.heads ?? [];
    expect(heads.map((h) => ({ ...h, bearing: Math.round(h.bearing * 1e4) / 1e4 }))).toEqual([
      {
        end: "b2.a",
        side: "head",
        item: "test-qc:QC40",
        d_in: 7.8,
        d_out: 18,
        on: "b1 +y (under its lips)",
        bearing: 0.5441,
        room: { depth: expect.closeTo(1.72, 9), side: expect.closeTo(2.005, 9) },
      },
    ]);
  });

  it("refuses the same head taken as a cylinder, and a shank or a joint off the groove", async () => {
    expect(said((await project("G47", conn("QC40-CYL"))).d, "fit")).toEqual([
      [
        "error",
        "c1",
        "the head of test-qc:QC40-CYL at b2.a, Ø18.00, is wider than the chamber under the lips of b1's face +y where it reaches, 8.27 deep (17.92)",
      ],
    ]);
    const off = (y: number) => ({ bars: { b2: { a: [300, y, 20], b: [300, y, 520] } } });
    expect(said((await project("G47", off(3))).d, "fit")).toEqual([
      [
        "error",
        "c1",
        "test-qc:QC40 at b2.a sits 3.00 off the centre of the groove of b1's face +y, so its Ø7.80 shank does not pass the 8.18 opening",
      ],
    ]);
    expect(said((await project("G47", off(10))).d, "fit")).toEqual([
      [
        "error",
        "c1",
        "test-qc:QC40 at b2.a has no way through b1: the connector drills no hole in it there, and no groove of its face +y lies under the joint for the head",
      ],
    ]);
  });

  it("seats each connector of a recipe at its hole", async () => {
    const { d } = await project("G47", {
      bars: {
        b1: { item: "test-qc:Q80" },
        b2: { item: "test-qc:Q80", a: [300, 0, 40], b: [300, 0, 540] },
      },
      ...conn("QC-2"),
    });
    expect(d.diagnostics).toEqual([]);
    expect((d.butts.get("c1")?.heads ?? []).map((h) => [h.at, h.on])).toEqual([
      [[-20, -20], "b1 +y (under its lips)"],
      [[20, 20], "b1 +y (under its lips)"],
    ]);
  });

  it("reads a screw's domed head the same way, and keeps a head with no dome a cylinder", async () => {
    expect((await project("G47", conn("QJ-DOME"))).d.diagnostics).toEqual([]);
    expect(said((await project("G47", conn("QJ-FLAT"))).d, "fit")).toEqual([
      [
        "error",
        "c1",
        "the head of test-qc:QSCR-FLAT into b2.a's tap, Ø18.00, is wider than the chamber under the lips of b1's face +y where it reaches, 8.27 deep (17.92)",
      ],
    ]);
  });

  it("finds the least room between a dome and a tapering chamber", () => {
    const g = {
      face: "+y" as const,
      at_mm: 0,
      depth_mm: 9.99,
      undercut_mm: 22.01,
      taper_from_mm: 7.03,
      bottom_mm: 12.24,
    };
    // A cylinder: its top edge, 8.27 deep, where the chamber is 17.92 wide.
    const cyl = headRoom(g, 3.79, 4.48, 9);
    expect(cyl.depth).toBeCloseTo(1.72, 9);
    expect(cyl.at).toBeCloseTo(8.27, 9);
    expect(cyl.side).toBeCloseTo((22.01 - (9.77 * 1.24) / 2.96 - 18) / 2, 9);
    // The dome: the rim's top edge, 3.79 + 4.48 - (17.5 - √(17.5² - 81)) deep, in the undercut.
    const dome = headRoom(g, 3.79, 4.48, 9, 17.5);
    expect(dome.side).toBeCloseTo((22.01 - 18) / 2, 9);
    expect(dome.at).toBeCloseTo(3.79 + 4.48 - (17.5 - Math.sqrt(17.5 ** 2 - 81)), 9);
    // A chamber that closes steeply from 3 deep puts the dome in the taper, and its least room is
    // where the dome's tangent runs parallel to the taper's wall: the cap's centre c0 = k - rf
    // above the seat, and t - c0 = a·rf/√(1 + a²) for the taper's slope a (half-width per depth).
    const steep = { ...g, depth_mm: 8.5, taper_from_mm: 3, bottom_mm: 0 };
    const deep = headRoom(steep, 3.79, 4.48, 9, 17.5);
    const a = 22.01 / 2 / (8.5 - 3);
    const t = 4.48 - 17.5 + (a * 17.5) / Math.sqrt(1 + a * a);
    const halfChamber = (22.01 - 22.01 * ((3.79 + t - 3) / 5.5)) / 2;
    const halfHead = Math.sqrt(17.5 ** 2 - (t - 4.48 + 17.5) ** 2);
    expect(t).toBeGreaterThan(4.48 - (17.5 - Math.sqrt(17.5 ** 2 - 81)));
    expect(deep.at).toBeCloseTo(3.79 + t, 9);
    expect(deep.side).toBeCloseTo(halfChamber - halfHead, 9);
    expect(deep.side).toBeLessThan((22.01 - 22.01 * ((dome.at - 3) / 5.5) - 18) / 2);
  });
});

describe("a far-face head on the hole F2 makes (F7)", () => {
  it("seats a screw's head round the hole through the block", async () => {
    const { d } = await project("G48");
    expect(d.diagnostics).toEqual([]);
    expect(d.butts.get("c1")?.heads).toEqual([
      {
        end: "b2.a",
        side: "head",
        item: "test-qc:QSCR-M8x110",
        d_in: 9,
        d_out: 13,
        on: "b1 -y",
        bearing: 1,
      },
    ]);
  });

  it("seats no head where F2 refuses the hole", async () => {
    const { d } = await project("G48", {
      bars: {
        b2: { a: [100, 40, 0], b: [100, 906.0254037844386, 500], ends: { a: { cut: "angle" } } },
      },
    });
    expect(said(d, "connection")).toEqual([
      [
        "error",
        "c1",
        "connector requires[1]: the screw into b2.a's tap runs 30.00° off square to b1's face +x; a hole in a bar's side is drilled square to its face, so it cannot be made",
      ],
    ]);
    expect(holes(d, "b1")).toEqual([]);
    expect(d.butts.get("c1")?.heads).toBeUndefined();
  });
});

describe("Forseti's base-40 quick connector, from the catalog (X7, X8)", () => {
  // A 40x80 post (PF40-02, its cores at (0, ±20)) on an 80x80 rail (PF40-03B, its top grooves at
  // ±20 across). The rail's own groove (after the round-4 acceptance, F9): lip 4, depth 10 and
  // undercut 22 as p. 20 prints them, opening 8.2, the taper from 7.0 to 13.3 and the hooks 13.9
  // wide read off its raster image. The post's section x runs along world X and y along world Y,
  // so its cores stand over the rail's grooves. A recipe places one CN40-01 at each core, as a
  // two-core end is written.
  const doc = (connector: string, qty?: number) => ({
    schema: "alukit.project/1",
    name: "quick connector",
    catalogs: ["forseti"],
    bars: {
      b1: { item: "forseti:PF40-03B", a: [0, 0, 0], b: [600, 0, 0] },
      b2: { item: "forseti:PF40-02", a: [300, 0, 40], b: [300, 0, 540] },
    },
    connections: {
      c1: { type: "butt", through: "b1", ends: ["b2.a"], connector, ...(qty ? { qty } : {}) },
    },
  });
  const forseti = async (): Promise<ItemSource> => {
    const live = await openLiveCatalogs(FIXTURES, { catalogs: ["forseti"] });
    expect(live.diagnostics).toEqual([]);
    return catalogItems(live.set);
  };
  const withRecipe = async (): Promise<ItemSource> => {
    const base = await forseti();
    const recipe = ConnectorItem.parse({
      kind: "connector",
      subtype: "end-connector",
      name: "two quick connectors, one in each of a 40x80's cores",
      prov: { src: "est" },
      fits: ["forseti:s40-c8"],
      recipe: true,
      mounts: [
        {
          plane: { point_mm: [0, 0, 0], normal: [0, 0, -1] },
          holes: [
            { at_mm: [0, -20, 0], d_mm: 13.7 },
            { at_mm: [0, 20, 0], d_mm: 13.7 },
          ],
          fasteners: { "forseti:s40-c8": [{ item: "forseti:CN40-01", qty: 1 }] },
        },
      ],
    });
    return {
      ...base,
      item: (ref) =>
        ref === "local:QC-4080" ? { ok: true, id: ref, item: recipe } : base.item(ref),
    };
  };

  it("drills a cross hole over each core and seats each head under the rail's lips", async () => {
    const d = derive(doc("local:QC-4080"), await withRecipe());
    // Each Ø18 head bears on the lips' underside from the 8.2 opening out to the 13.9 hooks
    // (F8): 38.75 % of its seat, under F2b's 50 %. Draft 2.3 credited the face beside the opening
    // (54.41 %) and the rail took the 40x40 básico's groove (F9).
    const warn = (at: string) =>
      `the head of forseti:CN40-01 at b2.a ${at}, Ø18.00, bears on 38.8 % of its seat on the lips of b1's face +y, less than 50 %`;
    expect(said(d, "fit")).toEqual([
      ["warn", "c1", warn("(0.00, -20.00)")],
      ["warn", "c1", warn("(0.00, 20.00)")],
    ]);
    expect(d.diagnostics.filter((x) => x.severity !== "info" && x.code !== "fit")).toEqual([]);
    expect(holes(d, "b2")).toEqual([
      { op: "hole", face: "-y", from: "a", at: 25, d: 18, depth: 28, by: "c1" },
      { op: "hole", face: "+y", from: "a", at: 25, d: 18, depth: 28, by: "c1" },
    ]);
    const heads = (d.butts.get("c1")?.heads ?? []).map((h) => ({
      at: h.at,
      on: h.on,
      pct: Math.round(h.bearing * 1e4) / 100,
      depth: Math.round((h.room?.depth ?? Number.NaN) * 100) / 100,
      side: Math.round((h.room?.side ?? Number.NaN) * 1000) / 1000,
    }));
    // Room: 10 − 4 − 4.48 deep; 2 a side.
    const seat = { on: "b1 +y (under its lips)", pct: 38.75, depth: 1.52, side: 2 };
    expect(heads).toEqual([
      { at: [0, -20], ...seat },
      { at: [0, 20], ...seat },
    ]);
    expect(d.hardware).toEqual([{ item: "forseti:CN40-01", opt: {}, qty: 2, source: "c1" }]);
  });

  it("says two counted by qty would stand in one place, and points to a recipe", async () => {
    const d = derive(doc("forseti:CN40-01", 2), await forseti());
    expect(holes(d, "b2")).toEqual([
      { op: "hole", face: "+y", from: "a", at: 25, d: 18, depth: 28, by: "c1" },
    ]);
    expect(said(d, "connection")).toEqual([
      [
        "error",
        "c1",
        "forseti:CN40-01 x 2 at each butting end: a connector counted by qty is not placed, so all 2 would stand at the end's centre, one head in one place and its machining made once; to put one in each core, hold them in a recipe's fastener set at its mount's holes (§3.4). Its head is not seated",
      ],
    ]);
    expect(said(d, "fit")).toEqual([]);
    expect(d.butts.get("c1")?.heads).toBeUndefined();
    // One as sold, at a 40x40's single core over the rail's groove, is seated.
    const one = derive(
      mergePatch(doc("forseti:CN40-01"), {
        bars: {
          b1: { item: "forseti:PF40-01" },
          b2: { item: "forseti:PF40-01", a: [300, 0, 20] },
        },
      }),
      await forseti(),
    );
    expect(said(one, "connection")).toEqual([]);
    expect(said(one, "fit", "error")).toEqual([]);
    expect(one.butts.get("c1")?.heads?.map((h) => [h.item, h.on])).toEqual([
      ["forseti:CN40-01", "b1 +y (under its lips)"],
    ]);
  });
});

describe("a connector's dims (X8)", () => {
  const recipe = {
    kind: "connector",
    subtype: "end-connector",
    name: "R",
    prov: { src: "est" },
    fits: ["s40-c8"],
    recipe: true,
  };
  it("are a bought connector's, not a recipe's, which has no body", () => {
    const r = ConnectorItem.safeParse({ ...recipe, dims: { dk_mm: 18 } });
    expect(r.success).toBe(false);
    const { recipe: _r, ...bought } = recipe;
    expect(ConnectorItem.safeParse({ ...bought, dims: { dk_mm: 18, k_mm: 4.48 } }).success).toBe(
      true,
    );
  });
});
