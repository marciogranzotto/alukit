/**
 * The one edit path (design §6). M4a's server holds a `History` per project and applies each
 * client's batch through it; the CLI does the same in-process with no server.
 */
export {
  applyBatch,
  applyCommand,
  type BatchResult,
  batchOf,
  type CommandResult,
} from "./apply.ts";
export { History, type LogEntry, type Step, type UndoResult } from "./history.ts";
export { COMMAND_LIST, COMMANDS } from "./registry.ts";
export type {
  Command,
  CommandContext,
  CommandDef,
  CommandEnv,
  CommandError,
  Effect,
  Outcome,
  RawDoc,
  State,
} from "./types.ts";
