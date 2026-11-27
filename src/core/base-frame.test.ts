import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capture } from "../cli/testing.ts";
import { bom } from "./bom/bom.ts";
import { cutList } from "./cutlist/cutlist.ts";
import { derive } from "./derive/derive.ts";
import { derivedJson } from "./derive/output.ts";
import { openProject } from "./project/open.ts";
import { FIXTURES, lockStamp, oldestCutRead, scratchFixtures, withStamp } from "./testing.ts";

/**
 * The cart's base frame (M4b, design §12), the oracle the draw tool's Playwright script is held
 * to (tests/e2e/draw.spec.ts). It is the cart's bars b1–b10 and the connections that cut them:
 *
 * - the four posts b1–b4 (TS40, eccentric anchors),
 * - the top rails: b5 and b6 (TS4080 rolled 90°, flush outside and on top of the posts), b7 and
 *   b8 (TS40, between them),
 * - the base rails b9 and b10 (TS40, 100 above the ground, between the posts),
 * - the cart's c1 and c2 (posts and side rails butt through the front and back top rails) and
 *   c5–c8 (base rails butt through the posts).
 *
 * No other entity of the cart changes these bars' cuts or machining, so their cut list lines
 * are the cart's. `tests/fixtures/base-frame/build.json` builds it with `alukit do` from
 * `empty/` (the cart's settings, no entities) into `cli/`, the CLI-built fixture, whose cut list
 * and BOM the CLI wrote to `expected-cutlist.json` and `expected-bom.json`.
 */

const BASE = join(FIXTURES, "base-frame");
const BARS = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10"];

let scratch: string;
beforeAll(async () => {
  scratch = await scratchFixtures();
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("the CLI-built base frame", () => {
  it("is what build.json makes of the empty project, through alukit do", async () => {
    const dir = join(scratch, "base-frame", "empty");
    const r = await capture(["do", dir, "-f", join(scratch, "base-frame", "build.json")]);
    expect(r.code, r.err).toBe(0);
    for (const f of ["alukit.json", "alukit.lock.json"]) {
      expect(await readFile(join(dir, f), "utf8"), f).toBe(
        await readFile(join(BASE, "cli", f), "utf8"),
      );
    }
  });

  it("has the cut list and BOM the CLI prints, each stating the lock it came from", async () => {
    const dir = join(BASE, "cli");
    const lock = lockStamp(dir);
    const cutlist = await readFile(join(dir, "expected-cutlist.json"), "utf8");
    // The stamp's lines (§5.4): the cut list prices, so it states its oldest read date too.
    const expected = {
      cutlist: withStamp(cutlist, "price_basis", {
        oldest_read: oldestCutRead(JSON.parse(cutlist), dir),
        lock,
      }),
      bom: withStamp(await readFile(join(dir, "expected-bom.json"), "utf8"), "schema", { lock }),
    };
    for (const cmd of ["cutlist", "bom"] as const) {
      const r = await capture([cmd, dir, "--format", "json"]);
      expect(r.code, r.err).toBe(0);
      expect(`${r.out}\n`).toBe(expected[cmd]);
    }
  });
});

describe("restricted to the base frame's bars, the cart", () => {
  it("derives every bar alike: the same item, cut, centre line and end angles", async () => {
    const cart = await openProject(join(FIXTURES, "cart"));
    const base = await openProject(join(BASE, "cli"));
    const shape = (dir: typeof cart) => {
      const j = derivedJson(derive(dir.raw, dir.items)) as {
        bars: Record<string, Record<string, unknown> & { ends: Record<string, { by?: string }> }>;
      };
      // Connection ids differ (the cart's c5 is the base frame's c3): compare the planes.
      return Object.fromEntries(
        BARS.map((id) => {
          const b = j.bars[id] as (typeof j.bars)[string];
          const ends = Object.fromEntries(
            Object.entries(b.ends).map(([k, e]) => {
              const { by: _by, ...rest } = e;
              return [k, rest];
            }),
          );
          return [id, { ...b, ends }];
        }),
      );
    };
    expect(shape(base)).toEqual(shape(cart));
  });

  it("has the same cut list lines and bar lengths, so the same cut list and BOM", async () => {
    const cart = await openProject(join(FIXTURES, "cart"));
    const base = await openProject(join(BASE, "cli"));
    const outputs = (p: typeof cart) => {
      const derived = derive(p.raw, p.items);
      return {
        derived,
        cl: cutList({ derived, items: p.items }),
        b: bom({ derived, items: p.items }),
      };
    };
    const c = outputs(cart);
    const f = outputs(base);
    const inBase = (sources: readonly string[]) => sources.every((s) => BARS.includes(s));
    const lines = (o: typeof c) =>
      o.cl.groups.flatMap((g) =>
        g.lines.filter((l) => inBase(l.sources)).map((l) => ({ item: g.item, opt: g.opt, ...l })),
      );
    // Every base bar is in a line of its own kind in the cart: no cart bar shares its line.
    expect(
      lines(c)
        .flatMap((l) => l.sources)
        .sort(),
    ).toEqual([...BARS].sort());
    expect(lines(f)).toEqual(lines(c));
    // The BOM's bar lines are lengths by item: the cart's base bars sum to the base frame's.
    for (const line of f.b.groups.flatMap((g) => g.lines)) {
      const sum = line.sources.reduce(
        (s, id) => s + (c.derived.bars.get(id)?.lengths.centre ?? Number.NaN),
        0,
      );
      expect(sum, line.item).toBeCloseTo(line.length_mm ?? Number.NaN, 6);
    }
  });
});
