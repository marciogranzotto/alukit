import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { Model } from "../model.ts";
import { viewOf } from "../testing.ts";
import { moveNodeAt, moveNodeOn, nodePlace, nodeUsers } from "./node.ts";

/**
 * A node's fields (docs/ux/editing-audit.md E4.7): a tripod whose three legs end at node n1,
 * built on base-frame/empty, and G27's n1, which a shoe's end and its plane both use.
 */

let root: string;
let tripod: Model;
let tripodDir: string;
const TRIPOD = [
  { cmd: "addNode", args: { at: [500, 0, 600] } },
  { cmd: "addBar", args: { a: [0, 0, 0], b: "n1" } },
  { cmd: "addBar", args: { a: [1000, 0, 0], b: "n1" } },
  { cmd: "addBar", args: { a: [500, 300, 0], b: "n1" } },
  { cmd: "addNode", args: { on: { bar: "b1", at_mm: 100 } } },
];
beforeAll(async () => {
  root = await scratchFixtures();
  tripodDir = join(root, "base-frame", "tripod");
  await cp(join(root, "base-frame", "empty"), tripodDir, { recursive: true });
  tripod = await viewOf(tripodDir, TRIPOD);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("a node's fields (E4.7)", () => {
  it("says where a node is and what uses it", async () => {
    expect(nodePlace(tripod, "n1")).toEqual({ kind: "at", at: [500, 0, 600] });
    expect(nodePlace(tripod, "n2")).toEqual({ kind: "on", on: { bar: "b1", at_mm: 100 } });
    expect(nodeUsers(tripod, "n1")).toEqual(["b1.b", "b2.b", "b3.b"]);
    const g27 = await viewOf(join(root, "golden-ends", "G27"));
    // The shoe's end b is at n1, and so is its plane's point: one end.
    expect(nodeUsers(g27, "n1")).toEqual(["b2.b"]);
  });

  it("moves a node by a field, and every bar end at it follows, as moveNode does", async () => {
    const step = moveNodeAt(tripod, "n1", 2, 700);
    expect(step).toEqual({ cmd: "moveNode", args: { id: "n1", at: [500, 0, 700] } });
    expect(moveNodeAt(tripod, "n1", 0, "W / 2")).toEqual({
      cmd: "moveNode",
      args: { id: "n1", at: ["W / 2", 0, 600] },
    });
    const dir = join(root, "base-frame", "tripod-moved");
    await cp(tripodDir, dir, { recursive: true });
    const m = await viewOf(dir, [step]);
    for (const b of ["b1", "b2", "b3"]) expect(m.derived.bars[b]?.b).toEqual([500, 0, 700]);
  });

  it("moves a node along its bar by its station's fields", () => {
    expect(moveNodeOn(tripod, "n2", { at_mm: 250 })).toEqual({
      cmd: "moveNode",
      args: { id: "n2", on: { bar: "b1", at_mm: 250 } },
    });
    expect(moveNodeOn(tripod, "n2", { face: "+x", from: "b" })).toEqual({
      cmd: "moveNode",
      args: { id: "n2", on: { bar: "b1", at_mm: 100, face: "+x", from: "b" } },
    });
    expect(moveNodeOn(tripod, "n2", { from: "a", face: "" })).toEqual({
      cmd: "moveNode",
      args: { id: "n2", on: { bar: "b1", at_mm: 100 } },
    });
    expect(moveNodeOn(tripod, "n1", { at_mm: 1 })).toEqual({ why: "n1 is not on a bar" });
  });
});
