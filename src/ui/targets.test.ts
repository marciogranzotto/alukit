import { describe, expect, it } from "vitest";
import { resolveTargets } from "./targets.ts";
import { SMALL } from "./testing.ts";

/** What refs stand for in the scene (targets.ts), as far as S0's start goes. */

describe("resolveTargets", () => {
  it("resolves an entity, a part of one and a copy to the entities, once each", () => {
    expect(resolveTargets(SMALL, ["b1.a", "b1.b", "c1", "c1.f1", "b26@1", "p1", "n1"]).ids).toEqual(
      ["b1", "c1", "b26@1", "p1", "n1"],
    );
  });

  it("resolves what is not an entity to nothing yet: items, open items, suppliers, corners", () => {
    const t = resolveTargets(SMALL, ["forseti:PF40-01", "project:plate-a", "O1", "supplier:x"]);
    expect(t).toEqual({ ids: [], points: [] });
    expect(resolveTargets(SMALL, ["corner:0,0,0", "b9"]).ids).toEqual([]);
  });
});
