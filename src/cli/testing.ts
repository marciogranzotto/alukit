import { execFileSync } from "node:child_process";
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

/** Git in a scratch repository: a fixed identity, and none of the machine's hooks or signing. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=AluKit test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}
