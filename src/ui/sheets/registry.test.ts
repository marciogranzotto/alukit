import { afterEach, describe, expect, it } from "vitest";
import { activeSheet, openSheet, registerSheet, sheets, sheetsOpen } from "./registry.ts";

/** The sheets' registry (registry.ts): order, replacement, and which sheet is shown. */

const Body = () => null;

afterEach(() => {
  sheets.value = [];
  activeSheet.value = "cutlist";
  sheetsOpen.value = true;
});

describe("registerSheet", () => {
  it("lists sheets by their order, whatever order they register in", () => {
    registerSheet({ id: "bom", title: "BOM", order: 30, Body });
    registerSheet({ id: "cutlist", title: "Cut list", order: 10, Body });
    registerSheet({ id: "machining", title: "Machining", order: 20, Body });
    expect(sheets.value.map((s) => s.id)).toEqual(["cutlist", "machining", "bom"]);
  });

  it("replaces a sheet registered again under its id", () => {
    registerSheet({ id: "bom", title: "BOM", order: 30, Body });
    registerSheet({ id: "bom", title: "Bill of materials", order: 5, Body });
    expect(sheets.value.map((s) => [s.id, s.title])).toEqual([["bom", "Bill of materials"]]);
  });
});

describe("openSheet", () => {
  it("shows the sheet, opening the sheets when collapsed", () => {
    sheetsOpen.value = false;
    openSheet("order");
    expect([activeSheet.value, sheetsOpen.value]).toEqual(["order", true]);
  });
});
