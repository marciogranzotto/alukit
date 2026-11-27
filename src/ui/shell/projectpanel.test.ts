import { describe, expect, it } from "vitest";
import type { Model } from "../model.ts";
import { steps } from "./ProjectPanel.tsx";

/** First steps (docs/ux/review-phase4.md N5): each ticks by what the project holds. */

const project = (defaults: Record<string, unknown>, doc: Record<string, unknown> = {}): Model =>
  ({ defaults, doc }) as unknown as Model;

const done = (m: Model, label: RegExp) => steps(m).find((s) => label.test(s.label))?.done;

describe("steps", () => {
  it("ticks 'Choose a profile' when the project's default bar names one, as the box frame sets", () => {
    // The start card's box frame writes defaults.bar and never arms the tab's palette.
    expect(done(project({ bar: { item: "forseti:PF40-01" } }), /profile/)).toBe(true);
  });

  it("leaves it unticked while the project names no profile", () => {
    expect(done(project({}), /profile/)).toBe(false);
    expect(done(project({ bar: {} }), /profile/)).toBe(false);
  });

  it("ticks the others by bars and connections", () => {
    const m = project({}, { bars: { b1: {} }, connections: { c1: {} } });
    expect(done(m, /Draw a bar/)).toBe(true);
    expect(done(m, /Join two bars/)).toBe(true);
  });
});
