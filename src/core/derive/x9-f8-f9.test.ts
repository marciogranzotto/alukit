import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeGroove, ownGroove } from "#catalog/schema/groove.ts";
import { ConnectorItem } from "#catalog/schema/items.ts";
import { checkedMachining, modelOutputs } from "../check/outputs.ts";
import { catalogItems, type ItemSource } from "../items.ts";
import { machiningMarkdown } from "../machining/format.ts";
import { openLiveCatalogs, openProject } from "../project/open.ts";
import { FIXTURES, mergePatch } from "../testing.ts";
import { derive } from "./derive.ts";

/**
 * The gaps the round-4 acceptance found (docs/notes/x9-f8-f9.md): a cross hole drilled into a face
 * another member covers (X9), a head under the lips credited with the face beside the opening
 * instead of the lips' underside (F8), and profiles that took another profile's groove (F9). The
 * golden case G49 pins the numbers; these tests pin the words, the refusals and the catalog.
 */

async function g49(patch: unknown = {}) {
  const p = await openProject(join(FIXTURES, "golden-gen", "G49"));
  const raw = mergePatch(p.raw, patch);
  return { p, raw, d: derive(raw, p.items) };
}

const said = (d: ReturnType<typeof derive>, code: string, severity?: string) =>
  d.diagnostics
    .filter((x) => x.code === code && (severity === undefined || x.severity === severity))
    .map((x) => [x.severity, x.entity, x.message, x.refs ?? []]);

const holes = (d: ReturnType<typeof derive>, bar: string) =>
  (d.bars.get(bar)?.ops ?? []).filter((o) => o.op === "hole");

const conn = (c: string) => ({ connections: { c1: { connector: `test-cover:${c}` } } });

describe("a cross hole's mouth clear of the other members (X9)", () => {
  it("leaves +y for the next face in tie order when a bar stands in front of it", async () => {
    const { d } = await g49();
    expect(said(d, "connection")).toEqual([]);
    expect(holes(d, "b2")).toEqual([
      { op: "hole", face: "-y", from: "a", at: 25, d: 18, depth: 28, by: "c1" },
    ]);
  });

  it("keeps a face the requirement names, and says who covers it", async () => {
    const { d } = await g49(conn("HC40-FACE"));
    expect(holes(d, "b2").map((h) => h.face)).toEqual(["+y"]);
    expect(said(d, "connection")).toEqual([
      [
        "error",
        "c1",
        "connector requires[0]: the Ø18.00 hole 25.00 from b2.a goes in from b2's face +y on its centre line, as the requirement names it, where b3 stands in front of 100.0 % of its mouth, within 30.00 of the face: its mouth cannot be reached",
        ["b2", "b3"],
      ],
    ]);
  });

  it("counts a member within the tool's room, and not one beyond it", async () => {
    const off = { bars: { b3: { a: [200, 42, 45], b: [400, 42, 45] } } };
    expect(holes((await g49(off)).d, "b2").map((h) => h.face)).toEqual(["-y"]);
    const room = mergePatch(off, conn("HC40-ACCESS"));
    const { d } = await g49(room);
    expect(holes(d, "b2").map((h) => h.face)).toEqual(["+y"]);
    expect(said(d, "connection")).toEqual([]);
  });

  it("drills the default face when every face is covered, and names all that cover them", async () => {
    const bar = (a: number[], b: number[]) => ({ item: "test-cover:H40-B", a, b });
    const { d } = await g49({
      bars: {
        b4: bar([200, -40, 45], [400, -40, 45]),
        b5: bar([340, -15, 45], [340, 15, 45]),
        b6: bar([260, -15, 45], [260, 15, 45]),
      },
    });
    expect(holes(d, "b2").map((h) => h.face)).toEqual(["+y"]);
    expect(said(d, "connection")).toEqual([
      [
        "error",
        "c1",
        "connector requires[0]: no face of b2 that the Ø18.00 hole 25.00 from b2.a could go in from on its centre line is clear (+y, where b3 stands in front of 100.0 % of its mouth, within 30.00 of the face; -y, where b4 stands in front of 100.0 % of its mouth, within 30.00 of the face; +x, where b5 stands in front of 100.0 % of its mouth, within 30.00 of the face; -x, where b6 stands in front of 100.0 % of its mouth, within 30.00 of the face): it is drilled from +y, where a hole with no position goes, and its mouth cannot be reached",
        ["b2", "b3", "b4", "b5", "b6"],
      ],
    ]);
  });

  it("takes a placed part as a cover by its box, and a share of the mouth", async () => {
    // A plate 10 thick standing 1 off the post's +y face, its edge 4 short of the hole's axis: it
    // stands in front of the part of the mouth beyond its edge, about 23 %.
    const plate = { item: "test-cover:HPLATE", at: { pos: [246, 26, 45] } };
    const { d } = await g49({ bars: { b3: null }, parts: { p1: plate }, ...conn("HC40-FACE") });
    const [error] = said(d, "connection");
    expect(error?.[3]).toEqual(["b2", "p1"]);
    expect(error?.[2]).toMatch(/where p1 stands in front of 2[0-9]\.[0-9] % of its mouth/);
    const free = await g49({ bars: { b3: null }, parts: { p1: plate } });
    expect(holes(free.d, "b2").map((h) => h.face)).toEqual(["-y"]);
  });

  it("takes the face a mount's hole names", async () => {
    const { d } = await g49(conn("HR-X"));
    expect(holes(d, "b2")).toEqual([
      { op: "hole", face: "-x", from: "a", at: 25, d: 18, depth: 28, by: "c1" },
    ]);
  });

  it("moves a positioned hole to the next nearest face that reaches its position", async () => {
    // An 80x80 post in an 80x80 rail's grooves, a quick connector in two diagonal cores; a plate
    // against the post's -y face over the (-20, -20) core's hole. That hole is 20 from -y and from
    // -x: -y comes first in tie order and is covered, so -x.
    const { d } = await g49({
      bars: {
        b1: { item: "test-cover:H80" },
        b2: { item: "test-cover:H80", a: [300, 0, 40], b: [300, 0, 540] },
        b3: null,
      },
      parts: { p1: { item: "test-cover:HPLATE", at: { pos: [280, -45, 65] } } },
      ...conn("HR-2"),
    });
    expect(said(d, "connection")).toEqual([]);
    expect(holes(d, "b2")).toEqual([
      { op: "hole", face: "-x", from: "a", at: 25, across: -20, d: 18, depth: 28, by: "c1" },
      { op: "hole", face: "+y", from: "a", at: 25, across: 20, d: 18, depth: 28, by: "c1" },
    ]);
  });

  it("names the face drilled on the machining sheet, as the cut list does", async () => {
    const { p, raw } = await g49();
    const derived = derive(raw, p.items);
    const sheet = checkedMachining(derived, modelOutputs(derived, p.items));
    expect(sheet.bars.map((b) => [b.item, b.machining])).toEqual([
      ["test-cover:H40", ["Ø18.00 hole 25.00 mm from end a on face -y, 28.00 deep"]],
    ]);
    expect(machiningMarkdown(sheet)).toContain(
      "| 500.00 | 1 | 1 | Ø18.00 hole 25.00 mm from end a on face -y, 28.00 deep | b2 |",
    );
  });

  it("refuses a face or an access room on a requirement that drills no hole in a butting bar's side", () => {
    const item = (req: object) =>
      ConnectorItem.safeParse({
        kind: "connector",
        subtype: "end-connector",
        name: "x",
        prov: { src: "est" },
        fits: ["s"],
        requires: [req],
      });
    const tap = { op: "end-tap", on: "butting", thread: "M8", from_end_mm: 0 };
    expect(item({ ...tap, face: "+y" }).success).toBe(false);
    const through = { op: "access-hole", on: "through", d_mm: 18, from_end_mm: 25 };
    expect(item({ ...through, access_mm: 10 }).success).toBe(false);
    const ok = { op: "access-hole", on: "butting", d_mm: 18, from_end_mm: 25 };
    expect(item({ ...ok, face: "-x", access_mm: 10 }).success).toBe(true);
    expect(item({ ...ok, access_mm: -1 }).success).toBe(false);
  });
});

describe("a head on the lips' underside (F8) and a profile's own groove (F9)", () => {
  it("does not seat a head under lips whose undersides the profile's drawing does not give", async () => {
    const { d } = await g49({ bars: { b1: { item: "test-cover:H40-UNREAD" } } });
    expect(d.butts.get("c1")?.heads).toBeUndefined();
    expect(said(d, "fit")).toEqual([
      [
        "info",
        "c1",
        "test-cover:H40-UNREAD's grooves do not give taper_from_mm, bottom_mm, hook_mm and wall_mm from its own drawing (its drawing shows each face closed by its cover), so a head under its lips is not seated or checked: c1",
        [],
      ],
    ]);
  });

  it("drops a groove type's hook where the profile's own lip has none", () => {
    const type = { opening_mm: 8.18, lip_mm: 3.79, hook_mm: 13.6, wall_mm: 1.8 };
    expect(mergeGroove(type, ownGroove({ lip_mm: 4.01, opening_mm: 8.11 }))).toEqual({
      opening_mm: 8.11,
      lip_mm: 4.01,
    });
    expect(mergeGroove(type, ownGroove({ lip_mm: 4, unread: ["hook_mm", "wall_mm"] }))).toEqual({
      ...type,
      lip_mm: 4,
    });
    expect(mergeGroove(type, ownGroove({ opening_mm: 8.2 }))).toEqual({ ...type, opening_mm: 8.2 });
    expect(mergeGroove(type, undefined)).toBe(type);
  });

  const forseti = async (): Promise<ItemSource> => {
    const live = await openLiveCatalogs(FIXTURES, { catalogs: ["forseti"] });
    expect(live.diagnostics).toEqual([]);
    return catalogItems(live.set);
  };
  const grooveOf = (items: ItemSource, id: string) => {
    const r = items.item(`forseti:${id}`);
    if (!r.ok || !r.bar) throw new Error(id);
    return r.bar.grooves[0];
  };

  it("seats a head under a 40x40 básico's lips on their underside, as its vector outline draws it", async () => {
    const items = await forseti();
    const d = derive(
      {
        schema: "alukit.project/1",
        name: "f8",
        catalogs: ["forseti"],
        bars: {
          b1: { item: "forseti:PF40-01", a: [0, 0, 0], b: [600, 0, 0] },
          b2: { item: "forseti:PF40-01", a: [300, 0, 20], b: [300, 0, 520] },
        },
        connections: {
          c1: { type: "butt", through: "b1", ends: ["b2.a"], connector: "forseti:CN40-01" },
        },
      },
      items,
    );
    // The lips' underside runs 2.7 out from the opening's edge before the chamber rises: the
    // head bears there, under half its annulus. Draft 2.3 read the face: 52.88 %.
    const pct = Math.round((d.butts.get("c1")?.heads?.[0]?.bearing ?? 0) * 1e4) / 100;
    expect(pct).toBeGreaterThan(36.5);
    expect(pct).toBeLessThan(37);
    expect(said(d, "fit")).toEqual([
      [
        "warn",
        "c1",
        "the head of forseti:CN40-01 at b2.a, Ø18.00, bears on 36.7 % of its seat on the lips of b1's face +y, less than 50 %",
        ["b1"],
      ],
    ]);
  });

  it("gives Forseti's base-40 profiles their own grooves, printed where printed, read with a range elsewhere", async () => {
    const items = await forseti();
    const pick = (id: string) => {
      const g = grooveOf(items, id);
      return (
        g && [g.opening_mm, g.lip_mm, g.depth_mm, g.undercut_mm, g.hook_mm, g.wall_mm, g.unread]
      );
    };
    // The 40x40 básico is the groove type's source: its own outline is the type.
    expect(pick("PF40-01")).toEqual([8.18, 3.79, 9.99, 22.01, 13.59, 1.8, undefined]);
    // The 40x80: p. 17 prints 8,1, 4, 10 and 22; the hooks and the wall read off its image.
    expect(pick("PF40-02")).toEqual([8.1, 4, 10, 22, 14.3, 1.9, undefined]);
    // The 80x80 básico: p. 20 prints 4, 10 and 22; the opening read.
    expect(pick("PF40-03B")).toEqual([8.2, 4, 10, 22, 13.9, 2.6, undefined]);
    // The 80x80 reforçado's vector outline: its own groove measured, its lips with no hook.
    expect(pick("PF40-03")).toEqual([8.11, 4.01, 10.01, 22.05, undefined, undefined, undefined]);
    // The closed 40x40: printed behind the cover, the rest not drawn.
    expect(pick("PF40-04")).toEqual([
      8.2,
      4,
      10,
      22,
      13.59,
      1.8,
      ["taper_from_mm", "bottom_mm", "hook_mm", "wall_mm"],
    ]);
  });
});
