import { describe, expect, it } from "vitest";
import { connectionCommand, measured, patternCommand, placeCommand } from "./tools.ts";

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
