import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import { type Corner, cornerKey, cornerRef, cornersOf, pointKey } from "./corners.ts";
import type { Model } from "./model.ts";
import { viewOf } from "./testing.ts";

/**
 * Corners (D-UX-10), derived in the browser from the view model: on the cart, which a person
 * built by hand, and on a ground rectangle drawn bar by bar, auto-connected, then with its
 * butts removed. Every expectation below is read off the fixture's coordinates by hand.
 */

let root: string;
let cart: Model;
beforeAll(async () => {
  root = await scratchFixtures();
  cart = await viewOf(join(root, "cart"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const at = (cs: readonly Corner[], key: string) => cs.find((c) => c.key === key);

/** A 1000 × 600 rectangle on the ground, b1 to b4 around it, ends meeting at its corners. */
const RECTANGLE = [
  { cmd: "addBar", args: { a: [0, 0, 0], b: [1000, 0, 0] } },
  { cmd: "addBar", args: { a: [1000, 0, 0], b: [1000, 600, 0] } },
  { cmd: "addBar", args: { a: [1000, 600, 0], b: [0, 600, 0] } },
  { cmd: "addBar", args: { a: [0, 600, 0], b: [0, 0, 0] } },
];
const CORNERS = ["0,0,0", "1000,0,0", "1000,600,0", "0,600,0"];

describe("cornersOf: the cart", () => {
  it("finds where ends meet and where an end meets another bar's line, and nothing else", () => {
    const cs = cornersOf(cart);
    // The four top corners: a post, the long rail and the short rail, every end claimed by the
    // butt through the long rail (c1 at the front, c2 at the back).
    expect(at(cs, "0,0,900")).toEqual({
      key: "0,0,900",
      at: [0, 0, 900],
      state: "joined",
      through: "b5",
      ends: ["b1.b", "b5.a", "b7.a"],
      bars: ["b1", "b5", "b7"],
      connections: ["c1"],
    });
    expect(at(cs, "1200,600,900")).toMatchObject({
      state: "joined",
      through: "b6",
      ends: ["b4.b", "b6.b", "b8.b"],
      connections: ["c2"],
    });
    // A T: the base rail b9's end on the post b1's line, 100 above the floor.
    expect(at(cs, "0,0,100")).toMatchObject({
      state: "joined",
      through: "b1",
      ends: ["b9.a"],
      bars: ["b1", "b9"],
      connections: ["c5"],
    });
    // A splice: two ends, no bar through. A pattern copy's T, its copied butt claiming it.
    expect(at(cs, "700,300,900")).toMatchObject({
      state: "joined",
      ends: ["b11.b", "b12.a"],
      connections: ["c9"],
    });
    expect(at(cs, "700,300,900")?.through).toBeUndefined();
    expect(at(cs, "300,0,100")).toMatchObject({
      state: "joined",
      through: "b9",
      ends: ["b26@1.a"],
      connections: ["c26@1"],
    });
    // An end plate: b32.b bears on b31's end b, which no connection claims but which the butt
    // names as its through member: joined, as the check has it, and no bar runs through.
    expect(at(cs, "1350,20,800")).toMatchObject({
      state: "joined",
      ends: ["b31.b", "b32.b"],
      connections: ["c33"],
    });
    expect(at(cs, "1350,20,800")?.through).toBeUndefined();
  });

  it("makes no corner of a lone end, a pivot's foot, an offset butt or a rail along a profile", () => {
    const keys = new Set(cornersOf(cart).map((c) => c.key));
    // Post feet on the floor; the hinged braces' ends (c13, c14), off any bar's line.
    for (const k of ["0,0,0", "55,20,650", "400,20,135"]) expect(keys.has(k), k).toBe(false);
    // b31.a butts into b2 20 mm off b2's line: a connection at no corner.
    expect(keys.has("1200,20,800")).toBe(false);
    // The linear rail b33 lies along the profile b11: its free end is no T.
    expect(keys.has("130,300,900")).toBe(false);
    // Its splice with b34 sits on b11's line, but along it: a corner of two ends, b11 not in it.
    expect(at(cornersOf(cart), "600,300,900")?.bars).toEqual(["b33", "b34"]);
  });

  it("counts every corner of the cart, all joined, in a stable order", () => {
    const cs = cornersOf(cart);
    // 4 top corners; base rails b9, b10 on the posts (4 T's); the top mid rails b11, b12 (2 T's
    // and the splice); b13 on b12; b18 on b9 and b10; the slats b26 and its 5 copies on b9 and
    // b10 (12); the diagonals b27 to b30 on the rails (8); the end plate; the RAIL20 splice.
    expect(cs).toHaveLength(4 + 4 + 3 + 1 + 2 + 12 + 8 + 1 + 1);
    expect(cs.map((c) => c.state).every((s) => s === "joined")).toBe(true);
    expect(cornersOf(cart)).toEqual(cs);
    expect(new Set(cs.map((c) => c.key)).size).toBe(cs.length);
  });
});

describe("cornersOf: a rectangle drawn bar by bar", () => {
  it("auto-connected: 4 joined corners and none open; without the butts: 4 open", async () => {
    const dir = join(root, "base-frame", "empty");
    const joined = await viewOf(
      dir,
      RECTANGLE,
      CORNERS.map((k) => ({ cmd: "autoConnect", args: { at: k.split(",").map(Number) } })),
    );
    const cs = cornersOf(joined);
    expect(cs.map((c) => c.key).sort()).toEqual([...CORNERS].sort());
    expect(cs.map((c) => c.state)).toEqual(["joined", "joined", "joined", "joined"]);
    for (const c of cs) {
      expect(c.ends).toHaveLength(2);
      expect(c.connections).toHaveLength(1);
      expect(c.through).toBeDefined();
    }

    const conns = Object.keys((joined.doc.connections ?? {}) as object);
    expect(conns).toHaveLength(4);
    const open = await viewOf(
      dir,
      conns.map((id) => ({ cmd: "removeEntity", args: { id } })),
    );
    const os = cornersOf(open);
    expect(os.map((c) => c.state)).toEqual(["open", "open", "open", "open"]);
    expect(os.every((c) => c.connections.length === 0 && c.through === undefined)).toBe(true);
  });

  it("fails a corner whose end has two providers, and names both", async () => {
    // G1: b2 butts into b1's end at (1000, 0, 0) through c1. A second butt on b2.a gives it two
    // providers: an error, and the end falls back to the default (unclaimed), yet it is failed,
    // not merely open.
    const dir = join(root, "golden-ends", "G01");
    expect(at(cornersOf(await viewOf(dir)), "1000,0,0")?.state).toBe("joined");
    const two = await viewOf(dir, [
      { cmd: "addConnection", args: { type: "butt", through: "b1", ends: ["b2.a"] } },
    ]);
    const c = at(cornersOf(two), "1000,0,0");
    expect(c?.state).toBe("failed");
    expect(c?.ends).toEqual(["b1.b", "b2.a"]);
    expect(c?.connections).toEqual(["c1", "c2"]);
  });
});

describe("corner refs and keys", () => {
  it("writes a point to 0.01 mm with no trailing zeros, and reads a ref back", () => {
    expect(pointKey([0, -0, 12.5])).toBe("0,0,12.5");
    expect(pointKey([1000.004, 600.006, -0.001])).toBe("1000,600.01,0");
    expect(cornerRef("0,0,0")).toBe("corner:0,0,0");
    expect(cornerKey("corner:0,0,0")).toBe("0,0,0");
    expect(cornerKey("b1")).toBeUndefined();
  });
});
