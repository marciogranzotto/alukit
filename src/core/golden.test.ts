import { basename, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type Derived, derive } from "./derive/derive.ts";
import { type OpenedProject, openProject } from "./project/open.ts";
import { FIXTURES, mergePatch, readJson, shown, subdirs } from "./testing.ts";

/**
 * The golden end cases of design §4.6 (G1–G21, and G27, a strut bearing on a shoe mitred square
 * to it), M3a's oracle, and G28 (M6): bars bearing on a placeholder's box at a pose, §4.5's
 * butt through a body with a project item as the body. Each folder holds a small document and
 * the values the design's table (or, for G28, its hand calculation, by_hand.py) gives for it, to
 * 0.01 mm and 0.01°. A row's variations ("then H = 1000") are merge patches of
 * the same document. G22–G26 are generation and cost cases, in `golden-gen/`.
 */

interface EndExpect {
  by?: string;
  move_mm?: number;
  angle_deg?: number;
}

interface BarExpect {
  cut_mm?: number;
  centre_mm?: number;
  short_mm?: number;
  len_mm?: number;
  ends?: { a?: EndExpect; b?: EndExpect };
}

interface Expect {
  bars: Record<string, BarExpect>;
  /** Every error derive reports, by code and entity (and refs, when given). */
  errors: { code: string; entity: string; refs?: string[] }[];
}

interface Golden {
  case: string;
  rule: string;
  design: string;
  expect: Expect;
  cases?: { name: string; patch: unknown; expect: Expect }[];
}

const TOL = 0.01;

function check(d: Derived, want: Expect, label: string): void {
  const errors = shown(d.diagnostics, "error");
  const got = errors.map((e) => ({ code: e.code, entity: e.entity }));
  const expected = want.errors.map((e) => ({ code: e.code, entity: e.entity }));
  expect(got, `${label}: errors ${JSON.stringify(errors, null, 1)}`).toEqual(expected);
  for (const e of want.errors) {
    if (!e.refs) continue;
    const match = errors.find((x) => x.code === e.code && x.entity === e.entity);
    expect(match?.refs, `${label}: refs of ${e.code} on ${e.entity}`).toEqual(e.refs);
  }
  for (const [id, b] of Object.entries(want.bars)) {
    const bar = d.bars.get(id);
    expect(bar, `${label}: bar ${id} derived`).toBeDefined();
    if (!bar) continue;
    const near = (got: number, want: number | undefined, what: string) => {
      if (want === undefined) return;
      expect(
        Math.abs(got - want),
        `${label}: ${id} ${what} = ${got}, want ${want}`,
      ).toBeLessThanOrEqual(TOL + 1e-9);
    };
    near(bar.lengths.cut, b.cut_mm, "cut_mm");
    near(bar.lengths.centre, b.centre_mm, "centre_mm");
    near(bar.lengths.short, b.short_mm, "short_mm");
    near(bar.lengths.len, b.len_mm, "len_mm");
    for (const end of ["a", "b"] as const) {
      const e = b.ends?.[end];
      if (!e) continue;
      const r = bar.ends[end];
      near(r.move, e.move_mm, `${end}.move_mm`);
      near(r.angle, e.angle_deg, `${end}.angle_deg`);
      if (e.by !== undefined) expect(r.by, `${label}: ${id}.${end} by`).toBe(e.by);
    }
  }
}

const dirs = subdirs(join(FIXTURES, "golden-ends"));

describe("golden end cases (design §4.6)", () => {
  it("has one fixture per case G1–G21, G27 and G28", () => {
    expect(dirs.map((d) => basename(d))).toEqual([
      ...Array.from({ length: 21 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`),
      "G27",
      "G28",
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
        check(derive(project.raw, project.items), golden.expect, golden.case);
      });

      for (const c of golden.cases ?? []) {
        it(`${c.name}`, () => {
          const raw = mergePatch(project.raw, c.patch);
          check(derive(raw, project.items), c.expect, `${golden.case} (${c.name})`);
        });
      }
    });
  }
});
