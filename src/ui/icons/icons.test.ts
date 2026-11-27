import { describe, expect, it } from "vitest";
import { TOOLS } from "../tools.ts";
import { ICON_NAMES } from "./Icons.tsx";

/** The icons cover what the viewport's rail and tool bar place (docs/ux/visual-design.md §4.5). */
describe("icons", () => {
  it("has one for every tool, the standard views, the projection, fit and the section", () => {
    for (const tool of TOOLS.filter((t) => t !== "select")) expect(ICON_NAMES).toContain(tool);
    for (const name of [
      "select",
      "iso",
      "top",
      "front",
      "side",
      "persp",
      "ortho",
      "fit",
      "section",
    ]) {
      expect(ICON_NAMES).toContain(name);
    }
    expect(ICON_NAMES).toEqual(expect.arrayContaining(["colour-by", "problems"]));
  });
});
