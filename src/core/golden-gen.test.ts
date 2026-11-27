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
 * G29 (gap A3: a layer on an angle's inner leg face, `docs/notes/a3-face-contact.md`), G30–G32
 * (the other gaps the v1 acceptance found, `docs/notes/acceptance-gaps.md`), G33–G34 (the gaps
 * its second run found, `docs/notes/acceptance-gaps-2.md`) and G35–G37 (the joint geometry its
 * fourth run found, `docs/notes/f2-joint-geometry.md`) each have a hand calculation beside
 * them, `by_hand.py`, that imports nothing from AluKit, and so does G38 (a piece's span, the length
 * of stock it is cut from: `docs/notes/x4-stock-length.md`).
 */

interface Expect {
  /** Per bar: its lengths as derive gives them, to 0.01 (long point, centre line, short point, span). */
  bars?: Record<
    string,
    { cut_mm?: number; centre_mm?: number; short_mm?: number; span_mm?: number }
  >;
  /** Per rail bar: its hole count and end distances. */
  rails?: Record<string, { holes: number; E_a_mm: number; E_b_mm: number }>;
  /**
   * Per stock item: the number of pieces in each stock bar, what each bar uses, and the length
   * each of its pieces takes from it, in order along the bar.
   */
  stock?: Record<string, { pieces: number[]; used_mm?: number[]; lengths_mm?: number[][] }>;
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
  /**
   * Per item: its cut-list lines, and where given, each line's span, ordered and billed lengths,
   * and its machining as the cut list words it.
   */
  lines?: Record<string, LineExpect[]>;
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
  /** The order list: per item, its one line's (or, as a list, its lines') low, likely and high; and the total. */
  order?: {
    lines: Record<string, LineMoney | LineMoney[]>;
    total: MoneyOut;
  };
  /** Per item: its total length in the BOM. */
  bom?: Record<string, { length_mm: number }>;
  /** Every error the cut list reports, by code and entity. */
  cut_errors?: { code: string; entity: string }[];
  /**
   * Per butt connection: each butting end's seat on the face it bears on (§4.5, after acceptance
   * run 4): the end face's area, the greatest distance and the area of it past the face, and how
   * far the bar goes into the through bar beyond the face.
   */
  butts?: Record<
    string,
    {
      end: string;
      on: string;
      area_mm2: number;
      overhang_mm: number;
      overhang_mm2: number;
      overlap_mm: number;
    }[]
  >;
  /**
   * Per butt connection: its connector's screw heads, seated (after the alternative frame's
   * acceptance, F2b), as `seats` gives a face connection's.
   */
  heads?: Record<
    string,
    {
      end: string;
      side: string;
      item: string;
      on: string;
      d_in_mm: number;
      d_out_mm: number;
      bearing_pct: number;
    }[]
  >;
  /**
   * Per face connection: every station's head and nut seats (§4.5, after acceptance run 4), the
   * part that bears, the face, its annulus and the percentage of it on the face's material.
   */
  seats?: Record<
    string,
    {
      k: number;
      side: string;
      item: string;
      on: string;
      d_in_mm: number;
      d_out_mm: number;
      bearing_pct: number;
    }[]
  >;
  /** Every warning derive reports, by code and entity (and refs), where the case gives them. */
  warnings?: { code: string; entity: string; refs?: string[] }[];
  errors: { code: string; entity: string; refs?: string[] }[];
}

type LineMoney = MoneyOut & { range?: "quote" | "band" };

interface LineExpect {
  count: number;
  cut_mm: number;
  span_mm?: number;
  ordered_mm?: number;
  billed_mm?: number;
  machining?: string[];
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
  if (want.warnings) {
    const warns = shown(d.diagnostics, "warn");
    expect(
      warns.map((w) => ({ code: w.code, entity: w.entity, ...(w.refs ? { refs: w.refs } : {}) })),
      `${label}: warnings ${JSON.stringify(warns, null, 1)}`,
    ).toEqual(want.warnings);
  }
  for (const [id, seats] of Object.entries(want.butts ?? {})) {
    const got = d.butts.get(id)?.ends.map((e) => ({
      end: e.end,
      on: e.on,
      area_mm2: r2(e.area),
      overhang_mm: r2(e.overhang),
      overhang_mm2: r2(e.overhang_area),
      overlap_mm: r2(e.overlap),
    }));
    expect(got, `${label}: ${id}'s seats`).toEqual(seats);
  }
  for (const [id, heads] of Object.entries(want.heads ?? {})) {
    const got = (d.butts.get(id)?.heads ?? []).map((h) => ({
      end: h.end,
      side: h.side,
      item: h.item,
      on: h.on,
      d_in_mm: r2(h.d_in),
      d_out_mm: r2(h.d_out),
      bearing_pct: r2(100 * h.bearing),
    }));
    expect(got, `${label}: ${id}'s screw heads`).toEqual(heads);
  }
  for (const [id, seats] of Object.entries(want.seats ?? {})) {
    const got = d.fastenings.get(id)?.stations.flatMap((st) =>
      st.seats.map((x) => ({
        k: st.k,
        side: x.side,
        item: x.item,
        on: x.on,
        d_in_mm: r2(x.d_in),
        d_out_mm: r2(x.d_out),
        bearing_pct: r2(100 * x.bearing),
      })),
    );
    expect(got, `${label}: ${id}'s head seats`).toEqual(seats);
  }

  for (const [id, b] of Object.entries(want.bars ?? {})) {
    const l = d.bars.get(id)?.lengths;
    expect(l, `${label}: bar ${id} derived`).toBeDefined();
    const got: Record<string, number> = {
      cut_mm: r2(l?.cut ?? Number.NaN),
      centre_mm: r2(l?.centre ?? Number.NaN),
      short_mm: r2(l?.short ?? Number.NaN),
      span_mm: r2(l?.span ?? Number.NaN),
    };
    const given = Object.fromEntries(Object.keys(b).map((k) => [k, got[k]]));
    expect(given, `${label}: ${id}'s lengths`).toEqual(b);
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
    if (s.lengths_mm) {
      expect(
        g?.stock?.map((b) => b.pieces.map((p) => p.span_mm ?? p.cut_mm)),
        `${label}: the lengths ${item}'s pieces take from its stock bars`,
      ).toEqual(s.lengths_mm);
    }
  }
  if (want.cut_errors) {
    expect(
      shown(cl.diagnostics, "error").map((e) => ({ code: e.code, entity: e.entity })),
      `${label}: the cut list's errors`,
    ).toEqual(want.cut_errors);
  }
  for (const [item, lines] of Object.entries(want.lines ?? {})) {
    const g = cl.groups.find((x) => x.item === item);
    // A line's span, ordered and billed lengths and machining (as the cut list prints it) are
    // compared only where the case gives them.
    expect(
      g?.lines.map((l, i) => ({
        count: l.count,
        cut_mm: l.cut_mm,
        ...(lines[i]?.span_mm !== undefined ? { span_mm: l.span_mm } : {}),
        ...(lines[i]?.ordered_mm !== undefined ? { ordered_mm: l.ordered_mm } : {}),
        ...(lines[i]?.billed_mm !== undefined ? { billed_mm: l.billed_mm } : {}),
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
  const b = bom({ derived: d, items });
  for (const [item, x] of Object.entries(want.bom ?? {})) {
    const line = b.groups.flatMap((g) => g.lines).find((l) => l.item === item);
    expect(line?.length_mm, `${label}: ${item}'s length in the BOM`).toBe(x.length_mm);
  }
  if (want.order) {
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
        `${label}: ${item}'s order lines`,
      ).toEqual(Array.isArray(m) ? m : [m]);
    }
    const count = Object.values(want.order.lines).reduce(
      (n, m) => n + (Array.isArray(m) ? m.length : 1),
      0,
    );
    expect(lines.length, `${label}: order lines`).toBe(count);
    expect(o.totals.total, `${label}: the total`).toEqual(want.order.total);
  }
}

const dirs = subdirs(join(FIXTURES, "golden-gen"));

describe("golden generation cases (design §4.6)", () => {
  it("has one fixture per case G22–G26 and G29–G45", () => {
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
      "G33",
      "G34",
      "G35",
      "G36",
      "G37",
      "G38",
      "G39",
      "G40",
      "G41",
      "G42",
      "G43",
      "G44",
      "G45",
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
