import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { V3 } from "../../mesh/model.ts";
import { type ActionContext, actionsFor } from "../actions/registry.ts";
import { splitBatch } from "../edit/batches.ts";
import type { Model } from "../model.ts";
import { viewOf } from "../testing.ts";
import { barActions } from "./barActions.ts";

/**
 * A bar's actions on the menu (docs/ux/editing-audit.md E4.3, E-UX-21): Split here, at the
 * station the menu was opened on; Split at a typed distance; Reverse. Each is one existing
 * command (`splitBar`, `reverseBar`), as `alukit do` sends it. On base-frame/cli: b9, the front
 * base rail, runs 1200 along X from post b1 to post b2, butted into each; the cart's b11 and b12
 * are run r1.
 */

let root: string;
let frame: Model;
let cart: Model;
beforeAll(async () => {
  root = await scratchFixtures();
  frame = await viewOf(join(root, "base-frame", "cli"));
  cart = await viewOf(join(root, "cart"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
});

const p: V3 = [400, 0, 100];
const on = (m: Model, ids: string[], hit?: ActionContext["hit"]): ActionContext => ({
  m,
  selection: new Set(ids),
  ...(hit ? { hit } : {}),
  from: "view",
});
const entry = (c: ActionContext, id: string) => actionsFor(c).find((x) => x.action.id === id);
const title = (c: ActionContext, id: string) => {
  const t = entry(c, id)?.action.title;
  return typeof t === "function" ? t(c) : t;
};

describe("split (E4.3)", () => {
  it("builds one splitBar inside the bar, or says why not", () => {
    expect(splitBatch(frame, "b9", 400)).toEqual([
      { cmd: "splitBar", args: { id: "b9", at_mm: 400 } },
    ]);
    expect(splitBatch(frame, "b9", 400, { splice: true })).toEqual([
      { cmd: "splitBar", args: { id: "b9", at_mm: 400, splice: true } },
    ]);
    expect(splitBatch(frame, "b9", 1200)).toEqual({
      why: "split b9 inside it: between 0 and its length, 1200 mm",
    });
    expect(splitBatch(cart, "b26@2", 100)).toEqual({
      why: "b26@2 is a pattern copy: split its template, b26",
    });
    expect(splitBatch(frame, "c1", 100)).toEqual({ why: "c1 is not a bar" });
  });

  it("splits b9 at 400 into two bars whose cuts sum to b9's", async () => {
    const dir = join(root, "base-frame", "split");
    await cp(join(root, "base-frame", "cli"), dir, { recursive: true });
    const batch = splitBatch(frame, "b9", 400);
    if ("why" in batch) throw new Error(batch.why);
    const m = await viewOf(dir, batch);
    // The posts stand inside the W × D rectangle (anchors -x-y and +x-y): b1 from x = 0 to 40,
    // b2 from 1160 to 1200, so b9 is cut 1120. b9 keeps end a, from b1's face to the split
    // (360); the new b11 takes end b, from the split to b2's face (760).
    expect(frame.derived.bars.b9?.cut_mm).toBe(1120);
    expect(m.derived.bars.b9?.cut_mm).toBe(360);
    expect(m.derived.bars.b11?.cut_mm).toBe(760);
    expect(Object.keys(m.derived.bars).length).toBe(Object.keys(frame.derived.bars).length + 1);
  });

  it("offers Split here at the station the menu opened on, to the whole millimetre", () => {
    offs.push(barActions());
    const hit = {
      id: "b9",
      p,
      normal: [0, -1, 0] as V3,
      face: "-y" as const,
      station: { bar: "b9", at_mm: 399.6 },
    };
    const c = on(frame, ["b9"], hit);
    expect(title(c, "split-here")).toBe("Split b9 here, 400 mm from end a");
    expect(entry(c, "split-here")?.enabled).toBe(true);
    // Without a station (the menu key, the selection header) only the typed split applies.
    expect(entry(on(frame, ["b9"]), "split-here")).toBeUndefined();
    expect(title(on(frame, ["b9"]), "split-at")).toBe("Split b9 at…");
    // A station on another bar than the one selected is no split of it.
    const elsewhere = { ...hit, id: "b1", station: { bar: "b1", at_mm: 300 } };
    expect(entry(on(frame, ["b9"], elsewhere), "split-here")).toBeUndefined();
  });
});

describe("reverse (E4.3)", () => {
  it("offers Reverse on a bar, and says why not on a run's bar or a copy", () => {
    offs.push(barActions());
    expect(title(on(frame, ["b9"]), "reverse")).toBe("Reverse b9");
    expect(entry(on(frame, ["b9"]), "reverse")?.enabled).toBe(true);
    expect(entry(on(cart, ["b11"]), "reverse")?.enabled).toBe(
      "b11 is in run r1, whose bars all point the same way: reverse the run",
    );
    expect(entry(on(cart, ["b26@2"]), "reverse")).toBeUndefined();
    expect(entry(on(frame, ["b9", "b10"]), "reverse")).toBeUndefined();
  });
});
