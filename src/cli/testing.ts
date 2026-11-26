import { run } from "./cli.ts";

/** Runs the CLI in-process and captures what it prints. */
export async function capture(argv: string[], stdin?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...(stdin !== undefined ? { stdin: async () => stdin } : {}),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
