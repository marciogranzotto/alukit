import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemsAnswer } from "#core/problems/types.ts";
import { scratchFixtures } from "#core/testing.ts";
import { capture } from "../../cli/testing.ts";
import type { Model } from "../model.ts";
import { viewOf } from "../testing.ts";
import { barJoints, jointLine, joinVerdict, openCorner } from "./joints.ts";
import { endWords } from "./words.ts";

/**
 * A bar's joints and its ends' state as the core judges them (docs/ux/review-editing.md M7, m12),
 * on scratch copies: A12's T-nut plate on the cart, and on an empty project an open corner the
 * default butt joins (b1, b2), a mitred corner with a third end nothing butts on (b5) and an end
 * that meets nothing (b5.b). Each verdict is the check's and the problem list's, read back.
 */

let root: string;
let plate: Model;
let corners: Model;
let cornerProblems: ProblemsAnswer;

const PLATE = [
  { cmd: "addBar", args: { item: "test:TS40", a: [0, 2000, 0], b: [400, 2000, 0], anchor: "-y" } },
  {
    cmd: "addBar",
    args: { item: "test-geo:FB-50x20", a: [0, 2000, 40], b: [400, 2000, 40], anchor: "-y" },
  },
  {
    cmd: "addConnection",
    args: {
      type: "face",
      bars: ["b36", "b35"],
      fastening: "tnut",
      fastener: "test-gen:SCR-M5x25",
      stack: ["test-gen:TNUT-M5"],
      stations: { at_mm: [100, 300] },
      label: "T-nut plate",
    },
  },
];

const CORNERS = [
  { cmd: "addBar", args: { a: [0, 0, 0], b: [500, 0, 0] } },
  { cmd: "addBar", args: { a: [500, 0, 0], b: [500, 400, 0] } },
  { cmd: "addBar", args: { a: [1500, 0, 0], b: [2000, 0, 0] } },
  { cmd: "addBar", args: { a: [2000, 0, 0], b: [2000, 400, 0] } },
  { cmd: "addConnection", args: { type: "miter", ends: ["b3.b", "b4.a"] } },
  { cmd: "addBar", args: { a: [2000, 0, 0], b: [2000, 0, 400] } },
];

beforeAll(async () => {
  root = await scratchFixtures();
  plate = await viewOf(join(root, "cart"), PLATE);
  const dir = join(root, "base-frame", "corners");
  await cp(join(root, "base-frame", "empty"), dir, { recursive: true });
  corners = await viewOf(dir, CORNERS);
  const r = await capture(["problems", dir, "--json"]);
  cornerProblems = JSON.parse(r.out) as ProblemsAnswer;
  cornerProblems.rev = corners.rev;
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("a bar's ends, as the check judges them", () => {
  it("calls an end open only where the check finds an open corner", () => {
    expect(openCorner(corners, "b2.a")?.code).toBe("unconnected");
    expect(openCorner(corners, "b1.b")?.code).toBe("unconnected");
    expect(openCorner(corners, "b5.a")?.code).toBe("unconnected");
    // The mitred ends are claimed; an end that meets nothing is no corner.
    expect(openCorner(corners, "b3.b")).toBeUndefined();
    expect(openCorner(corners, "b5.b")).toBeUndefined();
    expect(endWords(corners, "b5", "b")).toMatchObject({ open: false });
    expect(endWords(corners, "b5", "b").text).toMatch(/^nothing joins it, square/);
  });

  it("offers Join where the problem list joins, and says the check's reason where it cannot", () => {
    expect(joinVerdict(corners, "b2.a", cornerProblems)).toEqual({ ok: true });
    const b5 = joinVerdict(corners, "b5.a", cornerProblems);
    expect(b5).toMatchObject({ ok: false });
    expect(b5 && !b5.ok ? b5.why : "").toContain(
      "only b5 meets at that point: nothing butts on it",
    );
    // Not yet known for this revision: no verdict, so no Join is offered blind.
    expect(
      joinVerdict(corners, "b2.a", { ...cornerProblems, rev: corners.rev - 1 }),
    ).toBeUndefined();
    expect(joinVerdict(corners, "b5.b", cornerProblems)).toMatchObject({ ok: false });
  });

  it("says a face joint holds a plate's ends, and lists the joint from both bars", () => {
    for (const e of ["a", "b"] as const) {
      const w = endWords(plate, "b36", e);
      expect(w.open).toBe(false);
      expect(w.text).toMatch(/^held by c36 \(face joint\), square/);
      expect(w.refs).toEqual(["c36"]);
    }
    expect(barJoints(plate, "b36").map(jointLine)).toEqual([
      "face joint c36 (T-nut plate): with b35, 2 stations",
    ]);
    expect(barJoints(plate, "b35").map(jointLine)).toEqual([
      "face joint c36 (T-nut plate): with b36, 2 stations",
    ]);
  });

  it("words a bar's end joints from its side: by an end, and as the bar a butt bears on", () => {
    // The cart's b7 butts on b5 by c1 at its end a; b5 is c1's through bar.
    expect(barJoints(plate, "b7").map(jointLine)).toContain("butt c1: end a on b5");
    expect(
      barJoints(plate, "b5")
        .map(jointLine)
        .some((l) => /^butt c1: .*butts? on it/.test(l)),
    ).toBe(true);
  });
});
