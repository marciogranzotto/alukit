import { describe, expect, it } from "vitest";
import { jointWords } from "./joint.ts";

/** The joint preview's words (S5.6): what a drawn bar's dry run says auto-connect will do. */

const bar = { cmd: "addBar", created: ["b2"], removed: [], changed: [] };
const join = (through: string, ends: string[]) => ({
  cmd: "autoConnect",
  created: ["c1"],
  removed: [],
  changed: [],
  info: { through, ends },
});
const nothing = { cmd: "autoConnect", created: [], removed: [], changed: [] };

describe("joint preview", () => {
  it("says which bar runs through and what each cut becomes", () => {
    // A rail drawn onto a post's top, under the upright rule: the rail butts, the post grows.
    const upright = jointWords(
      {
        results: [bar, nothing, join("b1", ["b2.b"])],
        effects: {
          cuts: { b1: [800, 820] },
          added: { b2: 580 },
          removed: [],
          claimed: ["b1.b", "b2.b"],
        },
      },
      "b2",
    );
    expect(upright.text).toBe("will butt on b1 · cut 580 · b1 800 → 820");
    expect(upright.joins).toBe(true);
    // The same under the X rule: the rail runs through, the post butts on it.
    const x = jointWords(
      {
        results: [bar, nothing, join("b2", ["b1.b"])],
        effects: {
          cuts: { b1: [800, 780] },
          added: { b2: 620 },
          removed: [],
          claimed: ["b1.b", "b2.b"],
        },
      },
      "b2",
    );
    expect(x.text).toBe("b1 will butt on it · cut 620 · b1 800 → 780");
    expect(x.shape).not.toBe(upright.shape);
  });

  it("names a through end by its bar, and joins at both ends", () => {
    const w = jointWords(
      {
        results: [bar, join("b1.b", ["b2.a"]), join("b3", ["b2.b"])],
        effects: { cuts: {}, added: { b2: 560 }, removed: [], claimed: ["b2.a", "b2.b"] },
      },
      "b2",
    );
    expect(w.text).toBe("will butt on b1 · will butt on b3 · cut 560");
  });

  it("says so when nothing joins", () => {
    const w = jointWords(
      {
        results: [bar, nothing, nothing],
        effects: { cuts: {}, added: { b2: 600 }, removed: [], claimed: [] },
      },
      "b2",
    );
    expect(w).toMatchObject({ text: "no joint: the ends stay open · cut 600", joins: false });
  });
});
