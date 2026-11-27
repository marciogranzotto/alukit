import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { BarJson, V3 } from "../mesh/model.ts";
import type { Model } from "../ui/model.ts";
import { viewOf } from "../ui/testing.ts";
import { barHit, hitOn } from "./pick.ts";
import { faceLocal, findSnap, type P2, type Ray, snapTargets } from "./snap.ts";

/**
 * Picking with a face (editing audit E0.3) and what the view hides (E0.5), on the cart: a ray at
 * a known point of b1 gives b1, the face it enters and its station, found from the derived model;
 * a snap passes over a hidden bar's targets.
 */

let cart: Model;
let root: string;
beforeAll(async () => {
  root = await scratchFixtures();
  cart = await viewOf(join(root, "cart"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

/** The middle of a bar's side face, `s` along it from its design point a. */
function onFace(bar: BarJson, face: "+x" | "-x" | "+y" | "-y", s: number): V3 {
  const [lx, ly] = faceLocal(bar.box_mm, face);
  return add(add(add(bar.a, bar.frame.x, lx), bar.frame.y, ly), bar.frame.z, s);
}

describe("a pick's face and station", () => {
  it("a ray at b1's +x face, 300 along it, enters there", () => {
    const b1 = cart.derived.bars.b1 as BarJson;
    const at = onFace(b1, "+x", 300);
    const ray: Ray = { o: add(at, b1.frame.x, 500), d: neg(b1.frame.x) };
    const h = barHit(ray, b1);
    expect(h).toMatchObject({ face: "+x", at_mm: 300, normal: b1.frame.x });
    for (let i = 0; i < 3; i++) expect(h?.p[i]).toBeCloseTo(at[i] as number, 6);
    // As the viewer reports it: the raycast's point, with the face and station from the model.
    expect(hitOn(cart.derived.bars, "b1", ray, at, [0, 0, 1])).toEqual({
      id: "b1",
      p: at,
      normal: b1.frame.x,
      face: "+x",
      station: { bar: "b1", at_mm: 300 },
    });
  });

  it("a ray down b1's axis enters by its end b; a part's hit keeps the raycast's normal", () => {
    const b1 = cart.derived.bars.b1 as BarJson;
    const mid = onFace(b1, "+x", 0);
    const inside = add(mid, b1.frame.x, -5);
    const ray: Ray = { o: add(inside, b1.frame.z, 5000), d: neg(b1.frame.z) };
    // End b is cut where its butt puts it, at its end plane, not at the design point.
    const cut = (b1.ends.b.point[2] - b1.a[2]) * b1.frame.z[2];
    expect(cut).toBeLessThan(b1.len_mm);
    expect(barHit(ray, b1)).toMatchObject({ face: "b", at_mm: cut, normal: b1.ends.b.normal });
    // A ray beside the bar misses it.
    expect(barHit({ o: add(ray.o, b1.frame.x, 100), d: ray.d }, b1)).toBeUndefined();
    const part = Object.keys(cart.derived.parts)[0] as string;
    expect(hitOn(cart.derived.bars, part, ray, [1, 2, 3], [0, 1, 0])).toEqual({
      id: part,
      p: [1, 2, 3],
      normal: [0, 1, 0],
    });
  });
});

describe("what the view hides", () => {
  it("a snap passes over a hidden bar's targets", () => {
    const b1 = cart.derived.bars.b1 as BarJson;
    // Looking along +y at b1's -y face, 1 px a millimetre (the cart's other posts stand behind
    // it, farther from the eye): screen x along the bar, screen y down its x.
    const dotA = (p: V3, u: V3) =>
      (p[0] - b1.a[0]) * u[0] + (p[1] - b1.a[1]) * u[1] + (p[2] - b1.a[2]) * u[2];
    const project = (p: V3): P2 => [dotA(p, b1.frame.z), -dotA(p, b1.frame.x)];
    const centre = onFace(b1, "-y", b1.len_mm / 2);
    const o = {
      at: project(centre),
      ray: { o: add(centre, b1.frame.y, -5000), d: b1.frame.y },
      project,
    };
    const targets = snapTargets({
      nodes: cart.derived.nodes,
      bars: cart.derived.bars,
      parts: cart.derived.parts,
      display: cart.display,
    });
    expect(findSnap(targets, o)?.label).toBe("b1 -y face centre");
    const hidden = findSnap(targets, { ...o, skip: new Set(["b1"]) });
    expect(hidden?.label ?? "").not.toMatch(/\bb1\b/);
  });
});
