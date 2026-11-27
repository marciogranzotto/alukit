import type { Model } from "./model.ts";

/** Models for the app's unit tests, which run in Node with no server. */

/**
 * A model with bars b1 and b2 and a copy b26@1, a part p1, a connection c1 and a node n1: only
 * the maps that say what is an entity, so it is no model to draw.
 */
/**
 * The view model (`alukit.view/1`) of a project folder, as a tab draws it, after applying
 * `commands` to it as one step each batch. The folder is written to: pass a scratch copy
 * (`scratchFixtures` in src/core/testing.ts). The server's modules load only when called.
 */
export async function viewOf(dir: string, ...batches: readonly unknown[][]): Promise<Model> {
  const { ProjectHost } = await import("../server/host.ts");
  const { viewModel } = await import("../server/view.ts");
  const host = await ProjectHost.open({ dir, watch: false });
  try {
    for (const commands of batches) {
      const r = await host.commands({ commands, source: "test" });
      if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`);
    }
    return JSON.parse(JSON.stringify(viewModel(host.snapshot()))) as Model;
  } finally {
    await host.close();
  }
}

export const SMALL = {
  doc: {
    bars: { b1: {}, b2: {} },
    connections: { c1: { type: "butt" } },
    nodes: { n1: [0, 0, 0] },
  },
  derived: { bars: { b1: {}, b2: {}, "b26@1": {} }, parts: { p1: {} } },
} as unknown as Model;
