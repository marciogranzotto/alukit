import { describe, expect, it } from "vitest";
import {
  connectionCommand,
  measured,
  patternCommand,
  pivotBatch,
  placeCommand,
  runOf,
} from "./commands.ts";
import { valueList } from "./typed.ts";

/** What the connect, place and pattern tools send (design §8), from what was picked. */

const at = [0, 0, 0] as const;
const bar = (ref: string) => ({ ref, kind: "bar" as const, p: at });
const end = (ref: string) => ({ ref, kind: "end" as const, p: at });

describe("connect", () => {
  it("butts ends through a bar, or through the first end picked (§4.5)", () => {
    expect(connectionCommand([bar("b5"), end("b1.b"), end("b2.b")], "butt")).toEqual({
      cmd: "addConnection",
      args: { type: "butt", through: "b5", ends: ["b1.b", "b2.b"] },
    });
    expect(connectionCommand([end("b1.b"), end("b2.a")], "butt")).toEqual({
      cmd: "addConnection",
      args: { type: "butt", through: "b1.b", ends: ["b2.a"] },
    });
    expect(connectionCommand([bar("b5"), bar("b6"), end("b1.b")], "butt")).toHaveProperty("why");
  });

  it("mitres and splices two ends; rests two or more bars on each other", () => {
    expect(connectionCommand([end("b1.b"), end("b2.a")], "miter")).toEqual({
      cmd: "addConnection",
      args: { type: "miter", ends: ["b1.b", "b2.a"] },
    });
    expect(connectionCommand([end("b1.b")], "splice")).toHaveProperty("why");
    expect(connectionCommand([bar("b5"), bar("b24")], "face")).toEqual({
      cmd: "addConnection",
      args: { type: "face", bars: ["b5", "b24"], fastening: "none" },
    });
  });
});

describe("connect: pivots and fastened face joints (§4.5)", () => {
  const station = { bar: "b9", at_mm: 300, face: "+y", p: at };
  const pivot = { base: station, from: "a" as const, axis: "across" as const, connector: "" };

  it("hinges the ends it carries on a face station, with a connector", () => {
    expect(
      connectionCommand([end("b35.a")], "pivot", { pivot: { ...pivot, base: undefined } }),
    ).toEqual({ why: "click a station on a face for the pivot's base" });
    expect(connectionCommand([end("b35.a")], "pivot", { pivot })).toHaveProperty("why");
    expect(
      connectionCommand([bar("b35")], "pivot", { pivot: { ...pivot, connector: "x:H" } }),
    ).toHaveProperty("why");
    expect(
      connectionCommand([end("b35.a")], "pivot", {
        pivot: { ...pivot, from: "b", connector: "test-geo:HNG-15" },
      }),
    ).toEqual({
      cmd: "addConnection",
      args: {
        type: "pivot",
        base: { bar: "b9", at_mm: 300, from: "b", face: "+y" },
        axis: "across",
        ends: ["b35.a"],
        connector: "test-geo:HNG-15",
      },
    });
  });

  it("points each carried end at the pivot the batch creates, by the document's next id", () => {
    const c = connectionCommand([end("b35.a"), end("b36.b")], "pivot", {
      pivot: { ...pivot, connector: "test-geo:HNG-15" },
    });
    if ("why" in c) throw new Error(c.why);
    // The counter says c40 was made once (and removed): ids are never reused.
    const doc = { ids: { c: 40 }, connections: { c1: {}, c35: {} } };
    expect(pivotBatch(c, doc)).toEqual({
      id: "c41",
      commands: [
        c,
        { cmd: "setBar", args: { id: "b35", set: { a: { pivot: "c41" } } } },
        { cmd: "setBar", args: { id: "b36", set: { b: { pivot: "c41" } } } },
      ],
    });
    expect(pivotBatch(c, { connections: { c7: {} } }).id).toBe("c8");
  });

  const face = {
    fastening: "bolt" as const,
    fastener: "test:M10-ROD",
    rod: true,
    rodLen: "140",
    stack: "test-geo:NUT-M10, test-geo:WSH-M10",
    at: "100, 200",
    across: "-15, 15",
    railHoles: false,
    gaps: "",
    tapDepth: "",
  };

  it("bolts layers head to nut through stations, a rod cut from bar stock as the fastener", () => {
    expect(connectionCommand([bar("b20"), bar("b21"), bar("b18")], "face", { face })).toEqual({
      cmd: "addConnection",
      args: {
        type: "face",
        bars: ["b20", "b21", "b18"],
        fastening: "bolt",
        fastener: { bar: "test:M10-ROD", len_mm: 140 },
        stack: ["test-geo:NUT-M10", "test-geo:WSH-M10"],
        stations: { at_mm: [100, 200], across_mm: [-15, 15] },
      },
    });
    // A run or a plate is a layer too; a screw takes a tap depth; an expression stays one.
    const run = { ref: "r2", kind: "run" as const, p: at };
    const plate = { ref: "p6", kind: "part" as const, p: at };
    expect(
      connectionCommand([run, plate], "face", {
        face: {
          ...face,
          fastening: "screw",
          fastener: "test-gen:SCR-M5x25",
          rod: false,
          stack: "",
          at: "W / 2",
          across: "",
          tapDepth: "8",
          gaps: "0.5",
        },
      }),
    ).toEqual({
      cmd: "addConnection",
      args: {
        type: "face",
        bars: ["r2", "p6"],
        fastening: "screw",
        fastener: "test-gen:SCR-M5x25",
        stations: { at_mm: ["W / 2"] },
        tap_depth_mm: 8,
        gaps_mm: [0.5],
      },
    });
  });

  it("says what a fastened joint lacks", () => {
    const layers = [bar("b5"), bar("b24")];
    const why = (f: Partial<typeof face>) =>
      (connectionCommand(layers, "face", { face: { ...face, ...f } }) as { why?: string }).why;
    expect(why({ fastener: "" })).toBe("name the bar stock the rod is cut from");
    expect(why({ rodLen: "" })).toBe("give the rod's length");
    expect(why({ at: "" })).toBe(
      "give the stations: distances along the first layer, or its rail's holes",
    );
    expect(why({ at: "", railHoles: true })).toBeUndefined();
    expect(why({ at: "100,,200" })).toBe("the stations are comma-separated distances in mm");
    expect(connectionCommand([bar("b5")], "face", { face })).toHaveProperty("why");
  });

  it("finds the run a bar is a piece of", () => {
    const doc = { runs: { r1: ["b11", "b12"], r2: { bars: ["b33", "b34"] } } };
    expect(runOf(doc, "b12")).toBe("r1");
    expect(runOf(doc, "b34")).toBe("r2");
    expect(runOf(doc, "b5")).toBeUndefined();
    expect(valueList(" 100 , W - 40 ")).toEqual([100, "W - 40"]);
  });
});

describe("place part", () => {
  it("lands the palette's item on a face or groove station, from either end (§4.7)", () => {
    const item = { id: "test:FOOT-M8", kind: "accessory", name: "foot" };
    expect(placeCommand(item, { bar: "b9", at_mm: 300, face: "+y", p: at }, "a", 0)).toEqual({
      cmd: "addPart",
      args: { item: "test:FOOT-M8", on: { bar: "b9", at_mm: 300, face: "+y" } },
    });
    expect(
      placeCommand(
        { ...item, opt: { finish: "black" } },
        { bar: "b9", at_mm: 100, groove: "+y.1", face: "+y", p: at },
        "b",
        90,
      ),
    ).toEqual({
      cmd: "addPart",
      args: {
        item: "test:FOOT-M8",
        opt: { finish: "black" },
        on: { bar: "b9", at_mm: 100, from: "b", groove: "+y.1" },
        roll_deg: 90,
      },
    });
  });
});

describe("pattern", () => {
  it("repeats the selection along a bar at a pitch, leaving pattern copies out (§4.7)", () => {
    expect(
      patternCommand({ template: ["p6", "b26@1"], along: "b9", pitch: "150", count: "4" }),
    ).toEqual({
      cmd: "addPattern",
      args: { template: ["p6"], along: "b9", pitch_mm: 150, count: 4 },
    });
    expect(patternCommand({ template: [], along: "b9", pitch: "150", count: "4" })).toHaveProperty(
      "why",
    );
    expect(patternCommand({ template: ["p6"], pitch: "150", count: "4" })).toHaveProperty("why");
    expect(
      patternCommand({ template: ["p6"], along: "b9", pitch: "x", count: "4" }),
    ).toHaveProperty("why");
    expect(
      patternCommand({ template: ["p6"], along: "b9", pitch: "150", count: "1" }),
    ).toHaveProperty("why");
  });
});

describe("measure", () => {
  it("gives the distance and its components", () => {
    expect(measured([0, 0, 0], [300, 0, 400])).toEqual({ d: 500, dx: 300, dy: 0, dz: 400 });
  });
});
