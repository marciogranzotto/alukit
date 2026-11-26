import type { Io } from "./cli.ts";
import type { PublishCommand } from "./publish-usage.ts";

/** Dispatches `diff` and `revision`, each loaded only when used. */
export async function publishCommand(cmd: PublishCommand, argv: readonly string[], io: Io) {
  switch (cmd) {
    case "diff":
      return (await import("./diff.ts")).diffCommand(argv, io);
    case "revision":
      return (await import("./revision.ts")).revisionCommand(argv, io);
  }
}
