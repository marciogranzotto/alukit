import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scratchFixtures } from "#core/testing.ts";
import type { Viewer } from "../../viewer/scene.ts";
import { model } from "../store.ts";
import { viewOf } from "../testing.ts";
import { activeTool } from "./state.ts";
import { createTools } from "./wiring.ts";

/**
 * The tools' wiring (S5) on a viewer, in Node: no WebGL, so the viewer is a stand-in whose every
 * method does nothing. What it proves is the order of the wiring, not what the tools draw.
 */

/**
 * A viewer whose methods all do nothing and return nothing, but for its `on…` subscriptions,
 * which return their undo, as the viewer's do.
 */
const quietViewer = (): Viewer =>
  new Proxy(
    {},
    {
      get: (_, k) =>
        typeof k === "string" && /^on[A-Z]/.test(k) ? () => () => undefined : () => undefined,
    },
  ) as unknown as Viewer;

const scratch: string[] = [];
afterEach(async () => {
  model.value = undefined;
  activeTool.value = "select";
  for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("createTools", () => {
  it("wires to a viewer made after the model came, as in a second tab on a warm server", async () => {
    const root = await scratchFixtures();
    scratch.push(root);
    model.value = await viewOf(join(root, "cart"));
    // With the model there, subscribing to it calls at once and refreshes the active tool.
    for (const tool of ["select", "draw", "frame"] as const) {
      activeTool.value = tool;
      let tools: ReturnType<typeof createTools> | undefined;
      expect(() => {
        tools = createTools(quietViewer());
      }, tool).not.toThrow();
      tools?.dispose();
    }
  });
});
