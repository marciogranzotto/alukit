import { basename, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bom } from "./bom/bom.ts";
import { cutList } from "./cutlist/cutlist.ts";
import { machiningText } from "./cutlist/format.ts";
import { type Derived, derive } from "./derive/derive.ts";
import type { ItemSource } from "./items.ts";
import { type MoneyOut, order } from "./order/order.ts";
import { type OpenedProject, openProject } from "./project/open.ts";
import { FIXTURES, mergePatch, readJson, shown, subdirs } from "./testing.ts";

/**
 * The generation and cost cases of design §4.6 (G22–G26), M3b's oracle: each folder holds a small
 * document and the values the design's table gives for it, to 0.01 mm, and for G26 to the minor
 * unit. A row's variations ("factory: b", "at at_mm 470") are merge patches of the same document.
 * G29 (gap A3: a layer on an angle's inner leg face, `docs/notes/a3-face-contact.md`) and G30 on
 * (the other gaps the v1 acceptance found, `docs/notes/acceptance-gaps.md`) each have a hand
 * calculation beside them, `by_hand.py`, that imports nothing from AluKit.
 */

interface Expect {
  /** Per rail bar: its hole count and end distances. */
  rails?: Record<string, { holes: number; E_a_mm: number; E_b_mm: number }>;
  /** Per stock item: the number of pieces in each stock bar, and what each bar uses. */
  stock?: Record<string, { pieces: number[]; used_mm?: number[] }>;
  /** Per face connection: its stations' world x. */
  stations?: Record<string, { x_mm: number[] }>;
  /**
   * Per face connection: its fastener count and every station's grip; optionally the fastener's
   * length through the layers (from the face its head bears on to the last layer's far face, as
   * the viewer draws it), each station's point, and the faces of each pair in contact.
   */
  fastenings?: Record<
    string,
    {
      count: number;
      grip_mm: number[];
      length_mm?: number[];
      point_mm?: number[][];
      contacts?: [string, string][];
    }
  >;
  /** Per part on a station: the bar it landed on and the distance from that bar's a. */
  parts?: Record<string, { bar: string; s_mm: number }>;
  /** Per item: its cut-list lines, and where given, each line's machining as the cut list words it. */
  lines?: Record<string, { count: number; cut_mm: number; machining?: string[] }[]>;
  /** Per bar: its ops as derive gives them (written, then generated), numbers to 0.01. */
  ops?: Record<string, unknown[]>;
  /** Per item: its count among the connections' hardware. */
  hardware?: Record<string, number>;
  /** Per joint recipe (a connector with no body, §3.4): its count; none when absent. */
  recipes?: Record<string, number>;
  /** Generated holes: how many, their diameters, how many per bar, and optionally a bar's ops. */
  holes?: {
    total: number;
    d_mm: number[];
    per_bar: Record<string, number>;
    ops?: Record<string, HoleOut[]>;
  };
  /** The order list: per item, its one line's low, likely and high; and the total. */
  order?: {
    lines: Record<string, MoneyOut & { range?: "quote" | "band" }>;
    total: MoneyOut;
  };
  errors: { code: string; entity: string; refs?: string[] }[];
}

/** A generated hole as the golden writes it. */
interface HoleOut {
  face: string;
  at_mm: number;
  across_mm?: number;
  d_mm?: number;
  depth_mm?: number;
}

interface Golden {
  case: string;
  rule: string;
  design: string;
  expect: Expect;
  cases?: { name: string; patch: unknown; expect: Expect }[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** A value with every number rounded to 0.01 and undefined fields dropped, to compare ops. */
function rounded(v: unknown): unknown {
  if (typeof v === "number") return r2(v) + 0;
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .map(([k, x]) => [k, rounded(x)]),
    );
  }
  return v;
}

function check(d: Derived, items: ItemSource, want: Expect, label: string): void {
  const errors = shown(d.diagnostics, "error");
  expect(
    errors.map((e) => ({ code: e.code, entity: e.entity })),
    `${label}: errors ${JSON.stringify(errors, null, 1)}`,
  ).toEqual(want.errors.map((e) => ({ code: e.code, entity: e.entity })));
  for (const e of want.errors) {
    if (!e.refs) continue;
    const match = errors.find((x) => x.code === e.code && x.entity === e.entity);
    expect(match?.refs, `${label}: refs of ${e.code} on ${e.entity}`).toEqual(e.refs);
  }

  for (const [id, r] of Object.entries(want.rails ?? {})) {
    const rail = d.bars.get(id)?.rail;
    expect(rail, `${label}: ${id} has a hole layout`).toBeDefined();
    expect(
      [rail?.holes.length, r2(rail?.E_a ?? Number.NaN), r2(rail?.E_b ?? Number.NaN)],
      `${label}: ${id}'s holes and end distances`,
    ).toEqual([r.holes, r.E_a_mm, r.E_b_mm]);
  }

  const cl = cutList({ derived: d, items });
  for (const [item, s] of Object.entries(want.stock ?? {})) {
    const g = cl.groups.find((x) => x.item === item);
    expect(
      g?.stock?.map((b) => b.pieces.length),
      `${label}: ${item}'s stock bars`,
    ).toEqual(s.pieces);
    if (s.used_mm) expect(g?.stock?.map((b) => b.used_mm)).toEqual(s.used_mm);
  }
  for (const [item, lines] of Object.entries(want.lines ?? {})) {
    const g = cl.groups.find((x) => x.item === item);
    // A line's machining, as the cut list prints it, is compared only where the case gives it.
    expect(
      g?.lines.map((l, i) => ({
        count: l.count,
        cut_mm: l.cut_mm,
        ...(lines[i]?.machining ? { machining: l.machining.map(machiningText) } : {}),
      })),
      `${label}: ${item}'s cut-list lines`,
    ).toEqual(lines);
  }
  for (const [id, ops] of Object.entries(want.ops ?? {})) {
    expect(rounded(d.bars.get(id)?.ops), `${label}: ${id}'s ops`).toEqual(ops);
  }

  for (const [id, s] of Object.entries(want.stations ?? {})) {
    const f = d.fastenings.get(id);
    expect(
      f?.stations.map((x) => r2(x.point[0])),
      `${label}: ${id}'s stations`,
    ).toEqual(s.x_mm);
  }
  for (const [id, f] of Object.entries(want.fastenings ?? {})) {
    const got = d.fastenings.get(id);
    expect(got?.stations.length, `${label}: ${id}'s fasteners`).toBe(f.count);
    expect([...new Set(got?.stations.map((x) => r2(x.grip)))], `${label}: ${id}'s grip`).toEqual(
      f.grip_mm,
    );
    if (f.length_mm) {
      expect(
        [...new Set(got?.stations.map((x) => r2(x.layers[x.layers.length - 1]?.to ?? Number.NaN)))],
        `${label}: ${id}'s length through the layers`,
      ).toEqual(f.length_mm);
    }
    if (f.point_mm) {
      expect(
        got?.stations.map((x) => x.point.map(r2)),
        `${label}: ${id}'s station points`,
      ).toEqual(f.point_mm);
    }
    if (f.contacts) {
      expect(
        got?.contacts.map((c) => c.faces),
        `${label}: ${id}'s faces in contact`,
      ).toEqual(f.contacts);
    }
  }
  for (const [id, p] of Object.entries(want.parts ?? {})) {
    const got = d.parts.get(id);
    expect(got?.placed && [got.bar, r2(got.s ?? Number.NaN)], `${label}: ${id}`).toEqual([
      p.bar,
      p.s_mm,
    ]);
  }
  for (const [item, qty] of Object.entries(want.hardware ?? {})) {
    const n = d.hardware.filter((h) => h.item === item).reduce((s, h) => s + h.qty, 0);
    expect(n, `${label}: ${item}`).toBe(qty);
  }
  const recipes: Record<string, number> = {};
  for (const r of d.recipes) recipes[r.item] = (recipes[r.item] ?? 0) + r.qty;
  expect(recipes, `${label}: recipes`).toEqual(want.recipes ?? {});
  if (want.holes) {
    const holes = [...d.bars.values()].flatMap((b) =>
      b.ops.flatMap((o) => (o.op === "hole" && o.by ? [{ bar: b.placed.id, d: o.d }] : [])),
    );
    expect(holes.length, `${label}: generated holes`).toBe(want.holes.total);
    expect([...new Set(holes.map((h) => h.d))], `${label}: hole diameters`).toEqual(
      want.holes.d_mm,
    );
    const per: Record<string, number> = {};
    for (const h of holes) per[h.bar] = (per[h.bar] ?? 0) + 1;
    expect(per, `${label}: holes per bar`).toEqual(want.holes.per_bar);
    for (const [bar, ops] of Object.entries(want.holes.ops ?? {})) {
      const got = (d.bars.get(bar)?.ops ?? []).flatMap((o): HoleOut[] =>
        o.op === "hole" && o.by
          ? [
              {
                face: o.face,
                at_mm: r2(o.at),
                ...(o.across !== undefined ? { across_mm: r2(o.across) } : {}),
                ...(o.d !== undefined ? { d_mm: o.d } : {}),
                ...(o.depth !== undefined ? { depth_mm: r2(o.depth) } : {}),
              },
            ]
          : [],
      );
      expect(got, `${label}: ${bar}'s generated holes`).toEqual(ops);
    }
  }
  if (want.order) {
    const b = bom({ derived: d, items });
    const o = order({
      derived: d,
      items,
      bom: b,
      cutList: cl,
      diagnostics: [...d.diagnostics, ...cl.diagnostics, ...b.diagnostics],
      asOf: "2026-11-26",
    });
    const lines = o.suppliers.flatMap((s) => s.lines);
    for (const [item, m] of Object.entries(want.order.lines)) {
      const got = lines.filter((l) => l.item === item);
      expect(
        got.map((l) => ({
          low_minor: l.low_minor,
          likely_minor: l.likely_minor,
          high_minor: l.high_minor,
          range: l.range,
        })),
        `${label}: ${item}'s order line`,
      ).toEqual([m]);
    }
    expect(lines.length, `${label}: order lines`).toBe(Object.keys(want.order.lines).length);
    expect(o.totals.total, `${label}: the total`).toEqual(want.order.total);
  }
}

const dirs = subdirs(join(FIXTURES, "golden-gen"));

describe("golden generation cases (design §4.6)", () => {
  it("has one fixture per case G22–G26, and G29 on", () => {
    expect(dirs.map((d) => basename(d))).toEqual([
      "G22",
      "G23",
      "G24",
      "G25",
      "G26",
      "G29",
      "G30",
      "G31",
      "G32",
    ]);
  });

  for (const dir of dirs) {
    const golden = readJson(join(dir, "expected.json")) as Golden;
    describe(`${golden.case}: ${golden.rule}`, () => {
      let project: OpenedProject;
      beforeAll(async () => {
        project = await openProject(dir);
        expect(project.diagnostics).toEqual([]);
      });

      it(golden.design, () => {
        check(derive(project.raw, project.items), project.items, golden.expect, golden.case);
      });

      for (const c of golden.cases ?? []) {
        it(`${c.name}`, () => {
          const raw = mergePatch(project.raw, c.patch);
          check(derive(raw, project.items), project.items, c.expect, `${golden.case} (${c.name})`);
        });
      }
    });
  }
});
