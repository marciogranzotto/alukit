import { type ParseArgsConfig, parseArgs } from "node:util";
import type { Io } from "./cli.ts";

/**
 * Option parsing for the project commands, on Node's `util.parseArgs` (strict: an unknown option
 * is a usage error). Returns the parsed values, or prints the problem and the usage and returns
 * the exit code 2.
 */
export function parseOptions<T extends NonNullable<ParseArgsConfig["options"]>>(
  cmd: string,
  argv: readonly string[],
  options: T,
  usage: string,
  io: Io,
) {
  try {
    return parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (e) {
    io.err(`alukit ${cmd}: ${e instanceof Error ? e.message : String(e)}`);
    io.err(`usage:\n${usage}`);
    return 2 as const;
  }
}

export function usageError(cmd: string, message: string, usage: string, io: Io): 2 {
  io.err(`alukit ${cmd}: ${message}`);
  io.err(`usage:\n${usage}`);
  return 2;
}
