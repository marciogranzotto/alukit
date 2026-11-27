import type { V3 } from "#core/vec.ts";
import type { ArrangementsAnswer } from "./client/arrangements.ts";
import type { DryRun } from "./client/dryrun.ts";
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

/**
 * A scratch project held open as the server holds it, for tests that ask what a step would do:
 * `view()` is the drawn view model, `dry(commands)` a dry run as the app's client reads it
 * (src/ui/client/dryrun.ts), `arrange(at)` the corners' arrangements as `GET /api/arrangements`
 * answers them (src/ui/client/arrangements.ts), `apply(commands)` a step. Close it when done.
 */
export async function hostOf(dir: string): Promise<{
  view(): Model;
  dry(commands: readonly unknown[]): Promise<DryRun>;
  arrange(at: readonly V3[]): Promise<ArrangementsAnswer>;
  apply(commands: readonly unknown[]): Promise<void>;
  close(): Promise<void>;
}> {
  const { ProjectHost } = await import("../server/host.ts");
  const { viewModel } = await import("../server/view.ts");
  const { dryRunOf } = await import("./client/dryrun.ts");
  const host = await ProjectHost.open({ dir, watch: false });
  return {
    view: () => JSON.parse(JSON.stringify(viewModel(host.snapshot()))) as Model,
    async dry(commands) {
      const a = await host.dryRun({ commands: commands as never, source: "test" });
      const read = dryRunOf(a.ok ? 200 : 422, JSON.parse(JSON.stringify(a)));
      if (!read.ok) throw new Error(read.why);
      return read.value;
    },
    async arrange(at) {
      const a = await host.arrangements({ at });
      if (!a.ok) throw new Error(`read-only: ${JSON.stringify(a.status)}`);
      return JSON.parse(JSON.stringify({ rev: a.rev, corners: a.corners, rules: a.rules }));
    },
    async apply(commands) {
      const r = await host.commands({ commands: commands as never, source: "test" });
      if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`);
    },
    close: () => host.close(),
  };
}

export const SMALL = {
  doc: {
    bars: { b1: {}, b2: {} },
    connections: { c1: { type: "butt" } },
    nodes: { n1: [0, 0, 0] },
  },
  derived: { bars: { b1: {}, b2: {}, "b26@1": {} }, parts: { p1: {} } },
} as unknown as Model;
