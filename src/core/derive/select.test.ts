import { describe, expect, it } from "vitest";
import { parsePaths, selectDerived } from "./select.ts";

/** `alukit derive --select` (design §7.3): members kept where they sit, in the model's order. */

const derived = {
  schema: "alukit.derived/1",
  variant: "base",
  params: { W: 1200, H: 900 },
  bars: {
    b1: { cut_mm: 860, item: "test:TS40", ends: { a: { by: "c1" } } },
    b2: { cut_mm: 1120, item: "test:TS40" },
  },
  pieces: [
    { item: "test:TS40", len_mm: 860 },
    { item: "test:TS40", len_mm: 1120 },
  ],
  diagnostics: [],
};

const select = (text: string) => {
  const p = parsePaths(text);
  if ("error" in p) throw new Error(p.error);
  return selectDerived(derived, p.paths);
};

describe("derive --select", () => {
  it("keeps the members named where they sit, and always the schema and variant", () => {
    expect(select("params")).toEqual({
      ok: true,
      value: { schema: "alukit.derived/1", variant: "base", params: { W: 1200, H: 900 } },
    });
    expect(select("bars.b2.cut_mm")).toEqual({
      ok: true,
      value: { schema: "alukit.derived/1", variant: "base", bars: { b2: { cut_mm: 1120 } } },
    });
  });

  it("takes * as every member or element, merges paths that meet, in the model's order", () => {
    expect(select("bars.*.cut_mm,bars.b1.ends,params.H")).toEqual({
      ok: true,
      value: {
        schema: "alukit.derived/1",
        variant: "base",
        params: { H: 900 },
        bars: {
          b1: { cut_mm: 860, ends: { a: { by: "c1" } } },
          b2: { cut_mm: 1120 },
        },
      },
    });
    expect(select("pieces.*.len_mm")).toMatchObject({
      value: { pieces: [{ len_mm: 860 }, { len_mm: 1120 }] },
    });
    // A list named whole, and an empty one.
    expect(select("pieces,diagnostics")).toMatchObject({
      value: { pieces: derived.pieces, diagnostics: [] },
    });
  });

  it("reports what the model does not have rather than leaving it out", () => {
    expect(select("bars.b9.cut_mm,nodes,params.W.v,pieces.0")).toEqual({
      ok: false,
      missing: [
        "nodes",
        "params.W.v (params.W is a value)",
        "bars.b9",
        "pieces.0 (pieces is a list: whole, or with *)",
      ],
    });
  });

  it("refuses a malformed path", () => {
    expect(parsePaths("bars..b1")).toEqual({
      error: '"bars..b1" is not a path: members are joined by dots',
    });
    expect(parsePaths("bars,")).toEqual({ error: "--select takes paths separated by commas" });
  });
});
