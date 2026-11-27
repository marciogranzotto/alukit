import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { V3 } from "../mesh/model.ts";
import type { Model } from "./model.ts";
import { resolveTargets } from "./targets.ts";
import { SMALL, viewOf } from "./testing.ts";

/** What refs stand for in the scene (targets.ts): on S0's small model, and on the cart. */

let root: string;
let cart: Model;
beforeAll(async () => {
  root = await scratchFixtures();
  cart = await viewOf(join(root, "cart"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const inside = (p: V3, box: [V3, V3] | undefined) =>
  box !== undefined &&
  p.every((c, i) => c >= (box[0][i] as number) - 1e-9 && c <= (box[1][i] as number) + 1e-9);

describe("resolveTargets", () => {
  it("resolves an entity, a part of one and a copy to the entities, once each", () => {
    expect(resolveTargets(SMALL, ["b1.a", "b1.b", "c1", "c1.f1", "b26@1", "p1", "n1"]).ids).toEqual(
      ["b1", "c1", "b26@1", "p1", "n1"],
    );
  });

  it("resolves to nothing what the model does not hold", () => {
    const t = resolveTargets(SMALL, ["forseti:PF40-01", "project:plate-a", "O1", "supplier:x"]);
    expect(t).toEqual({ ids: [], points: [] });
    expect(resolveTargets(SMALL, ["corner:0,0,0", "b9"]).ids).toEqual([]);
  });

  it("an end: its bar, at the end's point; a bar: at its middle", () => {
    const t = resolveTargets(cart, ["b9.b", "b1"]);
    expect(t.ids).toEqual(["b9", "b1"]);
    expect(t.points).toEqual([cart.derived.bars.b9?.ends.b.point, [0, 0, 450]]);
    // The box holds both bodies: b1 is a 40 mm post anchored −x−y, from the floor to the top
    // rail it butts under (cut 860).
    expect(t.box?.[0]).toEqual([0, 0, 0]);
    expect(t.box?.[1][2]).toBeCloseTo(860, 6);
  });

  it("a connection: itself, then its bars, at its first fastener (c35: a face joint of two runs)", () => {
    const t = resolveTargets(cart, ["c35"]);
    // c35 joins the runs r2 (b33, b34) and r1 (b11, b12): the bars are drawn, the runs are not.
    expect(t.ids).toEqual(["c35", "b33", "b34", "b11", "b12"]);
    const f = cart.display.fasteners.find((x) => x.connection === "c35");
    expect(t.points[0]).toEqual(f?.head);
    for (const id of ["b11", "b12", "b33", "b34"]) {
      const e = cart.derived.bars[id]?.ends;
      expect(inside(e?.a.point as V3, t.box) && inside(e?.b.point as V3, t.box), id).toBe(true);
    }
    // A butt: its butting end and the bar it bears on; a copy's butt, from the derived butts.
    expect(resolveTargets(cart, ["c5"]).ids).toEqual(["c5", "b9", "b1"]);
    expect(resolveTargets(cart, ["c26@1"]).ids).toEqual(["c26@1", "b26@1", "b9"]);
  });

  it("an item: what uses it; an open item: its scope; a supplier: its lines' items", () => {
    // The sensor bracket, a bent angle the project makes, is p7; O2 is scoped to the item.
    const angle = resolveTargets(cart, ["project:angle-a"]);
    expect(angle.ids).toEqual(["p7"]);
    expect(resolveTargets(cart, ["O2"]).ids).toEqual(["p7"]);
    // O1 is scoped to c35.
    expect(resolveTargets(cart, ["O1"]).ids).toEqual(resolveTargets(cart, ["c35"]).ids);
    // The RHS beam is one bar; the 40 mm profile is most of the frame.
    expect(resolveTargets(cart, ["test-geo:RHS-100x50x4"]).ids).toEqual(["b18"]);
    expect(resolveTargets(cart, ["test:TS40"]).ids.length).toBeGreaterThan(20);
    const order = { suppliers: [{ supplier: "local", lines: [{ item: "project:angle-a" }] }] };
    expect(resolveTargets(cart, ["supplier:local"], { order }).ids).toEqual(["p7"]);
    expect(resolveTargets(cart, ["supplier:local"]).ids).toEqual([]);
  });

  it("a corner: its bars, at its point; a run: its bars; a pattern: template and copies", () => {
    const c = resolveTargets(cart, ["corner:0,0,900"]);
    expect(c.ids).toEqual(["b1", "b5", "b7"]);
    expect(c.points).toEqual([[0, 0, 900]]);
    expect(resolveTargets(cart, ["r1"]).ids).toEqual(["r1", "b11", "b12"]);
    const pt = resolveTargets(cart, ["pt1"]).ids;
    expect(pt.slice(0, 4)).toEqual(["pt1", "b26", "c26", "c27"]);
    expect(pt).toContain("b26@6");
  });

  it("no refs: the whole model's box, nothing to select", () => {
    const t = resolveTargets(cart, []);
    expect(t.ids).toEqual([]);
    expect(inside([0, 0, 0], t.box) && inside([1200, 600, 900], t.box)).toBe(true);
  });
});
