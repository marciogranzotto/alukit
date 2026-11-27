import { describe, expect, it } from "vitest";
import type { Problem } from "#core/problems/types.ts";
import type { Corner } from "../corners.ts";
import type { Model } from "../model.ts";
import { groupsOf, placesOf, problemsByEntity, rowsOf } from "./rows.ts";

/** The outline's rows and groups (rows.ts): entities in words, Joints by corner. */

const M = {
  doc: {
    bars: {
      b1: { label: "post", tags: ["leg"] },
      b2: { label: "rail" },
    },
    connections: {
      c1: { type: "butt", through: "b1", ends: ["b2.a"] },
      c2: { type: "face", layers: ["b2", "p1"] },
    },
    nodes: { n1: [0, 0, 900] },
  },
  derived: {
    bars: {
      b1: { item: "forseti:PF40-01", cut_mm: 820 },
      b2: { item: "forseti:PF40-01", cut_mm: 580 },
      "b2@1": { item: "forseti:PF40-01", cut_mm: 580 },
    },
    parts: { p1: { item: "test:BRK", bar: "b1", s_mm: 300 } },
    runs: {},
  },
  items: { "forseti:PF40-01": { name: "40×40 Básico" } },
  bom: { groups: [{ kind: "part", lines: [{ item: "test:BRK", name: "Bracket" }] }] },
} as unknown as Model;

const corner = (key: string, connections: string[]): Corner => ({
  key,
  at: [0, 0, 900],
  state: "joined",
  ends: [],
  bars: [],
  connections,
  through: "b1",
});

describe("rowsOf", () => {
  it("reads label · item name · cut length, and marks copies (U19)", () => {
    const rows = rowsOf(M, "bars");
    expect(rows.map((r) => [r.id, r.text, r.copy])).toEqual([
      ["b1", "post · 40×40 Básico · 820.00 mm", false],
      ["b2", "rail · 40×40 Básico · 580.00 mm", false],
      ["b2@1", "40×40 Básico · 580.00 mm", true],
    ]);
    expect(rowsOf(M, "parts")[0]?.text).toBe("Bracket · on b1 at 300.00");
    expect(rowsOf(M, "connections").map((r) => r.text)).toEqual([
      "butt: b2.a → b1",
      "face: b2, p1",
    ]);
    expect(rowsOf(M, "nodes")[0]?.text).toBe("(0, 0, 900)");
  });
});

describe("groupsOf", () => {
  it("lists the joints by corner, then the connections at none", () => {
    const g = groupsOf(M, { byTag: false, filter: "", corners: [corner("0,0,900", ["c1"])] });
    const joints = g.find((x) => x.key === "connections");
    expect(joints?.groups?.map((x) => [x.key, x.ref, x.rows.map((r) => r.id)])).toEqual([
      ["corner:0,0,900", "corner:0,0,900", ["c1"]],
      ["other-connections", undefined, ["c2"]],
    ]);
    expect(joints?.groups?.[0]?.title).toBe("Corner (0, 0, 900) · joined · b1 runs through");
  });

  it("with no corners, the joints are a plain list; a filter keeps what matches", () => {
    const g = groupsOf(M, { byTag: false, filter: "rail", corners: [] });
    expect(g.map((x) => [x.key, x.rows.map((r) => r.id)])).toEqual([["bars", ["b2"]]]);
  });

  it("groups by tag, the untagged together", () => {
    const g = groupsOf(M, { byTag: true, filter: "b1", corners: [] });
    // b1 by its id; c1 and p1 because their words name b1.
    expect(g.map((x) => [x.title, x.rows.map((r) => r.id)])).toEqual([
      ["(untagged)", ["c1", "p1"]],
      ["leg", ["b1"]],
    ]);
  });
});

describe("placesOf", () => {
  it("finds every ref wanted, in the tree's order: a connection inside its corner's group", () => {
    const g = groupsOf(M, { byTag: false, filter: "", corners: [corner("0,0,900", ["c1"])] });
    const places = placesOf(g, new Set(["c1", "b2", "corner:0,0,900"]));
    expect(places.map((p) => [p.key, p.trail.map((t) => t.key)])).toEqual([
      ["r:bars:b2", ["bars"]],
      ["g:corner:0,0,900", ["connections"]],
      ["r:corner:0,0,900:c1", ["connections", "corner:0,0,900"]],
    ]);
    expect(placesOf(g, new Set(["nothing"]))).toEqual([]);
  });
});

describe("problemsByEntity", () => {
  it("keeps each entity's worst problem, an end's on its bar", () => {
    const p = (group: Problem["group"], targets: string[]) => ({ group, targets }) as Problem;
    const m = problemsByEntity([
      p("warning", ["b1.a"]),
      p("blocks-order", ["b1", "c1"]),
      p("note", ["c1"]),
    ]);
    expect(Object.fromEntries(m)).toEqual({ b1: "blocks-order", c1: "blocks-order" });
  });
});
