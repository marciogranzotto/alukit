#!/usr/bin/env node
import { run } from "./cli.ts";

// A reader that stops early (`alukit catalog schema | head`) closes the pipe; that is not an
// error of ours, so end quietly instead of crashing on EPIPE.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

const code = await run(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});
process.exitCode = code;
