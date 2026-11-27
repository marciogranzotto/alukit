import { afterEach, describe, expect, it } from "vitest";
import {
  activeSheet,
  firstOutputPending,
  openSheet,
  registerSheet,
  SHEETS_HEIGHT,
  setSheets,
  sheets,
  sheetsHeight,
  sheetsMax,
  sheetsOpen,
} from "./registry.ts";

/** The sheets' registry (registry.ts): order, replacement, which sheet is shown, and how. */

const Body = () => null;

afterEach(() => {
  sheets.value = [];
  activeSheet.value = "cutlist";
  sheetsOpen.value = true;
  sheetsMax.value = false;
  sheetsHeight.value = SHEETS_HEIGHT.initial;
  firstOutputPending.value = false;
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

  it("maximizes when asked, keeps a maximized view otherwise, and restores the split", () => {
    openSheet("order", { maximize: true });
    expect(sheetsMax.value).toBe(true);
    openSheet("problems");
    expect([activeSheet.value, sheetsMax.value]).toEqual(["problems", true]);
    openSheet("problems", { maximize: false });
    expect(sheetsMax.value).toBe(false);
  });
});

describe("setSheets", () => {
  it("collapsing also ends a maximized view; a height is never below the rail's minimum", () => {
    setSheets({ open: true, max: true });
    setSheets({ open: false });
    expect([sheetsOpen.value, sheetsMax.value]).toEqual([false, false]);
    setSheets({ height: 10 });
    expect(sheetsHeight.value).toBe(SHEETS_HEIGHT.min);
  });

  it("a person's own choice ends the wait for the first output; the app's does not", () => {
    firstOutputPending.value = true;
    setSheets({ open: false }, false);
    expect(firstOutputPending.value).toBe(true);
    setSheets({ open: true });
    expect(firstOutputPending.value).toBe(false);
  });
});
