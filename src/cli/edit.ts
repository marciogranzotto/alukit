import type { Io } from "./cli.ts";
import type { EditCommand } from "./project-usage.ts";

/** Dispatches the editing and housekeeping commands, each loaded only when used. */
export async function editCommand(cmd: EditCommand, argv: readonly string[], io: Io) {
  switch (cmd) {
    case "fmt":
      return (await import("./fmt.ts")).fmtCommand(argv, io);
    case "lock":
      return (await import("./lock.ts")).lockCommand(argv, io);
    case "new":
      return (await import("./new.ts")).newCommand(argv, io);
    case "check":
      return (await import("./check.ts")).checkCommand(argv, io);
    case "problems":
      return (await import("./problems.ts")).problemsCommand(argv, io);
    case "arrangements":
      return (await import("./arrangements.ts")).arrangementsCommand(argv, io);
    case "do":
      return (await import("./do.ts")).doCommand(argv, io);
    case "add":
      return (await import("./add.ts")).addCommand(argv, io);
    case "query":
      return (await import("./query.ts")).queryCommand(argv, io);
  }
}
