import { beforeAll, describe, expect, it } from "vitest";
import type { CatalogSet } from "#catalog/link.ts";
import { BUILTIN_DIR } from "#catalog/open.ts";
import { applyBatch } from "./commands/apply.ts";
import { stepWords } from "./commands/history.ts";
import type { RawDoc, State } from "./commands/types.ts";
import { derive } from "./derive/derive.ts";
import { emptyLock } from "./lock/schema.ts";
import { lockItems } from "./lock/source.ts";
import { openLiveCatalogs } from "./project/open.ts";

/**
 * The editing review's last three items, left for the core (docs/ux/review-editing.md m2, n2, n3
 * and §9.3; decisions in docs/ux/review-last-items-decisions.md):
 *
 * - m2: a copy that stands as an entity of its own numbers its label and says the tags it carries;
 * - n2: a step's words say one change of many entities once;
 * - n3: a step that composes an expression with constants folds them.
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

/** A7 as the app sends it: Duplicate of b13, the front top rail, 300 down (`0, 0, -300`). */
const A7 = {
  cmd: "array",
  args: { ids: ["b13"], along: { dir: [0, 0, -1] }, pitch_mm: 300, count: 2 },
};

let live: CatalogSet;
beforeAll(async () => {
  live = (await openLiveCatalogs(BUILTIN_DIR, NEW)).set;
});

function run(state: State, ...commands: object[]) {
  const r = applyBatch(state, commands, { ...ENV, live });
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.failed)}`);
  return { ...r, words: stepWords({ commands, results: r.results }) };
}

const frame = () => run({ doc: NEW, lock: emptyLock() }, ...FRAME).state;
const bars = (s: State) => s.doc.bars as Record<string, Record<string, unknown>>;

describe("m2: a copy of its own numbers its label and says the tags it carries", () => {
  it("A7: the rail copied 300 below the top is 'top rail, front (2)', still tagged top, and says so", () => {
    const s = frame();
    expect(bars(s).b13).toMatchObject({ label: "top rail, front", tags: ["top"] });
    const r = run(s, A7);
    expect(r.results[0]?.created).toEqual(["b17"]);
    expect(bars(r.state).b17).toMatchObject({ label: "top rail, front (2)", tags: ["top"] });
    // The original keeps its label: a copy is the second of that name.
    expect(bars(r.state).b13?.label).toBe("top rail, front");
    // The answer names the tags each copy carries, so a preview can say them (the app's Duplicate).
    expect(r.results[0]?.info).toMatchObject({ tagged: { b17: ["top"] } });
    expect(r.words).toBe("copy b13, making b17, tagged top");
  });

  it("numbers several copies in turn, and a copy of a copy after the last number taken", () => {
    const s = frame();
    const three = run(s, { ...A7, args: { ...A7.args, count: 3 } });
    expect(three.results[0]?.created).toEqual(["b17", "b18"]);
    expect(bars(three.state).b17?.label).toBe("top rail, front (2)");
    expect(bars(three.state).b18?.label).toBe("top rail, front (3)");
    // A copy of "top rail, front (2)" is "top rail, front (4)": the name's first free number.
    const again = run(three.state, { ...A7, args: { ...A7.args, ids: ["b17"] } });
    expect(bars(again.state).b19?.label).toBe("top rail, front (4)");
    // A number that is part of the name is the name's: only " (n)" counts as a copy's number.
    const named = run(s, { cmd: "label", args: { id: "b13", label: "rail 4040" } }).state;
    const copy = run(named, A7);
    expect(bars(copy.state).b17?.label).toBe("rail 4040 (2)");
    // An entity with no label gets none, and one with no tags says none.
    const plain = run(s, { cmd: "label", args: { id: "b13", label: null } }).state;
    const bare = run(run(plain, { cmd: "tag", args: { ids: ["b13"], remove: ["top"] } }).state, A7);
    expect(bars(bare.state).b17?.label).toBeUndefined();
    expect(bars(bare.state).b17?.tags).toBeUndefined();
    expect((bare.results[0]?.info as { tagged?: unknown } | undefined)?.tagged).toBeUndefined();
    expect(bare.words).toBe("copy b13, making b17");
  });

  it("mirror's images are copies of their own too; a live pattern's copies are the template's", () => {
    const s = frame();
    // b9, the front shelf rail, mirrored across y = 400: an image beyond the back, its ends open.
    const m = run(s, { cmd: "mirror", args: { ids: ["b9"], plane: { axis: "y", at_mm: 400 } } });
    const made = m.results[0]?.created[0] as string;
    expect(bars(m.state)[made]).toMatchObject({ label: "shelf rail, front (2)", tags: ["shelf"] });
    expect(m.results[0]?.info).toMatchObject({ tagged: { [made]: ["shelf"] } });
    expect(m.words).toMatch(/, tagged shelf/);

    // A live pattern's copies are instances of the template, named by their ids (b13@1): the
    // document holds no copy to label. Exploding it makes them entities, numbered as array's.
    const p = run(s, {
      cmd: "addPattern",
      args: { template: ["b13"], along: { dir: [0, 0, -1] }, pitch_mm: 100, count: 3 },
    }).state;
    const x = run(p, { cmd: "explodePattern", args: { id: "pt1" } });
    expect(x.results[0]?.created).toEqual(["b17", "b18"]);
    expect(bars(x.state).b17).toMatchObject({ label: "top rail, front (2)", tags: ["top"] });
    expect(bars(x.state).b18).toMatchObject({ label: "top rail, front (3)", tags: ["top"] });
  });
});

describe("n2: a step says one change of many entities once", () => {
  /** A4 as the app sends it: the four legs to the 40 × 80, rolled a quarter, each anchor turned. */
  const a4 = (ids: readonly string[]) =>
    ids.map((id, i) => ({
      cmd: "setBar",
      args: { id, set: { roll_deg: 90, anchor: i % 2 === 0 ? "-x+y" : "-x-y" } },
    }));

  it("names the fields once and the entities after them", () => {
    const s = frame();
    expect(run(s, ...a4(["b1", "b2", "b3", "b4"])).words).toBe(
      "change the roll and anchor of b1, b2, b3 and b4",
    );
    // A long list is bounded, as every list of ids in words is.
    expect(run(s, ...a4(["b1", "b2", "b3", "b4", "b5", "b6"])).words).toBe(
      "change the roll and anchor of b1, b2, b3 and 3 more",
    );
    // One entity reads as before; different changes are said apart, each once.
    expect(run(s, ...a4(["b1"])).words).toBe("change b1's roll and anchor");
    expect(
      run(
        s,
        ...a4(["b1", "b2"]),
        { cmd: "setBar", args: { id: "b3", set: { roll_deg: 90 } } },
        { cmd: "setBar", args: { id: "b4", set: { roll_deg: 90 } } },
      ).words,
    ).toBe("change the roll and anchor of b1 and b2, change the roll of b3 and b4");
  });
});

describe("n3: a step that composes an expression with constants folds them", () => {
  it("Move writes H - 400 for the copy at H - 300 moved 100 down, its value unchanged", () => {
    const copied = run(frame(), A7).state;
    expect(bars(copied).b17?.a).toEqual([0, 0, "H - 300"]);
    const r = run(copied, { cmd: "transform", args: { ids: ["b17"], by: [0, 0, -100] } });
    expect(bars(r.state).b17).toMatchObject({ a: [0, 0, "H - 400"], b: ["W", 0, "H - 400"] });
    expect(r.results[0]?.info).toMatchObject({ kept: ["b17.a z: H - 400"] });
    expect(r.words).toBe("move b17 by [0, 0, -100], keeping b17.a z: H - 400");

    // The text is all that moves: the document written unfolded derives the same, to the bit.
    const unfolded = structuredClone(r.state.doc) as RawDoc;
    const b17 = (unfolded.bars as Record<string, Record<string, unknown>>).b17 as Record<
      string,
      unknown
    >;
    b17.a = [0, 0, "H - 300 - 100"];
    b17.b = ["W", 0, "H - 300 - 100"];
    const items = lockItems(r.state.lock);
    const at = (doc: RawDoc) => {
      const d = derive(doc, items).bars.get("b17");
      return [d?.placed.A, d?.placed.B, d?.lengths];
    };
    expect(at(r.state.doc)).toEqual(at(unfolded));
  });
});
