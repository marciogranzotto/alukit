import { describe, expect, it } from "vitest";
import { formOf, settingsPatch } from "./Settings.tsx";

/** Project settings as one `setProject` merge patch (S2.11, BE-1): only what changed. */

const DOC = {
  name: "Cart",
  catalogs: ["../../catalogs/test"],
  currency: "BRL",
  fx: { USD: { v: 5.4, src: "src", read: "2026-11-01" } },
  defaults: {
    bar: { item: "test:TS40", opt: { finish: "anodised" } },
    cutting: { kerf_mm: 3, trim_mm: 5 },
  },
  order_rules: { "stale-price": "warn" },
};

describe("settingsPatch", () => {
  it("is empty when nothing changed", () => {
    const f = formOf(DOC);
    expect(settingsPatch(DOC, f, f)).toEqual({ patch: {} });
  });

  it("writes only what changed, removing with null, and keeps a rate's provenance", () => {
    const was = formOf(DOC);
    const now = {
      ...was,
      currency: "EUR",
      catalogs: [...was.catalogs, "forseti"],
      fx: { USD: "5.5" },
      barOpt: { finish: "black" },
      kerf: "",
      corner: "x",
      rules: {},
    };
    expect(settingsPatch(DOC, was, now)).toEqual({
      patch: {
        currency: "EUR",
        catalogs: ["../../catalogs/test", "forseti"],
        fx: { USD: { v: 5.5, src: "src", read: "2026-11-01" } },
        defaults: { bar: { opt: { finish: "black" } }, cutting: { kerf_mm: null }, corner: "x" },
        order_rules: { "stale-price": null },
      },
    });
  });

  // docs/ux/review-phase4.md B1: the default butt connector, which every butt naming none takes.
  it("sets, changes and removes the default butt connector and its quantity", () => {
    const was = formOf(DOC);
    expect(was).toMatchObject({ buttConnector: "", buttQty: "" });
    expect(settingsPatch(DOC, was, { ...was, buttConnector: "test:BRK-40", buttQty: "2" })).toEqual(
      { patch: { defaults: { butt: { connector: "test:BRK-40", qty: 2 } } } },
    );
    const doc = { ...DOC, defaults: { ...DOC.defaults, butt: { connector: "test:BRK-40" } } };
    const set = formOf(doc);
    expect(set.buttConnector).toBe("test:BRK-40");
    expect(settingsPatch(doc, set, { ...set, buttConnector: "" })).toEqual({
      patch: { defaults: { butt: { connector: null } } },
    });
    expect(settingsPatch(doc, set, { ...set, buttQty: "0" })).toEqual({
      error: "connectors per end: a whole number, 1 or more",
    });
  });

  it("refuses a length or a rate that is not a number, before sending anything", () => {
    const was = formOf(DOC);
    expect(settingsPatch(DOC, was, { ...was, trim: "five" })).toEqual({
      error: "trim_mm is not a length in mm",
    });
    expect(settingsPatch(DOC, was, { ...was, fx: { USD: "-1" } })).toEqual({
      error: "the rate for USD is not a positive number",
    });
  });
});
