import { describe, expect, it } from "vitest";
import {
  holeFaceCode,
  holeFacesEdit,
  lengthEdit,
  offsetEdit,
  quantityEdit,
  stationAtEdit,
  stationFacePatch,
  throughEndCode,
  throughEndEdit,
} from "./connection.ts";

/**
 * What the connection and part fields send (docs/ux/editing-audit.md E5.2, E5.4): one merge
 * patch per field, as `alukit do setConnection` (or `setPart`) takes it, or why the value typed
 * makes none. Lengths are typed as every length is (D-UX-17).
 */

const set = (id: string, patch: Record<string, unknown>, cmd = "setConnection") => ({
  commands: [{ cmd, args: { id, set: patch } }],
});

describe("a connection's fields (E5.2)", () => {
  it("a quantity is a whole number, 1 or more; empty takes the default", () => {
    expect(quantityEdit("c9", "2")).toEqual(set("c9", { qty: 2 }));
    expect(quantityEdit("c9", " ")).toEqual(set("c9", { qty: null }));
    expect(quantityEdit("c9", "0")).toEqual({ why: "the quantity is a whole number, 1 or more" });
    expect(quantityEdit("c9", "1.5")).toHaveProperty("why");
  });

  it("a gap or a spacer is a length: an expression over params stays one, empty removes it", () => {
    const params = { W: 1200 };
    expect(lengthEdit("c9", "gap_mm", "W / 600", params, "gap")).toEqual(
      set("c9", { gap_mm: "W / 600" }),
    );
    expect(lengthEdit("c1", "spacer_mm", "8mm", params, "spacer")).toEqual(
      set("c1", { spacer_mm: 8 }),
    );
    expect(lengthEdit("c1", "spacer_mm", "", params, "spacer")).toEqual(
      set("c1", { spacer_mm: null }),
    );
    expect(lengthEdit("c9", "gap_mm", "V", params, "gap")).toEqual({
      why: 'the gap: "V" is no param of this project',
    });
  });

  it("the through end: automatic, a mode at the corner, or a named end", () => {
    expect(throughEndCode(undefined)).toBe("");
    expect(throughEndCode("node")).toBe("node");
    expect(throughEndCode({ end: "b", mode: "cover" })).toBe("b:cover");
    expect(throughEndEdit("c1", "")).toEqual(set("c1", { through_end: null }));
    expect(throughEndEdit("c1", "none")).toEqual(set("c1", { through_end: "none" }));
    expect(throughEndEdit("c1", "a:node")).toEqual(
      set("c1", { through_end: { end: "a", mode: "node" } }),
    );
    expect(throughEndEdit("c1", "x")).toHaveProperty("why");
  });

  it("a cross hole's face per end: added beside the others; the last one taken leaves no map", () => {
    expect(holeFacesEdit("c1", undefined, "b2.a", "+x")).toEqual(
      set("c1", { hole_faces: { "b2.a": "+x" } }),
    );
    expect(holeFacesEdit("c1", { "b2.a": "+x", "b3.a": "-y" }, "b2.a", "")).toEqual(
      set("c1", { hole_faces: { "b2.a": null } }),
    );
    expect(holeFacesEdit("c1", { "b2.a": "+x" }, "b2.a", "")).toEqual(
      set("c1", { hole_faces: null }),
    );
    expect(holeFaceCode({ "b2.a": "+x" }, "b2.a")).toBe("+x");
    expect(holeFaceCode({ "b2.a": [{ at_mm: [20, 20], face: "+x" }] }, "b2.a")).toBe("-list");
    expect(holeFaceCode(undefined, "b2.a")).toBe("");
  });
});

describe("a station's fields: a part's on, a pivot's base (E5.2, E5.4)", () => {
  it("a face or a groove, never both; the bar's line takes neither", () => {
    expect(stationFacePatch("+y.1")).toEqual({ groove: "+y.1", face: null });
    expect(stationFacePatch("+y")).toEqual({ face: "+y", groove: null });
    expect(stationFacePatch("")).toEqual({ face: null, groove: null });
  });

  it("a distance is a length typed as every length is", () => {
    expect(stationAtEdit("setConnection", "c13", "base", "600", {})).toEqual(
      set("c13", { base: { at_mm: 600 } }),
    );
    expect(stationAtEdit("setPart", "p1", "on", "W / 2", { W: 1200 })).toEqual(
      set("p1", { on: { at_mm: "W / 2" } }, "setPart"),
    );
    expect(stationAtEdit("setPart", "p1", "on", "", {})).toEqual({
      why: "the distance: a value is missing",
    });
  });

  it("an offset is two lengths, across the face and out from it; empty removes it", () => {
    expect(offsetEdit("setPart", "p1", "on", "5, 0", {})).toEqual(
      set("p1", { on: { off_mm: [5, 0] } }, "setPart"),
    );
    expect(offsetEdit("setPart", "p1", "on", "", {})).toEqual(
      set("p1", { on: { off_mm: null } }, "setPart"),
    );
    expect(offsetEdit("setPart", "p1", "on", "5", {})).toEqual({
      why: "the offset is two lengths, u across the face and v out from it: 5, 0",
    });
  });
});
