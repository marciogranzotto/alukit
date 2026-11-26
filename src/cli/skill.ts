import { lstat, mkdir, readlink, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOptions, usageError } from "./args.ts";
import type { Io } from "./cli.ts";
import { publishUsageOf } from "./publish-usage.ts";

/**
 * `alukit skill install [--dir <skills folder>]` (design §7.5): links this checkout's
 * `skills/alukit` into `~/.claude/skills/alukit`, so the skill works from any folder, including
 * the ones where projects live. A link already pointing here is left as it is; anything else at
 * that path (another link, a folder, a file) is refused, never replaced.
 */

const USAGE = publishUsageOf("skill");

/** The skill's folder in this checkout. */
export const SKILL_DIR = fileURLToPath(new URL("../../skills/alukit", import.meta.url));

export async function skillCommand(argv: readonly string[], io: Io): Promise<number> {
  const args = parseOptions("skill", argv, { dir: { type: "string" } }, USAGE, io);
  if (args === 2) return 2;
  const [sub, ...extra] = args.positionals;
  if (sub !== "install") return usageError("skill", "the only subcommand is install", USAGE, io);
  if (extra.length > 0) return usageError("skill", `unexpected argument ${extra[0]}`, USAGE, io);
  const skills = resolve(args.values.dir ?? join(homedir(), ".claude", "skills"));
  const link = join(skills, "alukit");

  let existing: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    existing = await lstat(link);
  } catch {
    existing = undefined;
  }
  if (existing) {
    if (existing.isSymbolicLink()) {
      const target = resolve(dirname(link), await readlink(link));
      if (target === SKILL_DIR) {
        io.out(`${link} already links to ${SKILL_DIR}`);
        return 0;
      }
      io.err(
        `alukit skill install: ${link} links to ${target}, not to ${SKILL_DIR}; remove it first`,
      );
      return 1;
    }
    io.err(`alukit skill install: ${link} exists and is not a link; move it away first`);
    return 1;
  }
  await mkdir(skills, { recursive: true });
  await symlink(SKILL_DIR, link, "dir");
  io.out(`linked ${link} -> ${SKILL_DIR}`);
  return 0;
}
