import type { Io } from "./cli.ts";
import type { PublishCommand } from "./publish-usage.ts";

/** Dispatches `diff`, `revision`, `snapshot`, `export` and `skill`, each loaded only when used. */
export async function publishCommand(cmd: PublishCommand, argv: readonly string[], io: Io) {
  switch (cmd) {
    case "diff":
      return (await import("./diff.ts")).diffCommand(argv, io);
    case "revision":
      return (await import("./revision.ts")).revisionCommand(argv, io);
    case "snapshot":
      return (await import("./snapshot.ts")).snapshotCommand(argv, io);
    case "export":
      return (await import("./export.ts")).exportCommand(argv, io);
    case "skill":
      return (await import("./skill.ts")).skillCommand(argv, io);
  }
}
