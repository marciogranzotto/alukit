import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { beforeAll, describe, expect, it } from "vitest";
import { derive } from "../derive/derive.ts";
import { LockFile } from "../lock/schema.ts";
import { lockItems } from "../lock/source.ts";
import { openLiveCatalogs } from "../project/open.ts";
import { FIXTURES, latticeBatch, readJson } from "../testing.ts";
import { applyBatch } from "./apply.ts";
import type { CommandEnv, RawDoc, State } from "./types.ts";

/**
 * What a step costs on a large project (review M6), measured against one derive of it in the
 * same process, so the budget holds under any load. The project is the review's lattice, built
 * in tests/fixtures/ux/lattice (a project with nothing in it) by `latticeBatch`: 84 box frames,
 * 1,008 bars and 672 butts.
 */

const LATTICE = join(FIXTURES, "ux", "lattice");

let state: State;
let env: CommandEnv;
beforeAll(async () => {
  const doc = readJson(join(LATTICE, "alukit.json")) as RawDoc;
  const lock = LockFile.parse(readJson(join(LATTICE, "alukit.lock.json")));
  env = { today: "2026-11-27", live: (await openLiveCatalogs(LATTICE, doc)).set };
  const r = applyBatch({ doc, lock }, latticeBatch(), env);
  if (!r.ok) throw new Error(JSON.stringify(r.failed));
  state = r.state;
}, 60_000);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

/** The median of five runs, after one to warm up. */
function timed(f: () => void): number {
  f();
  const ts: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    f();
    ts.push(performance.now() - t0);
  }
  return median(ts);
}

describe("a step on the 1,008-bar lattice (review M6)", () => {
  it("is the lattice: 1,008 bars and 672 butts, every corner joined", () => {
    const d = derive(state.doc, lockItems(state.lock));
    expect(d.bars.size).toBe(1008);
    expect(Object.keys(state.doc.connections as object)).toHaveLength(672);
    expect(d.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
  });

  it("moves a frame and asks for a join at each of its 24 ends for a few derives, not 25", () => {
    // The second frame, moved up by 300 with follow, then an autoConnect at each of its ends:
    // every one finds its end joined already. Before, each command derived the model again and
    // looked again at every item the document names: about 25 derives.
    const bars = Array.from({ length: 12 }, (_, i) => `b${i + 13}`);
    const batch = [
      { cmd: "transform", args: { ids: bars, by: [0, 0, 300] } },
      ...bars.flatMap((b) =>
        ["a", "b"].map((e) => ({ cmd: "autoConnect", args: { end: `${b}.${e}`, optional: true } })),
      ),
    ];
    const one = timed(() => derive(state.doc, lockItems(state.lock)));
    const step = timed(() => {
      const r = applyBatch(state, batch, env);
      if (!r.ok) throw new Error(JSON.stringify(r.failed));
    });
    // The transform reads the state and checks the one it leaves: two derives, and the rest is
    // small. Five is a generous budget; before, the ratio was about 25.
    expect(step / one, `step ${step.toFixed(0)} ms, one derive ${one.toFixed(0)} ms`).toBeLessThan(
      5,
    );
  });
});
