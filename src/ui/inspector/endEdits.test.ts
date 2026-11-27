import { cp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { Model } from "../model.ts";
import { viewOf } from "../testing.ts";
import {
  detachBatch,
  endFields,
  endPatch,
  endStopsNear,
  faceStops,
  pickedPlane,
  planeBatch,
} from "./endEdits.ts";
import { endWords } from "./words.ts";

/**
 * A bar end's edits in the inspector (docs/ux/editing-audit.md E4.1) on fixtures: tests/fixtures/
 * ux/ends (b3 a free brace down −Y at x = 500, 280 short of b1's near face; b2.a butted on b1 by
 * c1, its only end), base-frame/cli (c1 a butt through b5 with four ends, whose through ends it
 * claims at both corners) and the audit's brace. Each batch is applied, and what it gives read
 * back from the view model, by hand.
 */

let root: string;
let ends: Model;
let frame: Model;
beforeAll(async () => {
  root = await scratchFixtures();
  ends = await viewOf(join(root, "ux", "ends"));
  frame = await viewOf(join(root, "base-frame", "cli"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

let copies = 0;
/** A fresh copy of a fixture beside it (its catalogs' relative path holds), for a test to write to. */
async function fresh(...at: string[]): Promise<string> {
  const dir = join(root, ...at.slice(0, -1), `${at[at.length - 1]}-${++copies}`);
  await cp(join(root, ...at), dir, { recursive: true });
  return dir;
}

describe("an end's fields", () => {
  it("writes a cut or an extension on the end, and leaves no empty end behind", () => {
    expect(endPatch(ends, "b3", "b", { cut: "angle" })).toEqual({
      cmd: "setBar",
      args: { id: "b3", set: { ends: { b: { cut: "angle" } } } },
    });
    // Removing an end's only field removes `ends` itself.
    const withCut = {
      ...ends,
      doc: {
        ...ends.doc,
        bars: {
          ...(ends.doc.bars as object),
          b3: {
            a: [500, 600, 0],
            b: [500, 300, 0],
            ends: { b: { cut: "square" }, a: { extend_mm: 5 } },
          },
        },
      },
    } as Model;
    expect(endFields(withCut, "b3", "b")).toEqual({ cut: "square" });
    expect(endPatch(withCut, "b3", "b", { cut: null }).args).toEqual({
      id: "b3",
      set: { ends: { b: null } },
    });
    expect(endPatch(withCut, "b3", "a", { extend_mm: null }).args).toEqual({
      id: "b3",
      set: { ends: { a: null } },
    });
    expect(endPatch(ends, "b3", "b", { cut: null }).args).toEqual({
      id: "b3",
      set: { ends: null },
    });
  });

  it("extends an end by a number or a param, and the cut follows", async () => {
    const m = await viewOf(await fresh("ux", "ends"), [
      endPatch(ends, "b3", "b", { extend_mm: 10 }),
    ]);
    expect(m.derived.bars.b3?.cut_mm).toBe(310);
    const l = await viewOf(await fresh("ux", "ends"), [
      endPatch(ends, "b3", "b", { extend_mm: "L / 40" }),
    ]);
    // L = 400 (the fixture's param): 10 longer, kept over L.
    expect(endFields(l, "b3", "b")).toEqual({ extend: "L / 40" });
    expect(l.derived.bars.b3?.cut_mm).toBe(310);
  });
});

describe("an end's plane", () => {
  it("lists the faces the end's line meets, the nearest first, and how far the end goes", () => {
    const faces = faceStops(ends, "b3", "b");
    // b1 runs along +X centred on y = 0: its +x face (local x is world +Y) at y = 20 is 580 from
    // b3's end a at y = 600, its −x face at y = −20 is 620; b3's end b is at 300 now.
    expect(faces.map((f) => [f.bar, f.face, f.by, f.angled])).toEqual([
      ["b1", "+x", 280, false],
      ["b1", "-x", 320, false],
    ]);
    expect(faces[0]?.label).toBe("b1's face +x · 280 mm longer");
    // Nothing lies beyond b2's free end b; b1's +x face, where its end a butts, is no stop for
    // end b, which would leave nothing to cut.
    expect(faceStops(ends, "b2", "b")).toEqual([]);
  });

  it("stops an end at a face, as one step, and the cut is the face's", async () => {
    const m = await viewOf(await fresh("ux", "ends"), [
      ...planeBatch(ends, "b3", "b", { face: { bar: "b1", face: "+x" } }, false),
    ]);
    expect(m.derived.bars.b3?.cut_mm).toBe(580);
    expect(endWords(m, "b3", "b").text).toBe("stops at b1's face +x, square, longer by 280.00 mm");
  });

  it("lists the nearest other ends for flush, and takes a picked end's", () => {
    // From b2.b at (1000, 600, 0): b3.a at (500, 600, 0) is 500 away, b3.b at (500, 300, 0) 583.
    expect(endStopsNear(ends, "b2", "b", 2).map((s) => [s.end, s.d])).toEqual([
      ["b3.a", 500],
      ["b3.b", 583.1],
    ]);
    // A press on b1's body nearer its end a gives b1.a; on its end face, that end.
    const hit = {
      id: "b1",
      p: [100, 20, 0] as [number, number, number],
      station: { bar: "b1", at_mm: 100 },
    };
    expect(pickedPlane(ends, { bar: "b3", end: "b", kind: "end" }, hit)).toMatchObject({
      plane: { of: "b1.a" },
    });
    expect(
      pickedPlane(ends, { bar: "b3", end: "b", kind: "end" }, { ...hit, face: "b" }),
    ).toMatchObject({ plane: { of: "b1.b" } });
  });

  it("takes a picked bar's face the end's line meets, else the first one, else says why", () => {
    const pick = { bar: "b3", end: "b" as const, kind: "face" as const };
    const p: [number, number, number] = [300, 0, 20];
    expect(pickedPlane(ends, pick, { id: "b1", p, face: "-x" })).toMatchObject({
      plane: { face: { bar: "b1", face: "-x" } },
    });
    // The top of b1, which the line never meets: the near face.
    expect(pickedPlane(ends, pick, { id: "b1", p, face: "+y" })).toMatchObject({
      plane: { face: { bar: "b1", face: "+x" } },
      words: "stops at b1's face +x",
    });
    expect(pickedPlane(ends, pick, { id: "b4", p, face: "+x" })).toEqual({
      why: "b3.b's line misses b4",
    });
    expect(pickedPlane(ends, pick, { id: "b3", p })).toEqual({
      why: "that is b3 itself: click another bar",
    });
    expect(pickedPlane(ends, pick, undefined)).toEqual({ why: "click a bar" });
  });

  it("declares an angled plane's cut in the same step, and frees a claimed end first", async () => {
    // b2.a butts on b1 (c1): a plane of its own replaces the butt, so the end keeps one provider.
    const batch = planeBatch(ends, "b2", "a", { face: { bar: "b1", face: "+x" } }, true);
    expect(batch).toEqual([
      { cmd: "removeEntity", args: { id: "c1" } },
      {
        cmd: "setBar",
        args: {
          id: "b2",
          set: { ends: { a: { plane: { face: { bar: "b1", face: "+x" } }, cut: "angle" } } },
        },
      },
    ]);
  });
});

describe("freeing an end from what claims it", () => {
  it("removes a butt with its last end, and drops an end from a butt with others", () => {
    expect(detachBatch(ends, "b2", "a")).toEqual({
      commands: [{ cmd: "removeEntity", args: { id: "c1" } }],
      from: ["c1"],
    });
    expect(detachBatch(frame, "b7", "a")).toEqual({
      commands: [
        { cmd: "setConnection", args: { id: "c1", set: { ends: ["b1.b", "b2.b", "b8.a"] } } },
      ],
      from: ["c1"],
    });
    // A free end: nothing to free it from.
    expect(detachBatch(ends, "b3", "b")).toBeUndefined();
  });

  it("frees a corner's through end, the butt keeping its other end", async () => {
    // c1 runs through b5 and claims both its ends, at the two front corners.
    expect(frame.claims["b5.a"]).toEqual(["c1"]);
    expect(frame.claims["b5.b"]).toEqual(["c1"]);
    const d = detachBatch(frame, "b5", "a");
    expect(d?.commands).toEqual([
      {
        cmd: "setConnection",
        args: { id: "c1", set: { through_end: { end: "b", mode: "cover" } } },
      },
    ]);
    const m = await viewOf(await fresh("base-frame", "cli"), d?.commands ?? []);
    expect(m.claims["b5.a"]).toBeUndefined();
    expect(m.claims["b5.b"]).toEqual(["c1"]);
    expect(endWords(m, "b5", "a")).toMatchObject({ open: true });
  });

  it("frees the audit's brace from its corner butt", async () => {
    const dir = join(root, "brace");
    const brace = JSON.parse(await readFile(join(dir, "brace.json"), "utf8")) as {
      commands: unknown[];
    };
    const m = await viewOf(dir, brace.commands);
    expect(detachBatch(m, "b13", "a")?.commands).toEqual([
      { cmd: "removeEntity", args: { id: "c9" } },
    ]);
  });
});
